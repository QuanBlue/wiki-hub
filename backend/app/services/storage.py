"""Object storage abstraction.

The rest of the application depends only on :class:`ObjectStorage`. The single
shipped implementation talks S3 and therefore works against MinIO, AWS S3, or
any other S3-compatible endpoint purely through configuration.

boto3 is synchronous, so every call is dispatched to a worker thread; this keeps
the event loop free without pulling in a second AWS SDK.
"""

from __future__ import annotations

import abc
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from io import BufferedReader, RawIOBase
from typing import IO, Any, cast

import anyio
import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings
from app.core.exceptions import NotFoundError, ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Read-ahead for `open_reader`. A ZIP's central directory is read in many
#: small pieces, so buffering turns that into a few range requests; 1 MiB is
#: large enough to cover a typical directory in one or two round trips
#: without over-fetching when only one small entry is wanted.
_RANGE_READ_BUFFER_BYTES = 1024 * 1024


def _open_binary_for_write(path: str) -> IO[bytes]:
    """Open a destination from a worker thread for streamed downloads."""
    return open(path, "wb")


@dataclass(slots=True)
class StoredObject:
    key: str
    size: int
    content_type: str
    etag: str | None = None
    last_modified: datetime | None = None


class ObjectStorage(abc.ABC):
    """Binary blob store. Attachments and export packages live here, never in Postgres."""

    @abc.abstractmethod
    async def put(
        self,
        key: str,
        data: bytes | IO[bytes],
        *,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> StoredObject: ...

    @abc.abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abc.abstractmethod
    async def get_stream(self, key: str) -> tuple[int, AsyncIterator[bytes]]: ...

    @abc.abstractmethod
    def open_reader(self, key: str) -> IO[bytes]:
        """A seekable, read-only binary handle over a stored object.

        Deliberately synchronous, and the only method here that is: it exists
        for library code that needs random access to a *remote* object and is
        itself synchronous - `zipfile.ZipFile` above all, which seeks to the
        end of an archive to find its central directory and then seeks
        directly to whichever entries it is asked for.

        Only the byte ranges actually read are ever fetched, so listing the
        contents of a multi-GB archive costs kilobytes instead of a full
        download. Callers must run this (and the reads it serves) in a worker
        thread - see `anyio.to_thread.run_sync` - never on the event loop.
        """

    @abc.abstractmethod
    async def upload_part(
        self, key: str, upload_id: str, part_number: int, data: bytes
    ) -> str: ...

    @abc.abstractmethod
    async def download_to_file(
        self,
        key: str,
        path: str,
        *,
        on_progress: Callable[[int], Awaitable[None]] | None = None,
    ) -> None: ...

    @abc.abstractmethod
    async def delete(self, key: str) -> None: ...

    @abc.abstractmethod
    async def exists(self, key: str) -> bool: ...

    @abc.abstractmethod
    async def presigned_url(
        self, key: str, *, expires_in: int | None = None, download_as: str | None = None
    ) -> str: ...

    @abc.abstractmethod
    async def presigned_upload_url(
        self, key: str, *, content_type: str, expires_in: int | None = None
    ) -> str: ...

    @abc.abstractmethod
    async def start_multipart_upload(self, key: str, *, content_type: str) -> str: ...

    @abc.abstractmethod
    async def list_multipart_parts(self, key: str, upload_id: str) -> list[tuple[int, str]]: ...

    @abc.abstractmethod
    async def presigned_upload_part_url(
        self, key: str, upload_id: str, part_number: int, *, expires_in: int | None = None
    ) -> str: ...

    @abc.abstractmethod
    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: list[tuple[int, str]]
    ) -> None: ...

    @abc.abstractmethod
    async def abort_multipart_upload(self, key: str, upload_id: str) -> None: ...

    @abc.abstractmethod
    async def list_objects(self, prefix: str = "") -> list[StoredObject]: ...

    @abc.abstractmethod
    async def ensure_bucket(self) -> None: ...

    @abc.abstractmethod
    async def health(self) -> bool: ...


