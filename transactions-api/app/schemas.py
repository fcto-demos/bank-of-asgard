from pydantic import BaseModel
from typing import List, Optional


class Transaction(BaseModel):
    id: str
    date: str
    amount: float
    currency: str
    type: str           # "debit" | "credit" | "transfer"
    category: str
    merchant: str
    description: str
    balance_after: float
    reference: str
    status: str         # "completed" | "pending" | "failed"


class TransactionListResponse(BaseModel):
    transactions: List[Transaction]
    total: int
    user_sub: str


class ProvisionRequest(BaseModel):
    user_sub: str
    num_transactions: Optional[int] = 40
    days_back: Optional[int] = 90
