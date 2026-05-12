from __future__ import annotations

from abc import ABC, abstractmethod

from backend.core.violation_checker import ViolationEvent


class AlertHandler(ABC):
    @property
    @abstractmethod
    def handler_type(self) -> str: ...

    @abstractmethod
    async def send(self, violation: ViolationEvent) -> bool:
        """Send alert. Returns True on success, False on failure."""
        ...
