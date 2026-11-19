type QualifyingSpend record {|
    decimal medical?;
    decimal commuting?;
    decimal home_energy?;
    decimal professional_travel?;
|};

type ReliefRule record {|
    string label;
    decimal rate;
    decimal cap;
    boolean evidenceRequired;
|};

type Relief record {|
    string category;
    string label;
    decimal qualifyingSpend;
    decimal rate;
    decimal cap;
    decimal deduction;
    boolean capped;
    boolean evidenceRequired;
|};

type Assessment record {|
    int taxYear;
    string filingDeadline;
    decimal grossIncome;
    Relief[] reliefs;
    decimal totalDeductions;
    decimal taxableIncome;
    decimal taxBeforeReliefs;
    decimal taxAfterReliefs;
    decimal estimatedSaving;
    decimal marginalRate;
    string[] evidenceNeeded;
|};

// What fileReturn records. Reliefs that need evidence are granted provisionally: they stand
// until an officer rejects them or the review deadline passes, and amendReturn withdraws them.
type FiledReturn record {|
    string reference;
    string? taxId;
    decimal taxAfterReliefs;
    string[] provisionalReliefs;
|};

// What amendReturn records: the provisional reliefs withdrawn and the tax due without them.
type AmendedReturn record {|
    string reference;
    string[] withdrawnReliefs;
    decimal taxAfterReliefs;
    decimal additionalTax;
|};

// The officer's answer to an evidence review.
type EvidenceReview record {|
    boolean accepted;
    string note?;
|};

type PrepareReturnRequest record {|
    decimal gross_income;
    map<decimal> qualifying_spend;
    // Optional: the bank has no tax ID attribute for its users, so its Coordinator omits it.
    string tax_id?;
    // The citizen the return is for: the `sub` of their own token at the bank's identity
    // provider. Only that citizen's token can sign the return (ownership.bal).
    string user_sub;
    string transaction_id?;
|};

type ReturnRef record {|
    string instanceId;
    Assessment assessment;
|};

// A return's progress as the Coordinator and the citizen see it. `filing` and `amendment` come
// from the recorded results of fileReturn and amendReturn, so they appear as soon as each runs,
// while the run itself may still be waiting on the officer.
type ReturnStatus record {|
    string instanceId;
    string status;
    FiledReturn? filing = ();
    AmendedReturn? amendment = ();
    string? summary = ();
|};

// A step waiting for the citizen: the signature that gates fileReturn. `assessment` is computed
// from the run's recorded input, which is exactly what fileReturn files.
type CitizenStep record {|
    string taskId;
    string kind;
    string title;
    Assessment assessment;
|};

type CitizenSteps record {|
    CitizenStep[] steps;
|};

// A claim waiting for an officer, built from the run's recorded input, never from the model.
type OfficerClaim record {|
    string taskId;
    string instanceId;
    // The filed return's reference, as the citizen was given it.
    string filingReference;
    string citizen;
    string openedAt;
    string deadline;
    Relief[] claims;
    Assessment assessment;
    // What rejecting the evidence (or letting the deadline pass) does: the tax due once the
    // provisional reliefs are withdrawn, and the increase over the return as filed.
    decimal taxIfWithdrawn;
    decimal additionalTaxIfWithdrawn;
|};

type OfficerClaims record {|
    OfficerClaim[] claims;
|};

type InboxConfig record {|
    string idpBaseUrl;
    string clientId;
    string scope;
    // Public information for the ministry's home page: the tax year, its filing deadline, the
    // published reliefs, and how long an officer has to review evidence.
    int taxYear;
    string filingDeadline;
    PublishedRelief[] reliefs;
    int reviewDeadlineMinutes;
|};

type PublishedRelief record {|
    *ReliefRule;
    string category;
|};
