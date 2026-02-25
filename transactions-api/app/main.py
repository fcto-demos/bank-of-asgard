import logging
import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Security, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.dependencies import validate_token, TokenData
from app.schemas import TransactionListResponse, ProvisionRequest, Transaction
from app.data import transaction_store, generate_sample_transactions

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Bank of Asgard — Transactions API",
    version="1.0.0",
    description="Secure transactions API protected by Asgardeo JWT validation.",
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Bank of Asgard Transactions API", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/transactions", response_model=TransactionListResponse)
async def get_transactions(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    type: Optional[str] = None,
    limit: int = 50,
    token_data: TokenData = Security(validate_token, scopes=["read_transactions"]),
):
    """
    Return the authenticated user's transactions.

    Identity comes entirely from the OBO token's `sub` claim — the user
    can only ever retrieve their own data. No user_id path parameter is needed.

    If the agent acts on behalf of a user (OBO token), `token_data.sub` is the
    user's identity and `token_data.act.sub` is the agent's client ID.
    """
    user_sub = token_data.sub

    if token_data.act and token_data.act.sub:
        logger.info(
            f"[OBO] Agent '{token_data.act.sub}' fetching transactions for user '{user_sub}'"
        )
    else:
        logger.info(f"[Direct] User '{user_sub}' fetching own transactions")

    txns = transaction_store.get(user_sub, [])

    # Apply optional filters
    if start_date:
        txns = [t for t in txns if t["date"] >= start_date]
    if end_date:
        txns = [t for t in txns if t["date"] <= end_date]
    if type:
        txns = [t for t in txns if t["type"] == type]

    txns = txns[:limit]

    return TransactionListResponse(
        transactions=[Transaction(**t) for t in txns],
        total=len(txns),
        user_sub=user_sub,
    )


@app.post("/admin/provision")
async def provision_transactions(
    req: ProvisionRequest,
    token_data: TokenData = Security(validate_token, scopes=["admin_provision"]),
):
    """
    Seed the in-memory store with realistic demo transactions for a given user_sub.

    Protected by AGENT_TOKEN (client credentials grant) with scope admin_provision.
    This endpoint is for demo setup — not user-facing.
    """
    logger.info(
        f"Provisioning {req.num_transactions} transactions "
        f"for user_sub='{req.user_sub}' (days_back={req.days_back})"
    )

    txns = generate_sample_transactions(
        user_sub=req.user_sub,
        num=req.num_transactions,
        days_back=req.days_back,
    )
    transaction_store[req.user_sub] = txns

    return {
        "status": "ok",
        "provisioned": len(txns),
        "user_sub": req.user_sub,
    }
