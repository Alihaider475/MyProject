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
    """Convert a stored frame path to its Supabase Storage public URL."""
    if not frame_path:
        return None
    from backend.storage import supabase_storage
    path = frame_path.replace("\\", "/")
    return supabase_storage.public_url(settings.SUPABASE_VIOLATION_BUCKET, path)


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
