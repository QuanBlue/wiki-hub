"""The transaction around work done outside a request."""

from __future__ import annotations

import pytest

from app.db import session as session_module


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0
        self.rolled_back = 0

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def commit(self) -> None:
        self.committed += 1

    async def rollback(self) -> None:
        self.rolled_back += 1


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeSession:
    session = FakeSession()
    monkeypatch.setattr(session_module, "get_session_factory", lambda: lambda: session)
    return session


async def test_work_that_goes_well_is_committed(fake: FakeSession) -> None:
    async with session_module.session_scope() as session:
        assert session is fake

    assert (fake.committed, fake.rolled_back) == (1, 0)


async def test_work_that_fails_is_rolled_back_and_the_failure_is_not_hidden(
    fake: FakeSession,
) -> None:
    with pytest.raises(RuntimeError, match="boom"):
        async with session_module.session_scope():
            raise RuntimeError("boom")

    assert (fake.committed, fake.rolled_back) == (0, 1)
