from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import create_engine, event
from .config import DATABASE_URL, DATABASE_URL_SYNC

# SQLite под конкурентной записью: без этих PRAGMA долгий прогон отчёта держит
# writer-lock, и любая параллельная запись немедленно падает с "database is locked".
#  - journal_mode=WAL: читатели не блокируют писателя (персистентная настройка файла БД);
#  - busy_timeout=30000: ждать освобождения блокировки до 30с вместо мгновенной ошибки;
#  - foreign_keys=ON: SQLite иначе игнорирует внешние ключи (per-connection).
_SQLITE_TIMEOUT_S = 30


def _apply_sqlite_pragmas(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


# Async engine for FastAPI
async_engine = create_async_engine(
    DATABASE_URL, echo=False, connect_args={"timeout": _SQLITE_TIMEOUT_S}
)
async_session_maker = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

# Sync engine for Alembic migrations
sync_engine = create_engine(
    DATABASE_URL_SYNC, echo=False, connect_args={"timeout": _SQLITE_TIMEOUT_S}
)

# PRAGMA на КАЖДОЕ новое соединение обоих движков (для async слушаем sync_engine-обёртку —
# рекомендованный SQLAlchemy способ настроить aiosqlite).
event.listen(async_engine.sync_engine, "connect", _apply_sqlite_pragmas)
event.listen(sync_engine, "connect", _apply_sqlite_pragmas)

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
