from __future__ import annotations

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    APP_ENV: Literal["dev", "staging", "prod"] = "dev"
    LOG_LEVEL: str = "INFO"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ppe_detection"

    # Model
    MODEL_PATH: str = "data/models/ppe.pt"
    DETECTION_CONFIDENCE: float = 0.5

    # Per-class minimum confidence for "NO-X" violation classes.
    # Higher than DETECTION_CONFIDENCE because YOLO PPE models tend to
    # over-predict the "NO-X" classes — a stricter floor cuts false positives.
    VIOLATION_CONFIDENCE: float = 0.6

    # Class-pair NMS: if Hardhat and NO-Hardhat boxes overlap by >= this IoU,
    # keep only the higher-confidence one.
    CONFLICT_IOU_THRESHOLD: float = 0.3

    # Color-based veto: if a NO-Hardhat detection sits on a brightly saturated
    # region (hardhats are designed in safety colors), suppress it as a likely
    # misclassification. Disable if your site has lots of bright clothing.
    ENABLE_HARDHAT_COLOR_VETO: bool = True

    # Violation frames storage
    FRAMES_DIR: str = "data/violation_frames"
    CHALLANS_DIR: str = "data/violation_frames/challans"
    COMPANY_NAME: str = "PPE Safety Systems"

    # Alert timing
    ALERT_COOLDOWN_SECONDS: int = 10
    VIOLATION_PERSIST_SECONDS: int = 10

    # Live stream output (MJPEG quality / size)
    STREAM_WIDTH: int = 960          # 0 = use original size
    STREAM_HEIGHT: int = 540
    STREAM_JPEG_QUALITY: int = 80    # 1–100; trade size vs sharpness
    STREAM_TARGET_FPS: float = 15.0  # cap inference rate to save CPU

    # Email
    SENDER_EMAIL: str = ""
    RECEIVER_EMAIL: str = ""
    EMAIL_PASSWORD: str = ""
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    EMAIL_RETRY_COUNT: int = 3
    EMAIL_RETRY_DELAY: float = 5.0

    # Optional webhook alerts
    SLACK_WEBHOOK_URL: str = ""
    WEBHOOK_URL: str = ""

    # MQTT alerts
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

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:8000"]

    # Fines / salary deduction
    FINES_ENABLED: bool = True
    FINES_CURRENCY: str = "PKR"
    DEFAULT_HARDHAT_FINE: float = 500.0
    DEFAULT_VEST_FINE: float = 300.0
    DEFAULT_MASK_FINE: float = 200.0

    BASE_URL: str = ""


settings = Settings()
