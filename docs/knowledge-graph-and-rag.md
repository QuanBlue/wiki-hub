# Knowledge graph and retrieval (RAG)

How WikiHub finds what a question is about, how it knows which pages belong
together, and how both feed the AI assistant and the page map. Read this before
changing search, the AI answer pipeline, or anything in `backend/app/modules/graph/`.

## The short version

```
Question
  -> search: keyword (Postgres full text) + meaning (pgvector embeddings), fused
  -> the best pages, copies of one page counted once
  -> knowledge graph: up to N pages tied to those (permission-checked)
  -> passages from all of them, under a character budget
  -> the chat model answers, citing the pages it read
```

The graph **adds to** retrieval; it never replaces search. Nothing in the graph is
written into a page, and no language model is called to build it.

## 1. Retrieval (RAG)

Code: `backend/app/modules/search/` (`service.py`, `query.py`, `indexer.py`,
`chunking.py`, `ddl.py`).

### Keyword search
- `pages.search_vector` is a generated `tsvector` of title (weight A) and body
  (weight B), built by `wh_search_vector` with `wh_unaccent` - accents removed and
  `_ . - / : @` treated as word breaks, so Vietnamese without accents and
  `tessel_v2` both match. Defined in `ddl.py`, created by migrations.
- `query.build_concepts` turns a question into a handful of *ideas*: stop words
  dropped, Vietnamese/English synonyms attached (`synonyms.py`). Rarer ideas weigh
  more; a page must cover at least half the weight to be listed.
- Substring matching fills in when ranked search finds little.
- A word of the question that names a space - its key or name without the leading
  ordering number, or with a digit the start of one ("dms4" for `3DMS40`) - makes
  that space's pages, ranked by the rest of the question, a fourth ranking in the
  fusion (`_named_space_pages`, weight 1.2): people call a project by its space.

### Semantic search
- `indexer.index_pending` (worker cron `index_search_pages`, every minute) polls for
  pages whose `updated_at` differs from `page_search_state`, splits them into
  passages (`chunking.chunk_page`, ~900 chars, each prefixed with title and heading)
  and stores one vector per passage in `page_chunks` (pgvector).
- The embedding model is set in Administration > AI assistant > Semantic search
  (`ai_embedding_settings`). Changing it empties the index and re-embeds
  everything (`reset_if_model_changed`).
- At query time the question is embedded (cached in Redis for an hour) and the
  nearest passages are found; results under `min_similarity` are dropped.

### Fusing and answering
- `SearchService._search_pages` merges the keyword and semantic rankings by
  reciprocal rank fusion and checks `PermissionService.can_view_page` for every page.
- `SearchService.answer_passages` (used by both the answer endpoint,
  `modules/ai/answer.py`, and chat, `modules/ai/chat.py`) takes the top pages,
  **skipping copies** of a page already taken (same title without a "(1)"
  suffix - see `graph.extract.copy_key`), picks each page's best passages, and
  keeps the total under `total_chars` (6,000 by default).
- Related pages from the graph are then added in what is left of that budget
  (section 3).

### Questions that need reasoning

A question that needs facts combined - counted, added up, compared, a rule applied to a case -
is recognised by its words (`search.query.needs_reasoning`: "bao nhiêu", "tổng", "so sánh",
"có được không", "nếu", "how many", "which"...). The chat then reads more (`chat.REASONING_LIMITS`:
7 pages, 2400 characters of each, 20 000 in all - a count needs the whole table) and answers
under `skills.REASONING_RULES`: gather facts from every source, count every group and check the
total, show the arithmetic, count shared resources once, answer yes/no first by the most
specific rule, name disagreeing sources, answer the part that is there. A page that links a
file attached elsewhere reads that file too (`SearchService._linked_files`, permission-checked),
and a page too long for what is left of the budget is skipped, not the end of reading.
A count or a list over a large table ("how many criteria is QuanNT responsible for" in a table
of 85) adds the table rows naming the question's rarest words (`SearchService._matching_rows`,
`answer_passages(table_rows=True)`): each row as its first cells plus the cells naming the
word, a merged cell repeated on every row it covers (`attachments.text.table_row_cells`), and
first the number of rows found, so the count is right even when not all of them fit. Words on
more than half the rows, or that only ask for a count or list ("liệt kê"), pick out nothing.
A word is found however a cell writes it - accents, case and spaces or dashes inside it aside
("QuanNT", "QuânNT", "Quan NT", "Quân NT"), but only where it begins a word and, run over a
space, ends one (`_spellings`); "Quan NT" asked is joined back into the one name when a cell
writes it as one word (`_joined_terms`). A name sits in short cells (an owner column) while a
common word sits in long ones, so a word found mostly in cells of 80 characters or less is
preferred to a rarer word of prose, and the spellings found are listed with the count.
Measure with `backend/scripts/eval_chat.py` on a question file of your own (`*.local.json`).

