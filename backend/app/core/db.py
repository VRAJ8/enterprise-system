"""Database engine, session factory and declarative base."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime

from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    # Fetch server-generated values (created_at, updated_at, ...) via RETURNING after INSERT/UPDATE,
    # so they're never lazily loaded later (lazy IO is not allowed with AsyncSession).
    __mapper_args__ = {"eager_defaults": True}


def utcnow() -> datetime:
    return datetime.now(UTC)


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def configure(url: str | None = None, **engine_kwargs) -> AsyncEngine:
    """(Re)create the engine. Tests call this to point at a throwaway database."""
    global _engine, _sessionmaker
    _engine = create_async_engine(url or settings.database_url, pool_pre_ping=True, **engine_kwargs)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_engine() -> AsyncEngine:
    if _engine is None:
        configure()
    return _engine  # type: ignore[return-value]


def session_factory() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        configure()
    return _sessionmaker  # type: ignore[return-value]


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request. Handlers commit explicitly."""
    async with session_factory()() as session:
        yield session
