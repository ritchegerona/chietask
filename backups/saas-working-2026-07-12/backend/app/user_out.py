"""Serialize User → UserOut with avatar_url."""
from pathlib import Path

from .models import User
from .schemas import UserOut


def to_user_out(user: User) -> UserOut:
    out = UserOut.model_validate(user)
    if user.avatar_path:
        name = Path(user.avatar_path).name
        out.avatar_url = f"/media/avatars/{name}"
    else:
        out.avatar_url = None
    return out
