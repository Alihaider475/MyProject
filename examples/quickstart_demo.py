"""
Standalone single-file PPE detector — quick model testing without the
FastAPI stack, DB, or Docker.

For production (multi-camera, web dashboard, violation history, alerts to
DB/email/webhook), run the API instead:
    uvicorn app.main:app

This file is intentionally minimal: OpenCV + YOLO + SMTP. No async, no DB,
no persistence beyond the latest violation snapshot JPEG.

Usage:
    cp .env.example .env       # set SENDER_EMAIL, RECEIVER_EMAIL, EMAIL_PASSWORD
    python examples/quickstart_demo.py  # press 'q' in the window to quit
"""
from __future__ import annotations

import os
import sys
import time
import threading
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

import cv2
from dotenv import load_dotenv
from ultralytics import YOLO

load_dotenv()

# ── Config (env-driven, sensible defaults) ──────────────────────────────────
MODEL_PATH = os.getenv("MODEL_PATH", "models/ppe.pt")
DETECTION_CONFIDENCE = float(os.getenv("DETECTION_CONFIDENCE", "0.5"))
VIOLATION_PERSIST_SECONDS = int(os.getenv("VIOLATION_PERSIST_SECONDS", "10"))
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "10"))
WEBCAM_INDEX = int(os.getenv("WEBCAM_INDEX", "0"))

SENDER_EMAIL = os.getenv("SENDER_EMAIL")
RECEIVER_EMAIL = os.getenv("RECEIVER_EMAIL")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))

# Class index → BGR colour, matching app/core/detector.py
COLORS = [
    (255, 0, 0),     # 0 Hardhat
    (0, 255, 0),     # 1 Mask
    (0, 0, 255),     # 2 NO-Hardhat
    (255, 255, 0),   # 3 NO-Mask
    (255, 0, 255),   # 4 NO-Safety Vest
    (0, 255, 255),   # 5 Person
    (128, 0, 128),   # 6 Safety Cone
    (128, 128, 0),   # 7 Safety Vest
    (0, 128, 128),   # 8 Machinery
    (128, 128, 128), # 9 Vehicle
]


def draw_text_with_background(frame, text, position, font_scale=0.4,
                              color=(255, 255, 255), thickness=1,
                              bg_color=(0, 0, 0), alpha=0.7, padding=5):
    font = cv2.FONT_HERSHEY_SIMPLEX
    text_w, text_h = cv2.getTextSize(text, font, font_scale, thickness)[0]
    x, y = position
    overlay = frame.copy()
    cv2.rectangle(overlay,
                  (x - padding, y - text_h - padding),
                  (x + text_w + padding, y + padding),
                  bg_color, -1)
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness)


def send_email_alert(image_path: str) -> None:
    if not SENDER_EMAIL or not EMAIL_PASSWORD:
        print("[email] not configured (SENDER_EMAIL / EMAIL_PASSWORD missing) — skipping")
        return

    msg = MIMEMultipart()
    msg["From"] = SENDER_EMAIL
    msg["To"] = RECEIVER_EMAIL
    msg["Subject"] = "PPE Alert: Hardhat Missing"
    body = ("A person was detected without a hardhat for "
            f"{VIOLATION_PERSIST_SECONDS}+ seconds. Snapshot attached.")
    msg.attach(MIMEText(body, "plain"))

    with open(image_path, "rb") as f:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition",
                        f"attachment; filename={os.path.basename(image_path)}")
        msg.attach(part)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(SENDER_EMAIL, EMAIL_PASSWORD)
            server.sendmail(SENDER_EMAIL, RECEIVER_EMAIL, msg.as_string())
        print(f"[email] sent: {image_path}")
    except Exception as exc:
        print(f"[email] failed: {exc}")


def send_email_in_background(image_path: str) -> None:
    threading.Thread(target=send_email_alert, args=(image_path,), daemon=True).start()


def main() -> None:
    if not os.path.exists(MODEL_PATH):
        sys.exit(f"Model not found at {MODEL_PATH!r}. "
                 f"Set MODEL_PATH in .env or place ppe.pt in models/.")

    model = YOLO(MODEL_PATH)

    # CAP_DSHOW is required on Windows; the default MSMF backend often fails
    # silently (isOpened() returns True, read() returns False).
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(WEBCAM_INDEX, backend)
    if not cap.isOpened():
        sys.exit(f"Cannot open webcam index {WEBCAM_INDEX}. "
                 f"Check OS camera permissions and that no other app is using it.")

    print(f"Webcam {WEBCAM_INDEX} open. Persist={VIOLATION_PERSIST_SECONDS}s, "
          f"Cooldown={ALERT_COOLDOWN_SECONDS}s. Press 'q' to quit.")

    last_hardhat_time = time.time()
    last_alert_time = 0.0   # 0 so first alert can fire immediately once persist threshold elapses
    alert_overlay_until = 0.0

    cv2.namedWindow("YOLOv8 PPE Detection", cv2.WINDOW_NORMAL)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("[error] failed to read frame from webcam")
                break

            results = model(frame, conf=DETECTION_CONFIDENCE, verbose=False)

            hardhat_count = vest_count = person_count = 0
            hardhat_seen = person_seen = False

            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    conf = float(box.conf[0])
                    cls = int(box.cls[0])
                    name = model.names[cls]
                    color = COLORS[cls % len(COLORS)]

                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    draw_text_with_background(frame, f"{name} ({conf:.2f})",
                                              (x1, y1 - 10),
                                              font_scale=0.4, bg_color=color, padding=4)

                    if name == "Hardhat":
                        hardhat_count += 1
                        hardhat_seen = True
                    elif name == "Safety Vest":
                        vest_count += 1
                    elif name == "Person":
                        person_count += 1
                        person_seen = True

            now = time.time()
            if hardhat_seen:
                last_hardhat_time = now

            # Mirror the FastAPI ViolationChecker logic: fire iff person present,
            # no hardhat for PERSIST_SECONDS, and COOLDOWN elapsed since last alert.
            if person_seen and not hardhat_seen:
                time_without_hardhat = now - last_hardhat_time
                time_since_alert = now - last_alert_time
                if (time_without_hardhat >= VIOLATION_PERSIST_SECONDS
                        and time_since_alert >= ALERT_COOLDOWN_SECONDS):
                    image_path = "no_hardhat_frame.jpg"
                    cv2.imwrite(image_path, frame)
                    send_email_in_background(image_path)
                    last_alert_time = now
                    alert_overlay_until = now + 3.0
                    print(f"[alert] NO-Hardhat fired "
                          f"(no hardhat for {time_without_hardhat:.1f}s)")

            for i, text in enumerate([
                f"Hardhats: {hardhat_count}",
                f"Safety Vests: {vest_count}",
                f"People: {person_count}",
            ]):
                draw_text_with_background(frame, text, (10, 30 + i * 30),
                                          font_scale=0.5, padding=5)

            if now < alert_overlay_until:
                draw_text_with_background(frame, "Alert Sent",
                                          (frame.shape[1] - 110, 30),
                                          font_scale=0.5, color=(0, 255, 0), padding=5)

            resized = cv2.resize(frame, (640, 480))
            cv2.imshow("YOLOv8 PPE Detection", resized)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
