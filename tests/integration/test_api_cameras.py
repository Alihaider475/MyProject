from __future__ import annotations

import pytest

from backend.schemas.camera import mask_rtsp_credentials

RTSP = "rtsp://admin:VERIFY123@192.168.100.15:554/ch1/main"


def _body(**overrides):
    body = {
        "name": "EZVIZ TY2",
        "source_type": "rtsp",
        "source_uri": RTSP,
        "detection_confidence": 0.4,
    }
    body.update(overrides)
    return body


def test_mask_rtsp_credentials_hides_password():
    masked = mask_rtsp_credentials(RTSP)
    assert "VERIFY123" not in masked
    assert masked == "rtsp://admin:***@192.168.100.15:554/ch1/main"
    # Webcam index / plain paths untouched.
    assert mask_rtsp_credentials("0") == "0"


async def test_create_rtsp_camera_ok(test_client):
    r = await test_client.post("/api/v1/cameras", json=_body())
    assert r.status_code == 201
    data = r.json()
    assert data["source_type"] == "rtsp"
    assert data["source_uri"] == RTSP  # stored verbatim; only error paths mask it
    assert data["detection_confidence"] == 0.4


async def test_duplicate_name_returns_409(test_client):
    assert (await test_client.post("/api/v1/cameras", json=_body())).status_code == 201
    # Same name, different sub-stream URI -> should be a clean 409, not a 500.
    r = await test_client.post(
        "/api/v1/cameras",
        json=_body(source_uri="rtsp://admin:VERIFY123@192.168.100.15:554/ch1/sub"),
    )
    assert r.status_code == 409
    assert "already exists" in r.json()["detail"].lower()


async def test_duplicate_source_returns_409_and_masks_password(test_client):
    assert (await test_client.post("/api/v1/cameras", json=_body())).status_code == 201
    r = await test_client.post("/api/v1/cameras", json=_body(name="Another Name"))
    assert r.status_code == 409
    assert "VERIFY123" not in r.text  # password never echoed back


async def test_missing_source_uri_returns_422_not_500(test_client):
    body = _body()
    body.pop("source_uri")
    r = await test_client.post("/api/v1/cameras", json=body)
    assert r.status_code == 422


async def test_invalid_confidence_returns_422_not_500(test_client):
    r = await test_client.post("/api/v1/cameras", json=_body(detection_confidence=5.0))
    assert r.status_code == 422


async def test_invalid_rtsp_scheme_no_500_and_password_masked(test_client):
    r = await test_client.post(
        "/api/v1/cameras",
        json=_body(source_uri="http://admin:VERIFY123@192.168.100.15/ch1"),
    )
    assert r.status_code == 422
    assert r.status_code != 500
    assert "VERIFY123" not in r.text  # verification code must not leak in the error


async def test_start_camera_before_ai_ready_returns_structured_503(test_client):
    created = await test_client.post("/api/v1/cameras", json=_body())
    camera_id = created.json()["id"]

    r = await test_client.post(f"/api/v1/cameras/{camera_id}/start")

    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["code"] == "AI_NOT_READY"
    assert "AI model loading" in detail["message"]
    assert detail["readiness"]["ready"] is False
    assert "VERIFY123" not in r.text
