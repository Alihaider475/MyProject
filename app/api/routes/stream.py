from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.api.deps import get_camera_manager
from app.camera.manager import CameraManager
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(tags=["stream"])


async def _mjpeg_generator(manager: CameraManager, camera_id: int):
    boundary = b"--frame"
    while True:
        frame = manager.get_latest_frame(camera_id)
        if frame:
            yield (
                boundary
                + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(frame)).encode()
                + b"\r\n\r\n"
                + frame
                + b"\r\n"
            )
        await asyncio.sleep(0.04)  # ~25 fps max


@router.get("/stream/{camera_id}")
async def mjpeg_stream(camera_id: int, request: Request):
    manager: CameraManager = get_camera_manager(request)
    if not manager.is_running(camera_id):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Camera not running")

    return StreamingResponse(
        _mjpeg_generator(manager, camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.websocket("/ws/{camera_id}")
async def websocket_stream(websocket: WebSocket, camera_id: int):
    await websocket.accept()
    request = websocket
    manager: CameraManager = websocket.app.state.camera_manager

    if not manager.is_running(camera_id):
        await websocket.close(code=1008, reason="Camera not running")
        return

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
