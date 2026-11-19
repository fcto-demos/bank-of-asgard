import ballerina/ai;
import ballerina/log;
import ballerina/workflow;

const int TAX_YEAR = 2026;
const string FILING_DEADLINE = "2027-04-30";

final readonly & [decimal?, decimal][] brackets = [[12000, 0.00], [30000, 0.20], [60000, 0.35], [(), 0.45]];

final readonly & map<ReliefRule> reliefRules = {
    medical: {label: "Medical and health expenses", rate: 0.50, cap: 1500, evidenceRequired: false},
    commuting: {label: "Commuting relief", rate: 0.30, cap: 900, evidenceRequired: false},
    home_energy: {label: "Home office and energy relief", rate: 0.20, cap: 600, evidenceRequired: false},
    professional_travel: {label: "Professional travel", rate: 0.25, cap: 1200, evidenceRequired: true}
};

// The model never handles a figure. Each tool takes only the return number the ministry assigned
// when the return was started, and reads the figures the bank sent from the run's recorded input
// (ownership.bal). So what is assessed, signed, filed and amended is always what the citizen
// shared, and a model that passes a wrong number gets an error, never someone else's figures.

# Prepares the draft income tax assessment of a return for the 2026 tax year under the published rules.
# Every figure comes from the published bracket table and relief rules, never from the model.
# + returnNumber - The return number given in the request
# + return - The full assessment: reliefs, deductions, taxable income, tax before and after reliefs, saving and the reliefs that need evidence
@ai:AgentTool
isolated function assessReturn(string returnNumber) returns Assessment|error {
    RunInput input = check inputForReturn(returnNumber);
    return assess(input.grossIncome, input.qualifyingSpend);
}

# Files the tax return with the Ministry of Finance. The citizen must sign the filing before it runs.
# Reliefs that need evidence are granted provisionally, pending an officer's review.
#
# + returnNumber - The return number given in the request
# + return - The filed return with its reference and the reliefs granted provisionally
@workflow:Activity
isolated function fileReturn(string returnNumber) returns FiledReturn|error {
    RunInput input = check inputForReturn(returnNumber);
    Assessment assessment = assess(input.grossIncome, input.qualifyingSpend);
    FiledReturn filed = {
        reference: filingReference(returnNumber),
        taxId: input.taxId,
        taxAfterReliefs: assessment.taxAfterReliefs,
        provisionalReliefs: assessment.evidenceNeeded
    };
    log:printInfo("Tax return filed", reference = filed.reference, taxAfterReliefs = filed.taxAfterReliefs,
            provisionalReliefs = filed.provisionalReliefs);
    return filed;
}

# Amends a filed return by withdrawing its provisional reliefs, after an officer rejected the
# evidence or nobody reviewed it before the deadline. Recomputes the tax without those reliefs.
#
# + returnNumber - The return number given in the request
# + return - The amendment: the reliefs withdrawn, the tax now due and the additional tax
@workflow:Activity
isolated function amendReturn(string returnNumber) returns AmendedReturn|error {
    RunInput input = check inputForReturn(returnNumber);
    Assessment filed = assess(input.grossIncome, input.qualifyingSpend);
    Assessment amended = check withoutProvisionalReliefs(input);
    AmendedReturn amendment = {
        reference: filingReference(returnNumber),
        withdrawnReliefs: filed.evidenceNeeded,
        taxAfterReliefs: amended.taxAfterReliefs,
        additionalTax: (amended.taxAfterReliefs - filed.taxAfterReliefs).round(2)
    };
    log:printInfo("Tax return amended", reference = amendment.reference, withdrawnReliefs = amendment.withdrawnReliefs,
            taxAfterReliefs = amendment.taxAfterReliefs, additionalTax = amendment.additionalTax);
    return amendment;
}

// The return as amended: assessed again without the reliefs that need evidence. Also what the
// Ministry inbox shows an officer as the consequence of rejecting the evidence.
isolated function withoutProvisionalReliefs(RunInput input) returns Assessment|error {
    map<decimal> keptSpend = {};
    foreach [string, decimal] [category, amount] in input.qualifyingSpend.entries() {
        ReliefRule? rule = reliefRules[category];
        if rule is ReliefRule && !rule.evidenceRequired {
            keptSpend[category] = amount;
        }
    }
    QualifyingSpend amendedSpend = check keptSpend.cloneWithType();
    return assess(input.grossIncome, amendedSpend);
}

// Derived from the return number rather than random: filing the same return can only ever
// produce the same reference.
isolated function filingReference(string returnNumber) returns string =>
    string `ASG-${TAX_YEAR}-${returnNumber.substring(0, 8).toUpperAscii()}`;

isolated function assess(decimal grossIncome, QualifyingSpend qualifyingSpend) returns Assessment {
    Relief[] reliefs = computeReliefs(qualifyingSpend);
    decimal totalDeductions = 0;
    string[] evidenceNeeded = [];
    foreach Relief relief in reliefs {
        totalDeductions += relief.deduction;
        if relief.evidenceRequired {
            evidenceNeeded.push(relief.label);
        }
    }
    decimal taxableIncome = decimal:max(grossIncome - totalDeductions, 0).round(2);
    decimal before = taxDue(grossIncome);
    decimal after = taxDue(taxableIncome);
    return {
        taxYear: TAX_YEAR,
        filingDeadline: FILING_DEADLINE,
        grossIncome: grossIncome.round(2),
        reliefs,
        totalDeductions: totalDeductions.round(2),
        taxableIncome,
        taxBeforeReliefs: before,
        taxAfterReliefs: after,
        estimatedSaving: (before - after).round(2),
        marginalRate: marginalRate(taxableIncome),
        evidenceNeeded
    };
}

isolated function computeReliefs(QualifyingSpend qualifyingSpend) returns Relief[] {
    Relief[] reliefs = [];
    foreach [string, ReliefRule] [category, rule] in reliefRules.entries() {
        decimal spend = (qualifyingSpend[category] ?: 0d).round(2);
        if spend <= 0d {
            continue;
        }
        decimal raw = spend * rule.rate;
        reliefs.push({
            category,
            label: rule.label,
            qualifyingSpend: spend,
            rate: rule.rate,
            cap: rule.cap,
            deduction: decimal:min(raw, rule.cap).round(2),
            capped: raw > rule.cap,
            evidenceRequired: rule.evidenceRequired
        });
    }
    return reliefs;
}

isolated function taxDue(decimal taxableIncome) returns decimal {
    decimal remaining = decimal:max(taxableIncome, 0);
    decimal lower = 0;
    decimal total = 0;
    foreach [decimal?, decimal] [upper, rate] in brackets {
        decimal band = upper is decimal ? upper - lower : remaining;
        decimal taxed = decimal:min(remaining, band);
        if taxed <= 0d {
            break;
        }
        total += taxed * rate;
        remaining -= taxed;
        if upper is decimal {
            lower = upper;
        }
    }
    return total.round(2);
}

isolated function marginalRate(decimal taxableIncome) returns decimal {
    foreach [decimal?, decimal] [upper, rate] in brackets {
        if upper is () || taxableIncome < upper {
            return rate;
        }
    }
    return brackets[brackets.length() - 1][1];
}

isolated function toQualifyingSpend(map<decimal> spend) returns QualifyingSpend|error {
    map<decimal> published = {};
    foreach [string, decimal] [category, amount] in spend.entries() {
        if reliefRules.hasKey(category) {
            published[category] = amount;
        }
    }
    return published.cloneWithType();
}
