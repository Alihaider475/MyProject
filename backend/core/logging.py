from __future__ import annotations

import logging
import re
import sys

_CREDENTIALS_RE = re.compile(r"://([^/@:\s]+):([^/@\s]+)@")
_SENSITIVE_QUERY_RE = re.compile(
    r"([?&](?:token|access_token|refresh_token|authorization|password)=)([^&#\s]+)",
    re.IGNORECASE,
)
_AUTH_HEADER_RE = re.compile(r"\b(Authorization\s*[:=]\s*Bearer\s+)([A-Za-z0-9._~+/=-]+)", re.IGNORECASE)


def mask_sensitive_text(value: object) -> object:
    """Mask credentials/tokens in log strings while leaving non-strings alone."""
    if not isinstance(value, str):
        return value
    masked = _CREDENTIALS_RE.sub(lambda m: f"://{m.group(1)}:***@", value)
    masked = _SENSITIVE_QUERY_RE.sub(lambda m: f"{m.group(1)}***", masked)
    masked = _AUTH_HEADER_RE.sub(lambda m: f"{m.group(1)}***", masked)
    return masked


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = mask_sensitive_text(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(mask_sensitive_text(arg) for arg in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: mask_sensitive_text(value) for key, value in record.args.items()}
        return True


_sensitive_filter = SensitiveDataFilter()


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(_sensitive_filter)
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def configure_root_logger(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
    )
    for logger_name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        log = logging.getLogger(logger_name)
        log.addFilter(_sensitive_filter)
        for handler in log.handlers:
            handler.addFilter(_sensitive_filter)
