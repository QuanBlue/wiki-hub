from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

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
    assert await storage.put(
        "a", b"data", content_type="text/plain", metadata={"x": "y"}
    ) == StoredObject(key="a", size=4, content_type="text/plain", etag='"etag"')
    client.put_object.assert_called_once()

    body = Mock()
    body.read.return_value = b"payload"
    client.get_object.return_value = {"Body": body}
    assert await storage.get("a") == b"payload"

    stream_chunks = iter([b"aaaa", b"bbbb", b""])
    stream_body = Mock()
    stream_body.read.side_effect = lambda _size: next(stream_chunks)
    stream_body.close.return_value = None
    client.get_object.return_value = {"Body": stream_body, "ContentLength": 8}
    content_length, chunk_iter = await storage.get_stream("a")
    assert content_length == 8
    assert [chunk async for chunk in chunk_iter] == [b"aaaa", b"bbbb"]
    stream_body.close.assert_called_once()

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

    client.head_object.return_value = {"ContentLength": 42}
    assert await storage.stat("a") == 42
    client.head_object.side_effect = _client_error("NoSuchKey")
    assert await storage.stat("a") is None
    client.head_object.side_effect = None

    client.generate_presigned_url.return_value = "internal-url"
    assert await storage.presigned_internal_url("a", expires_in=9) == "internal-url"
    client.generate_presigned_url.assert_called_once_with(
        "get_object", Params={"Bucket": "test-bucket", "Key": "a"}, ExpiresIn=9
    )

    signing.generate_presigned_url.side_effect = ["get-url", "put-url", "part-url"]
    assert await storage.presigned_url("a", expires_in=10, download_as='bad"name\\\r') == "get-url"
    assert (
        await storage.presigned_upload_url("a", content_type="text/plain", expires_in=11)
        == "put-url"
    )
    assert await storage.presigned_upload_part_url("a", "upload", 2, expires_in=12) == "part-url"

    client.create_multipart_upload.return_value = {"UploadId": "upload"}
    assert (
        await storage.start_multipart_upload("a", content_type="application/octet-stream")
        == "upload"
    )

    client.upload_part.return_value = {"ETag": '"part-etag"'}
    assert await storage.upload_part("a", "upload", 1, b"chunk") == '"part-etag"'
    client.upload_part.assert_called_once_with(
        Bucket="test-bucket", Key="a", UploadId="upload", PartNumber=1, Body=b"chunk"
    )

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


# -- download_to_file: must survive a connection dropped mid-transfer -------