### Attached files

People often attach a Word, Excel, PDF or HTML file to a page instead of importing
it, and still expect to search and ask about it. Code:
`backend/app/modules/attachments/text.py`, table `attachment_texts`.

- The worker cron `extract_attachment_texts` (every minute, lock
  `lock:attachment_text`, paused with indexing) reads each file **the page still
  links to** with the document-import readers (`document_import.convert`: pandoc,
  PyMuPDF, the spreadsheet reader; plain `.txt` as is) and keeps only the words as
  `<h2>`/`<p>` markup, cut at 200,000 characters. Nothing calls a model; a scanned
  PDF is **not** OCR'd but marked `scanned`. Other statuses: `ok`, `empty`,
  `unsupported`, `too_large` (over 50 MB), `failed` (with the reason).
- A reading is valid for its `signature` (size, office revision, name): a replaced
  or re-edited file is read again; a file removed from the page's content is
  forgotten, with its passages.
- Keyword: `attachment_texts.search_vector` (`wh_search_vector(filename, content)`,
  see `ddl.ATTACHMENT_VECTOR_STATEMENTS`). `SearchService._file_hits` ranks files
  like page bodies (half the question's weight; a file whose name holds the
  question first) and is fused as a third ranking (`_FILE_WEIGHT` 0.8) for the
  page the file is attached to. A result whose words are only in a file carries
  `file_id`/`file_name`.
- Meaning: the indexer embeds a page's files with it - up to `FILE_CHUNKS` (20)
  passages per file, led by "page title - file name" - in `page_chunks` with
  `attachment_id` set. Reading a file drops the page's search state, so the page is
  re-embedded. The graph's similar edges ignore file passages.
- Answers: `answer_passages` takes, per page, the stretches with the asked words
  from the page and up to three matching files (`_FILES_PER_PAGE`), the one holding
  most of the question first; each `AnswerPassage`/`AnswerSource` lists the `files`
  it was read from.
- "Ask about this file": `ChatRequest.attachment_id` makes the chat answer from that
  file alone (`SearchService.file_context`: the whole text when short, else its
  opening plus the passages closest to the question) - no wiki search, Help or web.
  The page's view permission is checked; a file that could not be read is refused.
- Files attached in the chat (`ai/chat_files.py`): `POST /ai/chat/files` reads an
  upload (at most 20 MB) with the same `read_file`, keeps only its words in Redis
  (`aichatfile:<id>`, for that person, 24 h after the last question) and never stores
  the file. `ChatRequest.file_ids` (at most 3) adds them to an ordinary chat turn: the
  wiki, Help and web are still searched, the files are given as `<file_sources>`
  (whole when short, else their opening plus the stretch for each question) and cited
  `[f1]`, and `AnswerResult.file_sources` lists the ones cited. An answer citing only
  a file is grounded; an expired or foreign id is refused (`chat_file_expired`).
  Such turns are not recorded as unanswered questions.

## 2. The knowledge graph

Code: `backend/app/modules/graph/` - `extract.py` (pure text functions),
`builder.py` (background pass), `neighbors.py` (reading the graph), `service.py`
(what readers see). Tables: `page_links`, `page_graph_state`
(migration `20261023_0001_page_graph`).

### Kinds of tie

| Kind | Where it comes from | Weight when ranking neighbours |
| --- | --- | --- |
| `link` | An internal link in the page (`/spaces/{key}/pages/{slug}`, HTML or Markdown) | 3.0 |
| `mention` | The page names another page by its exact title | 2.0 |
| `similar` | The two pages' mean passage vectors are alike (`>= graph_min_similarity`, 0.70) | 1.5 x similarity |
| parent / child | `pages.parent_id` - not stored, read live | 1.0 |
| sibling | Same parent (top-level pages are not siblings) | 0.5 |

Edges are stored one way (`source -> target`) but read both ways: "links to this
page" (`linked_from`) and "names this page" (`mentioned_by`) count too.

### How mentions are found (`extract.py`)
- Titles and text are folded the way search folds them (`query.fold`), and matched
  on whole words. At each word the longest title wins ("Leave request form" over
  "Leave request").
