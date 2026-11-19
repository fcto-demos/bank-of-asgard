"""Follow a durable tax return to completion, relaying its human steps to the chat UI.

The Ministry of Finance's durable Tax Agent (durable-tax-agent/, Ballerina + Temporal)
answers PrepareTaxReturn with a run ID and a draft assessment, then waits for the citizen's
signature on the filing. Nothing on the ministry side can reach the citizen, so the
Coordinator does it: TaxReturnFollowUp polls the run, sends the signature step to this
session's chat as a `tax_task` message (rendered like the OBO consent panel), and forwards
the citizen's click back to the ministry.

After filing, reliefs that need evidence stand provisionally while a ministry officer
reviews them, which can take far longer than a chat session. The Coordinator posts the
filing as soon as it happens, and the ministry's final outcome (relief confirmed, or
withdrawn and the return amended) if it arrives while the session is still open. Otherwise
the citizen asks later, and CheckMyTaxReturns reads it from the ministry.

Two credentials, one per kind of call:
- Starting and following a return (status, pending steps) carries the Coordinator's own
  agent token for the Tax Agent. The token from the PrepareTaxReturn call is reused for
  polling and a fresh one is fetched only after a 401: the auth manager writes a
  token-audit event on every lookup, cache hits included, and a lookup every poll would
  flood the Token Flow page.
- Answering a step carries the CITIZEN's own delegated (OBO) token for the Tax Agent,
  obtained through their consent (TAX_FILING_SCOPE). The ministry only accepts an answer
  from the citizen the return was started for (durable-tax-agent/ownership.bal), so the
  bank can prepare a return but cannot confirm or file it for them. The consent prompt
  appears on the first answer; the token is cached for the next one.
"""

import asyncio
import base64
import json
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from typing import Any, Literal

import httpx
from asgardeo.models import OAuthToken
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2.0
# Consecutive failed polls (ministry down, run failed) before giving up on a run.
MAX_POLL_FAILURES = 5
REQUEST_TIMEOUT_SECONDS = 30.0

# The only step the citizen answers: signing the filing. The evidence review is the officer's.
TaxTaskKind = Literal["filing"]


class TaxTaskMessage(BaseModel):
    """A ministry step waiting for the citizen, sent to the chat UI."""

    type: Literal["tax_task"] = "tax_task"
    task_id: str
    kind: TaxTaskKind
    title: str
    description: str
    # The reliefs that will stand only provisionally until an officer reviews their evidence,
    # and the figures the citizen is asked to sign. Both come from the ministry's own
    # assessment of exactly what the agent proposed to file.
    evidence_needed: list[str] = []
    figures: dict[str, float] = {}


class TaxTaskDecision(BaseModel):
    """The citizen's answer to a TaxTaskMessage, sent back by the chat UI."""

    type: Literal["tax_task_decision"]
    task_id: str
    approve: bool


def parse_decision(text: str) -> TaxTaskDecision | None:
    """The chat socket carries plain user text; a decision is a JSON object of its own
    type. Anything that isn't one is a chat message."""
    if not text.lstrip().startswith("{"):
        return None
    try:
        return TaxTaskDecision.model_validate_json(text)
    except ValidationError:
        return None


