import ballerina/workflow.management;

// Task decisions go through here one at a time. ballerina/workflow 0.10.1 crashed this whole
// process when several decisions were logged at the same instant (an InvalidUpdate panic in its
// decision audit, TaskDecisionSpan.audit -> log:printInfo), taking every waiting return's polling
// down with it. Decisions are rare, so serializing them costs nothing.
isolated int decisionsMade = 0;

# Records the citizen's signature (or refusal) on a filing.
#
# + taskId - The filing approval's task ID
# + decision - Proceed or reject
# + citizenSub - The citizen's subject, already checked to own the return
# + return - An error if the workflow refused the decision
isolated function signFiling(string taskId, management:ReviewDecision decision, string citizenSub) returns error? {
    management:ReviewDecision & readonly frozenDecision = decision.cloneReadOnly();
    lock {
        decisionsMade += 1;
        check management:completeReviewActivity(taskId, frozenDecision, callerRoles = [CITIZEN_ROLE],
                userId = citizenSub);
    }
}

# Records an officer's review of the evidence for a return's provisional reliefs.
#
# + taskId - The evidence review's task ID
# + review - Accepted or not, with an optional note
# + officerSub - The officer's subject, already checked not to own the return
# + return - An error if the workflow refused the review
isolated function recordReview(string taskId, EvidenceReview review, string officerSub) returns error? {
    EvidenceReview & readonly frozenReview = review.cloneReadOnly();
    lock {
        decisionsMade += 1;
        check management:completeHumanTask(taskId, frozenReview, callerRoles = [OFFICER_ROLE], userId = officerSub);
    }
}
