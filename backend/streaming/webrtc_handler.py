from __future__ import annotations

import asyncio
import fractions
import time
import uuid

import av
import cv2
import numpy as np
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription

VIDEO_CLOCK_RATE = 90000
VIDEO_TIME_BASE = fractions.Fraction(1, VIDEO_CLOCK_RATE)


class CameraStreamTrack(MediaStreamTrack):
    kind = "video"

    def __init__(self, camera_id: int, queue: asyncio.Queue) -> None:
        super().__init__()
        self._camera_id = camera_id
        self._queue = queue
        self._start: float | None = None

    async def recv(self) -> av.VideoFrame:
        jpeg_bytes = await self._queue.get()
        now = time.time()
        if self._start is None:
            self._start = now
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            bgr = np.zeros((480, 640, 3), dtype=np.uint8)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
        frame.pts = int((now - self._start) * VIDEO_CLOCK_RATE)
        frame.time_base = VIDEO_TIME_BASE
        return frame


class WebRTCManager:
    def __init__(self) -> None:
        self._pcs: dict[str, RTCPeerConnection] = {}
        self._tracks: dict[str, CameraStreamTrack] = {}

    async def create_offer_answer(
        self, camera_id: int, sdp: str, sdp_type: str, camera_manager
    ) -> tuple[str, str, str]:
        pc_id = str(uuid.uuid4())
        pc = RTCPeerConnection()
        self._pcs[pc_id] = pc

        q = camera_manager.subscribe_webrtc(camera_id)
        track = CameraStreamTrack(camera_id, q)
        self._tracks[pc_id] = track
        pc.addTrack(track)

        @pc.on("connectionstatechange")
        async def _on_state():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self._close(pc_id, camera_id, camera_manager)

        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=sdp_type))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        return pc.localDescription.sdp, pc.localDescription.type, pc_id

    async def add_ice_candidate(self, pc_id: str, candidate: dict) -> bool:
        from aiortc import RTCIceCandidate

        pc = self._pcs.get(pc_id)
        if not pc:
            return False
        ice = RTCIceCandidate(
            foundation=candidate["foundation"],
            component=candidate.get("component", 1),
            ip=candidate["ip"],
            port=candidate["port"],
            priority=candidate["priority"],
            protocol=candidate["protocol"],
            type=candidate["type"],
            sdpMid=candidate.get("sdpMid"),
            sdpMLineIndex=candidate.get("sdpMLineIndex"),
        )
        await pc.addIceCandidate(ice)
        return True

    async def _close(
        self, pc_id: str, camera_id: int, camera_manager
    ) -> None:
        pc = self._pcs.pop(pc_id, None)
        track = self._tracks.pop(pc_id, None)
        if track:
            camera_manager.unsubscribe_webrtc(camera_id, track._queue)
        if pc:
            await pc.close()

    async def close_all(self) -> None:
        for pc in list(self._pcs.values()):
            await pc.close()
        self._pcs.clear()
        self._tracks.clear()
