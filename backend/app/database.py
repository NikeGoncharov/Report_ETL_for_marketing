from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import create_engine
from .config import DATABASE_URL, DATABASE_URL_SYNC

# Async engine for FastAPI
async_engine = create_async_engine(DATABASE_URL, echo=False)
async_session_maker = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

# Sync engine for Alembic migrations
sync_engine = create_engine(DATABASE_URL_SYNC, echo=False)

# Base class for models
Base = declarative_base()


async def get_db() -> AsyncSession:
    """Dependency for getting async database session."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables (for development, use Alembic in production)."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Мини-миграции SQLite: create_all не добавляет колонки в существующие таблицы
        result = await conn.exec_driver_sql("PRAGMA table_info(report_runs)")
        existing = {row[1] for row in result.fetchall()}
        for column in ("period_from", "period_to"):
            if column not in existing:
                await conn.exec_driver_sql(
                    f"ALTER TABLE report_runs ADD COLUMN {column} VARCHAR(10)"
                )
