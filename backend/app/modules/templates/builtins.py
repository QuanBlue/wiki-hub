# ruff: noqa: E501
"""Built-in read-only page templates in English (en) and Vietnamese (vi).

Markup uses clean semantic HTML compatible with WikiHub's Tiptap editor
(headings, lists, task lists, tables, code blocks, and callouts).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.modules.pages.tiptap_html import (
    TASK_BODY_CLASS,
    TASK_CHECKBOX_CLASS,
    TASK_ITEM_CLASS,
    TASK_LIST_CLASS,
)
from app.schemas.page_template import PageTemplateRead, TemplateLang

_TH_PATTERN = re.compile(r"<th>(.*?)</th>")


def _style_table_headers(html: str) -> str:
    """Give built-in template table headers a subtle background tint and bold text."""
    return _TH_PATTERN.sub(
        r'<th style="background-color: var(--primary-subtle)"><strong>\1</strong></th>',
        html,
    )

BUILTIN_PREFIX = "builtin:"
BUILTIN_SLUGS: tuple[str, ...] = (
    "meeting-notes",
    "runbook",
    "adr",
    "post-mortem",
    "onboarding",
    "rfc",
    "prd",
    "sprint-retro",
    "project-plan",
    "release-notes",
    "api-spec",
    "system-architecture",
    "deployment-checklist",
    "security-review",
    "weekly-status",
    "one-on-one",
    "sop",
    "troubleshooting-faq",
)


def _task_list(items: list[str]) -> str:
    rows = "".join(
        f'<li class="{TASK_ITEM_CLASS}" data-type="taskItem" data-checked="false">'
        f'<input type="checkbox" class="{TASK_CHECKBOX_CLASS}" disabled="disabled" />'
        f'<span class="{TASK_BODY_CLASS}">{item}</span>'
        f"</li>"
        for item in items
    )
    return f'<ul class="{TASK_LIST_CLASS}" data-type="taskList">{rows}</ul>'


@dataclass(frozen=True)
class _LocalizedCopy:
    name: str
    description: str
    content: str


@dataclass(frozen=True)
class _BuiltinTemplateDef:
    slug: str
    category: str
    icon: str
    en: _LocalizedCopy
    vi: _LocalizedCopy


_BUILTINS: tuple[_BuiltinTemplateDef, ...] = (
    _BuiltinTemplateDef(
        slug="meeting-notes",
        category="meeting",
        icon="clipboard-list",
        en=_LocalizedCopy(
            name="Meeting Notes",
            description="Structured agenda, attendees, key decisions, and follow-up action items.",
            content=(
                '<div data-type="callout" data-callout-type="info">'
                "<p><strong>Date:</strong> YYYY-MM-DD &nbsp;|&nbsp; "
                "<strong>Facilitator:</strong> @name &nbsp;|&nbsp; "
                "<strong>Note taker:</strong> @name</p>"
                "</div>"
                "<h2>Attendees</h2>"
                "<ul><li>Participant 1 (Role)</li><li>Participant 2 (Role)</li></ul>"
                "<h2>Agenda</h2>"
                "<ol><li>Topic 1 — context and goal</li><li>Topic 2 — discussion</li></ol>"
                "<h2>Discussion Notes</h2>"
                "<p>Summarize key points, trade-offs, and open questions discussed "
                "during the meeting.</p>"
                "<h2>Decisions</h2>"
                "<ul><li><strong>Decision 1:</strong> Rationale and owner.</li></ul>"
                "<h2>Action Items</h2>"
                + _task_list(
                    [
                        "<strong>@owner</strong> — Describe follow-up task (Due: YYYY-MM-DD)",
                        "<strong>@owner</strong> — Share notes and confirm next check-in",
                    ]
                )
            ),
        ),
        vi=_LocalizedCopy(
            name="Biên bản cuộc họp",
            description=(
                "Chương trình họp, thành phần tham dự, quyết định chính và các đầu việc "
                "cần theo dõi."
            ),
            content=(
                '<div data-type="callout" data-callout-type="info">'
                "<p><strong>Ngày họp:</strong> YYYY-MM-DD &nbsp;|&nbsp; "
                "<strong>Chủ trì:</strong> @ten &nbsp;|&nbsp; "
                "<strong>Thư ký:</strong> @ten</p>"
                "</div>"
                "<h2>Thành phần tham dự</h2>"
                "<ul><li>Thành viên 1 (Vai trò)</li><li>Thành viên 2 (Vai trò)</li></ul>"
                "<h2>Chương trình họp</h2>"
                "<ol><li>Nội dung 1 — bối cảnh và mục tiêu</li>"
                "<li>Nội dung 2 — thảo luận</li></ol>"
                "<h2>Nội dung thảo luận</h2>"
                "<p>Tóm tắt các ý chính, phương án đánh đổi và câu hỏi mở trong cuộc họp.</p>"
                "<h2>Quyết định đã thống nhất</h2>"
                "<ul><li><strong>Quyết định 1:</strong> Lý do và người phụ trách.</li></ul>"
                "<h2>Hạng mục hành động</h2>"
                + _task_list(
                    [
                        "<strong>@nguoi-phu-trach</strong> — Mô tả công việc tiếp theo "
                        "(Hạn: YYYY-MM-DD)",
                        "<strong>@nguoi-phu-trach</strong> — Gửi biên bản và chốt lịch họp "
                        "tiếp theo",
                    ]
                )
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="runbook",
        category="operations",
        icon="book-open",
        en=_LocalizedCopy(
            name="Operations Runbook",
            description=(
                "Step-by-step operational procedure with prerequisites, commands, "
                "verification, and rollback."
            ),
            content=(
                '<div data-type="callout" data-callout-type="warning">'
                "<p><strong>Service:</strong> service-name &nbsp;|&nbsp; "
                "<strong>Owner:</strong> Platform Team &nbsp;|&nbsp; "
                "<strong>Severity:</strong> P2</p>"
                "</div>"
                "<h2>Overview</h2>"
                "<p>Describe when to run this procedure and what symptoms or alerts "
                "trigger it.</p>"
                "<h2>Prerequisites</h2>"
                + _task_list(
                    [
                        "Confirm VPN / production cluster access",
                        "Notify the on-call channel before starting",
                        "Verify recent backups or snapshots are healthy",
                    ]
                )
                + "<h2>Procedure</h2>"
                "<ol>"
                "<li>Check current service health and error rates.</li>"
                "<li>Run the remediation command below:</li>"
                "</ol>"
                "<pre><code># Example diagnostic / remediation command\n"
                "kubectl get pods -n production\n"
                "kubectl rollout status deployment/service-name -n production</code></pre>"
                "<h2>Verification</h2>"
                "<ul><li>Error rate returns below threshold for 5 consecutive minutes.</li>"
                "<li>Health check endpoint returns HTTP 200.</li></ul>"
                "<h2>Rollback</h2>"
                "<pre><code>kubectl rollout undo deployment/service-name "
                "-n production</code></pre>"
                "<h2>Escalation Contacts</h2>"
                "<table><thead><tr><th>Role</th><th>Contact</th><th>Notes</th></tr></thead>"
                "<tbody>"
                "<tr><td>Primary On-Call</td><td>@oncall-primary</td>"
                "<td>First responder</td></tr>"
                "<tr><td>Service Owner</td><td>@service-owner</td>"
                "<td>Escalate after 15m</td></tr>"
                "</tbody></table>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Sổ tay vận hành (Runbook)",
            description=(
                "Quy trình vận hành từng bước gồm điều kiện tiên quyết, câu lệnh, "
                "kiểm tra và khôi phục."
            ),
            content=(
                '<div data-type="callout" data-callout-type="warning">'
                "<p><strong>Dịch vụ:</strong> ten-dich-vu &nbsp;|&nbsp; "
                "<strong>Đội phụ trách:</strong> Platform Team &nbsp;|&nbsp; "
                "<strong>Mức độ:</strong> P2</p>"
                "</div>"
                "<h2>Tổng quan</h2>"
                "<p>Mô tả thời điểm áp dụng quy trình này cùng các dấu hiệu hoặc cảnh báo "
                "kích hoạt.</p>"
                "<h2>Điều kiện tiên quyết</h2>"
                + _task_list(
                    [
                        "Xác nhận đã kết nối VPN và có quyền truy cập môi trường production",
                        "Thông báo lên kênh trực vận hành trước khi thực hiện",
                        "Kiểm tra bản sao lưu / snapshot gần nhất đang hợp lệ",
                    ]
                )
                + "<h2>Các bước thực hiện</h2>"
                "<ol>"
                "<li>Kiểm tra trạng thái dịch vụ và tỉ lệ lỗi hiện tại.</li>"
                "<li>Thực thi câu lệnh xử lý bên dưới:</li>"
                "</ol>"
                "<pre><code># Lệnh kiểm tra / xử lý mẫu\n"
                "kubectl get pods -n production\n"
                "kubectl rollout status deployment/service-name -n production</code></pre>"
                "<h2>Xác minh kết quả</h2>"
                "<ul><li>Tỉ lệ lỗi giảm dưới ngưỡng liên tục trong 5 phút.</li>"
                "<li>Endpoint kiểm tra sức khỏe trả về HTTP 200.</li></ul>"
                "<h2>Phương án khôi phục (Rollback)</h2>"
                "<pre><code>kubectl rollout undo deployment/service-name "
                "-n production</code></pre>"
                "<h2>Liên hệ leo thang</h2>"
                "<table><thead><tr><th>Vai trò</th><th>Liên hệ</th><th>Ghi chú</th></tr></thead>"
                "<tbody>"
                "<tr><td>Trực chính (On-Call)</td><td>@oncall-primary</td>"
                "<td>Xử lý đầu mối</td></tr>"
                "<tr><td>Chủ sở hữu dịch vụ</td><td>@service-owner</td>"
                "<td>Báo cáo sau 15 phút</td></tr>"
                "</tbody></table>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="adr",
        category="engineering",
        icon="git-branch",
        en=_LocalizedCopy(
            name="Architecture Decision Record (ADR)",
            description=(
                "Capture architectural context, options considered, final decision, "
                "and consequences."
            ),
            content=(
                "<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>"
                "<tr><td><strong>Status</strong></td>"
                "<td>Proposed / Accepted / Deprecated</td></tr>"
                "<tr><td><strong>Date</strong></td><td>YYYY-MM-DD</td></tr>"
                "<tr><td><strong>Deciders</strong></td><td>@architect, @tech-lead</td></tr>"
                "</tbody></table>"
                "<h2>Context</h2>"
                "<p>Describe the technical or business problem, constraints, and forces "
                "influencing this decision.</p>"
                "<h2>Decision</h2>"
                "<p>State the chosen architecture or design clearly in active voice.</p>"
                "<h2>Alternatives Considered</h2>"
                "<table><thead><tr><th>Option</th><th>Pros</th><th>Cons</th></tr></thead>"
                "<tbody>"
                "<tr><td>Option A (Chosen)</td><td>Clear benefit</td>"
                "<td>Known trade-off</td></tr>"
                "<tr><td>Option B</td><td>Benefit</td><td>Reason not selected</td></tr>"
                "</tbody></table>"
                "<h2>Consequences</h2>"
                "<ul><li><strong>Positive:</strong> Improved reliability, maintainability, "
                "or performance.</li>"
                "<li><strong>Negative / Risks:</strong> Migration effort, operational "
                "overhead, or constraints.</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Ghi nhận quyết định kiến trúc (ADR)",
            description=(
                "Ghi lại bối cảnh kiến trúc, các phương án đã cân nhắc, quyết định cuối cùng "
                "và hệ quả."
            ),
            content=(
                "<table><thead><tr><th>Trường</th><th>Giá trị</th></tr></thead><tbody>"
                "<tr><td><strong>Trạng thái</strong></td>"
                "<td>Đề xuất / Đã duyệt / Ngừng dùng</td></tr>"
                "<tr><td><strong>Ngày</strong></td><td>YYYY-MM-DD</td></tr>"
                "<tr><td><strong>Người quyết định</strong></td>"
                "<td>@architect, @tech-lead</td></tr>"
                "</tbody></table>"
                "<h2>Bối cảnh</h2>"
                "<p>Mô tả bài toán kỹ thuật hoặc nghiệp vụ, các ràng buộc và yếu tố tác động "
                "tới quyết định.</p>"
                "<h2>Quyết định</h2>"
                "<p>Nêu rõ phương án kiến trúc hoặc thiết kế được lựa chọn.</p>"
                "<h2>Các phương án đã cân nhắc</h2>"
                "<table><thead><tr><th>Phương án</th><th>Ưu điểm</th>"
                "<th>Nhược điểm</th></tr></thead><tbody>"
                "<tr><td>Phương án A (Chọn)</td><td>Lợi ích nổi bật</td>"
                "<td>Điểm đánh đổi đã biết</td></tr>"
                "<tr><td>Phương án B</td><td>Ưu điểm</td><td>Lý do không chọn</td></tr>"
                "</tbody></table>"
                "<h2>Hệ quả</h2>"
                "<ul><li><strong>Tích cực:</strong> Tăng độ ổn định, dễ bảo trì hoặc hiệu năng "
                "tốt hơn.</li>"
                "<li><strong>Rủi ro / Đánh đổi:</strong> Chi phí chuyển đổi, công sức vận hành "
                "hoặc giới hạn mới.</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="post-mortem",
        category="operations",
        icon="alert-triangle",
        en=_LocalizedCopy(
            name="Incident Post-mortem",
            description=(
                "Blameless incident summary, timeline, root cause analysis, and preventive "
                "follow-ups."
            ),
            content=(
                '<div data-type="callout" data-callout-type="info">'
                "<p><strong>Incident ID:</strong> INC-000 &nbsp;|&nbsp; "
                "<strong>Severity:</strong> SEV-2 &nbsp;|&nbsp; "
                "<strong>Duration:</strong> 0h 00m &nbsp;|&nbsp; "
                "<strong>Owner:</strong> @owner</p>"
                "</div>"
                "<h2>Executive Summary</h2>"
                "<p>Brief description of what happened, user impact, and how service "
                "was restored.</p>"
                "<h2>Impact</h2>"
                "<ul><li>Affected services / regions:</li>"
                "<li>Estimated users or requests impacted:</li></ul>"
                "<h2>Timeline (UTC)</h2>"
                "<table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody>"
                "<tr><td>HH:MM</td><td>Alert triggered / issue first observed.</td></tr>"
                "<tr><td>HH:MM</td><td>Mitigation applied.</td></tr>"
                "<tr><td>HH:MM</td><td>Service confirmed fully recovered.</td></tr>"
                "</tbody></table>"
                "<h2>Root Cause Analysis</h2>"
                "<p>Explain the underlying technical cause and contributing factors without "
                "assigning blame.</p>"
                "<h2>What Went Well / What Can Be Improved</h2>"
                "<ul><li><strong>Went well:</strong> Fast detection and clear communication.</li>"
                "<li><strong>To improve:</strong> Missing guardrail or runbook gap.</li></ul>"
                "<h2>Preventive Action Items</h2>"
                + _task_list(
                    [
                        "<strong>@owner</strong> — Add automated alert / regression test "
                        "(Due: YYYY-MM-DD)",
                        "<strong>@owner</strong> — Update runbook with mitigation steps "
                        "(Due: YYYY-MM-DD)",
                    ]
                )
            ),
        ),
        vi=_LocalizedCopy(
            name="Báo cáo sau sự cố (Post-mortem)",
            description=(
                "Tổng kết sự cố khách quan, dòng thời gian, phân tích nguyên nhân gốc rễ "
                "và hành động phòng ngừa."
            ),
            content=(
                '<div data-type="callout" data-callout-type="info">'
                "<p><strong>Mã sự cố:</strong> INC-000 &nbsp;|&nbsp; "
                "<strong>Mức độ:</strong> SEV-2 &nbsp;|&nbsp; "
                "<strong>Thời gian ảnh hưởng:</strong> 0g 00p &nbsp;|&nbsp; "
                "<strong>Phụ trách:</strong> @owner</p>"
                "</div>"
                "<h2>Tóm tắt sự cố</h2>"
                "<p>Mô tả ngắn gọn diễn biến, mức độ ảnh hưởng đến người dùng và cách "
                "khắc phục.</p>"
                "<h2>Phạm vi ảnh hưởng</h2>"
                "<ul><li>Dịch vụ / khu vực bị ảnh hưởng:</li>"
                "<li>Số lượng người dùng hoặc yêu cầu bị tác động:</li></ul>"
                "<h2>Dòng thời gian</h2>"
                "<table><thead><tr><th>Thời điểm</th><th>Sự kiện</th></tr></thead><tbody>"
                "<tr><td>HH:MM</td><td>Cảnh báo kích hoạt / phát hiện sự cố.</td></tr>"
                "<tr><td>HH:MM</td><td>Áp dụng biện pháp giảm thiểu.</td></tr>"
                "<tr><td>HH:MM</td><td>Xác nhận dịch vụ khôi phục hoàn toàn.</td></tr>"
                "</tbody></table>"
                "<h2>Phân tích nguyên nhân gốc rễ</h2>"
                "<p>Giải thích nguyên nhân kỹ thuật cốt lõi và các yếu tố liên quan trên "
                "tinh thần xây dựng.</p>"
                "<h2>Điểm làm tốt &amp; Điểm cần cải thiện</h2>"
                "<ul><li><strong>Làm tốt:</strong> Phát hiện nhanh và phối hợp rõ ràng.</li>"
                "<li><strong>Cần cải thiện:</strong> Bổ sung cơ chế bảo vệ hoặc cập nhật "
                "runbook.</li></ul>"
                "<h2>Hành động phòng ngừa</h2>"
                + _task_list(
                    [
                        "<strong>@nguoi-phu-trach</strong> — Thêm cảnh báo tự động / kiểm thử "
                        "hồi quy (Hạn: YYYY-MM-DD)",
                        "<strong>@nguoi-phu-trach</strong> — Cập nhật sổ tay vận hành với "
                        "bước xử lý mới (Hạn: YYYY-MM-DD)",
                    ]
                )
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="onboarding",
        category="team",
        icon="users",
        en=_LocalizedCopy(
            name="Team Onboarding Guide",
            description=(
                "First-week checklist, environment setup, key contacts, and essential "
                "team resources."
            ),
            content=(
                '<div data-type="callout" data-callout-type="info">'
                "<p>Welcome to the team! Use this guide during your first two weeks to get "
                "your tools, access, and context ready.</p>"
                "</div>"
                "<h2>First-Week Checklist</h2>"
                + _task_list(
                    [
                        "Request access to Git repositories, issue tracker, and wiki spaces",
                        "Set up local development environment and run the test suite",
                        "Meet your onboarding buddy and team members",
                        "Ship your first small pull request or documentation improvement",
                    ]
                )
                + "<h2>Local Setup</h2>"
                "<pre><code>git clone &lt;repository-url&gt;\n"
                "cd project-directory\n"
                "# Follow README setup instructions</code></pre>"
                "<h2>Key People &amp; Channels</h2>"
                "<table><thead><tr><th>Role / Topic</th>"
                "<th>Contact / Channel</th></tr></thead><tbody>"
                "<tr><td>Engineering Manager</td><td>@manager</td></tr>"
                "<tr><td>Onboarding Buddy</td><td>@buddy</td></tr>"
                "<tr><td>Team Chat</td><td>#team-general</td></tr>"
                "</tbody></table>"
                "<h2>Essential Reading</h2>"
                "<ul><li>System architecture overview</li>"
                "<li>Coding standards &amp; review checklist</li>"
                "<li>Deployment &amp; on-call handbook</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Hướng dẫn hội nhập (Onboarding)",
            description=(
                "Danh mục tuần đầu tiên, cài đặt môi trường, đầu mối liên hệ và tài liệu "
                "trọng tâm của nhóm."
            ),
            content=(
                '<div data-type="callout" data-callout-type="info">'
                "<p>Chào mừng bạn gia nhập nhóm! Hãy dùng tài liệu này trong hai tuần đầu để "
                "thiết lập công cụ, quyền truy cập và nắm bắt bối cảnh dự án.</p>"
                "</div>"
                "<h2>Danh mục tuần đầu tiên</h2>"
                + _task_list(
                    [
                        "Xin quyền truy cập kho mã nguồn Git, hệ thống theo dõi công việc "
                        "và không gian wiki",
                        "Cài đặt môi trường phát triển cục bộ và chạy bộ kiểm thử",
                        "Làm quen với người đồng hành (buddy) và các thành viên trong nhóm",
                        "Hoàn thành pull request hoặc cập nhật tài liệu đầu tiên",
                    ]
                )
                + "<h2>Thiết lập môi trường</h2>"
                "<pre><code>git clone &lt;repository-url&gt;\n"
                "cd thu-muc-du-an\n"
                "# Làm theo hướng dẫn trong tệp README</code></pre>"
                "<h2>Đầu mối liên hệ &amp; Kênh trao đổi</h2>"
                "<table><thead><tr><th>Vai trò / Chủ đề</th>"
                "<th>Liên hệ / Kênh</th></tr></thead><tbody>"
                "<tr><td>Quản lý trực tiếp</td><td>@manager</td></tr>"
                "<tr><td>Người đồng hành (Buddy)</td><td>@buddy</td></tr>"
                "<tr><td>Kênh trao đổi nhóm</td><td>#team-general</td></tr>"
                "</tbody></table>"
                "<h2>Tài liệu cần đọc</h2>"
                "<ul><li>Tổng quan kiến trúc hệ thống</li>"
                "<li>Quy chuẩn mã nguồn và kiểm duyệt</li>"
                "<li>Quy trình triển khai và trực vận hành</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="rfc",
        category="engineering",
        icon="file-text",
        en=_LocalizedCopy(
            name="Technical Proposal (RFC)",
            description=(
                "Structured proposal for significant technical changes with goals, design, "
                "rollout, and risks."
            ),
            content=(
                "<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>"
                "<tr><td><strong>Author</strong></td><td>@author</td></tr>"
                "<tr><td><strong>Status</strong></td>"
                "<td>Draft / In Review / Approved</td></tr>"
                "<tr><td><strong>Reviewers</strong></td><td>@reviewer1, @reviewer2</td></tr>"
                "</tbody></table>"
                "<h2>Motivation &amp; Goals</h2>"
                "<p>Explain why this change is needed now and what measurable outcomes "
                "define success.</p>"
                "<h3>Non-Goals</h3>"
                "<ul><li>Explicitly list what is out of scope for this proposal.</li></ul>"
                "<h2>Proposed Design</h2>"
                "<p>Describe the architecture, data model, API contracts, and key workflows.</p>"
                "<pre><code>// Optional API contract or schema sketch</code></pre>"
                "<h2>Security, Privacy &amp; Performance</h2>"
                "<ul><li><strong>Security:</strong> AuthN/AuthZ, input validation, "
                "auditability.</li>"
                "<li><strong>Performance:</strong> Latency, throughput, and storage "
                "impact.</li></ul>"
                "<h2>Rollout &amp; Migration Plan</h2>"
                "<ol><li>Phase 1 — backward-compatible schema and feature flag.</li>"
                "<li>Phase 2 — gradual rollout and monitoring.</li>"
                "<li>Phase 3 — cleanup of legacy path.</li></ol>"
                "<h2>Open Questions</h2>"
                "<ul><li>Question 1 — needs feedback from @team.</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Đề xuất kỹ thuật (RFC)",
            description=(
                "Bản đề xuất có cấu trúc cho các thay đổi kỹ thuật lớn gồm mục tiêu, thiết kế, "
                "triển khai và rủi ro."
            ),
            content=(
                "<table><thead><tr><th>Trường</th><th>Giá trị</th></tr></thead><tbody>"
                "<tr><td><strong>Tác giả</strong></td><td>@author</td></tr>"
                "<tr><td><strong>Trạng thái</strong></td>"
                "<td>Bản nháp / Đang góp ý / Đã duyệt</td></tr>"
                "<tr><td><strong>Người phản biện</strong></td>"
                "<td>@reviewer1, @reviewer2</td></tr>"
                "</tbody></table>"
                "<h2>Động lực &amp; Mục tiêu</h2>"
                "<p>Giải thích lý do cần thay đổi ở thời điểm hiện tại và các chỉ số đánh giá "
                "thành công.</p>"
                "<h3>Ngoài phạm vi</h3>"
                "<ul><li>Liệt kê rõ những hạng mục không nằm trong đề xuất này.</li></ul>"
                "<h2>Thiết kế đề xuất</h2>"
                "<p>Mô tả kiến trúc, mô hình dữ liệu, hợp đồng API và các luồng xử lý chính.</p>"
                "<pre><code>// Phác thảo hợp đồng API hoặc lược đồ dữ liệu (nếu có)</code></pre>"
                "<h2>Bảo mật, Quyền riêng tư &amp; Hiệu năng</h2>"
                "<ul><li><strong>Bảo mật:</strong> Xác thực, phân quyền, kiểm tra dữ liệu đầu "
                "vào, nhật ký kiểm toán.</li>"
                "<li><strong>Hiệu năng:</strong> Tác động đến độ trễ, thông lượng và dung lượng "
                "lưu trữ.</li></ul>"
                "<h2>Kế hoạch triển khai &amp; Chuyển đổi</h2>"
                "<ol><li>Giai đoạn 1 — thay đổi tương thích ngược và bật cờ tính năng.</li>"
                "<li>Giai đoạn 2 — mở rộng từng phần và theo dõi chỉ số.</li>"
                "<li>Giai đoạn 3 — dọn dẹp luồng cũ.</li></ol>"
                "<h2>Câu hỏi mở</h2>"
                "<ul><li>Câu hỏi 1 — cần thêm ý kiến từ @team.</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="prd",
        category="product",
        icon="target",
        en=_LocalizedCopy(
            name="Product Requirements Document (PRD)",
            description="Define user problems, goals, user stories, acceptance criteria, and launch metrics.",
            content=(
                "<h2>Overview</h2>"
                "<table><tbody>"
                "<tr><th>Product Owner</th><td>@owner</td></tr>"
                "<tr><th>Engineering Lead</th><td>@tech-lead</td></tr>"
                "<tr><th>Target Release</th><td>Q1 / v1.0</td></tr>"
                "<tr><th>Status</th><td>Draft / In Review / Approved</td></tr>"
                "</tbody></table>"
                "<h2>Problem Statement</h2>"
                "<p>Describe the user pain point, business opportunity, and evidence (customer feedback, metrics, support tickets).</p>"
                "<h2>Goals &amp; Success Metrics</h2>"
                "<ul><li><strong>Primary KPI:</strong> Measurable target and timeframe.</li>"
                "<li><strong>Non-goals:</strong> Explicitly list what is out of scope for this release.</li></ul>"
                "<h2>User Stories &amp; Acceptance Criteria</h2>"
                "<table><thead><tr><th>Story</th><th>Priority</th><th>Acceptance Criteria</th></tr></thead>"
                "<tbody><tr><td>As a [role], I want [action] so that [value]</td><td>P0</td>"
                "<td>Given ..., when ..., then ...</td></tr></tbody></table>"
                "<h2>Design &amp; Technical Notes</h2>"
                "<p>Link wireframes, prototypes, API constraints, and edge cases.</p>"
                "<h2>Rollout &amp; Risks</h2>"
                "<ul><li>Feature flag / phased rollout plan.</li>"
                "<li>Key dependencies and mitigation steps.</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Tài liệu yêu cầu sản phẩm (PRD)",
            description="Xác định bài toán người dùng, mục tiêu, user story, tiêu chí nghiệm thu và chỉ số ra mắt.",
            content=(
                "<h2>Tổng quan</h2>"
                "<table><tbody>"
                "<tr><th>Product Owner</th><td>@owner</td></tr>"
                "<tr><th>Trưởng nhóm kỹ thuật</th><td>@tech-lead</td></tr>"
                "<tr><th>Phiên bản mục tiêu</th><td>Q1 / v1.0</td></tr>"
                "<tr><th>Trạng thái</th><td>Nháp / Đang duyệt / Đã phê duyệt</td></tr>"
                "</tbody></table>"
                "<h2>Bài toán cần giải quyết</h2>"
                "<p>Mô tả nỗi đau của người dùng, cơ hội kinh doanh và bằng chứng thực tế (phản hồi, số liệu, ticket hỗ trợ).</p>"
                "<h2>Mục tiêu &amp; Chỉ số thành công</h2>"
                "<ul><li><strong>KPI chính:</strong> Mục tiêu đo lường được và mốc thời gian.</li>"
                "<li><strong>Ngoài phạm vi:</strong> Liệt kê rõ những hạng mục chưa làm ở đợt này.</li></ul>"
                "<h2>User Stories &amp; Tiêu chí nghiệm thu</h2>"
                "<table><thead><tr><th>Yêu cầu</th><th>Ưu tiên</th><th>Tiêu chí nghiệm thu</th></tr></thead>"
                "<tbody><tr><td>Là [vai trò], tôi muốn [hành động] để [giá trị]</td><td>P0</td>"
                "<td>Khi ..., hệ thống phải ...</td></tr></tbody></table>"
                "<h2>Thiết kế &amp; Lưu ý kỹ thuật</h2>"
                "<p>Gắn liên kết bản thiết kế, giới hạn API và các trường hợp biên.</p>"
                "<h2>Kế hoạch ra mắt &amp; Rủi ro</h2>"
                "<ul><li>Kế hoạch bật tính năng theo giai đoạn.</li>"
                "<li>Các phụ thuộc chính và phương án giảm thiểu rủi ro.</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="sprint-retro",
        category="meeting",
        icon="refresh-cw",
        en=_LocalizedCopy(
            name="Sprint Retrospective",
            description="Reflect on what went well, what slowed the team down, and concrete actions for next sprint.",
            content=(
                "<h2>Sprint Summary</h2>"
                "<table><tbody>"
                "<tr><th>Sprint</th><td>Sprint #</td></tr>"
                "<tr><th>Dates</th><td>YYYY-MM-DD — YYYY-MM-DD</td></tr>"
                "<tr><th>Facilitator</th><td>@facilitator</td></tr>"
                "<tr><th>Team</th><td>@team</td></tr>"
                "</tbody></table>"
                "<h2>What Went Well</h2>"
                "<ul><li>Highlight wins, smooth collaborations, and practices worth repeating.</li></ul>"
                "<h2>What Could Be Improved</h2>"
                "<ul><li>Call out bottlenecks, unclear requirements, or recurring friction.</li></ul>"
                "<h2>Action Items for Next Sprint</h2>"
                "<table><thead><tr><th>Action</th><th>Owner</th><th>Target Date</th><th>Status</th></tr></thead>"
                "<tbody><tr><td>Concrete improvement step</td><td>@owner</td><td>YYYY-MM-DD</td><td>Open</td></tr></tbody></table>"
                "<h2>Shout-outs</h2>"
                "<ul><li>Recognise teammates who went above and beyond this sprint.</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Họp cải tiến Sprint (Retrospective)",
            description="Nhìn lại điểm làm tốt, điểm cần cải thiện và hành động cụ thể cho Sprint tiếp theo.",
            content=(
                "<h2>Thông tin Sprint</h2>"
                "<table><tbody>"
                "<tr><th>Sprint</th><td>Sprint #</td></tr>"
                "<tr><th>Thời gian</th><td>YYYY-MM-DD — YYYY-MM-DD</td></tr>"
                "<tr><th>Điều phối</th><td>@facilitator</td></tr>"
                "<tr><th>Nhóm</th><td>@team</td></tr>"
                "</tbody></table>"
                "<h2>Điểm đã làm tốt</h2>"
                "<ul><li>Ghi nhận kết quả nổi bật, phối hợp hiệu quả và thói quen nên duy trì.</li></ul>"
                "<h2>Điểm cần cải thiện</h2>"
                "<ul><li>Nêu rõ điểm nghẽn, yêu cầu chưa rõ hoặc trở ngại lặp lại.</li></ul>"
                "<h2>Hành động cho Sprint tới</h2>"
                "<table><thead><tr><th>Hành động</th><th>Người phụ trách</th><th>Hạn chót</th><th>Trạng thái</th></tr></thead>"
                "<tbody><tr><td>Bước cải tiến cụ thể</td><td>@owner</td><td>YYYY-MM-DD</td><td>Đang mở</td></tr></tbody></table>"
                "<h2>Lời cảm ơn / Ghi nhận</h2>"
                "<ul><li>Ghi nhận thành viên hỗ trợ tích cực trong Sprint.</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="project-plan",
        category="product",
        icon="rocket",
        en=_LocalizedCopy(
            name="Project Kickoff & Plan",
            description="Align stakeholders on scope, milestones, roles (RACI), deliverables, and risks.",
            content=(
                "<h2>Project Charter</h2>"
                "<table><tbody>"
                "<tr><th>Project Lead</th><td>@lead</td></tr>"
                "<tr><th>Sponsor</th><td>@sponsor</td></tr>"
                "<tr><th>Timeline</th><td>Start — Launch</td></tr>"
                "<tr><th>Status</th><td>Planning / Active / At Risk / Complete</td></tr>"
                "</tbody></table>"
                "<h2>Objectives &amp; Deliverables</h2>"
                "<ul><li>Key deliverable 1</li><li>Key deliverable 2</li></ul>"
                "<h2>Milestones</h2>"
                "<table><thead><tr><th>Phase</th><th>Deliverable</th><th>Owner</th><th>Due Date</th></tr></thead>"
                "<tbody>"
                "<tr><td>Discovery</td><td>Approved spec &amp; design</td><td>@pm</td><td>YYYY-MM-DD</td></tr>"
                "<tr><td>Build</td><td>Feature complete in staging</td><td>@eng</td><td>YYYY-MM-DD</td></tr>"
                "<tr><td>Launch</td><td>Production rollout &amp; handoff</td><td>@ops</td><td>YYYY-MM-DD</td></tr>"
                "</tbody></table>"
                "<h2>Risks &amp; Mitigations</h2>"
                "<table><thead><tr><th>Risk</th><th>Impact</th><th>Mitigation</th></tr></thead>"
                "<tbody><tr><td>Dependency delay</td><td>High</td><td>Agree fallback interface early</td></tr></tbody></table>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Kế hoạch triển khai dự án",
            description="Thống nhất phạm vi, mốc tiến độ, vai trò phụ trách, sản phẩm bàn giao và quản lý rủi ro.",
            content=(
                "<h2>Thông tin dự án</h2>"
                "<table><tbody>"
                "<tr><th>Trưởng dự án</th><td>@lead</td></tr>"
                "<tr><th>Người tài trợ</th><td>@sponsor</td></tr>"
                "<tr><th>Thời gian</th><td>Bắt đầu — Ra mắt</td></tr>"
                "<tr><th>Trạng thái</th><td>Lập kế hoạch / Đang chạy / Có rủi ro / Hoàn tất</td></tr>"
                "</tbody></table>"
                "<h2>Mục tiêu &amp; Sản phẩm bàn giao</h2>"
                "<ul><li>Hạng mục bàn giao 1</li><li>Hạng mục bàn giao 2</li></ul>"
                "<h2>Các mốc tiến độ</h2>"
                "<table><thead><tr><th>Giai đoạn</th><th>Sản phẩm</th><th>Phụ trách</th><th>Ngày dự kiến</th></tr></thead>"
                "<tbody>"
                "<tr><td>Khảo sát</td><td>Đặc tả &amp; thiết kế được duyệt</td><td>@pm</td><td>YYYY-MM-DD</td></tr>"
                "<tr><td>Phát triển</td><td>Hoàn tất trên môi trường staging</td><td>@eng</td><td>YYYY-MM-DD</td></tr>"
                "<tr><td>Triển khai</td><td>Go-live production &amp; bàn giao</td><td>@ops</td><td>YYYY-MM-DD</td></tr>"
                "</tbody></table>"
                "<h2>Rủi ro &amp; Phương án xử lý</h2>"
                "<table><thead><tr><th>Rủi ro</th><th>Mức ảnh hưởng</th><th>Phương án giảm thiểu</th></tr></thead>"
                "<tbody><tr><td>Trễ phụ thuộc bên ngoài</td><td>Cao</td><td>Chốt giao diện dự phòng sớm</td></tr></tbody></table>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="release-notes",
        category="engineering",
        icon="sparkles",
        en=_LocalizedCopy(
            name="Release Notes & Changelog",
            description="Communicate new features, improvements, bug fixes, and upgrade steps for a release.",
            content=(
                "<h2>Release Summary</h2>"
                "<table><tbody>"
                "<tr><th>Version</th><td>vX.Y.Z</td></tr>"
                "<tr><th>Release Date</th><td>YYYY-MM-DD</td></tr>"
                "<tr><th>Release Manager</th><td>@owner</td></tr>"
                "</tbody></table>"
                "<h2>New Features</h2>"
                "<ul><li><strong>Feature name:</strong> Short summary of what changed and why it matters.</li></ul>"
                "<h2>Improvements</h2>"
                "<ul><li>Performance, usability, or workflow enhancement.</li></ul>"
                "<h2>Bug Fixes</h2>"
                "<ul><li>Fixed issue where ... (#issue-id)</li></ul>"
                "<h2>Breaking Changes &amp; Upgrade Notes</h2>"
                "<pre><code># Required migration or configuration command\n</code></pre>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Ghi chú phát hành (Release Notes)",
            description="Tổng hợp tính năng mới, cải tiến, lỗi đã sửa và hướng dẫn nâng cấp cho mỗi phiên bản.",
            content=(
                "<h2>Thông tin phiên bản</h2>"
                "<table><tbody>"
                "<tr><th>Phiên bản</th><td>vX.Y.Z</td></tr>"
                "<tr><th>Ngày phát hành</th><td>YYYY-MM-DD</td></tr>"
                "<tr><th>Người phụ trách</th><td>@owner</td></tr>"
                "</tbody></table>"
                "<h2>Tính năng mới</h2>"
                "<ul><li><strong>Tên tính năng:</strong> Mô tả ngắn gọn lợi ích cho người dùng.</li></ul>"
                "<h2>Cải tiến</h2>"
                "<ul><li>Tối ưu hiệu năng, giao diện hoặc quy trình thao tác.</li></ul>"
                "<h2>Sửa lỗi</h2>"
                "<ul><li>Khắc phục lỗi khi ... (#mã-issue)</li></ul>"
                "<h2>Thay đổi cần lưu ý &amp; Hướng dẫn nâng cấp</h2>"
                "<pre><code># Lệnh migration hoặc cấu hình cần chạy khi nâng cấp\n</code></pre>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="api-spec",
        category="engineering",
        icon="file-code",
        en=_LocalizedCopy(
            name="API Specification",
            description="Document endpoints, authentication, request/response schemas, and error codes.",
            content=(
                "<h2>Overview</h2>"
                "<table><tbody>"
                "<tr><th>Base URL</th><td><code>/api/v1/...</code></td></tr>"
                "<tr><th>Authentication</th><td>Bearer JWT / Session cookie</td></tr>"
                "<tr><th>Owner</th><td>@backend-team</td></tr>"
                "</tbody></table>"
                "<h2>Endpoints</h2>"
                "<table><thead><tr><th>Method</th><th>Path</th><th>Permission</th><th>Description</th></tr></thead>"
                "<tbody><tr><td><code>POST</code></td><td><code>/api/v1/resources</code></td><td>Authenticated</td><td>Create a resource</td></tr></tbody></table>"
                "<h2>Request Example</h2>"
                "<pre><code>{\n  \"name\": \"example\",\n  \"enabled\": true\n}</code></pre>"
                "<h2>Response Example (200 OK)</h2>"
                "<pre><code>{\n  \"id\": \"uuid\",\n  \"name\": \"example\",\n  \"created_at\": \"2026-01-01T00:00:00Z\"\n}</code></pre>"
                "<h2>Error Codes</h2>"
                "<table><thead><tr><th>HTTP</th><th>Code</th><th>When it happens</th></tr></thead>"
                "<tbody>"
                "<tr><td>400</td><td><code>validation_error</code></td><td>Missing or invalid input fields</td></tr>"
                "<tr><td>403</td><td><code>permission_denied</code></td><td>Caller lacks required role</td></tr>"
                "</tbody></table>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Đặc tả API",
            description="Mô tả endpoint, cơ chế xác thực, cấu trúc request/response mẫu và bảng mã lỗi.",
            content=(
                "<h2>Tổng quan</h2>"
                "<table><tbody>"
                "<tr><th>Base URL</th><td><code>/api/v1/...</code></td></tr>"
                "<tr><th>Xác thực</th><td>Bearer JWT / Session cookie</td></tr>"
                "<tr><th>Đội phụ trách</th><td>@backend-team</td></tr>"
                "</tbody></table>"
                "<h2>Danh sách Endpoint</h2>"
                "<table><thead><tr><th>Phương thức</th><th>Đường dẫn</th><th>Quyền</th><th>Mô tả</th></tr></thead>"
                "<tbody><tr><td><code>POST</code></td><td><code>/api/v1/resources</code></td><td>Đã đăng nhập</td><td>Tạo tài nguyên mới</td></tr></tbody></table>"
                "<h2>Request mẫu</h2>"
                "<pre><code>{\n  \"name\": \"example\",\n  \"enabled\": true\n}</code></pre>"
                "<h2>Response mẫu (200 OK)</h2>"
                "<pre><code>{\n  \"id\": \"uuid\",\n  \"name\": \"example\",\n  \"created_at\": \"2026-01-01T00:00:00Z\"\n}</code></pre>"
                "<h2>Bảng mã lỗi</h2>"
                "<table><thead><tr><th>HTTP</th><th>Mã lỗi</th><th>Nguyên nhân</th></tr></thead>"
                "<tbody>"
                "<tr><td>400</td><td><code>validation_error</code></td><td>Thiếu hoặc sai định dạng dữ liệu đầu vào</td></tr>"
                "<tr><td>403</td><td><code>permission_denied</code></td><td>Không đủ quyền thực hiện</td></tr>"
                "</tbody></table>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="system-architecture",
        category="engineering",
        icon="layers",
        en=_LocalizedCopy(
            name="System Architecture Overview",
            description="Document components, data flow, storage, external integrations, and operational SLAs.",
            content=(
                "<h2>System Summary</h2>"
                "<p>High-level purpose of the system, who uses it, and its business criticality.</p>"
                "<h2>Architecture Diagram</h2>"
                "<p>Insert a <code>/diagram</code> block (Mermaid) or architecture image showing services and data flow.</p>"
                "<h2>Core Components</h2>"
                "<table><thead><tr><th>Component</th><th>Tech Stack</th><th>Responsibility</th><th>Owner</th></tr></thead>"
                "<tbody><tr><td>API Service</td><td>FastAPI / Python</td><td>Business logic &amp; REST API</td><td>@team</td></tr></tbody></table>"
                "<h2>Data Stores &amp; Integrations</h2>"
                "<ul><li><strong>Primary Database:</strong> PostgreSQL (retention, backup cadence).</li>"
                "<li><strong>Cache / Queue:</strong> Redis.</li>"
                "<li><strong>External Services:</strong> List third-party APIs and failure modes.</li></ul>"
                "<h2>Security, Scaling &amp; Observability</h2>"
                "<ul><li>Authentication, encryption at rest/in transit, and network boundaries.</li>"
                "<li>Dashboards, alerts, and target SLOs.</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Tổng quan kiến trúc hệ thống",
            description="Tài liệu hóa các thành phần, luồng dữ liệu, lưu trữ, tích hợp ngoài và cam kết vận hành.",
            content=(
                "<h2>Mục đích hệ thống</h2>"
                "<p>Tóm tắt vai trò hệ thống, đối tượng sử dụng và mức độ quan trọng với doanh nghiệp.</p>"
                "<h2>Sơ đồ kiến trúc</h2>"
                "<p>Chèn khối <code>/diagram</code> (Mermaid) hoặc hình sơ đồ thể hiện các dịch vụ và luồng dữ liệu.</p>"
                "<h2>Các thành phần chính</h2>"
                "<table><thead><tr><th>Thành phần</th><th>Công nghệ</th><th>Trách nhiệm</th><th>Phụ trách</th></tr></thead>"
                "<tbody><tr><td>API Service</td><td>FastAPI / Python</td><td>Nghiệp vụ &amp; REST API</td><td>@team</td></tr></tbody></table>"
                "<h2>Lưu trữ &amp; Tích hợp bên ngoài</h2>"
                "<ul><li><strong>Cơ sở dữ liệu chính:</strong> PostgreSQL (chính sách lưu trữ, sao lưu).</li>"
                "<li><strong>Cache / Hàng đợi:</strong> Redis.</li>"
                "<li><strong>Dịch vụ tích hợp:</strong> Liệt kê API bên thứ ba và cách xử lý khi gián đoạn.</li></ul>"
                "<h2>Bảo mật, Mở rộng &amp; Giám sát</h2>"
                "<ul><li>Xác thực, mã hóa dữ liệu và phân vùng mạng.</li>"
                "<li>Dashboard giám sát, cảnh báo và chỉ tiêu SLO.</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="deployment-checklist",
        category="operations",
        icon="check-square",
        en=_LocalizedCopy(
            name="Deployment & Rollback Checklist",
            description="Step-by-step release checklist covering pre-flight checks, rollout, smoke tests, and rollback.",
            content=(
                "<h2>Release Metadata</h2>"
                "<table><tbody>"
                "<tr><th>Service / Version</th><td>service-name vX.Y.Z</td></tr>"
                "<tr><th>Window</th><td>YYYY-MM-DD HH:MM TZ</td></tr>"
                "<tr><th>Operator</th><td>@operator</td></tr>"
                "</tbody></table>"
                "<h2>Pre-Deployment Checks</h2>"
                "<ul><li>CI pipeline green and release artifact tagged.</li>"
                "<li>Database backup verified before running migrations.</li>"
                "<li>Environment variables and secrets updated.</li></ul>"
                "<h2>Deployment Steps</h2>"
                "<ol><li>Run database migrations.</li>"
                "<li>Deploy new application version.</li>"
                "<li>Verify health endpoints (<code>/health</code>, <code>/ready</code>).</li></ol>"
                "<h2>Post-Deployment Verification</h2>"
                "<ul><li>Run core user-journey smoke tests.</li>"
                "<li>Monitor error rate, latency, and logs for 15 minutes.</li></ul>"
                "<h2>Rollback Plan</h2>"
                "<pre><code># Exact command to restore previous release tag\n</code></pre>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Danh sách kiểm tra triển khai (Deployment)",
            description="Checklist triển khai từng bước: kiểm tra trước khi chạy, deploy, kiểm thử nhanh và phương án rollback.",
            content=(
                "<h2>Thông tin đợt triển khai</h2>"
                "<table><tbody>"
                "<tr><th>Dịch vụ / Phiên bản</th><td>service-name vX.Y.Z</td></tr>"
                "<tr><th>Khung giờ</th><td>YYYY-MM-DD HH:MM</td></tr>"
                "<tr><th>Người thực hiện</th><td>@operator</td></tr>"
                "</tbody></table>"
                "<h2>Kiểm tra trước khi triển khai</h2>"
                "<ul><li>CI đã xanh và image/tag phát hành đã sẵn sàng.</li>"
                "<li>Đã xác nhận bản sao lưu cơ sở dữ liệu trước khi chạy migration.</li>"
                "<li>Đã rà soát biến môi trường và secret mới.</li></ul>"
                "<h2>Các bước triển khai</h2>"
                "<ol><li>Chạy database migration.</li>"
                "<li>Cập nhật phiên bản ứng dụng mới.</li>"
                "<li>Kiểm tra endpoint sức khỏe (<code>/health</code>, <code>/ready</code>).</li></ol>"
                "<h2>Kiểm tra sau triển khai</h2>"
                "<ul><li>Chạy kiểm thử nhanh các luồng người dùng cốt lõi.</li>"
                "<li>Theo dõi tỷ lệ lỗi, độ trễ và log trong 15 phút.</li></ul>"
                "<h2>Phương án khôi phục (Rollback)</h2>"
                "<pre><code># Lệnh quay về phiên bản ổn định trước đó\n</code></pre>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="security-review",
        category="operations",
        icon="shield",
        en=_LocalizedCopy(
            name="Security Review Checklist",
            description="Evaluate authentication, authorization, input handling, secrets, and audit logging before launch.",
            content=(
                "<h2>Review Scope</h2>"
                "<table><tbody>"
                "<tr><th>Feature / Service</th><td>Name</td></tr>"
                "<tr><th>Reviewer</th><td>@security</td></tr>"
                "<tr><th>Decision</th><td>Approved / Changes Requested</td></tr>"
                "</tbody></table>"
                "<h2>Authentication &amp; Authorization</h2>"
                "<ul><li>Every endpoint enforces authentication and object-level permission checks.</li>"
                "<li>Sensitive actions (role changes, resets, deletes) require elevated privileges and audit logs.</li></ul>"
                "<h2>Data &amp; Input Protection</h2>"
                "<ul><li>All user inputs validated; HTML/Markdown sanitized against XSS.</li>"
                "<li>Secrets encrypted at rest, masked in UI, and redacted from logs.</li>"
                "<li>Rate limiting applied to login, verification, and public endpoints.</li></ul>"
                "<h2>Findings &amp; Follow-ups</h2>"
                "<table><thead><tr><th>Severity</th><th>Finding</th><th>Remediation</th><th>Status</th></tr></thead>"
                "<tbody><tr><td>Medium</td><td>Describe finding</td><td>Fix before release</td><td>Open</td></tr></tbody></table>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Đánh giá bảo mật (Security Review)",
            description="Rà soát xác thực, phân quyền, kiểm tra dữ liệu đầu vào, quản lý bí mật và nhật ký kiểm toán trước khi ra mắt.",
            content=(
                "<h2>Phạm vi đánh giá</h2>"
                "<table><tbody>"
                "<tr><th>Tính năng / Dịch vụ</th><td>Tên hạng mục</td></tr>"
                "<tr><th>Người đánh giá</th><td>@security</td></tr>"
                "<tr><th>Kết luận</th><td>Đạt / Cần chỉnh sửa</td></tr>"
                "</tbody></table>"
                "<h2>Xác thực &amp; Phân quyền</h2>"
                "<ul><li>Mọi endpoint đều kiểm tra đăng nhập và quyền truy cập tới từng đối tượng.</li>"
                "<li>Thao tác nhạy cảm (đổi quyền, đặt lại mật khẩu/2FA, xóa) đều có kiểm tra quyền và ghi audit log.</li></ul>"
                "<h2>Bảo vệ dữ liệu &amp; Đầu vào</h2>"
                "<ul><li>Kiểm tra chặt dữ liệu đầu vào; làm sạch HTML chống XSS.</li>"
                "<li>Khóa bí mật được mã hóa khi lưu trữ, che trên UI và không xuất hiện trong log.</li>"
                "<li>Áp dụng giới hạn tần suất (rate limit) cho đăng nhập, xác minh và API công khai.</li></ul>"
                "<h2>Phát hiện &amp; Hạng mục khắc phục</h2>"
                "<table><thead><tr><th>Mức độ</th><th>Vấn đề</th><th>Hướng khắc phục</th><th>Trạng thái</th></tr></thead>"
                "<tbody><tr><td>Trung bình</td><td>Mô tả phát hiện</td><td>Xử lý trước khi phát hành</td><td>Đang mở</td></tr></tbody></table>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="weekly-status",
        category="team",
        icon="calendar",
        en=_LocalizedCopy(
            name="Weekly Status Update",
            description="Share weekly highlights, progress against goals, blockers, and priorities for next week.",
            content=(
                "<h2>Week of YYYY-MM-DD</h2>"
                "<table><tbody>"
                "<tr><th>Team / Project</th><td>Team Name</td></tr>"
                "<tr><th>Overall Health</th><td>On Track / Needs Attention / Blocked</td></tr>"
                "<tr><th>Author</th><td>@author</td></tr>"
                "</tbody></table>"
                "<h2>Key Wins This Week</h2>"
                "<ul><li>Completed milestone or shipped feature.</li></ul>"
                "<h2>In Progress</h2>"
                "<ul><li>Workstream 1 — current status and ETA.</li></ul>"
                "<h2>Blockers &amp; Help Needed</h2>"
                "<ul><li>Describe blocker and who can help unblock it.</li></ul>"
                "<h2>Priorities for Next Week</h2>"
                "<ol><li>Top priority 1</li><li>Top priority 2</li></ol>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Báo cáo tiến độ hàng tuần",
            description="Cập nhật kết quả nổi bật trong tuần, đầu việc đang làm, vướng mắc và ưu tiên tuần tới.",
            content=(
                "<h2>Tuần ngày YYYY-MM-DD</h2>"
                "<table><tbody>"
                "<tr><th>Nhóm / Dự án</th><td>Tên nhóm</td></tr>"
                "<tr><th>Tình trạng chung</th><td>Đúng tiến độ / Cần lưu ý / Đang bị chặn</td></tr>"
                "<tr><th>Người báo cáo</th><td>@author</td></tr>"
                "</tbody></table>"
                "<h2>Kết quả hoàn thành trong tuần</h2>"
                "<ul><li>Tính năng hoặc cột mốc đã hoàn tất.</li></ul>"
                "<h2>Đang triển khai</h2>"
                "<ul><li>Đầu việc 1 — tiến độ hiện tại và thời gian dự kiến.</li></ul>"
                "<h2>Vướng mắc &amp; Cần hỗ trợ</h2>"
                "<ul><li>Mô tả trở ngại và người/bộ phận cần phối hợp tháo gỡ.</li></ul>"
                "<h2>Ưu tiên tuần tới</h2>"
                "<ol><li>Ưu tiên số 1</li><li>Ưu tiên số 2</li></ol>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="one-on-one",
        category="meeting",
        icon="users",
        en=_LocalizedCopy(
            name="1:1 Meeting Notes",
            description="Recurring check-in structure for wins, challenges, feedback, and career growth.",
            content=(
                "<h2>Check-in — YYYY-MM-DD</h2>"
                "<p><strong>Participants:</strong> @manager, @teammate</p>"
                "<h2>Top of Mind &amp; Wins</h2>"
                "<ul><li>What went well since our last chat?</li></ul>"
                "<h2>Challenges &amp; Support Needed</h2>"
                "<ul><li>Anything blocking progress, workload concerns, or decisions needed?</li></ul>"
                "<h2>Feedback &amp; Growth</h2>"
                "<ul><li>Two-way feedback and skills/goals to focus on this quarter.</li></ul>"
                "<h2>Action Items</h2>"
                "<ul><li>[ ] Follow-up item — @owner</li></ul>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Ghi chú họp 1:1",
            description="Khung trao đổi định kỳ về kết quả, khó khăn, góp ý hai chiều và định hướng phát triển.",
            content=(
                "<h2>Buổi trao đổi — YYYY-MM-DD</h2>"
                "<p><strong>Thành phần:</strong> @manager, @teammate</p>"
                "<h2>Điểm nổi bật &amp; Thành quả</h2>"
                "<ul><li>Những việc làm tốt từ buổi gặp trước đến nay?</li></ul>"
                "<h2>Khó khăn &amp; Cần hỗ trợ</h2>"
                "<ul><li>Có vướng mắc công việc, khối lượng hay quyết định nào cần tháo gỡ không?</li></ul>"
                "<h2>Phản hồi &amp; Phát triển</h2>"
                "<ul><li>Góp ý hai chiều và kỹ năng/mục tiêu muốn tập trung trong quý này.</li></ul>"
                "<h2>Hành động tiếp theo</h2>"
                "<ul><li>[ ] Hạng mục theo dõi — @owner</li></ul>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="sop",
        category="operations",
        icon="wrench",
        en=_LocalizedCopy(
            name="Standard Operating Procedure (SOP)",
            description="Document a repeatable business or IT process with roles, steps, and compliance checks.",
            content=(
                "<h2>Document Control</h2>"
                "<table><tbody>"
                "<tr><th>Process Owner</th><td>@owner</td></tr>"
                "<tr><th>Effective Date</th><td>YYYY-MM-DD</td></tr>"
                "<tr><th>Review Cadence</th><td>Quarterly / Annually</td></tr>"
                "</tbody></table>"
                "<h2>Purpose &amp; Scope</h2>"
                "<p>Explain when this procedure applies and who must follow it.</p>"
                "<h2>Prerequisites &amp; Tools</h2>"
                "<ul><li>Required permissions, systems, or templates.</li></ul>"
                "<h2>Step-by-Step Procedure</h2>"
                "<ol><li><strong>Step 1:</strong> Clear, unambiguous action.</li>"
                "<li><strong>Step 2:</strong> Verification checkpoint.</li>"
                "<li><strong>Step 3:</strong> Completion and record keeping.</li></ol>"
                "<h2>Exceptions &amp; Escalation</h2>"
                "<p>Who to contact when an edge case falls outside the standard flow.</p>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Quy trình vận hành chuẩn (SOP)",
            description="Chuẩn hóa quy trình nghiệp vụ hoặc vận hành IT với vai trò, các bước thực hiện và điểm kiểm soát.",
            content=(
                "<h2>Kiểm soát tài liệu</h2>"
                "<table><tbody>"
                "<tr><th>Chủ quy trình</th><td>@owner</td></tr>"
                "<tr><th>Ngày hiệu lực</th><td>YYYY-MM-DD</td></tr>"
                "<tr><th>Chu kỳ rà soát</th><td>Hàng quý / Hàng năm</td></tr>"
                "</tbody></table>"
                "<h2>Mục đích &amp; Phạm vi áp dụng</h2>"
                "<p>Nêu rõ khi nào áp dụng quy trình này và những ai cần tuân thủ.</p>"
                "<h2>Điều kiện tiên quyết &amp; Công cụ</h2>"
                "<ul><li>Quyền truy cập, hệ thống hoặc biểu mẫu cần chuẩn bị.</li></ul>"
                "<h2>Các bước thực hiện</h2>"
                "<ol><li><strong>Bước 1:</strong> Thao tác cụ thể, rõ ràng.</li>"
                "<li><strong>Bước 2:</strong> Điểm kiểm tra xác nhận kết quả.</li>"
                "<li><strong>Bước 3:</strong> Hoàn tất và lưu hồ sơ.</li></ol>"
                "<h2>Ngoại lệ &amp; Leo thang xử lý</h2>"
                "<p>Liên hệ ai khi phát sinh tình huống nằm ngoài quy trình chuẩn.</p>"
            ),
        ),
    ),
    _BuiltinTemplateDef(
        slug="troubleshooting-faq",
        category="general",
        icon="lightbulb",
        en=_LocalizedCopy(
            name="Troubleshooting & FAQ",
            description="Organise common issues, symptoms, root causes, and quick answers for your team.",
            content=(
                "<h2>Quick Summary</h2>"
                "<p>What product, service, or workflow this troubleshooting guide covers.</p>"
                "<h2>Common Issues</h2>"
                "<h3>Symptom 1: Error message or unexpected behaviour</h3>"
                "<ul><li><strong>Cause:</strong> Short explanation of why this happens.</li>"
                "<li><strong>Fix:</strong> Exact steps or command to resolve it.</li></ul>"
                "<h3>Symptom 2: Another frequent issue</h3>"
                "<ul><li><strong>Cause:</strong> Short explanation.</li>"
                "<li><strong>Fix:</strong> Resolution steps.</li></ul>"
                "<h2>Frequently Asked Questions</h2>"
                "<p><strong>Q: Common question?</strong></p>"
                "<p>A: Clear, direct answer with a link to the relevant guide.</p>"
                "<h2>Still Stuck?</h2>"
                "<p>Share logs, screenshots, and steps to reproduce with @support-channel.</p>"
            ),
        ),
        vi=_LocalizedCopy(
            name="Xử lý sự cố & Câu hỏi thường gặp (FAQ)",
            description="Tổng hợp các lỗi thường gặp, nguyên nhân, cách khắc phục nhanh và câu hỏi phổ biến.",
            content=(
                "<h2>Giới thiệu nhanh</h2>"
                "<p>Phạm vi sản phẩm, dịch vụ hoặc quy trình mà tài liệu này hỗ trợ.</p>"
                "<h2>Các lỗi thường gặp</h2>"
                "<h3>Triệu chứng 1: Thông báo lỗi hoặc hành vi bất thường</h3>"
                "<ul><li><strong>Nguyên nhân:</strong> Giải thích ngắn gọn lý do xảy ra.</li>"
                "<li><strong>Cách khắc phục:</strong> Các bước hoặc câu lệnh xử lý chi tiết.</li></ul>"
                "<h3>Triệu chứng 2: Một sự cố phổ biến khác</h3>"
                "<ul><li><strong>Nguyên nhân:</strong> Giải thích ngắn gọn.</li>"
                "<li><strong>Cách khắc phục:</strong> Các bước xử lý.</li></ul>"
                "<h2>Câu hỏi thường gặp</h2>"
                "<p><strong>Hỏi: Câu hỏi phổ biến?</strong></p>"
                "<p>Đáp: Câu trả lời rõ ràng kèm liên kết tới tài liệu chi tiết.</p>"
                "<h2>Vẫn chưa xử lý được?</h2>"
                "<p>Gửi kèm log, ảnh chụp màn hình và các bước tái hiện lỗi tới @support-channel.</p>"
            ),
        ),
    ),
)

_BUILTINS_BY_SLUG: dict[str, _BuiltinTemplateDef] = {item.slug: item for item in _BUILTINS}


def is_builtin_template_id(template_id: str) -> bool:
    """Return True when ``template_id`` targets a built-in template."""
    return template_id.startswith(BUILTIN_PREFIX)


def _to_read(definition: _BuiltinTemplateDef, lang: TemplateLang) -> PageTemplateRead:
    copy = definition.vi if lang == "vi" else definition.en
    return PageTemplateRead(
        id=f"{BUILTIN_PREFIX}{definition.slug}",
        scope="builtin",
        is_builtin=True,
        space_id=None,
        space_key=None,
        name=copy.name,
        description=copy.description,
        category=definition.category,
        icon=definition.icon,
        content=_style_table_headers(copy.content),
        content_format="html",
        created_by_username=None,
        updated_by_username=None,
        created_at=None,
        updated_at=None,
    )


def list_builtin_templates(lang: TemplateLang = "en") -> list[PageTemplateRead]:
    """Return all read-only built-in templates in the requested language."""
    return [_to_read(item, lang) for item in _BUILTINS]


def get_builtin_template(
    template_id: str, lang: TemplateLang = "en"
) -> PageTemplateRead | None:
    """Look up a built-in template by ``builtin:<slug>`` id (or bare slug)."""
    slug = (
        template_id[len(BUILTIN_PREFIX) :]
        if template_id.startswith(BUILTIN_PREFIX)
        else template_id
    )
    definition = _BUILTINS_BY_SLUG.get(slug)
    if definition is None:
        return None
    return _to_read(definition, lang)
