"""What the chat knows about the person asking and about WikiHub itself.

Two things the wiki's pages cannot say: *who is asking* (their spaces, the role they hold in each,
what they may do across the workspace) and *how the application works* (where a setting is, why
something may not work). Both are read on the server, for the person who is asking, only when the
question is about them, and are handed to the model as data in the question - never as
instructions, and never anything about anyone else.

The same table that picks the guidance also picks the buttons shown under the answer: a question
about changing a password offers a button to the account page; one about backups offers the
backup page, but only to someone who may open it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.permission import GlobalPermission
from app.models.user import User
from app.modules.ai.answer import prompt_text
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.ai import AnswerAction
from app.schemas.space import SpaceRead

#: How many spaces are listed to the model, and offered as buttons.
MAX_SPACES = 40
MAX_SPACE_BUTTONS = 6
MAX_TOPICS = 3
MAX_ACTIONS = 6

_OWN_TAGS = re.compile(r"</?\s*(?:account|app_guide|topic)\b[^>]*>", re.IGNORECASE)


def fold(text: str) -> str:
    """Lower case without accents, so ``Quyền`` and ``quyen`` are the same word."""
    decomposed = unicodedata.normalize("NFD", text.casefold().replace("đ", "d"))
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


@dataclass(frozen=True)
class Link:
    href: str
    en: str
    vi: str


@dataclass(frozen=True)
class Topic:
    id: str
    title: str
    #: Words (accent-free, lower case) that make the topic relevant to a question.
    keywords: tuple[str, ...]
    #: What the model may say about it. Plain statements of how WikiHub works.
    guide: str
    links: tuple[Link, ...] = ()
    #: ``admin`` (a system administrator) or a global permission name; ``None`` for everyone.
    requires: str | None = None
    #: A topic about the person's own spaces: the buttons also list those spaces.
    lists_spaces: bool = False
    #: A catch-all (the user guide, troubleshooting): only used when nothing more specific matched.
    generic: bool = False
    #: The question may be a request to *do* something: the model may propose a plan.
    plan: bool = False


#: What the model is told it can propose, when the question asks it to do something.
PLAN_GUIDE = (
    "Actions this person may ask you to do (propose them; the person confirms before anything "
    "runs):"
    + chr(10)
    + '- create_space: {"type":"create_space","name":"...","description":"(optional)",'
    '"visibility":"open|restricted"} - needs the create-space permission. The key is made from '
    "the name; do not invent one."
    + chr(10)
    + '- create_page: {"type":"create_page","space":"<key of an existing space from <account>, '
    'or $1 for the space made by step 1>","title":"...","prompt":"what the page must cover, '
    '1-3 sentences, in the language of the page"} - needs the editor role in that space; an AI '
    "draft is written from the prompt when the plan runs."
    + chr(10)
    + '- favorite_space: {"type":"favorite_space","space":"<key>"}'
    + chr(10)
    + '- add_space_member: {"type":"add_space_member","space":"<key>","username":"...",'
    '"role":"viewer|editor|admin"} - needs the admin role in that space.'
    + chr(10)
    + "Keys are for the steps only: never show a key to the person."
)

TOPICS: tuple[Topic, ...] = (
    Topic(
        id="actions",
        title="Doing things for the person",
        keywords=(
            "tao",
            "tao giup",
            "lam giup",
            "giup toi tao",
            "create",
            "make a",
            "add member",
            "them thanh vien",
            "them nguoi",
            "cap quyen cho",
            "yeu thich",
            "star space",
            "favorite space",
        ),
        guide=PLAN_GUIDE,
        plan=True,
    ),
    Topic(
        id="my-access",
        title="Your spaces, roles and permissions",
        keywords=(
            "space",
            "spaces",
            "khong gian",
            "quyen truy cap",
            "quyen cua toi",
            "toi co quyen",
            "vai tro",
            "my access",
            "my role",
            "my roles",
            "my permissions",
            "my spaces",
            "permission",
            "permissions",
            "quyen han",
            "access to",
            "who am i",
            "toi la ai",
        ),
        guide=(
            "The <account> block lists every space this person can open, with their role in it "
            "(viewer reads; editor also adds and edits pages; admin also manages the space) and "
            "whether they own it. A space that is not listed is one they cannot open. Spaces are "
            "Open (every signed-in person reads and writes) or Restricted (only people granted "
            "access). Roles are set per space by its owners or by a system administrator."
        ),
        links=(Link("/spaces", "Open Spaces", "Mở danh sách Space"),),
        lists_spaces=True,
    ),
    Topic(
        id="cannot-see",
        title="Cannot see or open a page or space",
        keywords=(
            "khong xem duoc",
            "khong mo duoc",
            "khong vao duoc",
            "khong thay",
            "khong co quyen",
            "khong truy cap",
            "cannot see",
            "cannot open",
            "cannot access",
            "can't see",
            "can't open",
            "can't access",
            "no access",
            "no permission",
            "access denied",
            "forbidden",
            "403",
            "restricted",
            "han che",
        ),
        guide=(
            "A page or space is hidden from someone when the space is Restricted and they were not "
            "given access, or when the page itself has view restrictions (child pages inherit "
            "their parent's restrictions). If it is not in the <account> list, they have no access "
            "to that space: ask a space owner or a system administrator to grant it. A space owner "
            "can see and change who has access in Edit space > Access & Permissions."
        ),
        links=(
            Link("/spaces", "Open Spaces", "Mở danh sách Space"),
            Link("/admin/spaces", "Manage spaces", "Quản lý Space"),
        ),
    ),
    Topic(
        id="account",
        title="Profile, password and sessions",
        keywords=(
            "profile",
            "ho so",
            "avatar",
            "anh dai dien",
            "ten hien thi",
            "display name",
            "password",
            "mat khau",
            "doi mat khau",
            "session",
            "sessions",
            "phien dang nhap",
            "dang xuat",
            "sign out",
            "log out",
            "my account",
            "tai khoan cua toi",
            "email cua toi",
        ),
        guide=(
            "Open the account menu (the person's name, top right) and choose Account. It has "
            "Profile (name, email, avatar, bio, pronouns, company), Password & authentication "
            "(change the password; Generate password makes a strong one), Sessions (see where "
            "they are signed in and Revoke all sessions) and Keyboard shortcuts. Someone who "
            "cannot sign in at all can send a request from the sign-in page."
        ),
        links=(Link("/account", "Open my account", "Mở tài khoản của tôi"),),
    ),
    Topic(
        id="shortcuts",
        title="Keyboard shortcuts",
        keywords=("shortcut", "shortcuts", "phim tat", "ctrl+k", "ctrl k"),
        guide=(
            "Ctrl+K (Cmd+K on macOS) opens global search anywhere. Shortcuts can be listed and "
            "customised under Account > Keyboard shortcuts; the Help page has the full reference."
        ),
        links=(
            Link("/account", "Customise shortcuts", "Tuỳ chỉnh phím tắt"),
            Link("/help/workspace", "Shortcut reference", "Bảng phím tắt"),
        ),
    ),
    Topic(
        id="search",
        title="Search",
        keywords=("search", "tim kiem", "tim trang", "find a page", "khong tim thay", "not found"),
        guide=(
            "Press Ctrl+K or use the search box in the top bar. It matches space names and keys "
            "and page titles and content, ignores accents and capitals, and forgives small typos. "
            "Pressing Ask AI in search answers a question from wiki pages the person may read. "
            "Pages in spaces they cannot open never appear."
        ),
        links=(Link("/help/workspace", "Search help", "Hướng dẫn tìm kiếm"),),
    ),
    Topic(
        id="my-work",
        title="Recent, saved and favourite pages",
        keywords=(
            "recent",
            "gan day",
            "da xem",
            "da sua",
            "visited",
            "saved",
            "da luu",
            "luu lai",
            "favorite",
            "favourite",
            "yeu thich",
            "bookmark",
        ),
        guide=(
            "Recent lists pages the person visited or worked on; Saved lists pages they saved; "
            "Favorites lists spaces they starred (the star on a space's header)."
        ),
        links=(
            Link("/recent", "Recent pages", "Trang gần đây"),
            Link("/saved", "Saved pages", "Trang đã lưu"),
            Link("/favorites", "Favorites", "Yêu thích"),
        ),
    ),
    Topic(
        id="writing",
        title="Creating and editing pages",
        keywords=(
            "create page",
            "new page",
            "tao trang",
            "trang moi",
            "edit page",
            "sua trang",
            "soan thao",
            "viet bai",
            "markdown",
            "slash",
            "editor",
            "bang bieu",
            "table",
            "code block",
            "draft",
            "ban nhap",
        ),
        guide=(
            "Open a space and use Create page; edit with the page's Edit button. Type / in the "
            "editor for commands (headings, tables, code blocks, images). Drafts are saved "
            "automatically and can be recovered. A page can be switched between Rich text, "
            "Markdown and HTML. Creating or editing needs the editor role (Add/Edit) in the space."
        ),
        links=(
            Link("/help/writing", "Writing help", "Hướng dẫn soạn trang"),
            Link("/spaces", "Open Spaces", "Mở danh sách Space"),
        ),
    ),
    Topic(
        id="attachments",
        title="Files, images and uploads",
        keywords=(
            "attachment",
            "attachments",
            "dinh kem",
            "upload",
            "tai len",
            "tep",
            "image",
            "hinh anh",
            "video",
            "preview",
            "xem truoc",
            "word",
            "excel",
            "powerpoint",
            "import",
            "nhap tai lieu",
        ),
        guide=(
            "Drag files into the editor or use Add image / attach. Files can be previewed on the "
            "page; Word, Excel and PowerPoint can be edited in place when an administrator has "
            "connected a document server. If an upload fails, the file may exceed the size limit "
            "(the space or workspace sets it) or its type may not be allowed: try a smaller file "
            "or ask an administrator to check the limits under Administration > Settings. "
            "Documents can be imported as new pages."
        ),
        links=(Link("/help/attachments", "Files help", "Hướng dẫn tệp đính kèm"),),
    ),
    Topic(
        id="export",
        title="Export and page history",
        keywords=(
            "export",
            "xuat",
            "pdf",
            "history",
            "lich su",
            "revision",
            "phien ban",
            "khoi phuc trang",
            "restore page",
            "diff",
        ),
        guide=(
            "A page's ... menu has Export (Word and PDF; allowed to anyone who can view the page) "
            "and Page history, where earlier versions can be compared and restored."
        ),
        links=(Link("/help/writing", "Export & history help", "Hướng dẫn xuất & lịch sử"),),
    ),
    Topic(
        id="report-issue",
        title="Reporting a problem",
        keywords=(
            "bug",
            "bao loi",
            "report",
            "issue",
            "issues",
            "su co",
            "feedback",
            "phan hoi",
            "gop y",
            "problem",
            "van de",
        ),
        guide=(
            "Account menu > Report issue: give a title, say what happened, add screenshots "
            "(paste with Ctrl+V) and labels. My issues lists the person's reports with their "
            "status (Open, In progress, Done); they are notified as it moves."
        ),
        links=(Link("/issues", "My issues", "Sự cố của tôi"),),
    ),
    Topic(
        id="notifications",
        title="Notifications",
        keywords=("notification", "notifications", "thong bao", "bell", "chuong"),
        guide=(
            "The bell in the top bar tells the person about changes to their own access and "
            "account, and about their reported issues. There are no page-watch or @-mention alerts."
        ),
    ),
    Topic(
        id="appearance",
        title="Language and theme",
        keywords=(
            "language",
            "ngon ngu",
            "tieng viet",
            "english",
            "dark mode",
            "light mode",
            "theme",
            "giao dien",
            "che do toi",
            "che do sang",
        ),
        guide=(
            "The interface language (English or Vietnamese) and the light/dark theme are switched "
            "from the toggles in the top bar or the account menu."
        ),
    ),
    Topic(
        id="chat",
        title="The AI assistant",
        keywords=(
            "ai assistant",
            "ung dung ai",
            "dung ai",
            "su dung ai",
            "tinh nang ai",
            "ai feature",
            "ai features",
            "tri tue nhan tao",
            "chatbot",
            "tro ly",
            "chat ai",
            "tl;dr",
            "tom tat",
            "summary",
            "ask ai",
        ),
        guide=(
            "The AI assistant button in the top bar opens this chat: it answers from wiki pages "
            "the person can read, and (when allowed) from the web, the weather, and about their "
            "own account. Pages can be summarised (TL;DR); selected words can be explained or "
            "translated; the editor can help write. If AI features are missing, an administrator "
            "has not enabled them."
        ),
        links=(Link("/help/workspace", "AI help", "Hướng dẫn AI"),),
    ),
    Topic(
        id="help",
        title="User guide",
        keywords=(
            "huong dan",
            "cach dung",
            "cach su dung",
            "how to",
            "how do i",
            "guide",
            "tutorial",
            "tai lieu su dung",
            "help",
            "tro giup",
            "lam sao",
            "lam the nao",
        ),
        guide=(
            "The Help page (the ? in the top bar) is the in-app user guide, in sections: "
            "Workspace, Writing, Attachments & Media, Account and (for administrators) "
            "Administration."
        ),
        links=(
            Link("/help", "Open the user guide", "Mở hướng dẫn sử dụng"),
            Link("/help/workspace", "Workspace", "Không gian làm việc"),
            Link("/help/writing", "Writing", "Soạn trang"),
        ),
        generic=True,
    ),
    Topic(
        id="troubleshoot",
        title="Something is not working",
        keywords=(
            "khong hoat dong",
            "khong chay",
            "khong tai duoc",
            "khong luu duoc",
            "bi loi",
            "gap loi",
            "bi treo",
            "cham",
            "trang trang",
            "not working",
            "doesn't work",
            "does not work",
            "slow",
            "error",
            "broken",
            "blank page",
            "not saving",
            "troubleshoot",
            "troubleshooting",
            "khac phuc",
            "xu ly su co",
        ),
        guide=(
            "Steps to try, in order: reload the page (Ctrl+F5); check the connection; sign out and "
            "in again (Account > Sessions can revoke stale sessions); if an edit was lost, "
            "reopen the page - drafts are auto-saved and offered for recovery. If it persists, "
            "use Account menu > Report issue with a screenshot so an administrator can look. "
            "Access problems: see 'cannot see'. Administrators can check Administration > Server "
            "(health of the app, database, storage and workers) and Safe Operation in Help."
        ),
        links=(
            Link("/issues", "Report an issue", "Báo sự cố"),
            Link("/admin/monitor", "Server monitor", "Giám sát máy chủ"),
        ),
        generic=True,
    ),
    # ---- administration: offered only to people who may open these pages
    Topic(
        id="admin-users",
        title="Managing users",
        keywords=(
            "tao tai khoan",
            "them nguoi dung",
            "quan ly nguoi dung",
            "create user",
            "add user",
            "create account",
            "create an account",
            "reset password",
            "vo hieu hoa tai khoan",
            "deactivate user",
        ),
        guide=(
            "Administration > Users: create accounts (there is no invite e-mail), edit, "
            "deactivate, reset passwords, and set a person's global access."
        ),
        links=(Link("/admin/users", "Manage users", "Quản lý người dùng"),),
        requires="manage_users",
    ),
    Topic(
        id="admin-groups",
        title="Managing groups",
        keywords=(
            "tao nhom",
            "quan ly nhom",
            "create group",
            "manage groups",
            "add to group",
        ),
        guide=(
            "Administration > Groups: create groups, add members, and give a group global "
            "permissions; groups can also be granted access to spaces."
        ),
        links=(Link("/admin/groups", "Manage groups", "Quản lý nhóm"),),
        requires="manage_groups",
    ),
    Topic(
        id="admin-spaces",
        title="Managing spaces",
        keywords=(
            "quan ly space",
            "tao space",
            "create space",
            "new space",
            "cap quyen",
            "grant access",
            "space owner",
            "chu space",
            "luu tru space",
            "archive",
            "space settings",
            "effective permissions",
        ),
        guide=(
            "Administration > Spaces lists every space with owners and counts and opens each "
            "space's Access & Permissions (including Effective permissions for any one person). "
            "Creating a space needs the create-space permission: use Create Space in the Spaces "
            "directory. Owners edit a space from the pencil icon in the space sidebar."
        ),
        links=(
            Link("/admin/spaces", "Manage spaces", "Quản lý Space"),
            Link("/spaces", "Spaces directory", "Danh sách Space"),
        ),
        requires="admin",
    ),
    Topic(
        id="admin-settings",
        title="Workspace settings and branding",
        keywords=(
            "workspace settings",
            "cai dat he thong",
            "branding",
            "logo",
            "dung luong upload",
            "upload size",
            "upload limit",
            "site name",
            "ten site",
        ),
        guide=(
            "Administration > Settings: site name, theme and branding, upload size limits and "
            "allowed types, and other workspace-wide options."
        ),
        links=(Link("/admin/settings", "Workspace settings", "Cài đặt hệ thống"),),
        requires="admin",
    ),
    Topic(
        id="admin-mail",
        title="Administrator mail and requests",
        keywords=(
            "smtp",
            "administrator mail",
            "hop thu quan tri",
            "yeu cau dang nhap",
            "requests inbox",
        ),
        guide=(
            "Administration > Mail sets up e-mail and administrator mailboxes; Requests (Inbox) "
            "holds sign-in requests from people who cannot sign in."
        ),
        links=(
            Link("/admin/mail", "Mail settings", "Cài đặt thư"),
            Link("/admin/inbox", "Requests inbox", "Hộp yêu cầu"),
        ),
        requires="admin",
    ),
    Topic(
        id="admin-ai",
        title="AI assistant settings",
        keywords=(
            "ollama",
            "embedding",
            "semantic search",
            "cau hinh ai",
            "bat ai",
            "enable ai",
            "web search",
            "ai settings",
        ),
        guide=(
            "Administration > AI assistant: connect a model (or the self-hosted Ollama), turn "
            "features on, set semantic search and web search, and edit the skills' instructions."
        ),
        links=(Link("/admin/ai", "AI settings", "Cài đặt AI"),),
        requires="admin",
    ),
    Topic(
        id="admin-storage",
        title="Object storage",
        keywords=(
            "object storage",
            "minio console",
            "luu tru doi tuong",
            "storage quota",
        ),
        guide="Administration > Storage explores object storage and shows what uses space.",
        links=(Link("/admin/storage", "Storage", "Lưu trữ"),),
        requires="admin",
    ),
    Topic(
        id="admin-backup",
        title="Backup, restore and Confluence import",
        keywords=(
            "backup",
            "restore",
            "sao luu",
            "phuc hoi",
            "confluence",
            "import confluence",
            "nhap confluence",
        ),
        guide=(
            "Administration > Backup: make and schedule backups, restore, and import a Confluence "
            "export. An interrupted scan or upload can be resumed from the same panel."
        ),
        links=(Link("/admin/backup", "Backup & import", "Sao lưu & nhập"),),
        requires="admin",
    ),
    Topic(
        id="admin-monitor",
        title="Server monitor and statistics",
        keywords=(
            "server monitor",
            "giam sat may chu",
            "statistics",
            "thong ke",
            "system health",
            "suc khoe he thong",
        ),
        guide=(
            "Administration > Server shows the health and load of the app, database, storage and "
            "workers; Statistics shows usage."
        ),
        links=(
            Link("/admin/monitor", "Server monitor", "Giám sát máy chủ"),
            Link("/admin/statistics", "Statistics", "Thống kê"),
        ),
        requires="admin",
    ),
    Topic(
        id="admin-issues",
        title="Managing reported issues",
        keywords=("quan ly su co", "manage issues", "assign issue", "triage"),
        guide=(
            "Administration > Issues lists what people reported; take, note, assign and close them."
        ),
        links=(Link("/admin/issues", "Issues", "Sự cố"),),
        requires="manage_issues",
    ),
)


#: Where in the Help page each topic is written about: those passages are looked at first.
HELP_SECTIONS: dict[str, tuple[str, ...]] = {
    "actions": ("spaces", "pages"),
    "my-access": ("spaces", "permissions-overview"),
    "cannot-see": ("spaces", "permissions-overview", "admin-spaces-access", "safe-operation"),
    "account": ("your-account",),
    "shortcuts": ("keyboard-shortcuts", "keyboard-shortcut-settings"),
    "search": ("getting-started", "ask-ai-from-search"),
    "my-work": ("my-work",),
    "writing": (
        "pages",
        "slash-commands",
        "tables-and-codeblocks",
        "drafts-and-autosave",
        "format-conversion",
    ),
    "attachments": (
        "images-and-attachments",
        "attachment-previews",
        "office-editing",
        "importing-documents",
    ),
    "export": ("history-and-export", "page-actions-menu"),
    "report-issue": ("report-issues",),
    "notifications": ("notifications",),
    "appearance": ("language-switching", "theme-and-branding"),
    "chat": ("chat-with-ai", "ask-ai-from-search"),
    "help": ("getting-started",),
    "troubleshoot": ("safe-operation", "drafts-and-autosave"),
    "admin-users": ("admin-users-groups", "switch-account"),
    "admin-groups": ("admin-users-groups",),
    "admin-spaces": ("admin-spaces-access", "spaces"),
    "admin-settings": ("settings-and-storage", "theme-and-branding"),
    "admin-mail": ("admin-mail",),
    "admin-ai": ("admin-ai",),
    "admin-storage": ("settings-and-storage",),
    "admin-backup": ("backup-and-restore",),
    "admin-monitor": ("admin-server-monitor", "admin-statistics"),
    "admin-issues": ("report-issues",),
}


def help_sections(topics: list[Topic]) -> set[str]:
    """The Help sections the topics are about."""
    return {section for topic in topics for section in HELP_SECTIONS.get(topic.id, ())}


@dataclass
class Viewer:
    """What the person asking may do: decides which admin topics and buttons are theirs."""

    user: User
    permissions: frozenset[str]

    def may(self, requires: str | None) -> bool:
        if requires is None or self.user.is_superuser:
            return True
        if GlobalPermission.system_admin.value in self.permissions:
            return True
        return requires in self.permissions


async def viewer_of(session: AsyncSession, user: User) -> Viewer:
    granted = await PermissionService(session).global_permissions(user)
    return Viewer(user, frozenset(permission.value for permission in granted))


def match_topics(question: str, viewer: Viewer | None = None) -> list[Topic]:
    """The topics a question is about, best first.

    Administration topics are found for everyone: a member asking about backups should hear that
    the feature exists and who runs it. Whether a topic's *buttons* are offered is
    :func:`actions_for`'s decision, by what the person may open.
    """
    words = fold(question)
    scored: list[tuple[int, int, Topic]] = []
    for order, topic in enumerate(TOPICS):
        # A phrase ("tao tai khoan") says more than a word ("tao"): it counts for its words.
        hits = sum(
            len(keyword.split())
            for keyword in topic.keywords
            if re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", words)
        )
        if hits:
            scored.append((-hits, order, topic))
    scored.sort(key=lambda item: item[:2])
    found = [topic for _, _, topic in scored]
    # "how do I change my password" is about the account, not about the guide in general.
    if any(not topic.generic for topic in found):
        found = [topic for topic in found if not topic.generic]
    # A request to do something rides along with what it is about, whatever the count.
    chosen = [topic for topic in found if not topic.plan][:MAX_TOPICS]
    return chosen + [topic for topic in found if topic.plan]


def _safe(text: str, limit: int = 120) -> str:
    cleaned = _OWN_TAGS.sub(" ", prompt_text(text)).replace('"', "'")
    return " ".join(cleaned.split())[:limit]


def _role(space: SpaceRead) -> str:
    return space.my_role.value if space.my_role else "none"


async def visible_spaces(session: AsyncSession, user: User) -> list[SpaceRead]:
    return await SpaceService(session).list_spaces(user, limit=MAX_SPACES)


def account_block(viewer: Viewer, spaces: list[SpaceRead], *, keys: bool = False) -> str:
    """The person's own account as the model reads it."""
    user = viewer.user
    admin = user.is_superuser or GlobalPermission.system_admin.value in viewer.permissions
    lines = [
        "<account>",
        f"name: {_safe(user.full_name or user.username)}",
        f"username: {_safe(user.username)}",
        f"system administrator: {'yes' if admin else 'no'}",
        "workspace permissions: "
        + (", ".join(sorted(viewer.permissions)) if viewer.permissions else "none"),
        f"spaces they can open ({len(spaces)}):",
    ]
    for space in spaces:
        flags = [f"role {_role(space)}", space.visibility.value]
        if space.is_owner:
            flags.append("owner")
        if space.status.value == "archived":
            flags.append("archived")
        # No key here: it means nothing to a person, and the model would print it.
        about = _safe(space.description, 80)
        # A key only when a plan needs it for a step; it is never to be shown to the person.
        if keys:
            flags.append(f"key={_safe(space.key, 32)}")
        lines.append(
            f"- {_safe(space.name)} ({', '.join(flags)})" + (f" - about: {about}" if about else "")
        )
    if not spaces:
        lines.append("- none")
    elif len(spaces) >= MAX_SPACES:
        lines.append(f"(only the first {MAX_SPACES} are listed; there may be more)")
    lines.append("</account>")
    return "\n".join(lines)


