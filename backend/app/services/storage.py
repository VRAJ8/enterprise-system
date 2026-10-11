"""Attachment file storage, plus the filename / content-type rules for uploads and downloads.

Files are stored under random keys, never under the uploader's filename: ``ab/ab12…ef.pdf`` (uuid hex,
sharded by its first two characters, plus a whitelisted extension). The active backend comes from
`get_storage()`; `set_storage()` swaps it (tests, or an object-store backend with the same interface).
"""

import mimetypes
import re
import unicodedata
import uuid
from pathlib import Path, PurePosixPath
from typing import Protocol
from urllib.parse import quote

import anyio
from fastapi import UploadFile

from app.core.config import settings
from app.core.errors import BadRequest, PayloadTooLarge

CHUNK_SIZE = 1024 * 1024
MAX_FILENAME_LENGTH = 255
FALLBACK_FILENAME = "file"
OCTET_STREAM = "application/octet-stream"

_KEY_RE = re.compile(r"[0-9a-f]{2}/[0-9a-f]{32}(?:\.[a-z0-9]{1,10})?")
_EXTENSION_RE = re.compile(r"\.[a-z0-9]{1,10}")
_MIME_RE = re.compile(r"[a-z0-9][a-z0-9!#$&^_.+-]{0,62}/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}")
# Control, format (bidi overrides, zero-width…), surrogate and private-use characters.
_UNSAFE_CATEGORIES = {"Cc", "Cf", "Cs", "Co"}

# Images that can carry script; never previewed or served as images.
_SCRIPTABLE_IMAGE_TYPES = {"image/svg+xml"}
# Non-image types browsers won't execute; kept on download. Anything else becomes application/octet-stream.
SAFE_DOWNLOAD_TYPES = frozenset(
    {
        "application/pdf",
        "text/plain",
        "text/csv",
        "text/markdown",
        "application/json",
        "application/zip",
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
)


# ─── Filenames and content types ───


def safe_extension(filename: str | None) -> str:
    """Lower-cased extension of `filename` (``.pdf``) when it is short and alphanumeric, else ``""``."""
    suffix = PurePosixPath((filename or "").replace("\\", "/")).suffix.lower()
    return suffix if _EXTENSION_RE.fullmatch(suffix) else ""


def clean_filename(raw: str | None) -> str:
    """Display name for an upload: basename only, no control characters, at most 255 characters."""
    name = unicodedata.normalize("NFC", raw or "")
    name = "".join(ch for ch in name if unicodedata.category(ch) not in _UNSAFE_CATEGORIES)
    name = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name.strip("."):  # empty, "." or ".."
        return FALLBACK_FILENAME
    if len(name) > MAX_FILENAME_LENGTH:
        ext = safe_extension(name)
        name = name[: MAX_FILENAME_LENGTH - len(ext)].rstrip() + ext
    return name


def detect_content_type(declared: str | None, filename: str) -> str:
    """The client's declared type (parameters dropped) when well-formed, else a guess from the filename."""
    mime = (declared or "").split(";", 1)[0].strip().lower()
    if _MIME_RE.fullmatch(mime) and mime != OCTET_STREAM:
        return mime
    guessed, _ = mimetypes.guess_type(filename, strict=False)
    return guessed.lower() if guessed and _MIME_RE.fullmatch(guessed.lower()) else OCTET_STREAM


def is_image(content_type: str) -> bool:
    return content_type.startswith("image/") and content_type not in _SCRIPTABLE_IMAGE_TYPES


def download_media_type(content_type: str) -> str:
    """Media type to serve a stored file with: images and known-safe types as-is, anything else opaque."""
    if is_image(content_type) or content_type in SAFE_DOWNLOAD_TYPES:
        return content_type
    return OCTET_STREAM


def content_disposition(filename: str, inline: bool = False) -> str:
    """``attachment``/``inline`` header with an ASCII fallback and the RFC 5987 ``filename*`` form."""
    fallback = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode()
    fallback = re.sub(r"[^A-Za-z0-9 ._()+-]", "_", fallback).strip()
    if not re.search(r"[A-Za-z0-9]", fallback.rsplit(".", 1)[0]):  # nothing readable left before the extension
        fallback = "download" + safe_extension(filename)
    disposition = "inline" if inline else "attachment"
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def format_size(num_bytes: int) -> str:
    mb = num_bytes / (1024 * 1024)
    return f"{mb:g} MB" if mb >= 1 else f"{num_bytes // 1024} KB"


# ─── Backends ───


class Storage(Protocol):
    async def save(self, upload: UploadFile, max_bytes: int | None = None) -> tuple[str, int]: ...

    def path(self, key: str) -> Path: ...

    async def delete(self, key: str) -> None: ...


class LocalStorage:
    """Files on the local disk under `base_dir` (default: settings.upload_dir)."""

    def __init__(self, base_dir: Path | str | None = None) -> None:
        self.base_dir = Path(base_dir) if base_dir is not None else Path(settings.upload_dir)

    def path(self, key: str) -> Path:
        """Absolute path of a stored file. Rejects anything that isn't a key this storage generated."""
        if not _KEY_RE.fullmatch(key):
            raise ValueError(f"Invalid storage key: {key!r}")
        return self.base_dir / key

    async def save(self, upload: UploadFile, max_bytes: int | None = None) -> tuple[str, int]:
        """Stream `upload` to disk in chunks under a new random key. Returns (key, size_bytes).

        Raises PayloadTooLarge (file_too_large) past `max_bytes` (default: settings.max_upload_mb)
        and BadRequest (empty_file) for an empty upload; nothing is left on disk in either case.
        """
        limit = max_bytes if max_bytes is not None else settings.max_upload_mb * 1024 * 1024
        too_large = PayloadTooLarge(f"Files can be at most {format_size(limit)}", code="file_too_large")
        if upload.size is not None and upload.size > limit:
            raise too_large

        token = uuid.uuid4().hex
        key = f"{token[:2]}/{token}{safe_extension(upload.filename)}"
        target = anyio.Path(self.path(key))
        await target.parent.mkdir(parents=True, exist_ok=True)
        await upload.seek(0)
        size = 0
        try:
            async with await anyio.open_file(target, "xb") as out:
                while chunk := await upload.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > limit:
                        raise too_large
                    await out.write(chunk)
            if size == 0:
                raise BadRequest("The file is empty", code="empty_file")
        except Exception:
            await target.unlink(missing_ok=True)
            raise
        return key, size

    async def delete(self, key: str) -> None:
        """Remove a stored file (no error if it is already gone)."""
        await anyio.Path(self.path(key)).unlink(missing_ok=True)


_storage: Storage | None = None


def get_storage() -> Storage:
    """The active storage backend (a LocalStorage on settings.upload_dir unless swapped)."""
    global _storage
    if _storage is None:
        _storage = LocalStorage()
    return _storage


def set_storage(storage: Storage | None) -> Storage | None:
    """Replace the active backend (None resets to the default). Returns the previous one."""
    global _storage
    previous, _storage = _storage, storage
    return previous
