import ballerina/time;
import ballerina/workflow;
import ballerina/workflow.management;

// What the Coordinator, the citizen and the officer read about returns. Everything here comes
// from what Temporal recorded: the run's input (ownership.bal) and the results of its activities.

// This agent's runs, as the instance listing names them. (Temporal's own history calls the type
// `workflow-taxAgent`; the listing filter takes the agent's name.)
const string TAX_AGENT_WORKFLOW_TYPE = "taxAgent";
const string EVIDENCE_REVIEW_TASK = "evidenceReview";
const string PENDING = "PENDING";

# Returns a return's progress: filed or not, amended or not, and the final summary once done.
# The filing and the amendment are the recorded results of fileReturn and amendReturn in the run's
# activity tree, so they show as soon as each runs, while the run may still wait on the officer.
#
# + instanceId - The return's instance ID
# + return - The return's status, or an error
isolated function returnStatus(string instanceId) returns ReturnStatus|error {
    ReturnStatus status = {instanceId, status: "in progress"};
    management:ActivityTreeNode[] nodes = check management:getActivityTree(instanceId, "");
    foreach management:ActivityTreeNode node in nodes {
        anydata output = node.output;
        if node.'type != management:ACTIVITY || node.status != "COMPLETED" || output is () {
            continue;
        }
        if node.name == "fileReturn" {
            status.filing = check output.cloneWithType();
        } else if node.name == "amendReturn" {
            status.amendment = check output.cloneWithType();
        }
    }
    string|error summary = taxAgent.getResult(instanceId);
    if summary is workflow:AgentBusyError {
        return status;
    }
    status.status = "completed";
    status.summary = check summary;
    return status;
}

# Returns the returns started for a citizen, most recent first.
#
# + citizen - The citizen's subject identifier
# + return - Their returns' status, or an error
isolated function citizenReturns(string citizen) returns ReturnStatus[]|error {
    management:WorkflowInstancePage page = check management:listWorkflowInstances(
            workflowType = TAX_AGENT_WORKFLOW_TYPE, 'limit = 100, taskQueue = management:getWorkflowTaskQueue());
    ReturnStatus[] citizenReturnList = [];
    foreach management:WorkflowInstanceSummary instance in page.items {
        RunInput|error input = runInput(instance.workflowId);
        if input is RunInput && input.citizen == citizen {
            citizenReturnList.push(check returnStatus(instance.workflowId));
        }
    }
    return citizenReturnList;
}

# Returns the signature steps waiting for a return's citizen, with the assessment of exactly what
# will be filed: the run's recorded input.
#
# + instanceId - The return's instance ID
# + return - The pending steps, or an error
isolated function citizenSteps(string instanceId) returns CitizenSteps|error {
    management:ReviewActivitySummary[] approvals = check management:listPendingReviewActivities(instanceId);
    CitizenStep[] steps = [];
    foreach management:ReviewActivitySummary approval in approvals {
        if !approval.activityName.endsWith("fileReturn") {
            continue;
        }
        RunInput input = check runInput(instanceId);
        steps.push({
            taskId: approval.taskId,
            kind: "filing",
            title: approval.title,
            assessment: assess(input.grossIncome, input.qualifyingSpend)
        });
    }
    return {steps};
}

# Returns the evidence reviews waiting for an officer, built from each run's recorded input.
#
# + return - The open claims, or an error
isolated function officerClaims() returns OfficerClaims|error {
    // This deployment's task queue only: other deployments may share the Temporal namespace.
    management:HumanTaskSummary[] tasks = check management:listAllHumanTasks(status = PENDING,
            taskQueue = management:getWorkflowTaskQueue());
    OfficerClaim[] claims = [];
    foreach management:HumanTaskSummary task in tasks {
        if !task.taskName.endsWith(EVIDENCE_REVIEW_TASK) {
            continue;
        }
        RunInput input = check runInput(task.parentWorkflowId);
        Assessment assessment = assess(input.grossIncome, input.qualifyingSpend);
        Assessment withdrawn = check withoutProvisionalReliefs(input);
        claims.push({
            taskId: task.taskId,
            instanceId: task.parentWorkflowId,
            filingReference: filingReference(input.returnNumber),
            citizen: input.citizen,
            openedAt: task.startTime,
            deadline: check reviewDeadline(task.startTime),
            claims: from Relief relief in assessment.reliefs
                where relief.evidenceRequired
                select relief,
            assessment,
            taxIfWithdrawn: withdrawn.taxAfterReliefs,
            additionalTaxIfWithdrawn: (withdrawn.taxAfterReliefs - assessment.taxAfterReliefs).round(2)
        });
    }
    return {claims};
}

isolated function reviewDeadline(string openedAt) returns string|error {
    time:Utc opened = check time:utcFromString(openedAt);
    return time:utcToString(time:utcAddSeconds(opened, <decimal>(reviewDeadlineMinutes * 60)));
}
