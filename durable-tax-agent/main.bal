import ballerina/http;
import ballerina/log;
import ballerina/uuid;
import ballerina/workflow.management;
import ballerinax/amp as _;

service /tax\-agent on new http:Listener(8014) {

    resource function get health() returns json {
        return {status: "healthy"};
    }

    // --- The bank's Coordinator (agent token): start and follow returns ---

    @http:ResourceConfig {auth: coordinatorAuth}
    resource function post prepare\-return(@http:Payload PrepareReturnRequest request) returns ReturnRef|error {
        QualifyingSpend qualifyingSpend = check toQualifyingSpend(request.qualifying_spend);
        // The figures go to the run's input only. The model gets the return number, and the
        // tools read the figures from the recorded input with it (functions.bal).
        RunInput runInput = {
            returnNumber: uuid:createType4AsString(),
            citizen: request.user_sub,
            grossIncome: request.gross_income,
            qualifyingSpend,
            taxId: request.tax_id
        };
        string instanceId = check taxAgent.run(
                string `Prepare and file the 2026 tax return number ${runInput.returnNumber}.`, runInput.toJson());
        rememberReturn(runInput.returnNumber, instanceId);
        return {instanceId, assessment: assess(request.gross_income, qualifyingSpend)};
    }

    @http:ResourceConfig {auth: coordinatorAuth}
    resource function get tax\-returns/[string instanceId]() returns ReturnStatus|error {
        return returnStatus(instanceId);
    }

    @http:ResourceConfig {auth: coordinatorAuth}
    resource function get tax\-returns/[string instanceId]/tasks() returns CitizenSteps|error {
        return citizenSteps(instanceId);
    }

    // --- The citizen (their own token, through the Coordinator) ---

    @http:ResourceConfig {auth: citizenAuth}
    resource function post approvals/[string taskId](@http:Header {name: "Authorization"} string authorization,
            @http:Payload management:ReviewDecision decision) returns http:Accepted|http:Forbidden|error {
        string callerSub = check callerSubject(authorization);
        management:ReviewActivityInfo approval = check management:getReviewActivityInfo(taskId);
        if !check ownsReturn(approval.parentWorkflowId, callerSub) {
            log:printWarn("Refused a filing signature from someone other than the return's citizen",
                    taskId = taskId, instanceId = approval.parentWorkflowId);
            return http:FORBIDDEN;
        }
        check signFiling(taskId, decision, callerSub);
        return http:ACCEPTED;
    }

    @http:ResourceConfig {auth: citizenAuth}
    resource function get my/tax\-returns(@http:Header {name: "Authorization"} string authorization)
            returns ReturnStatus[]|error {
        return citizenReturns(check callerSubject(authorization));
    }

    // --- A tax officer (their own token, from the Ministry inbox) ---

    @http:ResourceConfig {auth: officerAuth}
    resource function get officer/claims() returns OfficerClaims|error {
        return officerClaims();
    }

    @http:ResourceConfig {auth: officerAuth}
    resource function post officer/claims/[string taskId](@http:Header {name: "Authorization"} string authorization,
            @http:Payload EvidenceReview review) returns http:Accepted|http:Forbidden|error {
        string officerSub = check callerSubject(authorization);
        management:HumanTaskInfo task = check management:getHumanTaskInfo(taskId);
        // Separation of duties: nobody reviews the evidence for their own return.
        if check ownsReturn(task.parentWorkflowId, officerSub) {
            log:printWarn("Refused an officer's review of their own return", taskId = taskId,
                    instanceId = task.parentWorkflowId);
            return http:FORBIDDEN;
        }
        check recordReview(taskId, review, officerSub);
        log:printInfo("Evidence reviewed", taskId = taskId, instanceId = task.parentWorkflowId,
                accepted = review.accepted);
        return http:ACCEPTED;
    }

    // --- The Ministry inbox page (public; it signs the officer in, then calls the officer API) ---

    resource function get inbox() returns http:Response {
        http:Response response = new;
        response.setTextPayload(INBOX_PAGE, contentType = "text/html; charset=utf-8");
        return response;
    }

    resource function get inbox/config() returns InboxConfig {
        return {
            idpBaseUrl,
            clientId: expectedAudience,
            scope: officerScope,
            taxYear: TAX_YEAR,
            filingDeadline: FILING_DEADLINE,
            reliefs: from [string, ReliefRule] [category, rule] in reliefRules.entries()
                select {category, ...rule},
            reviewDeadlineMinutes
        };
    }
}
