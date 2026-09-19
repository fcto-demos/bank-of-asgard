"""Bank-side classification of transactions into the Ministry of Finance's relief buckets.

This is the data-minimisation step in the tax flow. It runs *inside the bank*, over
transactions the user has already consented to the assistant reading, and reduces them to
per-category totals. Only those totals are then sent to the Tax Agent — the ministry never
receives merchants, dates, descriptions, or transaction ids.

Deterministic and LLM-free by design: the model triggers this, but never produces or
restates the numbers (see service.py, which holds the result in session state rather than
round-tripping it through the conversation).

The bucket names must stay in step with tax-agent/tax_rules.py's RELIEF_RULES.
"""

from collections import defaultdict
from typing import TypedDict

# Bank transaction category -> the ministry's published relief bucket. Categories with no
# entry here (dining, groceries, entertainment, shopping, transfer) qualify for nothing and
# are never counted, never sent.
CATEGORY_TO_RELIEF: dict[str, str] = {
    "health": "medical",
    "transport": "commuting",
    "utilities": "home_energy",
    "travel": "professional_travel",
}

INCOME_CATEGORIES = {"salary"}


class DeductionSummary(TypedDict):
    tax_year: int
    gross_income: float
    qualifying_spend: dict[str, float]
    transaction_counts: dict[str, int]
    transactions_considered: int


def summarize_deductible_spend(transactions: list[dict], tax_year: int) -> DeductionSummary:
    """Reduce a transaction list to per-relief-category totals for `tax_year`.

    Debit amounts arrive negative (see transactions-api/app/data.py) and are accumulated
    as positive spend. Credits are only counted as income, never as qualifying spend, so a
    refund can never inflate a relief claim.
    """
    prefix = f"{tax_year}-"
    spend: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    gross_income = 0.0
    considered = 0

    for tx in transactions:
        if not str(tx.get("date", "")).startswith(prefix):
            continue
        considered += 1
        category = tx.get("category")
        amount = float(tx.get("amount", 0.0))

        if category in INCOME_CATEGORIES:
            if amount > 0:
                gross_income += amount
            continue

        bucket = CATEGORY_TO_RELIEF.get(str(category))
        if bucket and amount < 0:
            spend[bucket] += -amount
            counts[bucket] += 1

    return {
        "tax_year": tax_year,
        "gross_income": round(gross_income, 2),
        "qualifying_spend": {k: round(v, 2) for k, v in sorted(spend.items())},
        "transaction_counts": dict(sorted(counts.items())),
        # Only the two fields above ever cross the organisational boundary; this one is
        # kept bank-side, to show how much was examined to produce them.
        "transactions_considered": considered,
    }


def format_summary(summary: DeductionSummary) -> str:
    """Render the aggregates for the model — totals only, matching what gets shared."""
    if not summary["qualifying_spend"]:
        return (
            f"No {summary['tax_year']} spending falls into a relief category "
            f"({summary['transactions_considered']} transactions examined)."
        )
    lines = []
    for bucket, total in summary["qualifying_spend"].items():
        n = summary["transaction_counts"].get(bucket, 0)
        lines.append(f"{bucket}: {total:.2f} across {n} payment{'' if n == 1 else 's'}")
    return (
        f"Tax year {summary['tax_year']}: gross income {summary['gross_income']:.2f}. "
        f"Qualifying spend by relief category — " + "; ".join(lines) + ". "
        f"Examined {summary['transactions_considered']} transactions; "
        f"{len(summary['qualifying_spend'])} category totals will be shared with the "
        f"Ministry of Finance, and no individual transactions."
    )
