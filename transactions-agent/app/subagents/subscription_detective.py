import json
import logging
from collections import defaultdict
from datetime import datetime
from typing import Any

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

SUBSCRIPTION_DETECTIVE_PROMPT = """You are the Subscription Detective, a specialist sub-agent for Bank of Asgard.

You are given a JSON list of recurring charges already detected in a customer's transaction
history (same merchant and amount, charged roughly monthly, 3 or more times). Each entry has
merchant, amount, count (number of occurrences), first_seen, and last_seen dates.

Your job: write a short, friendly summary (3-6 sentences) for the customer that:
- Lists the recurring charges found, with their monthly amount.
- Calls out any that look like small discretionary subscriptions (entertainment, shopping,
  wellness/fitness — as opposed to essential utilities) as worth double-checking, since these
  are easy to forget about.
- States the total monthly amount across all flagged-as-worth-checking subscriptions.
- Never invents charges that are not in the provided data.

Be concise and conversational — this will be read directly by the customer."""


def build_graph(llm):
    """Build the Subscription Detective sub-agent graph. Call once per process."""
    graph = create_agent(llm, [], system_prompt=SUBSCRIPTION_DETECTIVE_PROMPT)
    return graph.with_config(run_name="subscription_detective")


def _detect_recurring(transactions: list[dict]) -> list[dict]:
    """Group debit transactions by (merchant, amount) and flag groups that recur
    roughly monthly 3+ times. Deterministic, no LLM involved."""
    groups: dict[tuple[str, float], list[str]] = defaultdict(list)
    for tx in transactions:
        if tx.get("type") != "debit":
            continue
        key = (tx["merchant"], round(abs(tx["amount"]), 2))
        groups[key].append(tx["date"])

    recurring: list[dict[str, Any]] = []
    for (merchant, amount), dates in groups.items():
        if len(dates) < 3:
            continue
        sorted_dates = sorted(datetime.strptime(d, "%Y-%m-%d") for d in dates)
        gaps = [
            (sorted_dates[i + 1] - sorted_dates[i]).days
            for i in range(len(sorted_dates) - 1)
        ]
        avg_gap = sum(gaps) / len(gaps)
        if 25 <= avg_gap <= 35:
            recurring.append({
                "merchant": merchant,
                "amount": amount,
                "count": len(sorted_dates),
                "first_seen": sorted_dates[0].strftime("%Y-%m-%d"),
                "last_seen": sorted_dates[-1].strftime("%Y-%m-%d"),
            })

    recurring.sort(key=lambda r: r["amount"], reverse=True)
    return recurring


async def analyze(graph, transactions: list[dict]) -> str:
    """Detect recurring charges and have the sub-agent phrase a customer-facing summary."""
    recurring = _detect_recurring(transactions)
    if not recurring:
        return "I didn't find any recurring monthly charges in your recent transaction history."

    logger.info("Subscription Detective found %d recurring charge(s)", len(recurring))
    message = HumanMessage(content=json.dumps(recurring))
    result = await graph.ainvoke({"messages": [message]})
    return result["messages"][-1].content
