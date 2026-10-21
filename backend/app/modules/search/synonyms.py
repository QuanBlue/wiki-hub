"""Words that mean the same thing across Vietnamese and English.

An IT wiki is written in a mix of both: someone typing "tài khoản" wants the page
titled "Account ...", and the other way round. Keyword search cannot know that,
so a few hundred well-known pairs are listed here; semantic search covers the
rest when an embedding model is configured.

Every entry is a group of interchangeable phrases, written without accents and
in lower case (queries are folded the same way before they are looked up). A
phrase may have several words. Add a group by adding a line - nothing else needs
to change.
"""

from __future__ import annotations

GROUPS: tuple[tuple[str, ...], ...] = (
    # "ipaddr" is not a word anyone writes: the search vector carries it for every page that
    # contains an IPv4 address, so asking about "ip" finds the pages that list addresses.
    ("ip", "ips", "ipaddr", "ipv4", "dia chi ip"),
    ("dia chi", "address"),
    # A two-word phrase must be one idea, or a page with just the title "he thong" would
    # already cover half of a four-word question.
    ("he thong", "system", "systems"),
    ("tai khoan", "account", "acc"),
    ("mat khau", "password", "pass", "pwd"),
    ("may chu", "server", "servers"),
    ("may ao", "vm", "virtual machine"),
    ("huong dan", "guide", "tutorial", "howto"),
    ("tai lieu", "document", "doc", "docs"),
    ("cai dat", "install", "installation", "setup"),
    ("cau hinh", "config", "configuration", "configure"),
    ("loi", "error", "bug", "fail", "failure"),
    ("giam sat", "monitor", "monitoring"),
    ("canh bao", "alert", "alarm", "warning"),
    ("sao luu", "backup"),
    ("phuc hoi", "restore", "recovery"),
    ("khach hang", "customer", "client"),
    ("dich vu", "service"),
    ("nguoi dung", "user"),
    ("quan tri", "admin", "administrator"),
    ("quan tri vien", "admin", "administrator"),
    ("co so du lieu", "database", "db"),
    ("trien khai", "deploy", "deployment"),
    ("ket noi", "connect", "connection"),
    ("tim kiem", "search"),
    ("phan quyen", "permission", "authorization", "role"),
    ("xac thuc", "authentication", "auth"),
    ("bao mat", "security"),
    ("ha tang", "infrastructure", "infra"),
    ("mang", "network"),
    ("tuong lua", "firewall"),
    ("cum", "cluster"),
    ("nhat ky", "log", "logs"),
    ("gia han", "renew", "renewal"),
    ("chung chi", "certificate", "cert"),
    ("kiem thu", "test", "testing"),
    ("phat hanh", "release"),
    ("ban cap nhat", "update", "patch"),
    ("cap nhat", "update"),
    ("nang cap", "upgrade"),
    ("xoa", "delete", "remove"),
    ("tao", "create"),
    ("sua", "edit", "fix"),
    ("thanh vien", "member"),
    ("nhom", "group", "team"),
    ("du an", "project"),
    ("hieu nang", "performance"),
    ("dung luong", "capacity", "storage", "disk"),
    ("o dia", "disk", "drive"),
    ("bo nho", "memory", "ram"),
    ("sao chep", "copy", "clone"),
    ("di chuyen", "move", "migrate"),
    ("chuyen doi", "convert", "migration"),
    ("dang nhap", "login", "signin"),
    ("dang xuat", "logout", "signout"),
    ("dang ky", "register", "signup", "sign up"),
    ("tuong thich", "compatible", "compatibility"),
    ("giao dien", "ui", "interface", "frontend"),
    ("bao cao", "report"),
    ("thong ke", "statistics", "stats"),
    ("hoa don", "invoice", "bill"),
    ("hop dong", "contract"),
    ("yeu cau", "request", "requirement"),
    ("su co", "incident", "outage"),
    ("van hanh", "operation", "ops"),
    ("moi truong", "environment", "env"),
    ("dam may", "cloud"),
)


def _build() -> dict[str, frozenset[str]]:
    index: dict[str, set[str]] = {}
    for group in GROUPS:
        for phrase in group:
            index.setdefault(phrase, set()).update(p for p in group if p != phrase)
    return {phrase: frozenset(others) for phrase, others in index.items()}


#: ``phrase -> the other phrases meaning the same``.
SYNONYMS: dict[str, frozenset[str]] = _build()

#: The longest phrase in words, so the matcher knows how far to look ahead.
MAX_WORDS = max(len(phrase.split()) for phrase in SYNONYMS)
