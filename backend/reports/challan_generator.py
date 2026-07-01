from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO

from backend.core.config import settings
from backend.core.logging import get_logger
from backend.storage import supabase_storage

logger = get_logger(__name__)

_CYAN = (6 / 255, 182 / 255, 212 / 255)  # #06b6d4
_DARK = (0.1, 0.1, 0.1)
_GREY = (0.4, 0.4, 0.4)


def create_challan_pdf(fine: object, worker: object, violation_event: object) -> bytes:
    """Return PDF bytes; on failure return a minimal error PDF."""
    try:
        return _build_pdf(fine, worker, violation_event)
    except Exception as exc:
        logger.warning("Challan PDF generation failed: %s", exc, exc_info=True)
        try:
            return _error_pdf(str(exc))
        except Exception:
            return b""


def _build_pdf(fine: object, worker: object, violation_event: object) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as rl_canvas

    from backend.core.config import settings

    buf = BytesIO()
    pw, ph = A4  # 595.27 x 841.89 pt
    c = rl_canvas.Canvas(buf, pagesize=A4)

    # ── Helpers ──────────────────────────────────────────────────────────────────
    def fill(r: float, g: float, b: float) -> None:
        c.setFillColorRGB(r, g, b)

    def _section(label: str, y: float) -> None:
        fill(*_CYAN)
        c.rect(20, y - 2, 3, 16, fill=1, stroke=0)
        fill(*_DARK)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(28, y, label)

    def _row(label: str, value: str, x: float, y: float, col2: float = 140) -> None:
        fill(*_GREY)
        c.setFont("Helvetica", 9)
        c.drawString(x, y, f"{label}:")
        fill(*_DARK)
        c.drawString(x + col2, y, str(value))

    # ── Prep values ──────────────────────────────────────────────────────────────
    challan_number = getattr(fine, "challan_number", "CH-????")
    fine_date = getattr(fine, "fine_date", None) or datetime.now(timezone.utc)
    date_str = fine_date.strftime("%Y-%m-%d") if hasattr(fine_date, "strftime") else str(fine_date)[:10]
    time_str = fine_date.strftime("%Y-%m-%d %H:%M") if hasattr(fine_date, "strftime") else date_str

    worker_name = getattr(worker, "name", "Unknown") if worker else "Unknown"
    employee_id = getattr(worker, "employee_id", "N/A") if worker else "N/A"
    phone = getattr(worker, "phone_number", None) if worker else None

    cam_id = getattr(violation_event, "camera_id", "N/A")
    viol_type = getattr(violation_event, "violation_type", "N/A")
    frame_path = getattr(violation_event, "frame_path", None)

    fine_amount = getattr(fine, "fine_amount", 0.0)
    currency = getattr(fine, "currency", "PKR")
    deduction_month = getattr(fine, "deduction_month", None)
    payment_due = (
        (fine_date + timedelta(days=30)).strftime("%Y-%m-%d")
        if hasattr(fine_date, "strftime")
        else "N/A"
    )

    # ── Header Band ──────────────────────────────────────────────────────────────
    header_h = 80
    hy = ph - header_h
    fill(*_CYAN)
    c.rect(0, hy, pw, header_h, fill=1, stroke=0)

    fill(1, 1, 1)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20, hy + 50, settings.COMPANY_NAME)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20, hy + 30, "SAFETY VIOLATION CHALLAN")
    c.setFont("Helvetica", 9)
    c.drawRightString(pw - 20, hy + 50, f"Challan: {challan_number}")
    c.drawRightString(pw - 20, hy + 33, f"Date: {date_str}")

    # ── Worker Information ────────────────────────────────────────────────────────
    y = hy - 30
    _section("WORKER INFORMATION", y)
    y -= 22
    for lbl, val in [
        ("Employee ID", employee_id),
        ("Name", worker_name),
        ("Phone", phone or "N/A"),
    ]:
        _row(lbl, val, 20, y)
        y -= 17

    # ── Violation Details + QR Code ───────────────────────────────────────────────
    y -= 10
    _section("VIOLATION DETAILS", y)
    y -= 22

    # QR Code (right side)
    qr_size = 80
    qr_x = pw - qr_size - 20
    qr_top = y
    try:
        import qrcode as _qrcode
        qr_img = _qrcode.make(challan_number)
        qr_buf = BytesIO()
        qr_img.save(qr_buf, format="PNG")
        qr_buf.seek(0)
        c.drawImage(ImageReader(qr_buf), qr_x, qr_top - qr_size, width=qr_size, height=qr_size)
    except Exception:
        pass  # skip if qrcode unavailable

    # Violation fields (left side)
    for lbl, val in [
        ("Date & Time", time_str),
        ("Camera", f"Camera {cam_id}"),
        ("Violation", viol_type),
    ]:
        _row(lbl, val, 20, y)
        y -= 17

    # Snapshot image
    if frame_path:
        snap_url = supabase_storage.public_url(settings.SUPABASE_VIOLATION_BUCKET, frame_path)
        snap_bytes = supabase_storage.fetch_bytes_sync(snap_url)
        if snap_bytes:
            try:
                snap_w, snap_h = 200, 130
                c.drawImage(
                    ImageReader(BytesIO(snap_bytes)),
                    20, y - snap_h,
                    width=snap_w, height=snap_h,
                    preserveAspectRatio=True,
                    mask="auto",
                )
                y -= snap_h + 10
            except Exception:
                pass

    # Ensure y is below QR bottom
    qr_bottom = qr_top - qr_size - 10
    if y > qr_bottom:
        y = qr_bottom

    # ── Fine Details ──────────────────────────────────────────────────────────────
    y -= 10
    _section("FINE DETAILS", y)
    y -= 22
    for lbl, val in [
        ("Fine Amount", f"{currency} {fine_amount:.2f}"),
        ("Payment Due", payment_due),
        ("Deduction Month", deduction_month or "Not set"),
    ]:
        _row(lbl, val, 20, y)
        y -= 17

    # ── Footer Band ───────────────────────────────────────────────────────────────
    footer_h = 70
    fill(0.95, 0.95, 0.95)
    c.rect(0, 0, pw, footer_h, fill=1, stroke=0)
    fill(0.3, 0.3, 0.3)
    c.setFont("Helvetica", 8.5)
    c.drawString(20, footer_h - 14, "This amount will be deducted from your salary.")
    c.drawString(20, footer_h - 27, "To appeal, contact HR within 7 days of issue date.")
    c.drawString(20, footer_h - 44, "Safety Officer: ___________________")
    c.drawString(20, footer_h - 57, "Contact: safety@company.com  |  HR: hr@company.com")

    c.save()
    return buf.getvalue()


def _error_pdf(error_msg: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rl_canvas

    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    _, h = A4
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, h - 80, "PDF Generation Failed")
    c.setFont("Helvetica", 10)
    c.drawString(50, h - 110, f"Error: {error_msg[:200]}")
    c.save()
    return buf.getvalue()
