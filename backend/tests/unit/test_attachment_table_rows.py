"""A table read for the chat keeps its rows: one line per row, merged cells repeated down."""

from __future__ import annotations

from app.modules.attachments.text import table_rows


def test_each_row_is_one_line_and_a_merged_cell_names_every_row_it_covers() -> None:
    markup = (
        "<p>Before</p><table>"
        "<tr><th colspan='2'>Service</th><th>Parameters</th></tr>"
        "<tr><td rowspan='3'><b>INTEGRATION-SERVICE</b></td><td>deployment</td>"
        "<td>minReplicas: 4<br>maxReplicas: 10</td></tr>"
        "<tr><td rowspan='x'>integration-configmap</td><td>PORT: 8080</td></tr>"
        "<tr><td>   </td><td>TZ</td></tr>"
        "<tr><td colspan='2'>AUTH-SERVICE</td><td>TZ</td></tr>"
        "<tr><td rowspan='2'>A</td><td rowspan='2'>B</td></tr>"
        "<tr></tr>"
        "</table><p>After</p>"
    )

    assert table_rows(markup) == (
        "<p>Before</p>"
        "<p>Service | Parameters</p>"
        "<p>INTEGRATION-SERVICE | deployment | minReplicas: 4; maxReplicas: 10</p>"
        "<p>INTEGRATION-SERVICE | integration-configmap | PORT: 8080</p>"
        "<p>INTEGRATION-SERVICE | TZ</p>"
        "<p>AUTH-SERVICE | TZ</p>"
        # A row of cells merged down from the one above only is not said twice.
        "<p>A | B</p>"
        "<p>After</p>"
    )


def _criteria_table() -> str:
    """Twenty criteria; one owner written four ways, "trách nhiệm" in some long notes."""
    who = {2: "QuanNT owner", 3: "QuanNT owner", 9: "Quan NT", 12: "- Quân NT + Thy", 15: "QuânNT"}
    note = "Ai chịu trách nhiệm cho tiêu chí này cần được ghi rõ trong kế hoạch triển khai năm"
    rows = "".join(
        f"<tr><td>{n}</td><td>GG-{n:02}</td><td>Criteria group</td><td>Criteria {n}</td>"
        f"<td>{who.get(n, 'Thy')}</td><td>{note if n % 3 == 0 else 'Kiểm tra chéo'}</td></tr>"
        for n in range(1, 21)
    )
    head = "<tr><th>No</th><th>Code</th><th>Group</th><th>Name</th><th>Who</th><th>Note</th></tr>"
    return f"<table>{head}{rows}</table>"


def test_the_rows_naming_a_rare_word_are_given_with_how_many_there_are() -> None:
    from app.modules.search.service import _matching_rows

    table = _criteria_table()
    found = _matching_rows(table, ["quannt", "phu", "trach", "criteria", "liet", "ke"], 4800)
    # The owner, however written, picks the rows: not "trách" in long notes (nor the "tra ch"
    # of "Kiểm tra chéo"), "criteria" on every row, or "liet ke", which only asks for a list.
    assert found.splitlines() == [
        "Table rows naming QuanNT / Quan NT / Quân NT / QuânNT: 5"
        " - one name written in several ways (accents, case or spacing), counted once",
        "2 | GG-02 | Criteria group | Criteria 2 | QuanNT owner",
        "3 | GG-03 | Criteria group | Criteria 3 | QuanNT owner",
        "9 | GG-09 | Criteria group | Criteria 9 | Quan NT",
        "12 | GG-12 | Criteria group | Criteria 12 | - Quân NT + Thy",
        "15 | GG-15 | Criteria group | Criteria 15 | QuânNT",
    ]
    # Asked as "Quân NT": joined back into the one name, "nt" alone is not looked for.
    asked_apart = _matching_rows(table, ["quan", "nt", "phu", "trach"], 4800)
    assert asked_apart.splitlines()[0].endswith(": 5" + found.splitlines()[0].split(": 5")[1])
    # When not all fit, the number found is still said.
    capped = _matching_rows(table, ["quannt"], 60).splitlines()
    assert capped[0].startswith(
        "Table rows naming QuanNT / Quan NT / Quân NT / QuânNT: 5 (1 shown)"
    )
    assert capped[1:] == ["2 | GG-02 | Criteria group | Criteria 2 | QuanNT owner"]
    # "Thy" is on 16 rows of 20: a word on most rows picks out nothing.
    assert _matching_rows(table, ["thy"], 4800) == ""
    # Nothing to pick rows by: no table, too small a table, no word found, or none rare.
    assert _matching_rows("<p>QuanNT</p>", ["quannt"], 4800) == ""
    assert _matching_rows(table, [], 4800) == ""
    assert _matching_rows("<table><tr><td>QuanNT</td></tr></table>", ["quannt"], 4800) == ""
    assert _matching_rows(table, ["zebra"], 4800) == ""
    assert _matching_rows(table, ["criteria"], 4800) == ""


def test_with_no_name_asked_the_rarest_word_picks_the_rows() -> None:
    from app.modules.search.service import _matching_rows

    # "trach" lives only in long notes: with nothing short to go by, it is the word to use.
    found = _matching_rows(_criteria_table(), ["trach", "criteria"], 4800)
    assert found.splitlines()[0] == "Table rows naming trách: 6"


def test_a_name_is_found_however_a_cell_writes_it_but_only_as_a_word() -> None:
    from app.modules.search.service import _spellings

    assert _spellings("QuanNT, Quân NT and QUÂN-NT", "quannt") == ["QuanNT", "Quân NT", "QUÂN-NT"]
    # Not inside another word, and not two words that only spell it across their gap.
    assert _spellings("ThuQuanNT", "quannt") == []
    assert _spellings("kiểm tra chéo", "trach") == []
    assert _spellings("trách nhiệm", "trach") == ["trách"]


def test_a_question_about_the_attached_file_is_told_from_one_beside_it() -> None:
    from app.modules.ai.chat_files import mentions_files

    for question in ("Trả lời các câu hỏi trong file đính kèm", "summarise the attached sheet"):
        assert mentions_files(question), question
    assert not mentions_files("Quannt phụ trách bao nhiêu tiêu chí")
