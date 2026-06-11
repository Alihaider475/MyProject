from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.api.deps import get_camera_manager
from backend.auth.supabase_auth import (
    AuthUser,
    authenticate_token,
    get_stream_user,
    require_safety_manager_or_admin,
)
from backend.camera.manager import CameraManager
from backend.core.logging import get_logger
from backend.streaming.webrtc_handler import WebRTCManager

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
        await asyncio.sleep(0.033)  # ~30 fps


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
    try:
        await authenticate_token(token)
    except HTTPException:
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


# ── WebRTC signalling ─────────────────────────────────────────────────────────

class WebRTCOfferBody(BaseModel):
    sdp: str
    type: str


class ICECandidateBody(BaseModel):
    pc_id: str
    candidate: dict


@router.post("/stream/webrtc/{camera_id}/offer")
async def webrtc_offer(
    camera_id: int,
    body: WebRTCOfferBody,
    request: Request,
    user: AuthUser = Depends(require_safety_manager_or_admin),
):
    mgr: CameraManager = get_camera_manager(request)
    if not mgr.is_running(camera_id):
        raise HTTPException(status_code=404, detail="Camera not running")
    wm: WebRTCManager = request.app.state.webrtc_manager
    sdp, typ, pc_id = await wm.create_offer_answer(
        camera_id, body.sdp, body.type, mgr
    )
    return {"sdp": sdp, "type": typ, "pc_id": pc_id}


@router.post("/stream/webrtc/{camera_id}/ice")
async def webrtc_ice(
    camera_id: int,
    body: ICECandidateBody,
    request: Request,
    user: AuthUser = Depends(require_safety_manager_or_admin),
):
    wm: WebRTCManager = request.app.state.webrtc_manager
    ok = await wm.add_ice_candidate(body.pc_id, body.candidate)
    if not ok:
        raise HTTPException(status_code=404, detail="Unknown peer connection")
    return {"ok": True}
