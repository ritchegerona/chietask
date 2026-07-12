import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..config import DATA_DIR
from ..database import get_db
from ..models import Category, User, Workspace, WorkspaceMember
from ..schemas import TokenResponse, UserLogin, UserOut, UserRegister, UserUpdate
from ..user_out import to_user_out

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_DIR = DATA_DIR / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2MB

DEFAULT_CATEGORIES = [
    ("Meetings", "#89c4e8"),
    ("Reports", "#f4d4a7"),
    ("Emails", "#b9d8e8"),
    ("Admin", "#c0c0c0"),
    ("Client", "#e895a8"),
    ("Follow-up", "#d4a7f4"),
    ("Candidates", "#a7d8f4"),
    ("Recruitment", "#f4a7d8"),
    ("Documentation", "#d8f4a7"),
    ("Dataflow", "#a7f4d8"),
    ("IT", "#b9b9e8"),
    ("General", "#7bcba3"),
]


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "workspace"


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: UserRegister, db: Session = Depends(get_db)):
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        name=body.name.strip(),
        hashed_password=hash_password(body.password),
        plan="free",
    )
    db.add(user)
    db.flush()

    # Personal workspace
    base_slug = _slugify(f"{user.name}-workspace")
    slug = base_slug
    n = 1
    while db.query(Workspace).filter(Workspace.slug == slug).first():
        slug = f"{base_slug}-{n}"
        n += 1

    workspace = Workspace(name=f"{user.name}'s Workspace", slug=slug, owner_id=user.id)
    db.add(workspace)
    db.flush()

    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
    for name, color in DEFAULT_CATEGORIES:
        db.add(Category(workspace_id=workspace.id, name=name, color=color))

    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return TokenResponse(access_token=token, user=to_user_out(user))


@router.post("/login", response_model=TokenResponse)
def login(body: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.id, user.email)
    return TokenResponse(access_token=token, user=to_user_out(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return to_user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update profile name and/or password."""
    data = body.model_dump(exclude_unset=True)

    if "name" in data and data["name"] is not None:
        user.name = data["name"].strip()

    new_password = data.get("new_password")
    if new_password:
        current = data.get("current_password") or ""
        if not verify_password(current, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        user.hashed_password = hash_password(new_password)

    db.commit()
    db.refresh(user)
    return to_user_out(user)


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a custom profile picture (JPEG/PNG/WebP/GIF, max 2MB)."""
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    ext = ALLOWED_AVATAR_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Use a JPEG, PNG, WebP, or GIF image.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 2MB or smaller.")

    # Remove previous avatar file if present
    if user.avatar_path:
        old = Path(user.avatar_path)
        if not old.is_absolute():
            old = DATA_DIR / user.avatar_path
        try:
            if old.is_file() and old.resolve().is_relative_to(AVATAR_DIR.resolve()):
                old.unlink(missing_ok=True)
        except Exception:
            pass

    filename = f"u{user.id}_{uuid.uuid4().hex[:12]}{ext}"
    dest = AVATAR_DIR / filename
    dest.write_bytes(data)

    rel = f"avatars/{filename}"
    user.avatar_path = rel
    db.commit()
    db.refresh(user)
    return to_user_out(user)


@router.delete("/me/avatar", response_model=UserOut)
def remove_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.avatar_path:
        # Only delete files inside the avatars directory (no path traversal)
        try:
            candidate = Path(user.avatar_path)
            if candidate.is_absolute():
                path = candidate
            else:
                path = (DATA_DIR / user.avatar_path).resolve()
            avatar_root = AVATAR_DIR.resolve()
            if path.is_file() and path.resolve().is_relative_to(avatar_root):
                path.unlink(missing_ok=True)
        except Exception:
            pass
        user.avatar_path = None
        db.commit()
        db.refresh(user)
    return to_user_out(user)
