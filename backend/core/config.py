from __future__ import annotations

import pathlib
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = pathlib.Path(__file__).parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    APP_ENV: Literal["dev", "staging", "prod"] = "dev"
    LOG_LEVEL: str = "INFO"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database
    # Default: SQLite for local development (no external service required).
    # For production, set DATABASE_URL to a PostgreSQL asyncpg connection string, e.g.:
    #   postgresql+asyncpg://user:password@host:5432/dbname
    DATABASE_URL: str = f"sqlite+aiosqlite:///{_PROJECT_ROOT / 'ppe_detection.db'}"

    # Redis Caching (optional, fallback to in-memory if empty)
    REDIS_URL: str = ""

    # Model
    MODEL_PATH: str = str(_PROJECT_ROOT / "data/models/ppe.pt")
    DETECTION_CONFIDENCE: float = 0.25
    YOLO_VID_STRIDE: int = 2
    YOLO_HALF_PRECISION: bool = True
    YOLO_VERBOSE: bool = False
    # Inference image size passed to model.predict(imgsz=...). Ultralytics
    # rescales result boxes back to the original frame, so lowering this only
    # speeds up inference (less per-frame lag on CPU) without changing the
    # coordinate space the rest of the pipeline sees. 640 = model default;
    # drop to 512/416 on slow CPUs to reduce bounding-box trailing further.
    YOLO_IMGSZ: int = 640
    # If a frame handed to the detector is wider than this, it is cv2.resize'd
    # down (aspect ratio preserved) before being passed to model.predict() —
    # this shrinks the pixel count Ultralytics' own preprocessing has to chew
    # through on CPU. Detection boxes are rescaled back up to the original
    # frame's coordinate space immediately after inference (see detector.py
    # _detect_at), so every downstream consumer (ROI, violation checker,
    # annotation, face crop) still sees the original frame's coordinates
    # unchanged. 0 disables this step.
    YOLO_PREPROCESS_MAX_WIDTH: int = 640
    # Smaller YOLO input size for single-image upload inference only (live
    # camera keeps YOLO_IMGSZ=640). Benchmarked ~70ms -> ~42ms/frame on CPU
    # (i5-1135G7, no CUDA) with no extra scaling needed — Ultralytics already
    # rescales returned box coordinates back to the original frame size
    # regardless of imgsz, same as the video-upload path below relies on.
    IMAGE_YOLO_IMGSZ: int = 416

    # Native YOLO NMS IoU threshold passed to model.predict(iou=...). Ultralytics'
    # own default is 0.7 (lenient) — at that threshold two slightly-offset same-class
    # boxes on one object (e.g. two Hardhat boxes on one head) both survive class-aware
    # NMS. Lowered to 0.45 so same-class duplicates are merged at the source.
    YOLO_NMS_IOU: float = 0.45

    # Device string passed to Ultralytics when the resolved backend is OpenVINO
    # (see detector.py _resolve_model_backend). "intel:<device>" is the only
    # string format Ultralytics' select_device() passes through unmodified to
    # OpenVINOBackend.load_model() — plain "GPU" gets misparsed by the generic
    # CUDA-index parsing path instead. OpenVINOBackend already falls back to
    # AUTO/CPU on its own if the requested device isn't in core.available_devices,
    # so an unsupported value here degrades gracefully rather than failing to load.
    # Has zero effect when the resolved backend is "onnx" or "pt" — neither
    # backend's device handling recognizes Intel-prefixed device strings.
    YOLO_OPENVINO_DEVICE: str = "intel:gpu"

    # Per-class minimum confidence for "NO-X" violation classes. Kept in step
    # with DETECTION_CONFIDENCE so live webcam frames (lower resolution, motion
    # blur) are not silently stripped of their NO-X detections before they ever
    # reach the violation checker. Raise this if you see NO-X false positives.
    VIOLATION_CONFIDENCE: float = 0.25

    # Class-pair NMS: if Hardhat and NO-Hardhat boxes overlap by >= this IoU,
    # keep only the higher-confidence one.
    CONFLICT_IOU_THRESHOLD: float = 0.3

    # --- Person de-duplication ("ghost person" fix) ---
    # The detector applies a *dedicated* confidence floor to Person boxes (PPE
    # objects stay on the lower DETECTION_CONFIDENCE floor because they are
    # small). This alone removes the classic low-confidence phantom box (e.g. a
    # 0.28 box sitting on a 0.45 box on one body).
    PERSON_CONFIDENCE_FLOOR: float = 0.45
    # Per-class PPE floors. Hardhat/Mask are small but reliable; Safety Vest gets
    # a higher floor because large solid-color background regions (dark
    # clothing, shadows) are a common false-positive source for that class.
    HARDHAT_MASK_CONFIDENCE_FLOOR: float = 0.30
    VEST_CONFIDENCE_FLOOR: float = 0.45
    # Secondary person-dedup pass (belt-and-suspenders for boxes whose IoU is
    # below the model's own NMS threshold): two Person boxes are merged when they
    # overlap by >= PERSON_DEDUP_IOU *or* one is >= PERSON_DEDUP_CONTAINMENT
    # contained in the other. The larger (full-body) box is kept.
    PERSON_DEDUP_IOU: float = 0.55
    PERSON_DEDUP_CONTAINMENT: float = 0.70

    # --- Hybrid violation derivation ---
    # The deployed ppe.pt emits NO-Hardhat/NO-Mask/NO-Safety Vest directly, but
    # frequently MISSES them on close-up webcam frames. With derivation ON, a
    # person with no matched PPE and no NO-X box still yields a violation
    # candidate (source="derived"). Set False for legacy NO-X-only behaviour.
    ENABLE_VIOLATION_DERIVATION: bool = True
    # Opt-in only: without a real Person box, a NO-X model hit is too risky for
    # automatic violation logging in low-light/home/background scenes.
    ENABLE_NO_PERSON_VIOLATION_FALLBACK: bool = False
    # Derived candidates only fire for a real, confident Person box (never for the
    # full-frame "no person detected" fallback). This is the main false-fine guard
    # in the absence of a pose guard.
    DERIVATION_PERSON_CONF: float = 0.55
    # Whether NO-Mask is evaluated at all. Preserves current behaviour (masks on)
    # but lets a site that does not mandate masks disable it without code changes.
    MASK_VIOLATION_ENABLED: bool = True
    # Pose guard: exclude non-upright (lying/crawling, often sitting/bending)
    # persons from PPE association/derivation because the head/torso region bands
    # assume an upright pose. Set False (POSE_GUARD_ENABLED=false in .env) to
    # enforce PPE compliance regardless of posture, at the cost of weaker
    # region-based false-positive filtering for unusual poses.
    POSE_GUARD_ENABLED: bool = True
    # Run full detection every Nth frame in the live loop (the tracker/stream
    # still run every frame). The loop only ever has one detection in flight
    # (it submits the next only when the previous has completed), so 1 means
    # "resubmit as soon as inference finishes" — the freshest possible boxes,
    # bounded by inference time. Raise it to throttle CPU at the cost of more
    # bounding-box trailing.
    DETECTION_FRAME_STRIDE: int = 1

    # --- Video file upload sampling (backend/detection/video_jobs.py) ---
    # Analyse 1 sampled frame every N frames (~1 fps for a 30 fps video).
    VIDEO_SAMPLE_EVERY_N: int = 30
    # Hard ceiling on total sampled frames per video regardless of length, so a
    # very long upload can't balloon into thousands of YOLO inferences — the
    # effective stride is widened (never narrowed) to stay under this cap.
    # Lowered 150 -> 60: on CPU (no CUDA) 150 inferences pushed processing to
    # 6-20 min/clip, far past the frontend poll window; 60 keeps a typical clip
    # comfortably under a minute or two.
    VIDEO_MAX_SAMPLED_FRAMES: int = 60
    # Smaller YOLO input size for uploaded-video inference only (live camera
    # keeps YOLO_IMGSZ=640). 416 is ~2.4x fewer pixels than 640 -> roughly that
    # much faster per frame on CPU, with negligible accuracy loss for the coarse
    # "is this PPE present" video summary.
    VIDEO_YOLO_IMGSZ: int = 416
    # If a VideoJob has been stuck in "processing" longer than this (e.g. the
    # server restarted mid-job), GET /detect/video/{job_id} reports it as failed
    # instead of leaving the frontend polling forever.
    VIDEO_JOB_STALE_SECONDS: int = 600
    # An uploaded video saves at most ONE violation row per type (deduplicated
    # across sampled frames). This caps the number of distinct types persisted
    # per upload as a safety net — with only ~3 PPE types it rarely binds.
    MAX_VIDEO_VIOLATIONS_PER_UPLOAD: int = 5

    # Color-based veto: if a NO-Hardhat detection sits on a brightly saturated
    # region (hardhats are designed in safety colors), suppress it as a likely
    # misclassification. Off by default — it silently suppressed real live
    # NO-Hardhat detections indoors. Enable if your site has lots of bright
    # clothing and you see NO-Hardhat false positives.
    ENABLE_HARDHAT_COLOR_VETO: bool = False

    # Violation frames storage
    FRAMES_DIR: str = str(_PROJECT_ROOT / "data/violation_frames")
    CHALLANS_DIR: str = str(_PROJECT_ROOT / "data/violation_frames/challans")
    COMPANY_NAME: str = "PPE Safety Systems"

    # Enrolled worker face photos — served only via an authenticated endpoint,
    # never through a public static mount (these are biometric photos).
    WORKER_PHOTOS_DIR: str = str(_PROJECT_ROOT / "data/worker_photos")

    # Alert timing
    # ALERT_COOLDOWN_SECONDS prevents duplicate emails for the same violation;
    # keep it generous. VIOLATION_PERSIST_SECONDS is how long a person must be
    # without PPE before the first violation fires — 1s keeps the live demo
    # responsive while still ignoring single-frame glitches.
    ALERT_COOLDOWN_SECONDS: int = 60
    VIOLATION_PERSIST_SECONDS: int = 1

    # Live stream output (MJPEG quality / size). 16:9 to match the default
    # 1280x720 webcam capture so the stream never stretches the frame (or its
    # burned-in annotation boxes) into a different aspect ratio.
    STREAM_WIDTH: int = 640          # 0 = use original size
    STREAM_HEIGHT: int = 360
    STREAM_JPEG_QUALITY: int = 75    # 1–100; trade size vs sharpness
    STREAM_TARGET_FPS: float = 15.0  # stream frame rate (detection is async/non-blocking)

    # Webcam capture (what the camera grabs — drives detection quality).
    # Higher than the MJPEG stream size on purpose: detection runs on the full
    # capture frame, while the stream is downscaled for bandwidth.
    WEBCAM_CAPTURE_WIDTH: int = 1280
    WEBCAM_CAPTURE_HEIGHT: int = 720
    WEBCAM_CAPTURE_FPS: int = 15

    # Webcam debug: when on, the detector + camera loop emit per-frame diagnostic
    # logs (raw/normalized classes, confidences, ROI filtering, dropped boxes,
    # save/cooldown/dispatch decisions) and write the last raw + annotated frame
    # to WEBCAM_DEBUG_DIR for comparison against image-upload detection.
    WEBCAM_DEBUG: bool = False
    WEBCAM_DEBUG_DIR: str = str(_PROJECT_ROOT / "backend/static/debug")

    # Email
    EMAIL_ALERTS_ENABLED: bool = True
    SENDER_EMAIL: str = ""
    RECEIVER_EMAIL: str = ""
    EMAIL_PASSWORD: str = ""
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USE_TLS: bool = True
    EMAIL_RETRY_COUNT: int = 3
    EMAIL_RETRY_DELAY: float = 5.0

    # Optional webhook alerts
    WEBHOOK_ENABLED: bool = True
    SLACK_WEBHOOK_URL: str = ""
    WEBHOOK_URL: str = ""
    WEBHOOK_TIMEOUT: float = 10.0
    WEBHOOK_RETRY_COUNT: int = 3
    WEBHOOK_RETRY_DELAY: float = 5.0

    # MQTT alerts
    MQTT_ENABLED: bool = True
    MQTT_BROKER: str = ""
    MQTT_PORT: int = 1883
    MQTT_TOPIC: str = "ppe/alerts"
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""
    MQTT_QOS: int = 1
    MQTT_KEEPALIVE: int = 60
    MQTT_RETRY_COUNT: int = 3
    MQTT_RETRY_DELAY: float = 5.0
    MQTT_CLIENT_ID: str = "ppe-detection-server"

    # Supabase
    SUPABASE_URL: str = "https://whchabyglamkdhmcwzxv.supabase.co"
    SUPABASE_ANON_KEY: str = ""
    # Service-role key: required server-side to read/write Storage buckets
    # (bypasses RLS). Never expose this to the frontend.
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # Supabase Storage buckets
    SUPABASE_VIOLATION_BUCKET: str = "violation-frames"
    SUPABASE_WORKER_PHOTOS_BUCKET: str = "worker-photos"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:8000"]

    # Auto-identification of unassigned violations (seconds, 0 = disabled)
    AUTO_IDENTIFY_INTERVAL: int = 60

    # Face recognition
    FACE_MATCH_THRESHOLD: float = 0.40    # cosine distance; lower = stricter
    FACE_MATCH_MARGIN: float = 0.08       # best must beat 2nd-best by this much, else ambiguous
    FACE_RECOG_FRAME_INTERVAL: int = 10   # run face recognition every N frames
    FACE_NO_FACE_LOG_INTERVAL_SECONDS: int = 15
    # DeepFace detector_backend — MUST be identical at enrollment and recognition
    # time, or the two embeddings are not comparable. yunet ships with
    # opencv-python (already a hard dependency) and downloads its own small
    # weight file on first use, same as the Facenet model already does.
    FACE_DETECTOR_BACKEND: str = "yunet"
    # When True, log every enrolled worker's distance (not just best/second-best)
    # on each identify_face() call — verbose, opt-in for debugging mismatches.
    FACE_DEBUG_LOGS: bool = False
    # YuNet's own default (0.9) is tuned for clean studio photos; real CCTV-quality
    # crops of clearly-visible faces measured as low as 0.88-0.92 even after fixing
    # crop geometry, so a modest safety margin is warranted. enforce_detection=True
    # is unchanged — this only lowers the bar for what counts as a genuine
    # detection, it does not disable the requirement.
    FACE_DETECTOR_SCORE_THRESHOLD: float = 0.6

    # n8n Payroll Risk Analysis Agent — shared secret for the X-N8N-API-KEY header
    # on the agent execution endpoints. Empty by default; set via .env in deployment.
    # Never exposed to the frontend.
    N8N_PAYROLL_AGENT_API_KEY: str = ""

    # n8n Safety Corrective Action Agent — separate shared secret for
    # /api/v1/admin/safety-actions/agent/* endpoints. Never exposed to the frontend.
    N8N_SAFETY_ACTION_AGENT_API_KEY: str = ""

    # Webhook URL for the n8n Payroll Risk Analysis workflow (Webhook Trigger node).
    # Admin-triggered runs POST { month: "YYYY-MM" } to this URL.
    # n8n must respond immediately via a "Respond to Webhook" node (status: accepted).
    # Never exposed to the frontend — only the backend reads this value.
    N8N_PAYROLL_WORKFLOW_WEBHOOK_URL: str = ""

    # Webhook URL for the n8n Safety Effectiveness Review workflow.
    # Admin-triggered via POST /admin/n8n/safety-effectiveness/run.
    # Accepts { task_id, month } — n8n then calls the evaluate-effectiveness endpoint.
    # Never exposed to the frontend — only the backend reads this value.
    N8N_SAFETY_EFFECTIVENESS_WEBHOOK_URL: str = ""

    # Days to wait after task completion before the after-window is considered
    # complete enough to evaluate. Set to 0 in .env for immediate demo evaluation.
    EFFECTIVENESS_REVIEW_WINDOW_DAYS: int = 7

    # Fines / salary deduction
    FINES_ENABLED: bool = True
    FINES_CURRENCY: str = "PKR"
    DEFAULT_HARDHAT_FINE: float = 500.0
    DEFAULT_VEST_FINE: float = 300.0
    DEFAULT_MASK_FINE: float = 200.0

    # Person tracking (Ultralytics ByteTrack — motion-only, no appearance embedder)
    TRACKING_ENABLED: bool = True
    TRACK_DEDUP_SECONDS: int = 300
    # Frames a lost track is kept alive before deletion (re-acquires the same ID
    # if the person reappears within this window).
    BYTETRACK_TRACK_BUFFER: int = 30
    # IoU matching threshold for the second association pass.
    BYTETRACK_MATCH_THRESH: float = 0.8
    # Detections at/above this score start the high-confidence association; a new
    # track is created at NEW_TRACK_THRESH. Kept low to match this project's
    # low per-class confidence floors so an ID appears on the first detection.
    BYTETRACK_TRACK_HIGH_THRESH: float = 0.25
    BYTETRACK_TRACK_LOW_THRESH: float = 0.1
    BYTETRACK_NEW_TRACK_THRESH: float = 0.25

    BASE_URL: str = ""


settings = Settings()
