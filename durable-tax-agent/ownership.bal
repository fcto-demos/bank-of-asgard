import ballerina/jwt;
import ballerina/lang.array;
import ballerina/lang.runtime;
import ballerina/workflow.management;

// What a return was started with, and so who may sign it. A return belongs to the citizen it
// was started for: the `user_sub` the Coordinator sent to /prepare-return, passed to the run
// with the figures as its input (`RunInput`). Temporal writes that input into the run's
// WORKFLOW_EXECUTION_STARTED event before the model runs, and it can never change afterwards.
// So the owner and the figures are read back from there, not from the model's output or from
// anything the caller says, and they survive restarts. A task is matched to its run through its
// `parentWorkflowId`. The officer's inbox shows claims built from the same input.

const string WORKFLOW_STARTED_EVENT = "WORKFLOW_EXECUTION_STARTED";

// Inputs already read, by instance ID. They never change, so entries never go stale.
isolated map<RunInput & readonly> runInputs = {};

// Return numbers already matched to their run. Never stale, for the same reason.
isolated map<string> returnRuns = {};

type RunInput record {|
    // Assigned by the ministry when the return starts; the only handle the model gets on it.
    string returnNumber;
    string citizen;
    decimal grossIncome;
    QualifyingSpend qualifyingSpend;
    string? taxId = ();
|};

// The parts of the start event's attributes that carry the run's input, as Temporal encodes it.
type StartedEventAttributes record {
    StartedEventInput input;
};

type StartedEventInput record {
    StartedEventPayload[] payloads;
};

type StartedEventPayload record {
    string data;
};

// The decoded payload: the agent's query and the structured input passed to `run`.
type StartedRun record {
    RunInput input;
};

# Returns what a return was started with: its citizen and the figures they shared.
#
# + instanceId - The return's instance ID
# + return - The run's input, or an error when it cannot be read
isolated function runInput(string instanceId) returns RunInput & readonly|error {
    lock {
        (RunInput & readonly)? cached = runInputs[instanceId];
        if cached !is () {
            return cached;
        }
    }
    management:HistoryEvent[] events = check management:getWorkflowHistory(instanceId, "");
    if events.length() == 0 || events[0].eventType != WORKFLOW_STARTED_EVENT {
        return error(string `Return ${instanceId} has no start event`);
    }
    StartedEventAttributes attributes = check events[0].attributes.cloneWithType();
    StartedEventPayload[] payloads = attributes.input.payloads;
    if payloads.length() == 0 {
        return error(string `Return ${instanceId} was started without input`);
    }
    byte[] payloadBytes = check array:fromBase64(payloads[0].data);
    string payloadText = check string:fromBytes(payloadBytes);
    StartedRun startedRun = check payloadText.fromJsonStringWithType();
    RunInput & readonly input = startedRun.input.cloneReadOnly();
    lock {
        runInputs[instanceId] = input;
    }
    return input;
}

# Returns what a return was started with, from its return number: how the agent's tools, which
# only ever receive the number, read the figures they assess, file and amend.
#
# + returnNumber - The return number the ministry assigned
# + return - The run's input, or an error when no run of this deployment has that number
isolated function inputForReturn(string returnNumber) returns RunInput & readonly|error {
    string? knownRun;
    lock {
        knownRun = returnRuns[returnNumber];
    }
    if knownRun is string {
        return runInput(knownRun);
    }
    // Not started by this process (another replica, or before a restart): find it in Temporal's
    // visibility index, which lags a run's start by a moment, hence the few retries.
    foreach int attempt in 1 ... RETURN_LOOKUP_ATTEMPTS {
        string|error instanceId = findReturnRun(returnNumber);
        if instanceId is string {
            rememberReturn(returnNumber, instanceId);
            return runInput(instanceId);
        }
        if attempt < RETURN_LOOKUP_ATTEMPTS {
            runtime:sleep(1);
        }
    }
    return error(string `No return with number ${returnNumber}`);
}

const int RETURN_LOOKUP_ATTEMPTS = 5;

# Records which run a return number belongs to, when this process starts the run.
#
# + returnNumber - The return number the ministry assigned
# + instanceId - The run it was started as
isolated function rememberReturn(string returnNumber, string instanceId) {
    lock {
        returnRuns[returnNumber] = instanceId;
    }
}

isolated function findReturnRun(string returnNumber) returns string|error {
    string? pageToken = ();
    while true {
        management:WorkflowInstancePage page = check management:listWorkflowInstances(
                workflowType = TAX_AGENT_WORKFLOW_TYPE, 'limit = 100, pageToken = pageToken,
                taskQueue = management:getWorkflowTaskQueue());
        foreach management:WorkflowInstanceSummary instance in page.items {
            RunInput & readonly|error input = runInput(instance.workflowId);
            if input is RunInput && input.returnNumber == returnNumber {
                return instance.workflowId;
            }
        }
        if !page.hasMore {
            return error(string `No return with number ${returnNumber}`);
        }
        pageToken = page.nextPageToken;
    }
}

# Returns the citizen a return was started for.
#
# + instanceId - The return's instance ID
# + return - The owner's subject identifier, or an error when it cannot be read
isolated function runOwner(string instanceId) returns string|error {
    RunInput input = check runInput(instanceId);
    return input.citizen;
}

# Returns the subject of the bearer token on a request. The token was already validated by the
# resource's declared auth, so it is only decoded here.
#
# + authorization - The request's `Authorization` header (already validated by the resource's auth)
# + return - The token's `sub` claim, or an error when there is none
isolated function callerSubject(string authorization) returns string|error {
    string token = authorization.startsWith("Bearer ") ? authorization.substring(7) : authorization;
    [jwt:Header, jwt:Payload] [_, payload] = check jwt:decode(token);
    string? subject = payload.sub;
    if subject is () {
        return error("The token has no subject");
    }
    return subject;
}

# Whether the caller owns the return a task belongs to.
#
# + parentWorkflowId - The task's run, from its task info
# + callerSub - The caller's subject, from `callerSubject`
# + return - `true` when the caller is the return's owner, or an error when the owner cannot be read
isolated function ownsReturn(string parentWorkflowId, string callerSub) returns boolean|error {
    string owner = check runOwner(parentWorkflowId);
    return owner == callerSub;
}