class _S3RangeReader(RawIOBase):
    """Seekable read-only file over an S3 object, backed by ranged GETs.

    Each `read` becomes a `Range:` request for exactly the bytes asked for,
    so a consumer that only touches part of the object (a ZIP directory
    lookup, say) never pays for the rest of it.
    """

    def __init__(self, storage: S3ObjectStorage, key: str, size: int) -> None:
        self._storage, self._key, self._size, self._pos = storage, key, size, 0

    # -- capabilities -------------------------------------------------------
    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def writable(self) -> bool:
        return False

    # -- positioning --------------------------------------------------------
    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            target = offset
        elif whence == 1:
            target = self._pos + offset
        elif whence == 2:
            target = self._size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        # Seeking past either end is a programming error here, not something
        # to paper over with a clamped position that silently reads the wrong
        # bytes; `zipfile` only ever seeks to offsets it read from the file.
        if target < 0:
            raise OSError("Cannot seek before the start of the object.")
        self._pos = target
        return self._pos

    # -- reading ------------------------------------------------------------
    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = max(0, self._size - self._pos)
        if size == 0 or self._pos >= self._size:
            return b""
        last = min(self._pos + size, self._size) - 1
        result = self._storage._call_sync(
            self._storage.client.get_object,
            Bucket=self._storage.bucket,
            Key=self._key,
            Range=f"bytes={self._pos}-{last}",
        )
        body = result["Body"]
        try:
            payload = body.read()
        finally:
            body.close()
        self._pos += len(payload)
        return payload

    def readinto(self, buffer: Any) -> int:
        payload = self.read(len(buffer))
        buffer[: len(payload)] = payload
        return len(payload)


