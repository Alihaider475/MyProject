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

    # Clamp the whole label box (background + baseline) inside the frame so a
    # label anchored at the top/left/right edge is never drawn off-screen.
    frame_h, frame_w = frame.shape[:2]
    # x is the text's left edge; keep [x-padding, x+text_width+padding] in-frame.
    x = max(padding, min(x, frame_w - text_width - padding))
    # y is the text baseline; keep the bg rectangle [y-text_height-padding, y+padding] in-frame.
    y = max(text_height + padding, min(y, frame_h - padding))

    top_left = (x - padding, y - text_height - padding)
    bottom_right = (x + text_width + padding, y + padding)

    overlay = frame.copy()
    cv2.rectangle(overlay, top_left, bottom_right, bg_color, -1)
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness)


def annotate_frame(
    frame: np.ndarray,
    detections: list[Detection],
    hardhat_count: int,
    vest_count: int,
    person_count: int,
    show_email_sent: bool = False,
    mask_count: int = 0,
    violation_count: int = 0,
) -> np.ndarray:
    annotated = frame.copy()

    for det in detections:
        cv2.rectangle(annotated, (det.x1, det.y1), (det.x2, det.y2), det.color, 2)
        if det.class_name == "Person":
            label = f"Person {det.confidence * 100:.0f}%"
            if det.track_id is not None:
                label += f" ID:{det.track_id}"
        else:
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

    # Sideboard counts. Violations get a red background so they stand out on
    # the live overlay (the NO-X boxes themselves are also drawn above).
    sideboard = [
        (f"People: {person_count}", (0, 0, 0)),
        (f"Hardhats: {hardhat_count}", (0, 0, 0)),
        (f"Safety Vests: {vest_count}", (0, 0, 0)),
        (f"Masks: {mask_count}", (0, 0, 0)),
        (f"Violations: {violation_count}", (0, 0, 200) if violation_count else (0, 0, 0)),
    ]
    for i, (text, bg) in enumerate(sideboard):
        draw_text_with_background(
            annotated,
            text,
            (10, 30 + i * 30),
            font_scale=0.5,
            color=(255, 255, 255),
            bg_color=bg,
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