def guide_block(topics: list[Topic]) -> str:
    """How WikiHub works, for the topics the question is about."""
    parts = ["<app_guide>"]
    for topic in topics:
        parts.append(f'<topic title="{_safe(topic.title)}">\n{topic.guide}\n</topic>')
    parts.append("</app_guide>")
    return "\n".join(parts)


def actions_for(
    topics: list[Topic], viewer: Viewer, spaces: list[SpaceRead] | None = None
) -> list[AnswerAction]:
    """The buttons that go with an answer: pages this person may open, never repeated."""
    actions: list[AnswerAction] = []
    seen: set[str] = set()

    def add(action_id: str, href: str, en: str, vi: str) -> None:
        if href in seen or len(actions) >= MAX_ACTIONS:
            return
        seen.add(href)
        actions.append(AnswerAction(id=action_id, href=href, label_en=en, label_vi=vi))

    for topic in topics:
        for link in topic.links:
            # A link into administration is only a button for someone who can use it.
            if link.href.startswith("/admin") and not viewer.may(topic.requires or "admin"):
                continue
            add(topic.id, link.href, link.en, link.vi)
        if topic.lists_spaces and spaces:
            names = [_safe(space.name, 40) for space in spaces]
            seen_names: dict[str, int] = {}
            for space in spaces[:MAX_SPACE_BUTTONS]:
                label = _safe(space.name, 40)
                if names.count(label) > 1:
                    # Several spaces of one name: tell them apart by what they are about, or by
                    # number - never by the key, which means nothing to a person.
                    seen_names[label] = seen_names.get(label, 0) + 1
                    about = _safe(space.description, 28)
                    label = f"{label} - {about}" if about else f"{label} #{seen_names[label]}"
                add(f"space:{space.key}", f"/spaces/{space.key}", label, label)
    return actions