class S3ObjectStorage(ObjectStorage):
    """S3-compatible implementation (MinIO locally, AWS S3 or equivalent in production)."""

    def __init__(
        self,
        *,
        bucket: str | None = None,
        endpoint_url: str | None = None,
        public_endpoint_url: str | None = None,
        region: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        path_style: bool | None = None,
    ) -> None:
        self.bucket = bucket or settings.s3_bucket
        self._endpoint = endpoint_url or (
            str(settings.s3_endpoint_url) if settings.s3_endpoint_url else None
        )
        self._public_endpoint = public_endpoint_url or (
            str(settings.s3_public_endpoint_url) if settings.s3_public_endpoint_url else None
        )
        self._region = region or settings.s3_region
        self._access_key = access_key or settings.s3_access_key_id
        self._secret_key = secret_key or settings.s3_secret_access_key
        self._path_style = settings.s3_use_path_style if path_style is None else path_style
        self._client: Any = None
        self._signing_client: Any = None

    # -- client construction ------------------------------------------------
    def _build_client(self, endpoint: str | None) -> Any:
        return boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=self._region,
            aws_access_key_id=self._access_key or None,
            aws_secret_access_key=self._secret_key or None,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if self._path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=30,
            ),
        )

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = self._build_client(self._endpoint)
        return self._client

    @property
    def signing_client(self) -> Any:
        """Client bound to the browser-reachable endpoint, used only for presigning.

        Inside Docker the API talks to ``http://minio:9000``, but a browser must be
        handed ``http://localhost:9000``. Signing with the public endpoint keeps the
        signature valid for the URL the user actually fetches.
        """
        if self._public_endpoint is None or self._public_endpoint == self._endpoint:
            return self.client
        if self._signing_client is None:
            self._signing_client = self._build_client(self._public_endpoint)
        return self._signing_client

    # -- operations ---------------------------------------------------------
    def _call_sync(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        """Invoke boto3 directly, mapping its errors the way `_call` does.

        Used only by `open_reader`, whose caller is already on a worker
        thread; everything else goes through `_call`, which adds the
        thread hop.
        """
        try:
            return fn(*args, **kwargs)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in {"NoSuchKey", "NoSuchUpload", "404", "NotFound"}:
                raise NotFoundError("Object not found in storage.") from exc
            logger.error("s3_client_error", code=error_code)
            raise ServiceUnavailableError("Object storage request failed.") from exc
        except BotoCoreError as exc:
            logger.error("s3_transport_error", error=str(exc))
            raise ServiceUnavailableError("Object storage is unreachable.") from exc

    async def _call(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            return await anyio.to_thread.run_sync(lambda: fn(*args, **kwargs))
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in {"NoSuchKey", "NoSuchUpload", "404", "NotFound"}:
                raise NotFoundError("Object not found in storage.") from exc
            logger.error("s3_client_error", code=error_code)
            raise ServiceUnavailableError("Object storage request failed.") from exc
        except BotoCoreError as exc:
            logger.error("s3_transport_error", error=str(exc))
            raise ServiceUnavailableError("Object storage is unreachable.") from exc

    async def put(
        self,
        key: str,
        data: bytes | IO[bytes],
        *,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> StoredObject:
        kwargs: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
        }
        if metadata:
            kwargs["Metadata"] = metadata
        result = await self._call(self.client.put_object, **kwargs)
        size = len(data) if isinstance(data, bytes) else 0
        return StoredObject(key=key, size=size, content_type=content_type, etag=result.get("ETag"))

    async def get(self, key: str) -> bytes:
        result = await self._call(self.client.get_object, Bucket=self.bucket, Key=key)
        body = result["Body"]
        return await anyio.to_thread.run_sync(body.read)

    async def get_stream(self, key: str) -> tuple[int, AsyncIterator[bytes]]:
        """Return the object's size plus an async chunk iterator.

        For a multi-GB export archive, `get()` would pull the whole file into
        this process's RAM before the client sees a single byte - exactly the
        pattern already fixed on the write side of exports. Downloads need the
        same treatment: read from the S3 body in bounded chunks and hand each
        one to the caller as it arrives, so memory stays flat regardless of
        object size and the browser starts receiving bytes immediately.
        """
        result = await self._call(self.client.get_object, Bucket=self.bucket, Key=key)
        body = result["Body"]
        content_length = int(result.get("ContentLength") or 0)

        async def _chunks() -> AsyncIterator[bytes]:
            try:
                while chunk := await anyio.to_thread.run_sync(body.read, 8 * 1024 * 1024):
                    yield chunk
            finally:
                await anyio.to_thread.run_sync(body.close)

        return content_length, _chunks()

    def open_reader(self, key: str) -> IO[bytes]:
        head = self._call_sync(self.client.head_object, Bucket=self.bucket, Key=key)
        raw = _S3RangeReader(self, key, int(head.get("ContentLength") or 0))
        # Buffered so `zipfile`'s many small central-directory reads coalesce
        # into a handful of range requests instead of one per read.
        return cast("IO[bytes]", BufferedReader(raw, buffer_size=_RANGE_READ_BUFFER_BYTES))

    async def upload_part(
        self, key: str, upload_id: str, part_number: int, data: bytes
    ) -> str:
        result = await self._call(
            self.client.upload_part,
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            PartNumber=part_number,
            Body=data,
        )
        return str(result.get("ETag", ""))

    async def download_to_file(
        self,
        key: str,
        path: str,
        *,
        on_progress: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        if on_progress is None:
            await self._call(self.client.download_file, self.bucket, key, path)
            return

        # Stream in chunks when progress is requested. boto3's transfer
        # callback runs on a worker thread, while the import job and its
        # counters live in this async session, so invoking the async callback
        # here keeps progress updates safe and observable by the UI.
        result = await self._call(self.client.get_object, Bucket=self.bucket, Key=key)
        body = result["Body"]
        downloaded = 0
        destination = await anyio.to_thread.run_sync(_open_binary_for_write, path)
        try:
            while chunk := await anyio.to_thread.run_sync(body.read, 8 * 1024 * 1024):
                await anyio.to_thread.run_sync(destination.write, chunk)
                downloaded += len(chunk)
                await on_progress(downloaded)
        finally:
            await anyio.to_thread.run_sync(destination.close)
            await anyio.to_thread.run_sync(body.close)

    async def upload_file(
        self, key: str, path: str, *, content_type: str = "application/octet-stream"
    ) -> None:
        await self._call(
            self.client.upload_file,
            path,
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )

    async def delete(self, key: str) -> None:
        await self._call(self.client.delete_object, Bucket=self.bucket, Key=key)

    async def exists(self, key: str) -> bool:
        try:
            await self._call(self.client.head_object, Bucket=self.bucket, Key=key)
        except NotFoundError:
            return False
        return True

    async def presigned_url(
        self, key: str, *, expires_in: int | None = None, download_as: str | None = None
    ) -> str:
        params: dict[str, Any] = {"Bucket": self.bucket, "Key": key}
        if download_as:
            # Force a download rather than inline rendering - prevents stored XSS
            # from uploaded HTML/SVG being executed on our own origin.
            safe = download_as.replace('"', "").replace("\\", "").replace("\r", "")
            params["ResponseContentDisposition"] = f'attachment; filename="{safe}"'
        url = await anyio.to_thread.run_sync(
            lambda: self.signing_client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_in or settings.s3_presign_ttl_seconds,
            )
        )
        return str(url)

    async def presigned_upload_url(
        self, key: str, *, content_type: str, expires_in: int | None = None
    ) -> str:
        """Give the browser a short-lived, storage-only upload capability.

        The archive does not traverse FastAPI, avoiding request buffering and
        making the configured archive limit enforceable before bytes transfer.
        """
        url = await anyio.to_thread.run_sync(
            lambda: self.signing_client.generate_presigned_url(
                "put_object",
                Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
                ExpiresIn=expires_in or settings.s3_presign_ttl_seconds,
            )
        )
        return str(url)

    async def start_multipart_upload(self, key: str, *, content_type: str) -> str:
        result = await self._call(
            self.client.create_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            ContentType=content_type,
        )
        return str(result["UploadId"])

    async def list_multipart_parts(self, key: str, upload_id: str) -> list[tuple[int, str]]:
        parts: list[tuple[int, str]] = []
        marker: int | None = None
        while True:
            params: dict[str, Any] = {
                "Bucket": self.bucket,
                "Key": key,
                "UploadId": upload_id,
            }
            if marker is not None:
                params["PartNumberMarker"] = marker
            result = await self._call(self.client.list_parts, **params)
            parts.extend(
                (int(part["PartNumber"]), str(part["ETag"])) for part in result.get("Parts", [])
            )
            if not result.get("IsTruncated"):
                return parts
            marker = int(result["NextPartNumberMarker"])

    async def presigned_upload_part_url(
        self, key: str, upload_id: str, part_number: int, *, expires_in: int | None = None
    ) -> str:
        url = await anyio.to_thread.run_sync(
            lambda: self.signing_client.generate_presigned_url(
                "upload_part",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "UploadId": upload_id,
                    "PartNumber": part_number,
                },
                ExpiresIn=expires_in or settings.s3_presign_ttl_seconds,
            )
        )
        return str(url)

    async def complete_multipart_upload(
        self, key: str, upload_id: str, parts: list[tuple[int, str]]
    ) -> None:
        await self._call(
            self.client.complete_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={
                "Parts": [{"PartNumber": number, "ETag": etag} for number, etag in sorted(parts)]
            },
        )

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        await self._call(
            self.client.abort_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
        )

    async def list_objects(self, prefix: str = "") -> list[StoredObject]:
        """List all objects in the bucket (up to 10 000 keys)."""
        objects: list[StoredObject] = []
        paginator = await anyio.to_thread.run_sync(
            lambda: self.client.get_paginator("list_objects_v2")
        )
        params: dict[str, Any] = {"Bucket": self.bucket}
        if prefix:
            params["Prefix"] = prefix

        def _paginate() -> list[dict[str, Any]]:
            items: list[dict[str, Any]] = []
            for page in paginator.paginate(**params):
                items.extend(page.get("Contents", []))
            return items

        try:
            raw = await anyio.to_thread.run_sync(_paginate)
        except (ClientError, BotoCoreError) as exc:
            logger.error("s3_list_error", error=str(exc))
            return []

        for item in raw:
            objects.append(
                StoredObject(
                    key=str(item["Key"]),
                    size=int(item.get("Size", 0)),
                    content_type="application/octet-stream",
                    etag=str(item["ETag"]).strip('"') if item.get("ETag") else None,
                    last_modified=item.get("LastModified"),
                )
            )
        return objects

    async def ensure_bucket(self) -> None:
        """Create the bucket when missing. Safe to call repeatedly at startup."""
        try:
            await anyio.to_thread.run_sync(lambda: self.client.head_bucket(Bucket=self.bucket))
            return
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code not in {"404", "NoSuchBucket", "NotFound"}:
                raise
        try:
            await anyio.to_thread.run_sync(lambda: self.client.create_bucket(Bucket=self.bucket))
            logger.info("s3_bucket_created", bucket=self.bucket)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                raise

    async def health(self) -> bool:
        try:
            await anyio.to_thread.run_sync(lambda: self.client.head_bucket(Bucket=self.bucket))
        except (ClientError, BotoCoreError):
            return False
        return True


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    """Return the configured storage backend."""
    global _storage
    if _storage is None:
        _storage = S3ObjectStorage()
    return _storage


def set_storage(storage: ObjectStorage | None) -> None:
    """Override the backend (used by tests)."""
    global _storage
    _storage = storage
