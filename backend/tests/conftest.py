"""Pytest configuration and fixtures."""
import asyncio
from typing import AsyncGenerator, Generator
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import User, Project, Integration, Report
from app.auth import get_password_hash, create_access_token, create_refresh_token


# Test database URL (in-memory SQLite)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Create test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
    )
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    yield engine
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create test database session."""
    async_session_maker = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    async with async_session_maker() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create test HTTP client with overridden database dependency."""
    
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        email="test@example.com",
        password_hash=get_password_hash("testpassword123")
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_user_token(test_user: User) -> str:
    """Create access token for test user."""
    return create_access_token(data={"sub": str(test_user.id)})


@pytest_asyncio.fixture
async def test_user_refresh_token(test_user: User) -> str:
    """Create refresh token for test user."""
    return create_refresh_token(data={"sub": str(test_user.id)})


@pytest_asyncio.fixture
async def auth_headers(test_user_token: str) -> dict:
    """Get authorization headers for test user."""
    return {"Authorization": f"Bearer {test_user_token}"}


@pytest_asyncio.fixture
async def test_project(db_session: AsyncSession, test_user: User) -> Project:
    """Create a test project."""
    project = Project(
        name="Test Project",
        user_id=test_user.id
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest_asyncio.fixture
async def test_integration_direct(db_session: AsyncSession, test_project: Project) -> Integration:
    """Create a test Yandex.Direct integration."""
    integration = Integration(
        project_id=test_project.id,
        type="yandex_direct",
        access_token="test_access_token",
        refresh_token="test_refresh_token",
        expires_at=datetime.utcnow() + timedelta(hours=1),
        account_info={"login": "test_login", "name": "Test Account"}
    )
    db_session.add(integration)
    await db_session.commit()
    await db_session.refresh(integration)
    return integration


@pytest_asyncio.fixture
async def test_integration_metrika(db_session: AsyncSession, test_project: Project) -> Integration:
    """Create a test Yandex.Metrika integration."""
    integration = Integration(
        project_id=test_project.id,
        type="yandex_metrika",
        access_token="test_metrika_token",
        refresh_token="test_metrika_refresh",
        expires_at=datetime.utcnow() + timedelta(hours=1),
        account_info={"login": "test_metrika_login"}
    )
    db_session.add(integration)
    await db_session.commit()
    await db_session.refresh(integration)
    return integration


@pytest_asyncio.fixture
async def test_integration_sheets(db_session: AsyncSession, test_project: Project) -> Integration:
    """Create a test Google Sheets integration."""
    integration = Integration(
        project_id=test_project.id,
        type="google_sheets",
        access_token="test_sheets_token",
        refresh_token="test_sheets_refresh",
        expires_at=datetime.utcnow() + timedelta(hours=1),
        account_info={"email": "test@gmail.com", "name": "Test User"}
    )
    db_session.add(integration)
    await db_session.commit()
    await db_session.refresh(integration)
    return integration


@pytest_asyncio.fixture
async def test_report(db_session: AsyncSession, test_project: Project) -> Report:
    """Create a test report."""
    report = Report(
        project_id=test_project.id,
        name="Test Report",
        config={
            "sources": [
                {"id": "direct", "type": "direct", "campaign_ids": []}
            ],
            "period": {"type": "last_7_days"},
            "transformations": [],
            "export": {"type": "google_sheets"}
        }
    )
    db_session.add(report)
    await db_session.commit()
    await db_session.refresh(report)
    return report


# Helper functions for tests
def assert_user_response(data: dict):
    """Assert that response contains valid user data."""
    assert "id" in data
    assert "email" in data
    assert "created_at" in data
    assert "password" not in data
    assert "password_hash" not in data


def assert_project_response(data: dict):
    """Assert that response contains valid project data."""
    assert "id" in data
    assert "name" in data
    assert "user_id" in data
    assert "created_at" in data


def assert_report_response(data: dict):
    """Assert that response contains valid report data."""
    assert "id" in data
    assert "name" in data
    assert "project_id" in data
    assert "config" in data
    assert "created_at" in data
