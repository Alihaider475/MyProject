from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.models import Base
from app.db.session import get_db

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def test_client(db_session: AsyncSession):
    from app.main import create_app
    from unittest.mock import AsyncMock, MagicMock

    app = create_app()

    # Override DB dependency
    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db

    # Mock detector and camera manager so tests don't need the model file or webcam
    mock_detector = MagicMock()
    mock_detector.detect.return_value = []

    mock_manager = MagicMock()
    mock_manager.is_running.return_value = False
    mock_manager.start.return_value = None
    mock_manager.stop = AsyncMock()
    mock_manager.start_camera = AsyncMock(return_value=True)
    mock_manager.stop_camera = AsyncMock(return_value=True)
    mock_manager.get_latest_frame.return_value = None
    mock_manager._entries = {}

    app.state.detector = mock_detector
    app.state.camera_manager = mock_manager

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
