"""Database objects behind hybrid and semantic page search.

Shared by the Alembic migration and the integration-test fixtures, so both build
exactly the same functions. They live in SQL (not Python) because an expression
index is only used when the query repeats the *same* expression, and that
expression has to be built from IMMUTABLE functions.
"""

from __future__ import annotations

#: ``tsvector`` is capped at 1MB; a page past the cap would make *saving it*
#: fail. Indexing the first part of the text keeps every page writable.
MAX_INDEXED_CHARS = 200_000

#: Added to the search vector of every page that contains an IPv4 address. A question
#: about "ip" is really "which page lists addresses": the numbers themselves are broken
#: into digits by the text parser, so nothing else could answer it.
IP_MARKER = "ipaddr"
#: Four dot-separated groups of 1-3 digits, not part of a longer number or version.
IPV4_REGEX = r"(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}([^0-9.]|$)"


def functions_sql(unaccent_schema: str = "public") -> list[str]:
    """``CREATE OR REPLACE`` statements for the helper functions.

    ``wh_unaccent`` also turns ``_ . - / : @`` into spaces: the default text
    parser would otherwise keep ``tessel_v2`` or ``monitoring.tessel.vn`` as one
    word, and searching "tessel" would never find them.

    ``unaccent_schema`` is where the ``unaccent`` extension was installed; it is
    written into the function, so it does not depend on the caller's ``search_path``.

    The bodies use the SQL-standard ``BEGIN ATOMIC`` form on purpose. A body in
    a quoted string records no dependency on what it calls, so ``pg_dump`` may
    write ``wh_search_vector`` *after* the ``pages`` table whose generated column
    needs it - and then ``pg_restore`` cannot create ``pages`` at all. An
    ``ATOMIC`` body records the dependencies, so a dump restores in a working order.
    """
    return [
        f"""
        CREATE OR REPLACE FUNCTION wh_unaccent(value text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        BEGIN ATOMIC
            SELECT translate(
                {unaccent_schema}.unaccent('{unaccent_schema}.unaccent'::regdictionary, value),
                '_.-/:@', '      ');
        END
        """,
        f"""
        CREATE OR REPLACE FUNCTION wh_plain_text(markup text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        BEGIN ATOMIC
            SELECT left(regexp_replace(markup, '<[^>]+>', ' ', 'g'), {MAX_INDEXED_CHARS});
        END
        """,
        f"""
        CREATE OR REPLACE FUNCTION wh_search_vector(title text, markup text) RETURNS tsvector
        LANGUAGE sql IMMUTABLE PARALLEL SAFE
        BEGIN ATOMIC
            SELECT setweight(to_tsvector('simple', wh_unaccent(coalesce(title, ''))), 'A')
                || setweight(to_tsvector('simple', wh_unaccent(p.body)), 'B')
                || CASE WHEN p.body ~ '{IPV4_REGEX}'
                    THEN setweight(to_tsvector('simple', '{IP_MARKER}'), 'B')
                    ELSE ''::tsvector END
            FROM (SELECT wh_plain_text(coalesce(markup, '')) AS body) AS p;
        END
        """,  # noqa: S608 - module constants, never user input
        """
        CREATE OR REPLACE FUNCTION wh_title_key(title text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        BEGIN ATOMIC
            SELECT wh_unaccent(lower(title));
        END
        """,
    ]


INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS ix_pages_search_vector "
    "ON pages USING gin (wh_search_vector(title, content))",
    "CREATE INDEX IF NOT EXISTS ix_pages_title_trgm "
    "ON pages USING gin (wh_title_key(title) gin_trgm_ops)",
)

#: A passage read from an attached file is stored with the page it is attached to, and
#: says which file it came from, so an answer can cite the file itself.
ATTACHMENT_CHUNK_STATEMENTS = (
    "ALTER TABLE page_chunks ADD COLUMN IF NOT EXISTS attachment_id uuid "
    "REFERENCES page_attachments(id) ON DELETE CASCADE",
    "CREATE INDEX IF NOT EXISTS ix_page_chunks_attachment_id ON page_chunks (attachment_id) "
    "WHERE attachment_id IS NOT NULL",
)

SEMANTIC_TABLE_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS page_search_state (
        page_id uuid PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        source_updated_at timestamptz NOT NULL,
        model varchar(255) NOT NULL,
        chunk_count integer NOT NULL DEFAULT 0,
        indexed_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    # ``embedding`` has no fixed dimension: it depends on the model the admin
    # picks. The approximate-nearest-neighbour index is created per dimension
    # by the indexer once that is known.
    """
    CREATE TABLE IF NOT EXISTS page_chunks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        chunk_idx integer NOT NULL,
        body text NOT NULL,
        embedding vector NOT NULL,
        CONSTRAINT uq_page_chunks_page_idx UNIQUE (page_id, chunk_idx)
    )
    """,
    *ATTACHMENT_CHUNK_STATEMENTS,
)

#: The page's search vector kept as a column, so a query ranks pages by reading
#: it instead of re-parsing every matching page's full text. (Not an ORM column:
#: the database computes it, and it exists only where the search functions do.)
STORED_VECTOR_STATEMENTS = (
    "ALTER TABLE pages ADD COLUMN IF NOT EXISTS search_vector tsvector "
    "GENERATED ALWAYS AS (wh_search_vector(title, content)) STORED",
    "CREATE INDEX IF NOT EXISTS ix_pages_search_vector_col ON pages USING gin (search_vector)",
    "DROP INDEX IF EXISTS ix_pages_search_vector",
)

#: The words read from attached files, searchable like a page's (``attachment_texts``,
#: see ``app.models.attachment_text``). The file name plays the part of the title.
ATTACHMENT_VECTOR_STATEMENTS = (
    "ALTER TABLE attachment_texts ADD COLUMN IF NOT EXISTS search_vector tsvector "
    "GENERATED ALWAYS AS (wh_search_vector(filename, content)) STORED",
    "CREATE INDEX IF NOT EXISTS ix_attachment_texts_search_vector "
    "ON attachment_texts USING gin (search_vector)",
)
