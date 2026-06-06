from __future__ import annotations

import json
import logging
from typing import Optional

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

FINE_PER_TYPE: dict[str, float] = {
    "NO-Hardhat": 100.0,
    "NO-Mask": 50.0,
    "NO-Safety Vest": 75.0,
}
DEFAULT_FINE = 50.0
MATCH_THRESHOLD = 0.40       # cosine distance — lower = stricter match
FACE_CROP_TOP_RATIO = 0.45   # top 45% of person bbox used as face region


class FaceRecognizer:
    def __init__(self) -> None:
        self._encodings: list[np.ndarray] = []
        self._worker_ids: list[int] = []

    async def load_known_faces(self, session: AsyncSession) -> None:
        from backend.database.models import Worker

        result = await session.execute(
            select(Worker.id, Worker.face_encoding).where(Worker.face_encoding.isnot(None))
        )
        self._encodings = []
        self._worker_ids = []
        for worker_id, encoding_json in result.all():
            try:
                enc = np.array(json.loads(encoding_json), dtype=np.float32)
                self._encodings.append(enc)
                self._worker_ids.append(worker_id)
            except Exception as exc:
                logger.warning("Failed to load face encoding for worker %d: %s", worker_id, exc)
        logger.info("FaceRecognizer: loaded %d known face(s)", len(self._encodings))

    def identify_face(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> Optional[int]:
        """Return worker_id of best cosine match, or None if below threshold / no faces loaded."""
        if not self._encodings:
            return None
        try:
            from deepface import DeepFace

            x1, y1, x2, y2 = bbox
            face_y2 = y1 + int((y2 - y1) * FACE_CROP_TOP_RATIO)
            crop = frame[max(0, y1):max(0, face_y2), max(0, x1):max(0, x2)]
            if crop.size == 0:
                return None

            result = DeepFace.represent(crop, model_name="Facenet", enforce_detection=False)
            if not result:
                return None

            query_enc = np.array(result[0]["embedding"], dtype=np.float32)
            best_dist = float("inf")
            best_idx = -1

            for i, known_enc in enumerate(self._encodings):
                norm = float(np.linalg.norm(query_enc) * np.linalg.norm(known_enc))
                if norm == 0:
                    continue
                dist = 1.0 - float(np.dot(query_enc, known_enc)) / norm
                if dist < best_dist:
                    best_dist = dist
                    best_idx = i

            if best_idx >= 0 and best_dist < MATCH_THRESHOLD:
                return self._worker_ids[best_idx]

        except Exception as exc:
            logger.debug("Face identification error: %s", exc)

        return None

    def encode_face(self, image: np.ndarray) -> list[float]:
        """Extract Facenet embedding from an image. Raises ValueError if no face found."""
        from deepface import DeepFace

        result = DeepFace.represent(image, model_name="Facenet", enforce_detection=False)
        if not result:
            raise ValueError("No face encoding could be extracted from the image")
        return result[0]["embedding"]

    def register_worker(self, worker_id: int, encoding: list[float]) -> None:
        """Update in-memory store for a single worker without a full DB reload."""
        if worker_id in self._worker_ids:
            idx = self._worker_ids.index(worker_id)
            self._encodings.pop(idx)
            self._worker_ids.pop(idx)
        self._encodings.append(np.array(encoding, dtype=np.float32))
        self._worker_ids.append(worker_id)

    @staticmethod
    def fine_for(violation_type: str) -> float:
        return FINE_PER_TYPE.get(violation_type, DEFAULT_FINE)
