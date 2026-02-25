"""
In-memory transaction store and sample data generator.

Transactions are keyed by Asgardeo user `sub` claim.
Use POST /admin/provision to seed demo data for a given user_sub.
"""

import random
import uuid
from datetime import datetime, timedelta
from typing import Dict, List

# In-memory store: user_sub -> list of transaction dicts
transaction_store: Dict[str, List[dict]] = {}

CATEGORIES = [
    "dining", "groceries", "transport", "entertainment",
    "utilities", "shopping", "health", "travel", "salary", "transfer"
]

MERCHANTS = {
    "dining": ["The Golden Tavern", "Valhalla Eats", "Odin's Kitchen", "Norse Bites", "Bifrost Cafe"],
    "groceries": ["Asgard Market", "Thor's Fresh Produce", "Midgard Supermart", "Freya's Organics"],
    "transport": ["Asgard Transit", "Bifrost Ride", "Valkyrie Cab", "Raven Air"],
    "entertainment": ["Asgard Cinema", "Norse Gaming", "Valhalla Arena", "Midgard Music"],
    "utilities": ["Asgard Power Co.", "Bifrost Internet", "Norse Water", "Realm Heating"],
    "shopping": ["Mjolnir Mall", "Aesir Apparel", "Vanaheim Fashion", "Rune Crafts"],
    "health": ["Healing Springs Clinic", "Asgard Pharmacy", "Thor's Gym", "Valkyrie Wellness"],
    "travel": ["Nine Realms Travel", "Bifrost Hotels", "Asgard Airlines", "Midgard Vacations"],
    "salary": ["Asgard Employer Inc."],
    "transfer": ["Bank Transfer"],
}

DEBIT_AMOUNTS = {
    "dining": (12.0, 120.0),
    "groceries": (35.0, 180.0),
    "transport": (5.0, 55.0),
    "entertainment": (10.0, 80.0),
    "utilities": (60.0, 200.0),
    "shopping": (20.0, 250.0),
    "health": (15.0, 200.0),
    "travel": (80.0, 600.0),
}


def generate_sample_transactions(user_sub: str, num: int = 40, days_back: int = 90) -> List[dict]:
    """
    Generate a realistic set of demo transactions for a user.
    Uses random.seed(hash(user_sub)) for deterministic output per user.
    """
    rng = random.Random(abs(hash(user_sub)) % (2 ** 32))

    transactions = []
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)

    balance = rng.uniform(8000.0, 12000.0)
    balance = round(balance, 2)

    # Build a list of (date, type) events spread over the period
    events = []

    # Monthly salary — 1st of each month within range
    current = start_date.replace(day=1)
    while current <= end_date:
        events.append((current, "salary"))
        # Advance to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)

    # Fill remaining slots with random debit categories
    remaining = max(num - len(events), 5)
    debit_cats = ["dining", "groceries", "transport", "entertainment",
                  "utilities", "shopping", "health", "travel"]

    for _ in range(remaining):
        offset = timedelta(days=rng.randint(0, days_back - 1),
                           hours=rng.randint(7, 22),
                           minutes=rng.randint(0, 59))
        tx_date = start_date + offset
        category = rng.choices(
            debit_cats,
            weights=[20, 18, 12, 8, 8, 14, 6, 4],
            k=1
        )[0]
        events.append((tx_date, category))

    # Sort chronologically
    events.sort(key=lambda e: e[0])

    for tx_date, category in events:
        tx_id = f"txn_{uuid.UUID(int=rng.getrandbits(128)).hex[:12]}"
        reference = f"REF{tx_date.strftime('%Y%m%d')}{rng.randint(100, 999)}"

        if category == "salary":
            amount = round(rng.uniform(3800.0, 4800.0), 2)
            tx_type = "credit"
            merchant = "Asgard Employer Inc."
            description = "Monthly salary payment"
            balance = round(balance + amount, 2)
        elif category == "transfer":
            amount = round(rng.uniform(100.0, 1000.0), 2)
            tx_type = "transfer"
            merchant = "Bank Transfer"
            description = "Inter-account transfer"
            balance = round(balance - amount, 2)
        else:
            lo, hi = DEBIT_AMOUNTS[category]
            amount = round(rng.uniform(lo, hi), 2)
            tx_type = "debit"
            merchant = rng.choice(MERCHANTS[category])
            description = f"{category.capitalize()} purchase at {merchant}"
            balance = round(balance - amount, 2)

        transactions.append({
            "id": tx_id,
            "date": tx_date.strftime("%Y-%m-%d"),
            "amount": amount if tx_type == "credit" else -amount,
            "currency": "USD",
            "type": tx_type,
            "category": category,
            "merchant": merchant,
            "description": description,
            "balance_after": balance,
            "reference": reference,
            "status": "completed",
        })

    # Return most recent first
    return list(reversed(transactions))
