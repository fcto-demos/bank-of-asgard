import ballerina/workflow;

// The workflow roles this agent's human steps are declared for. They are granted by the HTTP
// service only after it has checked the caller's own token (main.bal), never taken from a request.
const string CITIZEN_ROLE = "citizen";
const string OFFICER_ROLE = "tax-officer";

// Filing and amending are retried durably on failure rather than handed back to the model: a
// transient failure (the ministry's lookups, Temporal) must not end a run with a provisional relief
// that was never reviewed. Both are safe to rerun: their results depend only on the return number.
final readonly & workflow:AutoRetry ACTIVITY_RETRIES = {maxRetries: 5, retryDelay: 2, retryBackoff: 2.0};

final workflow:DurableAgent taxAgent = check new ({
    systemPrompt: {
        role: string `Tax Filing Agent`,
        instructions: string `You are the Tax Filing agent for the Kingdom of Asgard's Ministry of Finance. You prepare and file a citizen's income tax return for the 2026 tax year, then see any provisional relief through the ministry's evidence review.

Follow these steps one at a time, calling one tool per turn. Every tool takes the return number given in the request; pass it exactly as given. You never handle the citizen's figures yourself: the tools read them from the return.
1. Call assessReturn.
2. Call fileReturn. The citizen must sign the filing, so it may take a while to return. If the citizen declines, the return is not filed: stop and finish with that outcome.
3. If fileReturn returned any provisionalReliefs, call evidenceReview so a tax officer reviews the evidence for them. Pass the return number, the filing reference and the provisional reliefs. It may take a long time to return.
4. If the officer did not accept the evidence (accepted is false), or the review ended without an answer because its deadline passed (the tool returns an error), call amendReturn. Do this every time the evidence is not accepted: provisional reliefs must never stand without an accepted review.
5. Finish with the outcome.

Every number comes from the tools under the published rules. Never compute, adjust, round or invent a figure; quote them exactly as returned. Write figures as plain numbers with no currency symbol.

Your final message is a short, plain-language summary (4-6 sentences) for the citizen that states whether the return was filed and its filing reference, which reliefs were applied and their total, and the tax due. Mention the filing deadline only if the return was not filed: once it is filed, the deadline no longer concerns the citizen. If reliefs were provisional, say whether the officer confirmed them or they were withdrawn, and if withdrawn, why (rejected, or no review before the deadline) and the additional tax. Be factual and neutral in tone: this is a government service. Never promise an outcome, and never advise the citizen how to reduce tax further.`
    },
    model: taxAgentModel,
    tools: [assessReturn],
    activities: [
        {
            activity: fileReturn,
            description: "Files the tax return with the Ministry of Finance. The citizen must sign the filing before it runs. Reliefs that need evidence are granted provisionally.",
            approvalPolicy: {userRoles: CITIZEN_ROLE, title: "Sign and file your tax return"},
            retryPolicy: ACTIVITY_RETRIES
        },
        {
            activity: amendReturn,
            description: "Withdraws a filed return's provisional reliefs after their evidence was not accepted, and recomputes the tax due.",
            retryPolicy: ACTIVITY_RETRIES
        }
    ],
    humanTasks: {
        evidenceReview: {
            userRoles: OFFICER_ROLE,
            title: "Review evidence for a provisional relief",
            description: "Check the citizen's evidence for the reliefs granted provisionally, then accept or reject it.",
            resultType: EvidenceReview,
            timeout: {minutes: reviewDeadlineMinutes}
        }
    }
});
