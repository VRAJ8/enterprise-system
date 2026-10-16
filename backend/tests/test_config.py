"""Settings parsing that deployments rely on."""

import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@db:5432/x", "postgresql+asyncpg://u:p@db:5432/x"),
        ("postgresql://u:p@db/x", "postgresql+asyncpg://u:p@db/x"),
        ("postgresql+asyncpg://u:p@db/x", "postgresql+asyncpg://u:p@db/x"),
    ],
)
def test_database_url_uses_async_driver(given, expected):
    assert Settings(database_url=given, _env_file=None).database_url == expected
