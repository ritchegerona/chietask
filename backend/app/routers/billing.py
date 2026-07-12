"""Billing + checkout (demo payment dashboard; swap for Stripe later)."""
from __future__ import annotations

import os
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import APP_URL, PLAN_LIMITS, PLAN_PRICE_LABELS, PLAN_PRICES_CENTS
from ..database import get_db
from ..models import User
from ..schemas import (
    CheckoutConfirm,
    CheckoutSessionCreate,
    CheckoutSessionOut,
    PlanCatalogItem,
    PlansResponse,
    PlanUpgrade,
    UserOut,
)
from ..user_out import to_user_out

router = APIRouter(prefix="/api/billing", tags=["billing"])

PLAN_NAMES = {
    "free": "Free",
    "pro": "Pro",
    "team": "Team",
}

VALID_PLANS = frozenset(PLAN_LIMITS.keys())
PAID_PLANS = frozenset({"pro", "team"})

# In-memory checkout sessions (demo). Production: Redis / DB + Stripe Session.
_CHECKOUT_SESSIONS: dict[str, dict[str, Any]] = {}
_SESSION_TTL_SEC = 60 * 30


def _purge_expired() -> None:
    now = time.time()
    dead = [k for k, v in _CHECKOUT_SESSIONS.items() if now - v.get("created_at", 0) > _SESSION_TTL_SEC]
    for k in dead:
        _CHECKOUT_SESSIONS.pop(k, None)


@router.get("/plans", response_model=PlansResponse)
def list_plans(user: User = Depends(get_current_user)):
    """Return plan catalog + limits + pricing."""
    plans = [
        PlanCatalogItem(
            id=plan_id,
            name=PLAN_NAMES.get(plan_id, plan_id.title()),
            max_tasks=limits["max_tasks"],
            max_workspaces=limits["max_workspaces"],
            max_members=limits["max_members"],
            price_cents=PLAN_PRICES_CENTS.get(plan_id, 0),
            price_label=PLAN_PRICE_LABELS.get(plan_id, "$0/mo"),
        )
        for plan_id, limits in PLAN_LIMITS.items()
    ]
    return PlansResponse(plans=plans, current_plan=user.plan)


_PLAN_RANK = {"free": 0, "pro": 1, "team": 2}


@router.post("/checkout/session", response_model=CheckoutSessionOut)
def create_checkout_session(
    body: CheckoutSessionCreate,
    user: User = Depends(get_current_user),
):
    """Start a checkout session and return the payment dashboard URL."""
    plan = (body.plan or "").strip().lower()
    if plan not in PAID_PLANS:
        raise HTTPException(status_code=400, detail="Checkout is only for pro or team plans.")
    if user.plan == plan:
        raise HTTPException(status_code=400, detail=f"You are already on the {plan} plan.")
    # Only allow upgrades (not paid downgrades) through checkout
    if _PLAN_RANK.get(plan, 0) <= _PLAN_RANK.get(user.plan, 0):
        raise HTTPException(
            status_code=400,
            detail="Checkout is for upgrades only. Use Settings to switch to a lower plan.",
        )

    _purge_expired()
    session_id = secrets.token_urlsafe(24)
    amount = PLAN_PRICES_CENTS.get(plan, 0)
    _CHECKOUT_SESSIONS[session_id] = {
        "user_id": user.id,
        "plan": plan,
        "amount_cents": amount,
        "created_at": time.time(),
        "status": "pending",
    }
    base = APP_URL.rstrip("/")
    checkout_url = f"{base}/checkout?session={session_id}&plan={plan}"
    return CheckoutSessionOut(
        session_id=session_id,
        plan=plan,
        amount_cents=amount,
        currency="usd",
        checkout_url=checkout_url,
    )


@router.get("/checkout/session/{session_id}")
def get_checkout_session(session_id: str, user: User = Depends(get_current_user)):
    _purge_expired()
    sess = _CHECKOUT_SESSIONS.get(session_id)
    if not sess or sess["user_id"] != user.id:
        raise HTTPException(status_code=404, detail="Checkout session not found or expired.")
    return {
        "session_id": session_id,
        "plan": sess["plan"],
        "amount_cents": sess["amount_cents"],
        "currency": "usd",
        "status": sess["status"],
        "price_label": PLAN_PRICE_LABELS.get(sess["plan"], ""),
        "plan_name": PLAN_NAMES.get(sess["plan"], sess["plan"]),
        "limits": PLAN_LIMITS.get(sess["plan"], {}),
        "current_plan": user.plan,
    }


@router.post("/checkout/confirm", response_model=UserOut)
def confirm_checkout(
    body: CheckoutConfirm,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Confirm demo payment and activate plan.
    Production: verify Stripe PaymentIntent / Checkout Session server-side.
    Set BILLING_MODE=live to reject demo confirmations until real PSP is wired.
    """
    billing_mode = (os.getenv("BILLING_MODE") or "demo").strip().lower()
    if billing_mode == "live":
        raise HTTPException(
            status_code=503,
            detail="Live billing is not configured. Connect Stripe/Paddle before accepting payments.",
        )

    _purge_expired()
    sess = _CHECKOUT_SESSIONS.get(body.session_id)
    if not sess or sess["user_id"] != user.id:
        raise HTTPException(status_code=404, detail="Checkout session not found or expired.")
    if sess["status"] == "paid":
        return to_user_out(user)

    # Demo validation — real card numbers are never stored
    if not body.card_last4.isdigit():
        raise HTTPException(status_code=400, detail="Invalid card details.")
    if not body.payment_token or len(body.payment_token) < 4:
        raise HTTPException(status_code=400, detail="Payment was not authorized.")

    plan = sess["plan"]
    # Re-load user in this session
    db_user = db.query(User).filter(User.id == user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db_user.plan = plan
    sess["status"] = "paid"
    db.commit()
    db.refresh(db_user)
    return to_user_out(db_user)


@router.post("/upgrade", response_model=UserOut)
def upgrade_plan(
    body: PlanUpgrade,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Direct plan set (free / demo). Paid plans should use /checkout/session.
    Downgrading to free is always allowed here.
    """
    plan = (body.plan or "").strip().lower()
    if plan not in VALID_PLANS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan. Choose one of: {', '.join(sorted(VALID_PLANS))}",
        )
    # Paid upgrades: force checkout so Upgrade button goes through payment UI
    if plan in PAID_PLANS and user.plan != plan:
        raise HTTPException(
            status_code=402,
            detail="Payment required. Use checkout to upgrade to a paid plan.",
        )
    db_user = db.query(User).filter(User.id == user.id).first()
    db_user.plan = plan
    db.commit()
    db.refresh(db_user)
    return to_user_out(db_user)
