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

# Recurring monthly charges: (merchant, category, amount, months_active, forgettable).
# A mix of legitimate ongoing utilities and small discretionary subscriptions that are
# easy to forget about — the latter is what a "subscription detective" feature should
# surface. `forgettable` isn't used by the generator itself; it documents intent for
# whatever analyzes this data later.
SUBSCRIPTIONS = [
    ("Bifrost Internet",      "utilities",     64.99, 12, False),
    ("Realm Heating",         "utilities",     89.00, 12, False),
    ("Norse Gaming Plus",     "entertainment", 13.99, 11, True),
    ("Midgard Music Premium", "entertainment",  9.99, 14, True),
    ("Thor's Gym Membership", "health",        42.00,  8, True),
    ("Asgard Cloud Storage",  "shopping",        4.99, 16, True),
    ("Valkyrie Wellness Box", "health",        24.99,  6, True),
]


def _months_before(dt: datetime, i: int) -> datetime:
    """First-of-month date `i` months before dt's month (i=0 → dt's own month)."""
    month_index = dt.month - 1 - i
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    return dt.replace(year=year, month=month, day=1)


def _subscription_events(user_sub: str, rng: random.Random, end_date: datetime,
                          subscription_months: int) -> List[tuple]:
    """Build one event per month for each SUBSCRIPTIONS entry, going back up to
    min(months_active, subscription_months) months from end_date, on a per-user
    deterministic day-of-month with +/-1 day jitter. The current month's charge is
    included if it has already occurred (charge_date <= end_date)."""
    events = []
    for merchant, category, amount, months_active, _forgettable in SUBSCRIPTIONS:
        months = min(months_active, subscription_months)
        day_of_month = 1 + (abs(hash((user_sub, merchant))) % 28)
        for i in range(months):
            month_first = _months_before(end_date, i)
            charge_date = month_first.replace(day=day_of_month)
            jitter = timedelta(days=rng.randint(-1, 1), hours=rng.randint(7, 22))
            charge_date = charge_date + jitter
            if charge_date <= end_date:
                events.append((charge_date, "subscription", merchant, category, amount))
    return events


def _business_trip_events(rng: random.Random, end_date: datetime) -> List[tuple]:
    """A business trip in the last 60 days: a return flight, then a two- or three-night
    hotel stay. Every user has one, so their tax return always claims professional travel
    relief, which needs evidence: the ministry files it provisionally and opens an officer
    review (the durable Tax Agent's demo path)."""
    depart = end_date - timedelta(days=rng.randint(10, 60), hours=rng.randint(0, 12))
    nights = rng.randint(2, 3)
    return [
        (depart, "business_travel", "Asgard Airlines", round(rng.uniform(380.0, 620.0), 2),
         "Business trip: return flight, Asgard Airlines"),
        (depart + timedelta(days=nights, hours=2), "business_travel", "Bifrost Hotels",
         round(rng.uniform(140.0, 210.0) * nights, 2),
         f"Business trip: {nights} nights, Bifrost Hotels"),
    ]


def generate_sample_transactions(
    user_sub: str,
    num: int = 40,
    days_back: int = 90,
    subscription_months: int = 12,
) -> List[dict]:
    """
    Generate a realistic set of demo transactions for a user.
    Uses random.seed(hash(user_sub)) for deterministic output per user.

    Recent one-off purchases and salary stay within `days_back` (unchanged behavior).
    Recurring subscriptions independently reach back up to `subscription_months` months,
    giving long-running monthly patterns for subscription-detection use cases. Every user
    also has one business trip in the last 60 days (see _business_trip_events).
    """
    rng = random.Random(abs(hash(user_sub)) % (2 ** 32))

    transactions = []
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)

    balance = rng.uniform(8000.0, 12000.0)
    balance = round(balance, 2)

    # Build a list of (date, type[, merchant, category, amount]) events spread over the period
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
            weights=[20, 18, 12, 8, 8, 14, 6, 8],
            k=1
        )[0]
        events.append((tx_date, category))

    # Recurring subscriptions — independent of days_back, can reach back much further
    events.extend(_subscription_events(user_sub, rng, end_date, subscription_months))
    events.extend(_business_trip_events(rng, end_date))

    # Sort chronologically
    events.sort(key=lambda e: e[0])

    for event in events:
        tx_date, category, *_ = event
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
        elif category == "subscription":
            _, _, merchant, real_category, amount = event
            category = real_category
            tx_type = "debit"
            description = f"Recurring subscription — {merchant}"
            balance = round(balance - amount, 2)
        elif category == "business_travel":
            _, _, merchant, amount, description = event
            category = "travel"
            tx_type = "debit"
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
