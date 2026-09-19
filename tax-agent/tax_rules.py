"""Deterministic tax arithmetic for the Kingdom of Asgard's (fictional) income tax.

Plain arithmetic and published rates only — no LLM involved, the same split as
savings-goals-agent/projections.py. The LLM call in server.py explains and frames
these numbers; it never computes them. This matters for the demo narrative: a tax
authority can state exactly which rules produced a figure, and reproduce it.

Amounts are in the demo's notional currency units.
"""

from typing import TypedDict

TAX_YEAR = 2026
FILING_DEADLINE = "2027-04-30"

# Progressive brackets: (upper_bound, marginal_rate). The final bracket is open-ended.
BRACKETS: list[tuple[float | None, float]] = [
    (12_000.0, 0.00),
    (30_000.0, 0.20),
    (60_000.0, 0.35),
    (None, 0.45),
]

# Per-category relief rules, keyed by the deduction bucket names that the bank side
# produces (see transactions-agent/app/tax.py — the two must stay in step).
#   rate:              share of qualifying spend that is deductible
#   cap:               maximum deduction for the category, per year
#   evidence_required: the citizen must attach receipts before filing
class ReliefRule(TypedDict):
    label: str
    rate: float
    cap: float
    evidence_required: bool


RELIEF_RULES: dict[str, ReliefRule] = {
    "medical": {
        "label": "Medical and health expenses",
        "rate": 0.50,
        "cap": 1_500.0,
        "evidence_required": False,
    },
    "commuting": {
        "label": "Commuting relief",
        "rate": 0.30,
        "cap": 900.0,
        "evidence_required": False,
    },
    "home_energy": {
        "label": "Home office and energy relief",
        "rate": 0.20,
        "cap": 600.0,
        "evidence_required": False,
    },
    "professional_travel": {
        "label": "Professional travel",
        "rate": 0.25,
        "cap": 1_200.0,
        "evidence_required": True,
    },
}


class Relief(TypedDict):
    category: str
    label: str
    qualifying_spend: float
    rate: float
    cap: float
    deduction: float
    capped: bool
    evidence_required: bool


def compute_reliefs(qualifying_spend: dict[str, float]) -> list[Relief]:
    """Apply the published per-category rules to bank-side spend aggregates.

    Unknown categories are ignored rather than guessed at: the ministry only grants
    relief for rules it actually publishes.
    """
    reliefs: list[Relief] = []
    for category, rule in RELIEF_RULES.items():
        spend = round(float(qualifying_spend.get(category, 0.0)), 2)
        if spend <= 0:
            continue
        raw = spend * rule["rate"]
        deduction = round(min(raw, rule["cap"]), 2)
        reliefs.append({
            "category": category,
            "label": rule["label"],
            "qualifying_spend": spend,
            "rate": rule["rate"],
            "cap": rule["cap"],
            "deduction": deduction,
            "capped": raw > rule["cap"],
            "evidence_required": rule["evidence_required"],
        })
    return reliefs


def tax_due(taxable_income: float) -> float:
    """Total tax on `taxable_income` under the progressive bracket table."""
    remaining = max(taxable_income, 0.0)
    lower = 0.0
    total = 0.0
    for upper, rate in BRACKETS:
        band = (upper - lower) if upper is not None else remaining
        taxed = min(remaining, band)
        if taxed <= 0:
            break
        total += taxed * rate
        remaining -= taxed
        if upper is not None:
            lower = upper
    return round(total, 2)


def marginal_rate(taxable_income: float) -> float:
    """The rate applying to the next unit of income — what a deduction is worth."""
    for upper, rate in BRACKETS:
        if upper is None or taxable_income < upper:
            return rate
    return BRACKETS[-1][1]


class Assessment(TypedDict):
    tax_year: int
    filing_deadline: str
    gross_income: float
    reliefs: list[Relief]
    total_deductions: float
    taxable_income: float
    tax_before_reliefs: float
    tax_after_reliefs: float
    estimated_saving: float
    marginal_rate: float
    evidence_needed: list[str]


def assess(gross_income: float, qualifying_spend: dict[str, float]) -> Assessment:
    """Full assessment: reliefs, taxable income, and what the reliefs are worth."""
    reliefs = compute_reliefs(qualifying_spend)
    total_deductions = round(sum(r["deduction"] for r in reliefs), 2)
    taxable_income = round(max(gross_income - total_deductions, 0.0), 2)
    before = tax_due(gross_income)
    after = tax_due(taxable_income)
    return {
        "tax_year": TAX_YEAR,
        "filing_deadline": FILING_DEADLINE,
        "gross_income": round(gross_income, 2),
        "reliefs": reliefs,
        "total_deductions": total_deductions,
        "taxable_income": taxable_income,
        "tax_before_reliefs": before,
        "tax_after_reliefs": after,
        "estimated_saving": round(before - after, 2),
        "marginal_rate": marginal_rate(taxable_income),
        "evidence_needed": [r["label"] for r in reliefs if r["evidence_required"]],
    }
