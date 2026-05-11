from __future__ import annotations

import asyncio
import json

import httpx
from fastapi import APIRouter, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.api.deps import get_camera_manager
from app.auth.supabase_auth import get_stream_user
from app.camera.manager import CameraManager
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(tags=["stream"])


async def _mjpeg_generator(manager: CameraManager, camera_id: int):
    """Yield MJPEG frames, tolerating brief is_running()=False gaps.

    - On startup: wait up to 5 s for the first frame before giving up.
    - Once streaming: tolerate up to 3 consecutive not-running polls (~120 ms)
      before closing — enough for a normal Stop without holding the connection open.
    """
    no_run_streak = 0
    first_frame_seen = False
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 5.0

    while True:
        if not manager.is_running(camera_id):
            if not first_frame_seen:
                if loop.time() > deadline:
                    return  # camera never started — give up
                await asyncio.sleep(0.1)
                continue
            no_run_streak += 1
            if no_run_streak > 3:
                return
            await asyncio.sleep(0.04)
            continue

        no_run_streak = 0
        frame = manager.get_latest_frame(camera_id)
        if frame is not None:
            first_frame_seen = True
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame
                + b"\r\n"
            )
        await asyncio.sleep(0.04)  # ~25 fps max


@router.get("/stream/{camera_id}")
async def mjpeg_stream(
    camera_id: int,
    request: Request,
    token: str | None = Query(None),
):
    await get_stream_user(token=token)
    manager: CameraManager = get_camera_manager(request)
    # No upfront is_running() check — generator handles startup timing
    return StreamingResponse(
        _mjpeg_generator(manager, camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "keep-alive",
        },
    )


@router.websocket("/ws/{camera_id}")
async def websocket_stream(websocket: WebSocket, camera_id: int):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": settings.SUPABASE_ANON_KEY},
            timeout=5.0,
        )
    if resp.status_code != 200:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    request = websocket
    manager: CameraManager = websocket.app.state.camera_manager

    # Poll up to 3 s for camera to appear (matches MJPEG 5 s startup pattern)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 3.0
    while not manager.is_running(camera_id):
        if loop.time() > deadline:
            await websocket.close(code=1008, reason="Camera not running")
            return
        await asyncio.sleep(0.1)

    q = manager.subscribe(camera_id)
    try:
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=5.0)
                await websocket.send_text(json.dumps(data))
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"ping": True}))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.unsubscribe(camera_id, q)
