"""Admin endpoints for manually triggering n8n workflows.

Auth: Supabase JWT (verify_supabase_token) + admin role check — same pattern as
invite_tracker.py.  The n8n API key is never sent to or from the frontend.

The n8n Payroll Risk Analysis webhook must return quickly (use a "Respond to
Webhook" node set to respond immediately with { status: "accepted" }).  The
backend uses a 10-second timeout to avoid holding the frontend request open while
the full workflow executes asynchronously inside n8n.
"""
from __future__ import annotations

import logging
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/n8n", tags=["n8n-trigger"])

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _require_admin(user: dict = Depends(verify_supabase_token)) -> dict:
    if (user.get("user_metadata") or {}).get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


class RunAnalysisRequest(BaseModel):
    month: str  # YYYY-MM


class RunEffectivenessRequest(BaseModel):
    task_id: int | None = None
    month: str | None = None  # YYYY-MM


@router.post("/payroll-risk-analysis/run")
async def trigger_payroll_risk_analysis(
    body: RunAnalysisRequest,
    _admin: dict = Depends(_require_admin),
):
    """Trigger the n8n Payroll Risk Analysis workflow for a specific month.

    Forwards { month } to the configured N8N_PAYROLL_WORKFLOW_WEBHOOK_URL and
    returns immediately.  n8n executes the analysis asynchronously — results
    appear in the risk-analysis-history endpoint once the workflow completes.
    """
    if not _MONTH_RE.match(body.month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")

    url = settings.N8N_PAYROLL_WORKFLOW_WEBHOOK_URL
    if not url or url == "change-me":
        raise HTTPException(
            status_code=503,
            detail="N8N_PAYROLL_WORKFLOW_WEBHOOK_URL is not configured on this server",
        )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={"month": body.month})
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("n8n webhook returned HTTP %s for month %s", exc.response.status_code, body.month)
        raise HTTPException(
            status_code=502,
            detail=f"n8n webhook responded with error {exc.response.status_code}",
        )
    except httpx.TimeoutException:
        logger.error("n8n webhook timed out for month %s", body.month)
        raise HTTPException(
            status_code=504,
            detail="n8n webhook did not respond in time — ensure a Respond to Webhook node is configured",
        )
    except httpx.RequestError as exc:
        logger.error("n8n webhook unreachable for month %s: %s", body.month, exc)
        raise HTTPException(status_code=502, detail="n8n webhook is unreachable")

    return {"status": "accepted", "month": body.month}


@router.post("/safety-effectiveness/run")
async def trigger_safety_effectiveness(
    body: RunEffectivenessRequest,
    _admin: dict = Depends(_require_admin),
):
    """Trigger the n8n Safety Effectiveness Review workflow for a specific task or month.

    Forwards { task_id, month } to N8N_SAFETY_EFFECTIVENESS_WEBHOOK_URL and returns
    immediately.  n8n then calls the evaluate-effectiveness agent endpoint which
    compares violation counts before vs after task completion and writes the log.
    """
    if body.month is not None and not _MONTH_RE.match(body.month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")

    url = settings.N8N_SAFETY_EFFECTIVENESS_WEBHOOK_URL
    if not url or url == "change-me":
        raise HTTPException(
            status_code=503,
            detail="N8N_SAFETY_EFFECTIVENESS_WEBHOOK_URL is not configured on this server",
        )

    payload: dict = {}
    if body.task_id is not None:
        payload["task_id"] = body.task_id
    if body.month is not None:
        payload["month"] = body.month

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error("n8n effectiveness webhook returned HTTP %s", exc.response.status_code)
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=502,
                detail="n8n effectiveness webhook returned 404 — the webhook path does not exist in n8n yet. Create a workflow with a Webhook trigger on the configured path.",
            )
        raise HTTPException(
            status_code=502,
            detail=f"n8n webhook responded with error {exc.response.status_code}",
        )
    except httpx.TimeoutException:
        logger.error("n8n effectiveness webhook timed out")
        raise HTTPException(
            status_code=504,
            detail="n8n webhook did not respond in time — ensure a Respond to Webhook node is configured",
        )
    except httpx.RequestError as exc:
        logger.error("n8n effectiveness webhook unreachable: %s", exc)
        raise HTTPException(status_code=502, detail="n8n effectiveness webhook is unreachable")

    return {"status": "accepted", "task_id": body.task_id, "month": body.month}
