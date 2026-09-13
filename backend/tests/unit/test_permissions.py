from app.models.permission import Permission
from app.models.space import SpaceRole
from app.modules.permissions.service import ALL_SPACE_PERMISSIONS, ROLE_PERMISSIONS


def test_legacy_roles_map_to_additive_permissions() -> None:
    assert ROLE_PERMISSIONS[SpaceRole.viewer] == {Permission.view}
    assert ROLE_PERMISSIONS[SpaceRole.editor] == {Permission.view, Permission.add}
    assert ROLE_PERMISSIONS[SpaceRole.admin] == ALL_SPACE_PERMISSIONS


def test_space_admin_preset_contains_all_space_capabilities() -> None:
    assert {
        Permission.view,
        Permission.add,
        Permission.delete,
        Permission.delete_own,
        Permission.restrictions,
        Permission.export,
        Permission.move,
        Permission.admin,
    } <= ALL_SPACE_PERMISSIONS
