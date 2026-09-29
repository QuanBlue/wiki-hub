"""In-app notifications, against real PostgreSQL.

What matters: each person sees only their own, the unread count and the
"something new arrived" signal follow what happens, and the events that should
tell someone something (a password reset by an administrator, a role change,
being added to a group or a space, an administrator request) really do.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.permission import Group, Permission
from app.models.space import SpaceRole
from app.models.user import User
from app.modules.admin_mail.service import AdminMailService
from app.modules.auth.service import AuthService
from app.modules.notifications.service import NotificationService, notify
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.admin_mail import InboxUpdate
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate, UserUpdate
from tests.integration.conftest import unique
from tests.integration.test_admin_mail_service import _admin, _mailbox, _request
from tests.unit.test_admin_mail_smtp import _Server, smtp_server  # noqa: F401

pytestmark = pytest.mark.integration


async def _member(session: AsyncSession, **overrides: object) -> User:
    values: dict[str, object] = {
        "username": unique("member"),
        "email": f"{unique('member')}@example.org",
        "full_name": "Member",
        "password": "Member-password-1",
    }
    values.update(overrides)
    return await AuthService(session).create_user(UserCreate(**values))


async def _mine(session: AsyncSession, user: User, **kwargs: object):
    page = await NotificationService(session, user).list(
        unread_only=bool(kwargs.get("unread_only")), limit=50, offset=0
    )
    return page.items


class TestReadingNotifications:
    async def test_each_person_sees_only_their_own(self, session: AsyncSession) -> None:
        alice, bob = await _member(session), await _member(session)
        await notify(session, alice.id, "group_member_added", params={"group": "Ops"})
        await session.flush()

        assert [n.kind for n in await _mine(session, alice)] == ["group_member_added"]
        assert await _mine(session, bob) == []
        assert (await NotificationService(session, bob).summary()).unread_count == 0

    async def test_the_summary_counts_unread_and_dates_the_newest(
        self, session: AsyncSession
    ) -> None:
        alice = await _member(session)
        service = NotificationService(session, alice)
        empty = await service.summary()
        await notify(session, alice.id, "space_member_added", params={"space": "Docs"})
        await notify(session, alice.id, "group_member_added", params={"group": "Ops"})
        await session.flush()

        summary = await service.summary()

        assert (empty.unread_count, empty.latest_at) == (0, None)
        assert summary.unread_count == 2
        assert summary.latest_at is not None

    async def test_reading_one_or_all_lowers_the_count(self, session: AsyncSession) -> None:
        alice, bob = await _member(session), await _member(session)
        await notify(session, alice.id, "a")
        await notify(session, alice.id, "b")
        await notify(session, bob.id, "c")
        await session.flush()
        service = NotificationService(session, alice)
        first = (await _mine(session, alice))[0]

        await service.mark_read(first.id)
        assert (await service.summary()).unread_count == 1
        assert len(await _mine(session, alice, unread_only=True)) == 1
        await service.mark_read(first.id, read=False)
        assert (await service.summary()).unread_count == 2

        await service.mark_all_read()
        assert (await service.summary()).unread_count == 0
        # Someone else's are not touched.
        assert (await NotificationService(session, bob).summary()).unread_count == 1

    async def test_one_person_cannot_read_anothers(self, session: AsyncSession) -> None:
        alice, bob = await _member(session), await _member(session)
        await notify(session, alice.id, "a")
        await session.flush()
        (item,) = await _mine(session, alice)

        with pytest.raises(NotFoundError):
            await NotificationService(session, bob).mark_read(item.id)

    async def test_nobody_is_notified_of_what_they_did_themselves(
        self, session: AsyncSession
    ) -> None:
        alice = await _member(session)

        await notify(session, alice.id, "group_member_added", actor=alice)
        await session.flush()

        assert await _mine(session, alice) == []

    async def test_the_notification_names_who_did_it(self, session: AsyncSession) -> None:
        alice = await _member(session)
        ada = await _member(session, full_name="Ada Admin")
        await notify(session, alice.id, "group_member_added", actor=ada)
        await session.flush()

        (item,) = await _mine(session, alice)

        assert item.actor_name == "Ada Admin"


class TestEventsThatNotify:
    async def test_a_password_reset_by_an_administrator_tells_the_person(
        self, session: AsyncSession
    ) -> None:
        admin, alice = await _admin(session), await _member(session)

        await AuthService(session, actor=admin).reset_password(alice.id, "New-password-1")
        await session.flush()

        (item,) = await _mine(session, alice)
        assert item.kind == "password_reset_by_admin"
        assert item.actor_name == "Ops"

    async def test_resetting_your_own_password_does_not(self, session: AsyncSession) -> None:
        alice = await _member(session)

        await AuthService(session, actor=alice).reset_password(alice.id, "New-password-1")
        await session.flush()

        assert await _mine(session, alice) == []

    async def test_a_role_change_and_a_re_enabled_account_tell_the_person(
        self, session: AsyncSession
    ) -> None:
        admin, alice = await _admin(session), await _member(session)
        service = AuthService(session, actor=admin)

        await service.update_user(alice.id, UserUpdate(is_active=False))
        await service.update_user(alice.id, UserUpdate(is_active=True))
        # Last: once she is an administrator herself, a peer cannot edit her.
        await service.update_user(alice.id, UserUpdate(is_superuser=True))
        await session.flush()

        kinds = sorted(n.kind for n in await _mine(session, alice))
        # Being switched off cannot be announced to someone who can no longer
        # sign in, but switching back on can.
        assert kinds == ["account_enabled", "role_changed"]
        role = next(n for n in await _mine(session, alice) if n.kind == "role_changed")
        assert role.params == {"role": "admin"}

    async def test_a_new_administrator_request_reaches_the_bell_of_each_mailbox(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        await _mailbox(session, admin, smtp_server)

        await AdminMailService(session).submit_request(
            _request(requester_name="Thanh Quân"), client_ip=None
        )
        await session.flush()

        (item,) = await _mine(session, admin)
        assert item.kind == "admin_request"
        assert item.params["name"] == "Thanh Quân"
        assert item.link is not None and item.link.startswith("/admin/inbox?request=")

    async def test_reading_the_request_in_the_inbox_clears_its_bell_notification(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        await _mailbox(session, admin, smtp_server)
        mail = AdminMailService(session)
        await mail.submit_request(_request(), client_ip=None)
        await session.flush()
        (page,) = [await mail.list_inbox(admin, status="all", limit=1, offset=0)]
        request_id = page.items[0].id

        assert (await NotificationService(session, admin).summary()).unread_count == 1

        # Read from the Inbox, not from the bell - the other surface entirely.
        await mail.update_inbox_item(admin, request_id, InboxUpdate(read=True))
        await session.flush()

        assert (await NotificationService(session, admin).summary()).unread_count == 0

    async def test_mark_all_read_in_the_inbox_clears_matching_bell_notifications_only(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        await _mailbox(session, admin, smtp_server)
        mail = AdminMailService(session)
        await mail.submit_request(_request(), client_ip=None)
        await notify(session, admin.id, "group_member_added", params={"group": "Ops"})
        await session.flush()
        assert (await NotificationService(session, admin).summary()).unread_count == 2

        await mail.mark_all_read(admin)
        await session.flush()

        # The request notification is gone, but an unrelated one is untouched.
        kinds = [n.kind for n in await _mine(session, admin) if n.read_at is None]
        assert kinds == ["group_member_added"]


class TestAccessEventsNotify:
    async def _space(self, session: AsyncSession, admin: User):
        return await SpaceService(session).create(
            SpaceCreate(key=unique("S").upper()[:10], name="Docs"), admin
        )

    async def test_being_added_changed_and_removed_from_a_space_each_tell_the_person(
        self, session: AsyncSession
    ) -> None:
        admin, alice = await _admin(session), await _member(session)
        space = await self._space(session, admin)
        spaces = SpaceService(session)

        await spaces.set_member(space, admin, alice.id, SpaceRole.viewer)
        await spaces.set_member(space, admin, alice.id, SpaceRole.viewer)  # no change: silent
        await spaces.set_member(space, admin, alice.id, SpaceRole.editor)
        await spaces.remove_member(space, admin, alice.id)
        await session.flush()

        # (Every row here shares one transaction timestamp, so look them up by kind.)
        items = {n.kind: n for n in await _mine(session, alice)}
        assert sorted(items) == [
            "space_member_added",
            "space_member_removed",
            "space_role_changed",
        ]
        assert items["space_member_added"].params == {"space": "Docs", "role": "viewer"}
        assert items["space_role_changed"].params["role"] == "editor"
        assert items["space_member_added"].link == f"/spaces/{space.key}"
        assert items["space_member_removed"].link is None  # nowhere left to go

    async def test_being_added_to_a_group_tells_the_person(self, session: AsyncSession) -> None:
        admin, alice = await _admin(session), await _member(session)
        group = Group(name="Ops", owner_id=admin.id)
        session.add(group)
        await session.flush()
        permissions = PermissionService(session)

        await permissions.set_group_member(group, alice.id, admin, True)
        await permissions.set_group_member(group, alice.id, admin, False)
        await session.flush()

        items = await _mine(session, alice)
        assert sorted(n.kind for n in items) == ["group_member_added", "group_member_removed"]
        assert all(n.params == {"group": "Ops"} for n in items)

    async def test_a_space_permission_granted_to_a_person_tells_them_but_not_a_group(
        self, session: AsyncSession
    ) -> None:
        admin, alice = await _admin(session), await _member(session)
        space = await self._space(session, admin)
        permissions = PermissionService(session)

        await permissions.set_space_permission(
            space, alice.id, Permission.add, admin, group=False, present=True
        )
        await session.flush()

        (item,) = await _mine(session, alice)
        assert item.kind == "space_permission_granted"
        assert item.params == {"space": "Docs", "permission": "add"}

    async def test_becoming_a_space_owner_tells_the_person(self, session: AsyncSession) -> None:
        admin, alice = await _admin(session), await _member(session)
        space = await self._space(session, admin)

        await PermissionService(session).set_space_owners(space, [admin.id, alice.id], admin)
        await session.flush()

        (item,) = await _mine(session, alice)
        assert (item.kind, item.actor_name) == ("space_owner_added", "Ops")
        # The existing owner did not change, so nothing for them.
        assert await _mine(session, admin) == []
