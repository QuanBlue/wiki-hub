from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import Mock

import anyio
import pytest
from botocore.exceptions import BotoCoreError, ClientError

from app.core.exceptions import NotFoundError, ServiceUnavailableError
from app.services.storage import S3ObjectStorage, StoredObject, get_storage, set_storage


async def _inline_run_sync(fn, *args, **kwargs):
    return fn(*args, **kwargs)


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code}}, "operation")


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> S3ObjectStorage:
    monkeypatch.setattr(anyio.to_thread, "run_sync", _inline_run_sync)
    return S3ObjectStorage(
        bucket="test-bucket",
        endpoint_url="http://internal",
        public_endpoint_url="http://public",
        region="local",
        access_key="key",
        secret_key="secret",
        path_style=True,
    )


@pytest.mark.asyncio
async def test_storage_operations_and_presigned_urls(storage: S3ObjectStorage, tmp_path) -> None:
    client = Mock()
    signing = Mock()
    storage._client = client
    storage._signing_client = signing

    client.put_object.return_value = {"ETag": '"etag"'}
    assert await storage.put("a", b"data", content_type="text/plain", metadata={"x": "y"}) == StoredObject(
        key="a", size=4, content_type="text/plain", etag='"etag"'
    )
    client.put_object.assert_called_once()

    body = Mock()
    body.read.return_value = b"payload"
    client.get_object.return_value = {"Body": body}
    assert await storage.get("a") == b"payload"

    destination = tmp_path / "download.bin"
    client.download_file.return_value = None
    await storage.download_to_file("a", str(destination))
    client.download_file.assert_called_once_with("test-bucket", "a", str(destination))

    chunks = iter([b"one", b"two", b""])
    stream = Mock()
    stream.read.side_effect = lambda _size: next(chunks)
    stream.close.return_value = None
    client.get_object.return_value = {"Body": stream}
    progress: list[int] = []

    async def on_progress(value: int) -> None:
        progress.append(value)

    await storage.download_to_file("a", str(destination), on_progress=on_progress)
    assert destination.read_bytes() == b"onetwo"
    assert progress == [3, 6]
    stream.close.assert_called_once()

    await storage.upload_file("a", str(destination), content_type="application/octet-stream")
    client.upload_file.assert_called_once()
    await storage.delete("a")
    client.delete_object.assert_called_once_with(Bucket="test-bucket", Key="a")

    client.head_object.return_value = {}
    assert await storage.exists("a") is True
    client.head_object.side_effect = _client_error("NoSuchKey")
    assert await storage.exists("a") is False
    client.head_object.side_effect = None

    signing.generate_presigned_url.side_effect = ["get-url", "put-url", "part-url"]
    assert await storage.presigned_url("a", expires_in=10, download_as='bad"name\\\r') == "get-url"
    assert await storage.presigned_upload_url("a", content_type="text/plain", expires_in=11) == "put-url"
    assert await storage.presigned_upload_part_url("a", "upload", 2, expires_in=12) == "part-url"

    client.create_multipart_upload.return_value = {"UploadId": "upload"}
    assert await storage.start_multipart_upload("a", content_type="application/octet-stream") == "upload"

    client.list_parts.side_effect = [
        {"Parts": [{"PartNumber": 2, "ETag": "b"}], "IsTruncated": True, "NextPartNumberMarker": 2},
        {"Parts": [{"PartNumber": 1, "ETag": "a"}], "IsTruncated": False},
    ]
    assert await storage.list_multipart_parts("a", "upload") == [(2, "b"), (1, "a")]
    await storage.complete_multipart_upload("a", "upload", [(2, "b"), (1, "a")])
    await storage.abort_multipart_upload("a", "upload")


@pytest.mark.asyncio
async def test_storage_listing_bucket_health_and_error_translation(
    storage: S3ObjectStorage,
) -> None:
    client = Mock()
    storage._client = client
    paginator = Mock()
    paginator.paginate.return_value = [
        {"Contents": [{"Key": "a", "Size": 3, "ETag": '"e"', "LastModified": datetime.now(UTC)}]},
        {"Contents": [{"Key": "b"}]},
    ]
    client.get_paginator.return_value = paginator
    assert [item.key for item in await storage.list_objects("prefix/")] == ["a", "b"]

    paginator.paginate.side_effect = _client_error("AccessDenied")
    assert await storage.list_objects() == []

    client.head_bucket.return_value = {}
    await storage.ensure_bucket()
    assert await storage.health() is True

    client.head_bucket.side_effect = _client_error("404")
    client.create_bucket.return_value = {}
    await storage.ensure_bucket()
    client.create_bucket.side_effect = _client_error("BucketAlreadyOwnedByYou")
    await storage.ensure_bucket()

    client.head_bucket.side_effect = BotoCoreError()
    assert await storage.health() is False

@pytest.mark.asyncio
async def test_storage_call_maps_client_errors_and_global_override(
    storage: S3ObjectStorage,
) -> None:
    with pytest.raises(NotFoundError):
        await storage._call(lambda: (_ for _ in ()).throw(_client_error("NotFound")))
    with pytest.raises(ServiceUnavailableError):
        await storage._call(lambda: (_ for _ in ()).throw(_client_error("AccessDenied")))
    with pytest.raises(ServiceUnavailableError):
        await storage._call(lambda: (_ for _ in ()).throw(BotoCoreError()))

    first = storage.client
    assert first is storage.client
    other = S3ObjectStorage(endpoint_url="http://same", public_endpoint_url="http://same")
    other._client = Mock()
    assert other.signing_client is other.client
    set_storage(first)
    assert get_storage() is first
    set_storage(None)


def test_storage_builds_a_distinct_public_signing_client(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = S3ObjectStorage(endpoint_url="http://internal", public_endpoint_url="http://public")
    built = Mock()
    monkeypatch.setattr(storage, "_build_client", Mock(return_value=built))
    assert storage.signing_client is built
    storage._build_client.assert_called_once_with("http://public")


@pytest.mark.asyncio
async def test_storage_bucket_setup_reraises_unknown_errors(
    storage: S3ObjectStorage,
) -> None:
    storage._client = Mock()
    storage._client.head_bucket.side_effect = _client_error("AccessDenied")
    with pytest.raises(ClientError):
        await storage.ensure_bucket()

    storage._client.head_bucket.side_effect = _client_error("404")
    storage._client.create_bucket.side_effect = _client_error("AccessDenied")
    with pytest.raises(ClientError):
        await storage.ensure_bucket()
    assert isinstance(get_storage(), S3ObjectStorage)
    set_storage(None)
