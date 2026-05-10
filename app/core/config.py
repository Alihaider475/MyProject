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
    DATABASE_URL: str = "sqlite+aiosqlite:///./ppe_detection.db"

    # Model
    MODEL_PATH: str = "models/ppe.pt"
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
    FRAMES_DIR: str = "violation_frames"

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

    # JWT Authentication
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:8000"]

    # PLC siren (Modbus TCP)
    PLC_HOST: str = ""
    PLC_PORT: int = 502
    PLC_UNIT_ID: int = 1
    PLC_COIL_ADDRESS: int = 0
    PLC_COIL_DURATION: float = 5.0       # seconds coil stays HIGH before auto-reset
    PLC_TIMEOUT: int = 3                  # TCP connection timeout in seconds
    PLC_RETRY_COUNT: int = 3             # max connection attempts
    PLC_RETRY_DELAY: float = 5.0         # seconds between retry attempts


settings = Settings()
