"""Object storage abstraction.

The rest of the application depends only on :class:`ObjectStorage`. The single
shipped implementation talks S3 and therefore works against MinIO, AWS S3, or
any other S3-compatible endpoint purely through configuration.

boto3 is synchronous, so every call is dispatched to a worker thread; this keeps
the event loop free without pulling in a second AWS SDK.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import IO, Any

import anyio
import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings
from app.core.exceptions import NotFoundError, ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class StoredObject:
    key: str
    size: int
    content_type: str
    etag: str | None = None


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
    async def download_to_file(self, key: str, path: str) -> None: ...

    @abc.abstractmethod
    async def delete(self, key: str) -> None: ...

    @abc.abstractmethod
    async def exists(self, key: str) -> bool: ...

    @abc.abstractmethod
    async def presigned_url(
        self, key: str, *, expires_in: int | None = None, download_as: str | None = None
    ) -> str: ...

    @abc.abstractmethod
    async def ensure_bucket(self) -> None: ...

    @abc.abstractmethod
    async def health(self) -> bool: ...


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
    async def _call(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            return await anyio.to_thread.run_sync(lambda: fn(*args, **kwargs))
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in {"NoSuchKey", "404", "NotFound"}:
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

    async def download_to_file(self, key: str, path: str) -> None:
        await self._call(self.client.download_file, self.bucket, key, path)

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
