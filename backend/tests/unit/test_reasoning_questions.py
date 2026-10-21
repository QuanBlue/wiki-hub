"""Questions that need facts combined are recognised, and answered under the reasoning rules."""

from __future__ import annotations

from app.modules.ai.skills import REASONING_RULES, answer_system_prompt
from app.modules.search.query import needs_reasoning


def test_counting_comparing_and_applying_a_rule_need_reasoning() -> None:
    for question in (
        "Hệ thống dms4 đang có bao nhiêu server",
        "Production nhiều hơn staging bao nhiêu server?",
        "So sánh Grafana nội bộ và Grafana Cloud",
        "Dùng NodePort 9100 có được không?",
        "Những server nào có IP public?",
        "Nếu first master lỗi thì sao?",
        "How many workers are there in total?",
        "Which node has the smallest disk?",
    ):
        assert needs_reasoning(question), question
    for question in ("Cài đặt VPN SSL", "Thời tiết Hà Nội hôm nay", "Thông tin tài khoản admin"):
        assert not needs_reasoning(question), question


def test_the_reasoning_rules_are_added_only_when_asked() -> None:
    assert REASONING_RULES in answer_system_prompt(reasoning=True)
    assert REASONING_RULES not in answer_system_prompt()
    # The rules that matter most: totals that add up, sharing counted once, yes/no first.
    for phrase in ("equals the sum", "not 9", "answer yes or no first"):
        assert phrase in REASONING_RULES


def test_a_whole_list_and_a_complaint_about_the_last_answer_are_recognised() -> None:
    from app.modules.search.query import asks_about_last_answer, wants_full_list

    assert wants_full_list("liệt kê đầy đủ thông tin 33 serverr")
    assert wants_full_list("List all the servers")
    assert not wants_full_list("hệ thống dms4 có bao nhiêu server")
    for question in (
        "sao tôi thấy 33 server mà chỉ liệt kê mỗi 22 server",
        "tiếp tục",
        "còn lại thì sao",
        "you only listed 10",
    ):
        assert asks_about_last_answer(question), question
    # "Thiếu kinh phí" (a lack of funds) is a question of its own, not a complaint.
    assert not asks_about_last_answer("Thiếu kinh phí trong tờ trình phương án kinh doanh")
