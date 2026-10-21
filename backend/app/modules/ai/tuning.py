"""Tunable knobs of semantic search and the self-hosted Ollama, editable in the admin UI.

Each knob has a built-in default (the environment settings in ``core.config``) and
may be overridden from Administration > AI assistant > Semantic search - so tuning
never needs a shell. An override of ``None`` means "use the default".

``SPECS`` is the single source of truth: it drives the stored columns' validation,
the API's bounds and the form the admin sees.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

from app.core.config import settings

#: ``OLLAMA_KEEP_ALIVE`` values the controller accepts: how long Ollama keeps the
#: model in memory after its last request ("-1" = never unload, "0" = unload at once).
KEEP_ALIVE_CHOICES = ("0", "1m", "5m", "10m", "30m", "1h", "-1")


@dataclass(frozen=True)
class Spec:
    key: str
    label: str
    default: float | int | str
    minimum: float | int | None = None
    maximum: float | int | None = None
    #: ``int``, ``float`` or ``choice``.
    kind: str = "int"
    choices: tuple[str, ...] = ()
    #: Whether it only matters when the source is the self-hosted Ollama.
    ollama_only: bool = False
    #: Changing it needs Ollama restarted to take effect.
    restart: bool = False


def specs() -> tuple[Spec, ...]:
    """The knobs, with defaults taken from the environment at the time of the call."""
    return (
        Spec("index_batch", "Pages per minute", settings.search_index_batch, 1, 500),
        Spec("embed_batch_size", "Passages per request", 16, 1, 128),
        Spec(
            "max_chunks_per_page",
            "Passages per page",
            settings.search_max_chunks_per_page,
            1,
            400,
        ),
        Spec(
            "embed_timeout_seconds",
            "Embedding timeout (seconds)",
            settings.ai_embedding_timeout_seconds,
            5,
            1800,
            kind="float",
        ),
        Spec(
            "query_timeout_seconds",
            "Search embedding timeout (seconds)",
            settings.search_embed_timeout_seconds,
            0.5,
            60,
            kind="float",
        ),
        Spec(
            "min_similarity",
            "Minimum similarity",
            settings.search_semantic_min_similarity,
            0.0,
            0.99,
            kind="float",
        ),
        Spec(
            "margin",
            "Margin below the best match",
            settings.search_semantic_margin,
            0.0,
            1.0,
            kind="float",
        ),
        Spec("graph_related_pages", "Related pages added to answers", 2, 0, 5),
        Spec(
            "graph_min_similarity",
            "Similar-page threshold",
            0.70,
            0.0,
            0.99,
            kind="float",
        ),
        Spec(
            "ollama_memory_gb",
            "Ollama memory limit (GB)",
            settings.ollama_memory_gb,
            1,
            256,
            kind="float",
            ollama_only=True,
            restart=True,
        ),
        Spec(
            "ollama_cpus",
            "Ollama CPU cores",
            settings.ollama_cpus,
            0,
            256,
            ollama_only=True,
            restart=True,
        ),
        Spec(
            "ollama_keep_alive",
            "Keep the model loaded for",
            settings.ollama_keep_alive,
            kind="choice",
            choices=KEEP_ALIVE_CHOICES,
            ollama_only=True,
            restart=True,
        ),
    )


SPEC_BY_KEY = {spec.key: spec for spec in specs()}


@dataclass(frozen=True)
class Tuning:
    """The effective value of every knob: an override if one is saved, else the default."""

    index_batch: int = 20
    embed_batch_size: int = 16
    max_chunks_per_page: int = 60
    embed_timeout_seconds: float = 180.0
    query_timeout_seconds: float = 4.0
    min_similarity: float = 0.30
    margin: float = 0.10
    #: Pages next to the found ones, in the knowledge graph, added to an answer's
    #: sources. 0 leaves answers to search alone.
    graph_related_pages: int = 2
    #: How alike two pages' embeddings must be for a ``similar`` edge between them.
    graph_min_similarity: float = 0.70
    ollama_memory_gb: float = 3.0
    #: 0 means "no limit": Ollama may use every core.
    ollama_cpus: int = 0
    ollama_keep_alive: str = "5m"


def defaults() -> Tuning:
    return Tuning(**{spec.key: spec.default for spec in specs()})


def resolve(overrides: dict[str, object]) -> Tuning:
    """Defaults with the saved overrides on top (``None`` or missing keeps the default)."""
    base = defaults()
    values = {f.name: getattr(base, f.name) for f in fields(Tuning)}
    for key, value in overrides.items():
        spec = SPEC_BY_KEY.get(key)
        if spec is None or value is None:
            continue
        values[key] = _coerce(spec, value, fallback=values[key])
    return Tuning(**values)


def _coerce(spec: Spec, value: object, *, fallback: object) -> object:
    """A stored value, clamped to the allowed range (a bad row never breaks search)."""
    try:
        if spec.kind == "choice":
            return str(value) if str(value) in spec.choices else fallback
        number = float(value)  # type: ignore[arg-type]
        if spec.minimum is not None:
            number = max(number, float(spec.minimum))
        if spec.maximum is not None:
            number = min(number, float(spec.maximum))
        return int(number) if spec.kind == "int" else number
    except (TypeError, ValueError):
        return fallback
