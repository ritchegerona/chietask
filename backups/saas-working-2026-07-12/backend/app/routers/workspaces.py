import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import PLAN_LIMITS
from ..database import get_db
from ..models import Category, Task, User, Workspace, WorkspaceMember
from ..schemas import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    InviteMember,
    PlanOut,
    WorkspaceCreate,
    WorkspaceMemberOut,
    WorkspaceOut,
)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "workspace"


def get_membership(db: Session, workspace_id: int, user_id: int) -> WorkspaceMember:
    m = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
        .first()
    )
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")
    return m


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = db.query(WorkspaceMember).filter(WorkspaceMember.user_id == user.id).all()
    result = []
    for m in memberships:
        ws = db.query(Workspace).filter(Workspace.id == m.workspace_id).first()
        if ws:
            out = WorkspaceOut.model_validate(ws)
            out.role = m.role
            result.append(out)
    return result


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_workspace(
    body: WorkspaceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owned = db.query(Workspace).filter(Workspace.owner_id == user.id).count()
    limit = PLAN_LIMITS.get(user.plan, PLAN_LIMITS["free"])["max_workspaces"]
    if owned >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"Workspace limit reached for {user.plan} plan ({limit}). Upgrade to create more.",
        )

    base_slug = _slugify(body.name)
    slug = base_slug
    n = 1
    while db.query(Workspace).filter(Workspace.slug == slug).first():
        slug = f"{base_slug}-{n}"
        n += 1

    ws = Workspace(name=body.name.strip(), slug=slug, owner_id=user.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    for name, color in [
        ("Meetings", "#89c4e8"),
        ("Reports", "#f4d4a7"),
        ("Admin", "#c0c0c0"),
        ("Client", "#e895a8"),
        ("General", "#7bcba3"),
    ]:
        db.add(Category(workspace_id=ws.id, name=name, color=color))
    db.commit()
    db.refresh(ws)
    out = WorkspaceOut.model_validate(ws)
    out.role = "owner"
    return out


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberOut])
def list_members(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_membership(db, workspace_id, user.id)
    members = db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).all()
    result = []
    for m in members:
        u = db.query(User).filter(User.id == m.user_id).first()
        if u:
            result.append(
                WorkspaceMemberOut(id=m.id, user_id=u.id, email=u.email, name=u.name, role=m.role)
            )
    return result


@router.post("/{workspace_id}/invite", response_model=WorkspaceMemberOut)
def invite_member(
    workspace_id: int,
    body: InviteMember,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    membership = get_membership(db, workspace_id, user.id)
    if membership.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners/admins can invite")

    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    owner = db.query(User).filter(User.id == ws.owner_id).first()
    member_count = db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).count()
    limit = PLAN_LIMITS.get(owner.plan, PLAN_LIMITS["free"])["max_members"]
    if member_count >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"Member limit reached for {owner.plan} plan ({limit}). Upgrade to Team.",
        )

    invitee = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not invitee:
        raise HTTPException(status_code=404, detail="User not found. They must register first.")

    existing = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == invitee.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="User already a member")

    role = body.role if body.role in ("admin", "member") else "member"
    m = WorkspaceMember(workspace_id=workspace_id, user_id=invitee.id, role=role)
    db.add(m)
    db.commit()
    db.refresh(m)
    return WorkspaceMemberOut(
        id=m.id, user_id=invitee.id, email=invitee.email, name=invitee.name, role=m.role
    )


@router.get("/{workspace_id}/categories", response_model=list[CategoryOut])
def list_categories(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_membership(db, workspace_id, user.id)
    cats = db.query(Category).filter(Category.workspace_id == workspace_id).order_by(Category.name).all()
    return [CategoryOut.model_validate(c) for c in cats]


@router.post("/{workspace_id}/categories", response_model=CategoryOut, status_code=201)
def create_category(
    workspace_id: int,
    body: CategoryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_membership(db, workspace_id, user.id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    existing = (
        db.query(Category)
        .filter(Category.workspace_id == workspace_id, Category.name == name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")
    color = (body.color or "#4f8cff").strip()
    if not color.startswith("#") or len(color) not in (4, 7):
        color = "#4f8cff"
    cat = Category(workspace_id=workspace_id, name=name, color=color)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return CategoryOut.model_validate(cat)


@router.patch("/{workspace_id}/categories/{category_id}", response_model=CategoryOut)
def update_category(
    workspace_id: int,
    category_id: int,
    body: CategoryUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename and/or recolor a category. Renames cascade to tasks using the old name."""
    get_membership(db, workspace_id, user.id)
    cat = (
        db.query(Category)
        .filter(Category.id == category_id, Category.workspace_id == workspace_id)
        .first()
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    data = body.model_dump(exclude_unset=True)
    old_name = cat.name

    if "name" in data and data["name"] is not None:
        new_name = data["name"].strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Category name is required")
        if new_name != old_name:
            clash = (
                db.query(Category)
                .filter(
                    Category.workspace_id == workspace_id,
                    Category.name == new_name,
                    Category.id != category_id,
                )
                .first()
            )
            if clash:
                raise HTTPException(status_code=400, detail="Another category already has that name")
            # Cascade rename to tasks
            db.query(Task).filter(
                Task.workspace_id == workspace_id,
                Task.category == old_name,
            ).update({Task.category: new_name}, synchronize_session=False)
            cat.name = new_name

    if "color" in data and data["color"] is not None:
        color = data["color"].strip()
        if color.startswith("#") and len(color) in (4, 7):
            cat.color = color

    db.commit()
    db.refresh(cat)
    return CategoryOut.model_validate(cat)


@router.delete("/{workspace_id}/categories/{category_id}", status_code=204)
def delete_category(
    workspace_id: int,
    category_id: int,
    reassign_to: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a category. Tasks are reassigned to `reassign_to` or 'General'."""
    get_membership(db, workspace_id, user.id)
    cat = (
        db.query(Category)
        .filter(Category.id == category_id, Category.workspace_id == workspace_id)
        .first()
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    target = (reassign_to or "General").strip() or "General"
    if target == cat.name:
        target = "General"

    # Ensure target category exists
    if not db.query(Category).filter(Category.workspace_id == workspace_id, Category.name == target).first():
        db.add(Category(workspace_id=workspace_id, name=target, color="#94a3b8"))

    db.query(Task).filter(Task.workspace_id == workspace_id, Task.category == cat.name).update(
        {Task.category: target}, synchronize_session=False
    )
    db.delete(cat)
    db.commit()
    return None


@router.get("/{workspace_id}/plan", response_model=PlanOut)
def plan_usage(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_membership(db, workspace_id, user.id)
    from ..models import Task

    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    owner = db.query(User).filter(User.id == ws.owner_id).first()
    task_count = db.query(Task).filter(Task.workspace_id == workspace_id).count()
    member_count = db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).count()
    ws_count = db.query(Workspace).filter(Workspace.owner_id == owner.id).count()
    limits = PLAN_LIMITS.get(owner.plan, PLAN_LIMITS["free"])
    return PlanOut(
        plan=owner.plan,
        limits=limits,
        usage={"tasks": task_count, "members": member_count, "workspaces": ws_count},
    )