- A title is ignored if it is generic ("Overview", "Tổng quan", "FAQ"...), a single
  word shorter than 6 letters ("AM", "PMO"), or only filler words.
- A title shared by several pages names the one in the same space; if that is still
  ambiguous (copies), it names none. An empty page is never a target.
- At most 30 mentions per page.

### How the graph is kept current (`builder.py`)
The builder **polls**, like the search indexer, instead of hooking every write path:
worker cron `build_page_graph` (second 25 of every minute, Redis lock, 50 s budget).

1. Pages whose `updated_at` differs from `page_graph_state.source_updated_at` get
   their `link` and `mention` edges recomputed (`replace_edges`). Covers edit,
   import, restore, move - anything that touches the row.
2. A **new or renamed** title is looked up (via `search_vector`) in other pages, so
   older pages that already name it get the edge. A rename first drops the mentions
   of the old title.
3. Pages in the Trash have their state forgotten (edges kept, readers skip them); a
   restored page is treated as new.
4. `similar` edges: for pages embedded since last time
   (`page_search_state.indexed_at`), compare page centroids (`avg(embedding)`) with
   every live page, keep the top 5 above the threshold, skipping near-duplicates
   (>= 0.97) and more than one copy of a page. When the embedding model changes,
   `similar` edges measured with the old model are dropped and rebuilt as pages are
   re-embedded.

The graph is derived data: truncating `page_links` and `page_graph_state` rebuilds
everything on the next passes (81 pages took ~2 s on the dev data).

## 3. Graph in AI answers

`SearchService._related_passages`:
- Seeds = pages search found, weighted 1, 1/2, 1/3... by rank.
- `neighbors.related_pages` scores every tied page (sum of tie weight x seed weight;
  a `similar` pair counts once), drops copies of pages already in hand, keeps live
  pages in active spaces.
- Only neighbours scoring at least `_RELATED_MIN_SCORE` (0.75) are taken - a page tied
  only to a weak match is left out. Empty pages are skipped. **Every one is checked
  with `can_view_page` for the person asking.**
- Up to `graph_related_pages` pages (admin tuning, default **2**, 0 = off), placed
  after the search results and only in the budget left over.
- Logged as `search_related_pages` (counts and timing, never the question).

Measured on 28 real questions (`backend/scripts/eval_answers.py`, questions kept in
the git-ignored `scripts/eval_questions.local.json`):

| Setup | Recall | Questions with every needed page |
| --- | --- | --- |
| Search only, before copy de-duplication | 78% | 20/28 |
| Search, copies counted once | 86% | 22/28 |
| + 2 related pages from the graph | 90% | 24/28 |

The related step costs ~20 ms against ~500 ms for search. Re-run the script after
changing weights or thresholds:

```bash
docker compose exec backend python -m scripts.eval_answers \
  scripts/eval_questions.local.json --related 0 2 3 -v
```

It writes nothing and does not call the chat model. Make sure the embedding model is
reachable first, or semantic search silently falls back to keywords.

## 4. Graph for readers

`GraphService` (`modules/graph/service.py`), API in `app/api/v1/graph.py`:

| Endpoint | Used by |
| --- | --- |
| `GET /api/v1/spaces/{key}/pages/{slug}/related` | "Related pages" under a page, and the names linked while reading |
| `GET /api/v1/spaces/{key}/graph?kinds=` | Page map of one space |
| `GET /api/v1/graph?spaces=&kinds=` | Page map of every space the reader may open, ties between spaces included |

- **Related pages** (`components/pages/related-pages.tsx`): tree ties left out (the
  sidebar already shows them), up to 8, each with why.
- **Names become links** (`lib/page-mentions.ts`): the first place a page names
  another is turned into a link in the HTML handed to the reader; headings, code and
  existing links are left alone, the stored page is unchanged.
- **Page map** (`components/pages/space-graph.tsx`, layout in `lib/graph-layout.ts`):
  SVG, no chart library. Force-directed layout per connected component, components
  packed in rows; across spaces, pages of one space are pulled together. Colour by
  Space / Group (weighted label propagation, deterministic) / Branch; only three hues
  are used so they stay apart for colour-blind readers, the legend names every group.
  Insights: pages tied to nothing (in any space), pages joining groups, loosely tied
  groups (>= 4 pages, < 30% of pairs tied). Up to 500 pages, best-connected first.
  Opened from a space's sidebar, the Spaces page, and Administration > Spaces.