class TaxAgentApi:
    """The durable Tax Agent's HTTP API, relative to TAX_AGENT_URL (its base path)."""

    def __init__(self, base_url: str, ssl_verify: bool):
        self._base_url = base_url.rstrip("/")
        self._ssl_verify = ssl_verify

    @property
    def prepare_url(self) -> str:
        return f"{self._base_url}/prepare-return"

    async def _request(
        self, method: str, path: str, token: OAuthToken,
        json_body: Any = None, headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = {"Authorization": f"Bearer {token.access_token}"} | (headers or {})
        async with httpx.AsyncClient(verify=self._ssl_verify) as client:
            response = await client.request(
                method, f"{self._base_url}{path}", headers=request_headers,
                json=json_body, timeout=REQUEST_TIMEOUT_SECONDS,
            )
        response.raise_for_status()
        return response

    async def prepare_return(
        self, token: OAuthToken, payload: dict, headers: dict[str, str],
    ) -> dict:
        response = await self._request("POST", "/prepare-return", token, payload, headers)
        return response.json()

    async def pending_tasks(self, token: OAuthToken, instance_id: str) -> dict:
        response = await self._request("GET", f"/tax-returns/{instance_id}/tasks", token)
        return response.json()

    async def status(self, token: OAuthToken, instance_id: str) -> dict:
        response = await self._request("GET", f"/tax-returns/{instance_id}", token)
        return response.json()

    async def complete(
        self, token: OAuthToken, task_id: str, kind: TaxTaskKind, approve: bool,
    ) -> None:
        """Sign (or decline) a filing. `token` must be the citizen's own: the ministry checks
        it belongs to the citizen the return was started for and answers 403 otherwise."""
        body: dict = {"action": "proceed"} if approve else {
            "action": "reject", "feedback": "The citizen chose not to file the return.",
        }
        await self._request("POST", f"/approvals/{task_id}", token, body)

    async def my_returns(self, token: OAuthToken) -> list[dict]:
        """The citizen's returns, read with the citizen's own token."""
        response = await self._request("GET", "/my/tax-returns", token)
        return response.json()


def _tasks_from(pending: dict) -> list[TaxTaskMessage]:
    """Map the ministry's pending citizen steps to chat messages. The figures are the
    ministry's assessment of exactly what the agent proposed to file, so the citizen signs
    what will be filed. Steps of any other kind are ignored."""
    tasks: list[TaxTaskMessage] = []
    for step in pending.get("steps") or []:
        if step.get("kind") != "filing":
            continue
        assessment = step.get("assessment") or {}
        provisional = assessment.get("evidenceNeeded") or []
        tasks.append(TaxTaskMessage(
            task_id=step["taskId"], kind="filing",
            title=step.get("title") or "Sign and file your tax return",
            description=(
                "The Ministry of Finance will file your 2026 return with these figures as soon "
                "as you sign. Nothing is filed until you do."
                + (" Reliefs marked below are granted provisionally until a ministry officer "
                   "reviews their evidence." if provisional else "")
            ),
            evidence_needed=provisional,
            figures={
                label: float(assessment[key])
                for key, label in (
                    ("taxableIncome", "Taxable income"),
                    ("taxAfterReliefs", "Tax due"),
                    ("estimatedSaving", "Saving from reliefs"),
                )
                if key in assessment
            },
        ))
    return tasks


def describe_filing(filing: dict) -> str:
    """The chat message for a return the ministry has just filed."""
    provisional = filing.get("provisionalReliefs") or []
    text = (
        f"**Ministry of Finance:** your 2026 return is filed, reference "
        f"{filing['reference']}, tax due {filing['taxAfterReliefs']}."
    )
    if provisional:
        text += (
            f" {', '.join(provisional)} relief is provisional until a ministry officer reviews "
            "the evidence. If it isn't confirmed in time, it is withdrawn and the return "
            "amended. I'll post the outcome here, or ask me about your tax return later."
        )
    return text


def describe_returns(returns: list[dict]) -> str:
    """The CheckMyTaxReturns tool result: each return's state, as the ministry reports it."""
    if not returns:
        return "The Ministry of Finance has no tax returns for this user."
    lines = []
    for item in returns:
        filing = item.get("filing")
        amendment = item.get("amendment")
        if not filing:
            state = "not filed" if item.get("status") == "completed" else (
                "waiting for the user's signature; its signing panel is now shown in this chat"
            )
        elif amendment:
            state = (
                f"filed as {filing['reference']}, then amended: {', '.join(amendment['withdrawnReliefs'])} "
                f"withdrawn, tax due now {amendment['taxAfterReliefs']} "
                f"(additional {amendment['additionalTax']})"
            )
        elif item.get("status") == "completed":
            state = f"filed as {filing['reference']}, final, tax due {filing['taxAfterReliefs']}"
        else:
            state = (
                f"filed as {filing['reference']}, tax due {filing['taxAfterReliefs']}; "
                f"provisional relief under officer review: {', '.join(filing['provisionalReliefs'])}"
            )
        summary = item.get("summary")
        # Run IDs are time-ordered, so their start is shared by returns opened together.
        label = filing["reference"] if filing else f"opened as {item['instanceId'][-8:]}"
        lines.append(f"- Return {label}: {state}." + (f" Ministry summary: {summary}" if summary else ""))
    return "The user's tax returns at the Ministry of Finance:\n" + "\n".join(lines)


def token_claims(access_token: str) -> dict:
    """A JWT's payload, unverified: for the audit trail and for explaining a refusal, never
    for a decision (the ministry validates the token)."""
    try:
        payload = access_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return claims if isinstance(claims, dict) else {}
    except (IndexError, ValueError):
        return {}


def granted_scopes(claims: dict) -> list[str]:
    """The scopes a token carries: a space-separated `scope` claim, or a list."""
    granted = claims.get("scope") or ""
    return granted.split() if isinstance(granted, str) else [str(s) for s in granted]


def _mask(value: object) -> str:
    """A subject identifier shortened for logs and the audit trail: enough to tell two
    apart, not to copy."""
    text = str(value or "")
    return f"{text[:4]}…{text[-4:]}" if len(text) > 8 else repr(text)


_WRONG_ACCOUNT = (
    "The Ministry of Finance refused your signature: you authorised it as a different "
    "account from the one this return was prepared for. Your browser is probably still "
    "signed in to the identity provider as someone else (the Ministry inbox uses the same "
    "sign-in). Sign out there, then sign the return again: you'll be asked to authorise afresh."
)


def _missing_scope(missing: list[str]) -> str:
    return (
        "The Ministry of Finance refused your signature: your authorisation doesn't include "
        f"the permission to file a tax return ({', '.join(missing)}). Your account needs a role "
        "that grants it at the identity provider. Once it has one, sign the return again."
    )


class TaxRefusal(Exception):
    """The ministry answered 403 to the citizen's token. `audit_reason` is the short form
    for the Token Flow page (the failed hop's error), `message` the chat's explanation, and
    `fixable` whether a new consent can fix it, so the step is offered again."""

    def __init__(self, audit_reason: str, message: str, fixable: bool):
        super().__init__(audit_reason)
        self.audit_reason = audit_reason
        self.message = message
        self.fixable = fixable


def explain_refusal(claims: dict, citizen_sub: str | None, required_scopes: list[str]) -> TaxRefusal:
    """Why the ministry answered 403 to a citizen's token, from what the Coordinator knows:
    the citizen it started the return for and the scope it asked for. The ministry refuses
    both a token without its citizen scope (its listener) and a token of another user (its
    ownership check) with the same bare 403."""
    if citizen_sub and claims.get("sub") != citizen_sub:
        return TaxRefusal(
            f"not the return's citizen (token sub {_mask(claims.get('sub'))}, "
            f"return's citizen {_mask(citizen_sub)})",
            _WRONG_ACCOUNT, fixable=True,
        )
    granted = set(granted_scopes(claims))
    missing = [scope for scope in required_scopes if scope not in granted]
    if missing:
        return TaxRefusal(
            f"token lacks scope {', '.join(missing)}", _missing_scope(missing), fixable=True,
        )
    return TaxRefusal(
        "refused by the ministry; the token looks right from here (see the ministry's log)",
        "The Ministry of Finance refused that answer. Your authorisation looks right from "
        "here, so the ministry's log has the reason.",
        fixable=False,
    )


class TaxReturnFollowUp:
    """Per chat session: the durable returns started in it and their pending steps."""

    def __init__(
        self,
        api: TaxAgentApi,
        send_json: Callable[[dict], Awaitable[None]],
        notify: Callable[[str], Awaitable[None]],
        fresh_token: Callable[[], Awaitable[OAuthToken | None]],
        citizen_token: Callable[[], Awaitable[OAuthToken | None]],
        audit_call: Callable[[OAuthToken], AbstractContextManager[None]],
        citizen_sub: Callable[[], str | None],
        citizen_scopes: list[str],
        forget_citizen_token: Callable[[], None],
    ):
        """fresh_token gets the Coordinator's agent token, citizen_token the citizen's own
        delegated token (prompting for consent when none is cached), and audit_call wraps
        an answer in the token-audit hops for the citizen's token. citizen_sub is the
        citizen the session's returns were started for and citizen_scopes the scopes asked
        for on their token, used to explain a refusal; forget_citizen_token drops a refused
        token so the next answer asks for consent again."""
        self._api = api
        self._send_json = send_json
        self._notify = notify
        self._fresh_token = fresh_token
        self._citizen_token = citizen_token
        self._audit_call = audit_call
        self._citizen_sub = citizen_sub
        self._citizen_scopes = citizen_scopes
        self._forget_citizen_token = forget_citizen_token
        self._token: OAuthToken | None = None
        # task_id -> its message, for steps announced to the UI and not yet answered.
        self._pending: dict[str, TaxTaskMessage] = {}
        self._watchers: set[asyncio.Task] = set()
        # The runs this session is following, so a run is never followed twice.
        self._followed: set[str] = set()

    def watch(self, instance_id: str, token: OAuthToken) -> None:
        """Start following a run the Coordinator just started."""
        self._token = token
        self._start_following(instance_id)

    def resume(self, instance_ids: list[str]) -> None:
        """Follow the citizen's unsigned returns from earlier sessions too, so their signing
        panels come back in this chat. The ministry listed them for this citizen's own token
        (CheckMyTaxReturns), and only that citizen can sign them. Runs this session already
        follows are left alone."""
        for instance_id in instance_ids:
            if instance_id not in self._followed:
                logger.info("Tax return %s: resuming it in this session", instance_id)
                self._start_following(instance_id)

    def _start_following(self, instance_id: str) -> None:
        self._followed.add(instance_id)
        watcher = asyncio.create_task(self._follow(instance_id))
        self._watchers.add(watcher)
        watcher.add_done_callback(self._watchers.discard)
        # A run that stops being followed (finished, or given up on) may be resumed again.
        watcher.add_done_callback(lambda _: self._followed.discard(instance_id))

    def close(self) -> None:
        """The chat session ended. The runs carry on at the ministry; only the polling stops."""
        for watcher in self._watchers:
            watcher.cancel()
        self._pending.clear()

    async def _call(self, call: Callable[[OAuthToken], Awaitable[Any]]) -> Any:
        """Run one API call with the cached token, retrying once with a fresh token on 401."""
        if self._token is None:
            self._token = await self._fresh_token()
        if self._token is None:
            raise RuntimeError("No agent token for the Tax Agent")
        try:
            return await call(self._token)
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 401:
                raise
        self._token = await self._fresh_token()
        if self._token is None:
            raise RuntimeError("No agent token for the Tax Agent")
        return await call(self._token)

    async def _follow(self, instance_id: str) -> None:
        announced: set[str] = set()
        filing_posted = False
        failures = 0
        while True:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            try:
                status = await self._call(lambda t: self._api.status(t, instance_id))
                if status.get("filing") and not filing_posted:
                    filing_posted = True
                    await self._notify(describe_filing(status["filing"]))
                if status.get("status") == "completed":
                    await self._finish(instance_id, status.get("summary"))
                    return
                pending = await self._call(lambda t: self._api.pending_tasks(t, instance_id))
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:
                failures += 1
                logger.warning("Polling tax return %s failed (%d/%d): %s",
                               instance_id, failures, MAX_POLL_FAILURES, e)
                if failures >= MAX_POLL_FAILURES:
                    await self._notify(
                        "I lost contact with the Ministry of Finance while following your "
                        "tax return. It has not been confirmed from here; please try again later."
                    )
                    return
                continue
            for task in _tasks_from(pending):
                if task.task_id in announced:
                    continue
                announced.add(task.task_id)
                self._pending[task.task_id] = task
                logger.info("Tax return %s: asking the citizen to %s (task %s)",
                            instance_id, task.kind, task.task_id)
                await self._send_json(task.model_dump())

    async def _finish(self, instance_id: str, summary: str | None) -> None:
        logger.info("Tax return %s completed", instance_id)
        await self._notify(
            f"**Ministry of Finance:** {summary}" if summary
            else "The Ministry of Finance has finished processing your tax return."
        )

    def decide(self, decision: TaxTaskDecision) -> None:
        """Forward the citizen's click to the ministry, in the background: the first answer
        waits on the citizen's consent prompt, and the chat must stay usable meanwhile.
        Only steps this session announced are accepted, so a stray or forged decision
        can't act on another run."""
        task = self._pending.pop(decision.task_id, None)
        if task is None:
            logger.warning("Ignoring a decision for unknown tax task %s", decision.task_id)
            return
        answer = asyncio.create_task(self._answer(task, decision.approve))
        self._watchers.add(answer)
        answer.add_done_callback(self._watchers.discard)

    async def _retry_later(self, task: TaxTaskMessage, reason: str) -> None:
        """Put a step back in front of the citizen after an answer didn't go through."""
        self._pending[task.task_id] = task
        await self._notify(reason)
        await self._send_json(task.model_dump())

    async def _answer(self, task: TaxTaskMessage, approve: bool) -> None:
        try:
            token = await self._citizen_token()
        except Exception as e:
            logger.error("Getting the citizen's token for tax task %s failed: %s", task.task_id, e)
            token = None
        if token is None:
            await self._retry_later(
                task, "Your answer wasn't sent: the Ministry of Finance needs your "
                "authorisation first. Please answer again and approve the request.",
            )
            return
        try:
            with self._audit_call(token):
                await self._complete(token, task, approve)
        except TaxRefusal as refusal:
            await self._refused(task, refusal)
            return
        except httpx.HTTPStatusError as e:
            logger.error("Sending the %s answer for task %s failed: %s", task.kind, task.task_id, e)
            await self._retry_later(task, "The Ministry of Finance didn't accept that just now. Please try again.")
            return
        except Exception as e:
            logger.error("Sending the %s answer for task %s failed: %s", task.kind, task.task_id, e)
            await self._retry_later(task, "The Ministry of Finance didn't accept that just now. Please try again.")
            return
        logger.info("Tax task %s (%s) answered by the citizen: %s", task.task_id, task.kind,
                    "approved" if approve else "declined")

    async def _complete(self, token: OAuthToken, task: TaxTaskMessage, approve: bool) -> None:
        """Send the answer; a 403 becomes a TaxRefusal saying why, raised inside the audit
        hop so the Token Flow page shows the reason on the failed call."""
        try:
            await self._api.complete(token, task.task_id, task.kind, approve)
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 403:
                raise
            claims = token_claims(token.access_token)
            refusal = explain_refusal(claims, self._citizen_sub(), self._citizen_scopes)
            logger.warning(
                "The ministry refused tax task %s (403): %s; token scopes=%s, required=%s",
                task.task_id, refusal.audit_reason, granted_scopes(claims), self._citizen_scopes,
            )
            raise refusal from e

    async def _refused(self, task: TaxTaskMessage, refusal: TaxRefusal) -> None:
        """Say why the ministry refused the citizen's token. When a new consent can fix it
        (a wrong sign-in, a newly granted role), drop the token and offer the step again."""
        if not refusal.fixable:
            await self._notify(refusal.message)
            return
        self._forget_citizen_token()
        await self._retry_later(task, refusal.message)
