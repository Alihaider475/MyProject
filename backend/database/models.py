from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
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
    face_image_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # object path in the worker-photos Supabase bucket
    base_salary: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0.0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # Soft-delete flag: deactivated workers are excluded from active-worker
    # selection (e.g. assign-to-violation dropdown) but their row, and every
    # violation/fine FK pointing at it, is preserved for history/payroll.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")

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
    handler_type: Mapped[str] = mapped_column(String(50), nullable=False)  # email | mqtt | webhook | db
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


class VideoJob(Base):
    """Background processing job for an uploaded video (see backend/detection/video_jobs.py)."""

    __tablename__ = "video_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="queued", index=True)
    # queued | processing | done | error
    result_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
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
    status: Mapped[str] = mapped_column(String(20), server_default="pending", index=True)  # pending|paid|deducted|waived
    deduction_month: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)
    waive_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    settlement_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    settled_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    worker: Mapped["Worker"] = relationship("Worker", back_populates="fines")
    violation: Mapped["Violation"] = relationship("Violation", back_populates="fine")


class PayrollRiskAnalysisLog(Base):
    """Audit log for one run of the n8n Payroll Risk Analysis Agent.

    Written only by the n8n agent via POST /admin/payroll/agent/risk-analysis-log.
    This table never affects fine status — it is analysis/audit only (UC_16 amendment:
    the agent does NOT mark fines deducted/waived). Idempotency is enforced on the
    (month, n8n_execution_id) pair so concurrent n8n retries cannot create duplicates.
    """

    __tablename__ = "payroll_risk_analysis_logs"
    __table_args__ = (
        UniqueConstraint("month", "n8n_execution_id", name="uq_payroll_risk_month_exec"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    n8n_execution_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    month: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # YYYY-MM
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # success | empty | failed
    total_workers_analyzed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    high_risk_workers_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    medium_risk_workers_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_violations: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_fine_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    trend: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # improved | worsened | stable
    recommendations_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # JSONB on PostgreSQL (native querying/indexing); plain JSON on SQLite so the
    # test suite (sqlite+aiosqlite :memory:) can create_all() the table unchanged.
    response_snapshot_json: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    backend_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
