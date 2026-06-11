from datetime import datetime
from typing import Optional
from backend.core.config import settings

def naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Strip timezone info from a datetime, treating it as UTC.
    
    Normalises datetime variables so they match DB formats and avoid timezone-awareness conflicts.
    """
    if dt is None or dt.tzinfo is None:
        return dt
    return dt.replace(tzinfo=None)

def frame_url(frame_path: str | None) -> str | None:
    """Convert a stored frame path to a clean URL path.
    
    Normalises Windows backslashes to forward slashes.
    """
    if not frame_path:
        return None
    path = frame_path.replace("\\", "/")
    prefix = settings.FRAMES_DIR.replace("\\", "/").rstrip("/") + "/"
    if path.startswith(prefix):
        path = path[len(prefix):]
    return f"/frames/{path}"


def thumbnail_url(frame_path: str | None) -> str | None:
    """Convert a stored frame path to a clean URL path for its thumbnail.
    
    Prepends 'thumb_' to the filename portion of the frame path.
    """
    if not frame_path:
        return None
    url = frame_url(frame_path)
    if not url:
        return None
    # Insert 'thumb_' right before the final filename in the path
    parts = url.rsplit("/", 1)
    if len(parts) == 2:
        return f"{parts[0]}/thumb_{parts[1]}"
    return url