@pytest.mark.asyncio
async def test_download_to_file_resumes_after_a_broken_stream(
    storage: S3ObjectStorage, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A `body.read()` failure partway through must not discard the download.

    Reproduces the real-world failure: a multi-GB restore archive whose
    connection to storage broke mid-stream (`Connection broken:
    IncompleteRead(...)`) after some bytes had already arrived. The fix
    retries with a ranged GET resuming from the last confirmed byte instead
    of failing the whole download.
    """
    sleeps: list[float] = []

    async def _no_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(anyio, "sleep", _no_sleep)

    client = Mock()
    storage._client = client

    first_body = Mock()
    # The first attempt reads two good chunks, then the connection breaks.
    first_body.read.side_effect = [b"one-", BotoCoreError()]
    first_body.close.return_value = None

    second_body = Mock()
    second_chunks = iter([b"two-", b"three", b""])
    second_body.read.side_effect = lambda _size: next(second_chunks)
    second_body.close.return_value = None

    responses = iter([{"Body": first_body}, {"Body": second_body}])
    client.get_object.side_effect = lambda **_kwargs: next(responses)

    destination = tmp_path / "restore.zip"
    progress: list[int] = []

    async def on_progress(value: int) -> None:
        progress.append(value)

    await storage.download_to_file("a", str(destination), on_progress=on_progress)

    assert destination.read_bytes() == b"one-two-three"
    assert progress == [4, 8, 13]

    # The retried request must resume from the last confirmed byte, not
    # restart from zero.
    calls = client.get_object.call_args_list
    assert "Range" not in calls[0].kwargs
    assert calls[1].kwargs["Range"] == "bytes=4-"
    assert sleeps == [2]


@pytest.mark.asyncio
async def test_get_range_streams_a_ranged_get_and_reports_the_true_total(
    storage: S3ObjectStorage,
) -> None:
    """The total object size (for a `Content-Range` response header) is only
    ever findable after the slash - `ContentLength` on a ranged GET is the
    size of the *slice* returned, not the whole object.
    """
    client = Mock()
    storage._client = client
    chunks = iter([b"mid", b""])
    body = Mock()
    body.read.side_effect = lambda _size: next(chunks)
    body.close.return_value = None
    client.get_object.return_value = {
        "Body": body,
        "ContentRange": "bytes 10-12/12345",
        "ContentLength": 3,
    }

    total, chunk_iter = await storage.get_range("a", 10, 12)

    assert total == 12345
    assert [chunk async for chunk in chunk_iter] == [b"mid"]
    body.close.assert_called_once()
    client.get_object.assert_called_once_with(Bucket="test-bucket", Key="a", Range="bytes=10-12")


@pytest.mark.asyncio
async def test_get_range_falls_back_to_content_length_without_a_content_range(
    storage: S3ObjectStorage,
) -> None:
    """A backend that omits `Content-Range` on a ranged GET (seen from some
    S3-compatible stores) leaves `ContentLength` - the size of the slice
    itself - as the only size available at all."""
    client = Mock()
    storage._client = client
    chunks = iter([b"data", b""])
    body = Mock()
    body.read.side_effect = lambda _size: next(chunks)
    body.close.return_value = None
    client.get_object.return_value = {"Body": body, "ContentLength": 4}

    total, chunk_iter = await storage.get_range("a", 0, 3)

    assert total == 4
    assert [chunk async for chunk in chunk_iter] == [b"data"]


@pytest.mark.asyncio
async def test_download_to_file_gives_up_after_repeated_failures(
    storage: S3ObjectStorage, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(anyio, "sleep", AsyncMock())

    client = Mock()
    storage._client = client

    def _always_broken(**_kwargs) -> dict:
        body = Mock()
        body.read.side_effect = BotoCoreError()
        body.close.return_value = None
        return {"Body": body}

    client.get_object.side_effect = _always_broken

    with pytest.raises(ServiceUnavailableError):
        await storage.download_to_file(
            "a", str(tmp_path / "restore.zip"), on_progress=AsyncMock()
        )

    assert client.get_object.call_count == 8


# -- open_reader: ranged random access over a remote object -----------------


def _range_backed_client(payload: bytes) -> Mock:
    """A client whose `get_object` honours the `Range` header, like S3 does."""
    client = Mock()
    client.head_object.return_value = {"ContentLength": len(payload)}

    def _get_object(*, Bucket: str, Key: str, Range: str) -> dict:
        first, last = Range.removeprefix("bytes=").split("-")
        chunk = payload[int(first) : int(last) + 1]
        body = Mock()
        body.read.return_value = chunk
        return {"Body": body}

    client.get_object.side_effect = _get_object
    return client


def test_open_reader_serves_seeks_from_ranged_gets(storage: S3ObjectStorage) -> None:
    payload = bytes(range(256)) * 64
    storage._client = _range_backed_client(payload)

    with storage.open_reader("k") as reader:
        assert reader.read(16) == payload[:16]
        reader.seek(1000)
        assert reader.read(8) == payload[1000:1008]
        # Seeking relative to the end is how `zipfile` finds a ZIP's central
        # directory, so it has to work on a remote object too.
        reader.seek(-32, 2)
        assert reader.read() == payload[-32:]
        # Reading at EOF terminates rather than looping forever.
        assert reader.read(16) == b""


def test_open_reader_fetches_only_what_is_read(storage: S3ObjectStorage) -> None:
    """The property the space-list preview depends on: cost tracks bytes
    read, not object size."""
    payload = b"\0" * (64 * 1024 * 1024)
    client = _range_backed_client(payload)
    storage._client = client

    with storage.open_reader("k") as reader:
        reader.seek(len(payload) - 128)
        assert len(reader.read(128)) == 128

    fetched = sum(
        int(call.kwargs["Range"].removeprefix("bytes=").split("-")[1])
        - int(call.kwargs["Range"].removeprefix("bytes=").split("-")[0])
        + 1
        for call in client.get_object.call_args_list
    )
    assert fetched < len(payload) // 100


def test_open_reader_maps_a_missing_object_to_not_found(storage: S3ObjectStorage) -> None:
    storage._client = Mock()
    storage._client.head_object.side_effect = _client_error("NoSuchKey")
    with pytest.raises(NotFoundError):
        storage.open_reader("gone")


def test_open_reader_maps_transport_failure_to_unavailable(storage: S3ObjectStorage) -> None:
    storage._client = Mock()
    storage._client.head_object.side_effect = BotoCoreError()
    with pytest.raises(ServiceUnavailableError):
        storage.open_reader("k")


def test_open_reader_maps_an_unrecognised_client_error_to_unavailable(
    storage: S3ObjectStorage,
) -> None:
    """Distinct from the NoSuchKey case above: any other S3 error code (a
    permissions problem, say) is not a "not found" and must not be reported
    as one."""
    storage._client = Mock()
    storage._client.head_object.side_effect = _client_error("AccessDenied")
    with pytest.raises(ServiceUnavailableError):
        storage.open_reader("k")


def test_open_reader_rejects_a_seek_before_the_start(storage: S3ObjectStorage) -> None:
    storage._client = _range_backed_client(b"payload")
    with storage.open_reader("k") as reader, pytest.raises(OSError):
        reader.seek(-1)


def test_range_reader_raw_methods_used_directly(storage: S3ObjectStorage) -> None:
    """`open_reader` wraps the raw reader in a `BufferedReader` for
    `zipfile`'s benefit, which is why the whole-file/relative-seek/no-size-
    read branches below never fire through the public `reader` object in the
    tests above - `BufferedReader.read()` always asks its raw stream for a
    fixed size, never -1 or none, and `zipfile` itself only ever seeks
    absolute or from-the-end. Calling `.raw` bypasses the buffering to
    exercise those branches directly.
    """
    payload = bytes(range(256))
    storage._client = _range_backed_client(payload)

    with storage.open_reader("k") as reader:
        raw = reader.raw  # type: ignore[attr-defined]
        assert raw.writable() is False

        raw.seek(10)
        raw.seek(5, 1)  # relative to the current position
        assert raw.tell() == 15

        with pytest.raises(ValueError, match="Unsupported whence"):
            raw.seek(0, 3)

        # No size at all - reads everything remaining, the branch a
        # BufferedReader never triggers (it always requests a fixed size).
        assert raw.read() == payload[15:]
