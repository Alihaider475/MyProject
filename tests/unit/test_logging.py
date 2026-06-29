from __future__ import annotations

import logging

from backend.core.logging import SensitiveDataFilter, mask_sensitive_text


def test_mask_sensitive_text_masks_query_tokens_and_passwords():
    text = (
        "/api/v1/stream/11?token=jwt.header.payload&password=VERIFY123 "
        "/api/v1/ws/11?access_token=abc&refresh_token=def"
    )

    masked = mask_sensitive_text(text)

    assert "jwt.header.payload" not in masked
    assert "VERIFY123" not in masked
    assert "access_token=***" in masked
    assert "refresh_token=***" in masked
    assert "token=***" in masked
    assert "password=***" in masked


def test_mask_sensitive_text_masks_rtsp_credentials_and_authorization():
    text = (
        "rtsp://admin:VERIFY123@192.168.100.15:554/ch1/sub "
        "Authorization: Bearer eyJhbGciOi.fake.jwt"
    )

    masked = mask_sensitive_text(text)

    assert "VERIFY123" not in masked
    assert "eyJhbGciOi.fake.jwt" not in masked
    assert "rtsp://admin:***@192.168.100.15:554/ch1/sub" in masked
    assert "Authorization: Bearer ***" in masked


def test_sensitive_filter_masks_record_args():
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="%s %s",
        args=("GET", "/api/v1/ws/11?token=raw.jwt"),
        exc_info=None,
    )

    assert SensitiveDataFilter().filter(record) is True
    assert "raw.jwt" not in record.getMessage()
    assert "token=***" in record.getMessage()
