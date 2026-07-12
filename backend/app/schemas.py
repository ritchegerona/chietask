from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ── Auth ──────────────────────────────────────────────
class UserRegister(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    plan: str
    created_at: datetime
    avatar_url: Optional[str] = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """PATCH /api/auth/me — update profile and optional password change."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=6, max_length=128)


# ── Billing ───────────────────────────────────────────
class PlanUpgrade(BaseModel):
    """Direct plan change (admin/demo). Prefer checkout flow for paid upgrades."""

    plan: str = Field(description="One of: free, pro, team")


class CheckoutSessionCreate(BaseModel):
    plan: str = Field(description="pro or team")


class CheckoutSessionOut(BaseModel):
    session_id: str
    plan: str
    amount_cents: int
    currency: str = "usd"
    checkout_url: str


class CheckoutConfirm(BaseModel):
    session_id: str
    # Demo payment fields (replace with Stripe payment_intent confirmation in production)
    cardholder_name: str = Field(min_length=1, max_length=120)
    card_last4: str = Field(min_length=4, max_length=4)
    # Simulated success token from checkout UI
    payment_token: str = Field(min_length=4, max_length=128)


class PlanCatalogItem(BaseModel):
    id: str
    name: str
    max_tasks: int
    max_workspaces: int
    max_members: int
    price_cents: int = 0
    price_label: str = "$0/mo"


class PlansResponse(BaseModel):
    plans: list[PlanCatalogItem]
    current_plan: Optional[str] = None


# ── Workspace ─────────────────────────────────────────
class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class WorkspaceOut(BaseModel):
    id: int
    name: str
    slug: str
    owner_id: int
    role: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceMemberOut(BaseModel):
    id: int
    user_id: int
    email: str
    name: str
    role: str

    model_config = {"from_attributes": True}


class InviteMember(BaseModel):
    email: EmailStr
    role: str = "member"


# ── Task ──────────────────────────────────────────────
class TaskCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    category: str = Field(default="General", max_length=80)
    priority: str = "normal"
    due_date: Optional[str] = Field(default=None, max_length=20, pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    notes: str = Field(default="", max_length=10000)
    progress: int = Field(default=0, ge=0, le=100)


class TaskUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=500)
    category: Optional[str] = Field(default=None, max_length=80)
    priority: Optional[str] = None
    due_date: Optional[str] = Field(default=None, max_length=20, pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    notes: Optional[str] = Field(default=None, max_length=10000)
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    completed: Optional[bool] = None
    time_spent: Optional[int] = Field(default=None, ge=0, le=86400 * 365)


class TaskOut(BaseModel):
    id: int
    workspace_id: int
    created_by: int
    text: str
    notes: str
    completed: bool
    progress: int
    category: str
    priority: str
    due_date: Optional[str]
    time_spent: int
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class TaskTimeUpdate(BaseModel):
    # Cap per-call to avoid inflated timers from buggy clients
    seconds: int = Field(ge=0, le=3600)


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = "#4f8cff"


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    color: Optional[str] = None


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str

    model_config = {"from_attributes": True}


class StatsOut(BaseModel):
    total: int
    pending: int
    completed: int
    completed_today: int
    time_today_seconds: int
    by_priority: dict
    by_category: dict


class PlanOut(BaseModel):
    plan: str
    limits: dict
    usage: dict
