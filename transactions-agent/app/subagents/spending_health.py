import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

SPENDING_HEALTH_PROMPT = """You are the Spending Health agent, a specialist sub-agent for Bank of Asgard.

You are given a JSON object with per-category debit totals for a recent period and the
period of equal length immediately before it, plus the percentage change for each category.

Your job: write a short, friendly trend narrative (3-5 sentences) for the customer that:
- Highlights the categories with the largest spending increases.
- Notes any categories that decreased meaningfully (worth a quick positive mention).
- Never invents categories or numbers that are not in the provided data.

Be concise and conversational — this will be read directly by the customer."""


def build_graph(llm):
    """Build the Spending Health sub-agent graph. Call once per process."""
    # name= is the gen_ai.agent.name on this sub-agent's INTERNAL invoke_agent span.
    return create_agent(
        llm, [], system_prompt=SPENDING_HEALTH_PROMPT, name="spending_health",
    ).with_config(run_name="spending_health")


def _category_deltas(transactions: list[dict], window_days: int = 45) -> dict:
    """Sum debit amounts by category for the most recent window vs the prior window.
    Deterministic, no LLM involved."""
    debit_dates = [
        datetime.strptime(tx["date"], "%Y-%m-%d")
        for tx in transactions
        if tx.get("type") == "debit"
    ]
    if not debit_dates:
        return {}

    most_recent = max(debit_dates)
    recent_cutoff = most_recent - timedelta(days=window_days)
    prior_cutoff = recent_cutoff - timedelta(days=window_days)

    recent_totals: dict[str, float] = defaultdict(float)
    prior_totals: dict[str, float] = defaultdict(float)

    for tx in transactions:
        if tx.get("type") != "debit":
            continue
        tx_date = datetime.strptime(tx["date"], "%Y-%m-%d")
        category = tx["category"]
        amount = abs(tx["amount"])
        if recent_cutoff < tx_date <= most_recent:
            recent_totals[category] += amount
        elif prior_cutoff < tx_date <= recent_cutoff:
            prior_totals[category] += amount

    deltas = {}
    for category in set(recent_totals) | set(prior_totals):
        recent = round(recent_totals.get(category, 0.0), 2)
        prior = round(prior_totals.get(category, 0.0), 2)
        pct_change = round(((recent - prior) / prior) * 100, 1) if prior else None
        deltas[category] = {
            "recent_total": recent,
            "prior_total": prior,
            "pct_change": pct_change,
        }
    return deltas


async def analyze(graph, transactions: list[dict]) -> str:
    """Compute category spending trends and have the sub-agent phrase a customer-facing summary."""
    deltas = _category_deltas(transactions)
    if not deltas:
        return "I didn't find enough recent spending history to analyze trends."

    logger.info("Spending Health computed deltas for %d categor(y/ies)", len(deltas))
    message = HumanMessage(content=json.dumps(deltas))
    result = await graph.ainvoke({"messages": [message]})
    return result["messages"][-1].content
