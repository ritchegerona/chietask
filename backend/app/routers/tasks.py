from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import PLAN_LIMITS
from ..database import get_db
from ..models import Category, Task, User, Workspace, WorkspaceMember
from ..schemas import StatsOut, TaskCreate, TaskOut, TaskTimeUpdate, TaskUpdate

router = APIRouter(prefix="/api/workspaces/{workspace_id}/tasks", tags=["tasks"])


def require_member(db: Session, workspace_id: int, user_id: int) -> WorkspaceMember:
    m = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
        .first()
    )
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")
    return m


@router.get("", response_model=list[TaskOut])
def list_tasks(
    workspace_id: int,
    completed: bool | None = Query(None),
    category: str | None = Query(None),
    priority: str | None = Query(None),
    q: str | None = Query(None, description="Case-insensitive search on task text"),
    due_before: str | None = Query(None, description="Include tasks with due_date <= this (ISO date)"),
    due_after: str | None = Query(None, description="Include tasks with due_date >= this (ISO date)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, workspace_id, user.id)
    query = db.query(Task).filter(Task.workspace_id == workspace_id)
    if completed is not None:
        query = query.filter(Task.completed == completed)
    if category:
        query = query.filter(Task.category == category)
    if priority:
        query = query.filter(Task.priority == priority)
    if q and q.strip():
        term = q.strip()[:200].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(Task.text.ilike(f"%{term}%", escape="\\"))
    if due_before:
        query = query.filter(Task.due_date.isnot(None), Task.due_date <= due_before)
    if due_after:
        query = query.filter(Task.due_date.isnot(None), Task.due_date >= due_after)
    tasks = query.order_by(Task.completed.asc(), Task.created_at.desc()).all()
    # priority sort for incomplete
    order = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
    tasks.sort(key=lambda t: (t.completed, order.get(t.priority, 2), -(t.created_at.timestamp() if t.created_at else 0)))
    return [TaskOut.model_validate(t) for t in tasks]


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    workspace_id: int,
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, workspace_id, user.id)
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    owner = db.query(User).filter(User.id == ws.owner_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Workspace owner not found")
    count = db.query(Task).filter(Task.workspace_id == workspace_id).count()
    limit = PLAN_LIMITS.get(owner.plan, PLAN_LIMITS["free"])["max_tasks"]
    if count >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"Task limit reached for {owner.plan} plan ({limit}). Upgrade for more.",
        )

    priority = body.priority if body.priority in ("urgent", "high", "normal", "low") else "normal"
    category_name = (body.category or "General").strip() or "General"

    # Auto-create category if user typed a new name
    existing_cat = (
        db.query(Category)
        .filter(Category.workspace_id == workspace_id, Category.name == category_name)
        .first()
    )
    if not existing_cat:
        palette = ["#4f8cff", "#3dcf9a", "#f97316", "#a78bfa", "#f07178", "#45c4e6", "#f0b45a", "#94a3b8"]
        count_cats = db.query(Category).filter(Category.workspace_id == workspace_id).count()
        db.add(
            Category(
                workspace_id=workspace_id,
                name=category_name,
                color=palette[count_cats % len(palette)],
            )
        )

    task = Task(
        workspace_id=workspace_id,
        created_by=user.id,
        text=body.text.strip(),
        notes=body.notes or "",
        category=category_name,
        priority=priority,
        due_date=body.due_date,
        progress=body.progress or 0,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.get("/stats", response_model=StatsOut)
def task_stats(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, workspace_id, user.id)
    tasks = db.query(Task).filter(Task.workspace_id == workspace_id).all()
    today = datetime.now(timezone.utc).date().isoformat()

    by_priority: dict[str, int] = {}
    by_category: dict[str, int] = {}
    completed_today = 0
    time_today = 0

    for t in tasks:
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
        by_category[t.category] = by_category.get(t.category, 0) + 1
        # Hours today: time on incomplete work + time on tasks completed today
        # (was incorrectly only counting tasks *created* today)
        if t.completed and t.completed_at:
            completed_day = (
                t.completed_at.date().isoformat()
                if hasattr(t.completed_at, "date")
                else str(t.completed_at)[:10]
            )
            if completed_day == today:
                completed_today += 1
                time_today += t.time_spent or 0
        elif not t.completed:
            time_today += t.time_spent or 0

    return StatsOut(
        total=len(tasks),
        pending=sum(1 for t in tasks if not t.completed),
        completed=sum(1 for t in tasks if t.completed),
        completed_today=completed_today,
        time_today_seconds=time_today,
        by_priority=by_priority,
        by_category=by_category,
    )


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    workspace_id: int,
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, workspace_id, user.id)
    task = db.query(Task).filter(Task.id == task_id, Task.workspace_id == workspace_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskOut.model_validate(task)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    workspace_id: int,
    task_id: int,
    body: TaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, workspace_id, user.id)
    task = db.query(Task).filter(Task.id == task_id, Task.workspace_id == workspace_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = body.model_dump(exclude_unset=True)
    if "priority" in data and data["priority"] not in ("urgent", "high", "normal", "low"):
        data["priority"] = task.priority
    if "text" in data and data["text"]:
        data["text"] = data["text"].strip()

    for k, v in data.items():
        setattr(task, k, v)

    # Auto-create category when task category is changed to a new name
    if "category" in data and data["category"]:
        cat_name = data["category"].strip()
        task.category = cat_name
        if not db.query(Category).filter(
            Category.workspace_id == workspace_id, Category.name == cat_name
        ).first():
            palette = ["#4f8cff", "#3dcf9a", "#f97316", "#a78bfa", "#f07178", "#45c4e6"]
            n = db.query(Category).filter(Category.workspace_id == workspace_id).count()
            db.add(Category(workspace_id=workspace_id, name=cat_name, color=palette[n % len(palette)]))

    # Sync completed/progress
    if task.progress == 100 and not task.completed:
        task.completed = True
        task.completed_at = datetime.now(timezone.utc)
    if task.completed and task.progress < 100:
        task.progress = 100
        if not task.completed_at:
            task.completed_at = datetime.now(timezone.utc)
    if "completed" in data:
        if task.completed:
            task.progress = 100
            task.completed_at = task.completed_at or datetime.now(timezone.utc)
        else:
            task.completed_at = None
            if task.progress == 100:
                task.progress = 0

    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.post("/{task_id}/time", response_model=TaskOut)
def add_time(
    workspace_id: int,
    task_id: int,
    body: TaskTimeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add elapsed seconds to a task (used by client timer)."""
    require_member(db, workspace_id, user.id)
    task = db.query(Task).filter(Task.id == task_id, Task.workspace_id == workspace_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.time_spent = (task.time_spent or 0) + body.seconds
    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.delete("/{task_id}", status_code=204)
def delete_task(
    workspace_id: int,
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, workspace_id, user.id)
    task = db.query(Task).filter(Task.id == task_id, Task.workspace_id == workspace_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return None