Every endpoint filters by the reader's permissions: a restricted page never appears,
not even as the far end of a tie.

## 5. Content health and unanswered questions

Two uses of the same data to keep the wiki itself in shape.

**Content health** (`modules/graph/health.py`, `components/pages/space-health.tsx`) - a
report for a space's Owners and Admins, worked out when asked for; no model is called:

| List | How |
| --- | --- |
| Out of date | Live, non-empty pages with `GREATEST(updated_at, page_reviews.reviewed_at)` older than `stale_days` (180; 365 / 730 to choose) that have a neighbour - an edge either way, the parent or a child - edited in the last `recent_days` (90) and after the page |
| Broken links | `extract.internal_links` over the space's pages, resolved with the Trash included: `missing` (no such space or slug), `trashed`, `archived_space` |
| Orphans | Pages with no incoming `link` / `mention` edge from a live page; top-level and empty pages left out |
| Duplicates | Same `copy_key` title, and - with semantic search - page mean vectors at least `DUPLICATE_THRESHOLD` (0.92) alike, empty pages left out. The builder drops these pairs from `similar` edges on purpose, so they are computed here |

**Still correct** writes `page_reviews`; **Check with AI**
(`POST /spaces/{key}/pages/{slug}/stale-check`, `AIService.check_stale`) sends the page and
up to three newer neighbours (plain text, secrets scrubbed) and asks what in the page they
contradict or replace. It is rate-limited like every AI call and cached by content. Every
page listed or sent is checked against the reader's permissions.

| Endpoint | |
| --- | --- |
| `GET /api/v1/spaces/{key}/health?stale_days=&recent_days=` | the report (space admin) |
| `POST /api/v1/spaces/{key}/pages/{slug}/review` | mark still correct |
| `POST /api/v1/spaces/{key}/pages/{slug}/stale-check` | AI comparison |

**Unanswered questions** (`modules/ai/question_gaps.py`, `ai_question_gaps`,
`components/admin/ai-questions-panel.tsx`): the chat (`ChatTurn._done`) and the search box
(`AnswerService._noted`) note a question when `gap_reason` says the wiki did not answer it -
not found, or answered from the web or the model's knowledge without a wiki page - and
`POST /ai/feedback` notes an answer marked *Not helpful*. App questions, questions put back to
the person, plans, one-file chats and questions sent to the web from the start are not noted.
Questions fold (case, accents, punctuation) to a `group_key`; an entry lists count, askers,
wordings, reasons and the pages that came close. Resolving one as answered with a page
notifies each asker who may read it (`question_answered`). The note is written on its own
session with a 3 s lock timeout and never fails a reply. Rows keep who asked and are purged
after 90 days (`purge_unanswered_questions`, daily); `site_settings.record_unanswered_questions`
turns recording off. Admin endpoints under `/api/v1/ai/questions` are system-admin only.

## 6. Knobs

| Setting | Where | Default |
| --- | --- | --- |
| Related pages added to answers | Admin > AI assistant > Semantic search (`graph_related_pages`) | 2 |
| Similar-page threshold | same (`graph_min_similarity`) | 0.70 (tuned for bge-m3) |
| Tie weights, min score, limits | constants in `graph/neighbors.py`, `graph/builder.py`, `graph/extract.py`, `search/service.py` | see above |

## 7. Deliberately not done

- No LLM writing entity/concept pages or inserting links into pages (the approach of
  tools like llm_wiki): the wiki is written by people, and a self-hosted model would
  be slow and could be wrong.
- No separate graph database: one-step neighbour queries in Postgres take
  milliseconds; recursive CTEs are the next step if multi-hop queries are ever
  needed.

## Tests

- `backend/tests/unit/test_graph_extract.py`, `test_graph_insights.py`
- `backend/tests/integration/test_page_graph.py` (builder, neighbours, answers,
  permissions, cross-space maps)
- `backend/tests/api/test_graph.py`
- `backend/tests/unit/test_attachment_text_reading.py`,
  `backend/tests/integration/test_attachment_text.py` (attached files)
- `backend/tests/integration/test_content_health.py`, `test_question_gaps.py`,
  `backend/tests/api/test_content_health_api.py` (health report, AI check, questions)
- `frontend/tests/space-graph.test.tsx`, `related-pages.test.tsx`,
  `page-mentions.test.ts`, `graph-layout.test.ts`, `space-health.test.tsx`,
  `ai-questions-panel.test.tsx`
