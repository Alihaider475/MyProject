from __future__ import annotations

import cv2
import numpy as np

from backend.detection.detector import Detection


def draw_text_with_background(
    frame: np.ndarray,
    text: str,
    position: tuple[int, int],
    font_scale: float = 0.4,
    color: tuple[int, int, int] = (255, 255, 255),
    thickness: int = 1,
    bg_color: tuple[int, int, int] = (0, 0, 0),
    alpha: float = 0.7,
    padding: int = 5,
) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    text_size = cv2.getTextSize(text, font, font_scale, thickness)[0]
    text_width, text_height = text_size
    x, y = position

    overlay = frame.copy()
    cv2.rectangle(
        overlay,
        (x - padding, y - text_height - padding),
        (x + text_width + padding, y + padding),
        bg_color,
        -1,
    )
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness)


def annotate_frame(
    frame: np.ndarray,
    detections: list[Detection],
    hardhat_count: int,
    vest_count: int,
    person_count: int,
    show_email_sent: bool = False,
) -> np.ndarray:
    annotated = frame.copy()

    for det in detections:
        cv2.rectangle(annotated, (det.x1, det.y1), (det.x2, det.y2), det.color, 2)
        label = f"{det.class_name} ({det.confidence:.2f})"
        draw_text_with_background(
            annotated,
            label,
            (det.x1, det.y1 - 10),
            font_scale=0.4,
            color=(255, 255, 255),
            bg_color=det.color,
            alpha=0.8,
            padding=4,
        )

    # Sideboard counts
    for i, text in enumerate([
        f"Hardhats: {hardhat_count}",
        f"Safety Vests: {vest_count}",
        f"People: {person_count}",
    ]):
        draw_text_with_background(
            annotated,
            text,
            (10, 30 + i * 30),
            font_scale=0.5,
            color=(255, 255, 255),
            bg_color=(0, 0, 0),
            alpha=0.7,
            padding=5,
        )

    if show_email_sent:
        draw_text_with_background(
            annotated,
            "Alert Sent",
            (annotated.shape[1] - 110, 30),
            font_scale=0.5,
            color=(0, 255, 0),
            bg_color=(0, 0, 0),
            alpha=0.8,
            padding=5,
        )

    return annotated
