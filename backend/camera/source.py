from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np


class CameraSource(ABC):
    @abstractmethod
    async def connect(self) -> bool: ...

    @abstractmethod
    async def read_frame(self) -> np.ndarray | None: ...

    @abstractmethod
    async def release(self) -> None: ...

    @property
    @abstractmethod
    def is_open(self) -> bool: ...
