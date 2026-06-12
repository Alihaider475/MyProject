from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    employee_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    face_encoding: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list[float] — Facenet 128-dim
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    violations: Mapped[List["Violation"]] = relationship("Violation", back_populates="worker")
    fines: Mapped[List["Fine"]] = relationship("Fine", back_populates="worker")


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)  # webcam | rtsp | file
    source_uri: Mapped[str] = mapped_column(String(500), nullable=False)  # index, URL, or path
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    detection_confidence: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.5, server_default="0.5"
    )
    roi_polygon: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    violations: Mapped[List["Violation"]] = relationship("Violation", back_populates="camera")


class Violation(Base):
    __tablename__ = "violations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    camera_id: Mapped[int] = mapped_column(Integer, ForeignKey("cameras.id"), nullable=False, index=True)
    violation_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    frame_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    is_false_positive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    worker_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("workers.id"), nullable=True, index=True)
    fine_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    track_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    person_bbox: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON [x1,y1,x2,y2]

    camera: Mapped["Camera"] = relationship("Camera", back_populates="violations")
    alert_logs: Mapped[List["AlertLog"]] = relationship("AlertLog", back_populates="violation")
    worker: Mapped[Optional["Worker"]] = relationship("Worker", back_populates="violations")
    fine: Mapped[Optional["Fine"]] = relationship("Fine", back_populates="violation", uselist=False)


class AlertLog(Base):
    __tablename__ = "alert_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    violation_id: Mapped[int] = mapped_column(Integer, ForeignKey("violations.id"), nullable=False)
    handler_type: Mapped[str] = mapped_column(String(50), nullable=False)  # email | webhook | slack | db
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error_msg: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    violation: Mapped["Violation"] = relationship("Violation", back_populates="alert_logs")


class SystemSetting(Base):
    """Persistent runtime setting override (safe boolean toggles only — never secrets)."""

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    value_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="bool")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class FineConfig(Base):
    __tablename__ = "fine_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    violation_type: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    fine_amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), server_default="PKR")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, server_default=func.now(), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Fine(Base):
    __tablename__ = "fines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    worker_id: Mapped[int] = mapped_column(Integer, ForeignKey("workers.id"), nullable=False, index=True)
    violation_id: Mapped[int] = mapped_column(Integer, ForeignKey("violations.id"), nullable=False, unique=True)
    fine_amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), server_default="PKR")
    fine_date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    challan_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), server_default="pending", index=True)  # pending|deducted|waived
    deduction_month: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)
    waive_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    worker: Mapped["Worker"] = relationship("Worker", back_populates="fines")
    violation: Mapped["Violation"] = relationship("Violation", back_populates="fine")
