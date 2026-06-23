from __future__ import annotations

import json
import logging
from typing import Optional

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings

logger = logging.getLogger(__name__)

FACE_CROP_TOP_RATIO = 0.45   # top 45% of person bbox used as face region
FACE_MODEL_NAME = "Facenet"


class FaceRecognizer:
    def __init__(self) -> None:
        self._encodings: list[np.ndarray] = []
        self._worker_ids: list[int] = []
        self._model = None

    def load_model(self) -> None:
        """Build/cache the Facenet model once. Downloads weights on first run if missing.

        Idempotent — safe to call from startup and again from encode_face/identify_face.
        Raises RuntimeError with a user-friendly message if the model can't be loaded.
        """
        if self._model is not None:
            return
        logger.info("Face recognition model loading (%s)...", FACE_MODEL_NAME)
        try:
            from deepface import DeepFace

            self._model = DeepFace.build_model(model_name=FACE_MODEL_NAME, task="facial_recognition")
        except Exception as exc:
            logger.error("Face recognition model failed to load: %s", exc)
            raise RuntimeError(
                "Face recognition is unavailable: the Facenet model could not be "
                "downloaded or loaded. Check your network connection and try again."
            ) from exc
        logger.info("Face recognition model ready (%s)", FACE_MODEL_NAME)

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

    def match_embedding(
        self, query_enc: np.ndarray
    ) -> tuple[Optional[int], Optional[float], Optional[float], str]:
        """Decide which enrolled worker (if any) a face embedding belongs to.

        Pure, DeepFace-free matching logic so it can be unit-tested directly.

        Industry-safe identity rule — a worker is only returned when the match is
        both confident AND unambiguous:
          - no enrolled workers                       -> (None, None, None, "no_enrolled_workers")
          - best distance >= FACE_MATCH_THRESHOLD     -> (None, best, second, "below_threshold")
          - (second_best - best) < FACE_MATCH_MARGIN  -> (None, best, second, "ambiguous_match")
          - exactly one clear, confident best         -> (worker_id, best, second, "matched")

        The nearest worker is NOT the identified worker. Returns
        (worker_id, best_dist, second_best_dist, reason).
        """
        if not self._encodings:
            return None, None, None, "no_enrolled_workers"

        distances: list[tuple[int, float]] = []
        for worker_id, known_enc in zip(self._worker_ids, self._encodings):
            norm = float(np.linalg.norm(query_enc) * np.linalg.norm(known_enc))
            if norm == 0:
                continue
            dist = 1.0 - float(np.dot(query_enc, known_enc)) / norm
            distances.append((worker_id, dist))

        if not distances:
            return None, None, None, "no_enrolled_workers"

        distances.sort(key=lambda item: item[1])

        if settings.FACE_DEBUG_LOGS:
            logger.info(
                "[FaceID] worker distances: %s",
                ", ".join(f"worker={wid} dist={d:.4f}" for wid, d in distances),
            )

        best_worker_id, best_dist = distances[0]
        second_dist = distances[1][1] if len(distances) > 1 else None

        if best_dist >= settings.FACE_MATCH_THRESHOLD:
            return None, best_dist, second_dist, "below_threshold"

        if second_dist is not None and (second_dist - best_dist) < settings.FACE_MATCH_MARGIN:
            return None, best_dist, second_dist, "ambiguous_match"

        return best_worker_id, best_dist, second_dist, "matched"

    def identify_face(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> Optional[int]:
        """Return worker_id of a confident, unambiguous match, or None otherwise."""
        if not self._encodings:
            return None
        if self._model is None:
            return None
        try:
            from deepface import DeepFace

            x1, y1, x2, y2 = bbox
            face_y2 = y1 + int((y2 - y1) * FACE_CROP_TOP_RATIO)
            crop = frame[max(0, y1):max(0, face_y2), max(0, x1):max(0, x2)]
            if crop.size == 0:
                return None

            result = DeepFace.represent(
                crop,
                model_name=FACE_MODEL_NAME,
                detector_backend=settings.FACE_DETECTOR_BACKEND,
                enforce_detection=True,
                align=True,
            )
            if not result:
                logger.info("[FaceID] no face embedding extracted from crop (bbox=%s)", bbox)
                return None

            query_enc = np.array(result[0]["embedding"], dtype=np.float32)
            worker_id, best, second, reason = self.match_embedding(query_enc)

            logger.info(
                "[FaceID] decision=%s worker_id=%s best=%.4f second=%s threshold=%.4f margin=%.4f",
                reason,
                worker_id if worker_id is not None else "none",
                best if best is not None else -1.0,
                f"{second:.4f}" if second is not None else "none",
                settings.FACE_MATCH_THRESHOLD,
                settings.FACE_MATCH_MARGIN,
            )
            return worker_id

        except ValueError as exc:
            logger.info("[FaceID] no face detected in person crop (bbox=%s): %s", bbox, exc)
        except Exception as exc:
            logger.warning("[FaceID] unexpected error during face identification (bbox=%s): %s", bbox, exc)

        return None

    def identify_unique_worker(
        self, frame: np.ndarray, boxes: list[tuple[int, int, int, int]]
    ) -> Optional[int]:
        """Resolve a single confident worker across every person box in a frame.

        Calls identify_face() for each box (no early exit) and only returns a
        worker_id when exactly one distinct worker was matched across all boxes.
        Zero matches, or two-or-more *different* workers matched in the same
        frame, means the violating person cannot be clearly associated — returns
        None (Unidentified) rather than guessing from whichever box matched first.
        """
        matched_ids = {
            wid for wid in (self.identify_face(frame, box) for box in boxes) if wid is not None
        }
        if len(matched_ids) == 1:
            return next(iter(matched_ids))
        if len(matched_ids) > 1:
            logger.warning(
                "[FaceID] ambiguous frame: %d distinct workers matched (%s) — leaving unidentified",
                len(matched_ids), sorted(matched_ids),
            )
        return None

    def encode_face(self, image: np.ndarray) -> list[float]:
        """Extract Facenet embedding from an image. Raises ValueError if no face found."""
        logger.info("Face enrollment started")
        self.load_model()

        from deepface import DeepFace

        try:
            result = DeepFace.represent(
                image,
                model_name=FACE_MODEL_NAME,
                detector_backend=settings.FACE_DETECTOR_BACKEND,
                enforce_detection=True,
                align=True,
            )
        except ValueError as exc:
            logger.info("Face enrollment rejected — no face detected: %s", exc)
            raise ValueError(
                "No face detected in the uploaded image — please upload a clear face photo"
            ) from exc
        if not result:
            raise ValueError("No face encoding could be extracted from the image")

        embedding = result[0]["embedding"]
        logger.info("Face enrollment completed (embedding_dim=%d)", len(embedding))
        return embedding

    def register_worker(self, worker_id: int, encoding: list[float]) -> None:
        """Update in-memory store for a single worker without a full DB reload."""
        if worker_id in self._worker_ids:
            idx = self._worker_ids.index(worker_id)
            self._encodings.pop(idx)
            self._worker_ids.pop(idx)
        self._encodings.append(np.array(encoding, dtype=np.float32))
        self._worker_ids.append(worker_id)
