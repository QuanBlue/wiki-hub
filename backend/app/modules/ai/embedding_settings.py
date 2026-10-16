"""Administration of where semantic search gets its embeddings.

One wiki-wide setting (see ``models.ai_embedding_settings``). Saving is refused
unless the chosen source really creates embeddings with the chosen model, so
semantic search is never left "on" but silently empty.
"""

from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import BadRequestError
from app.core.logging import get_logger
from app.models.ai_connection import AiConnection
from app.models.ai_embedding_settings import AiEmbeddingSettings
from app.models.user import User
from app.modules.admin_mail.crypto import encrypt_password
from app.modules.ai import ollama
from app.modules.ai.admin import ensure_embeddings, mask_key, probe
from app.modules.ai.config import (
    OLLAMA_PLACEHOLDER_KEY,
    decrypt_embedding_key,
    decrypt_key,
    get_embedding_settings,
    load_config,
    tuning_overrides,
)
from app.modules.ai.embeddings import EmbeddingError, embed
from app.modules.ai.tuning import SPEC_BY_KEY, resolve, specs
from app.schemas.ai import (
    AIModelInfo,
    EmbeddingBenchmark,
    EmbeddingModelsRequest,
    EmbeddingModelsResult,
    EmbeddingSettingsRead,
    EmbeddingSettingsUpdate,
    TuningSpecRead,
)

logger = get_logger(__name__)

BENCHMARK_PASSAGES = 8
#: About what a real passage looks like (a paragraph of IT documentation, ~700 characters).
_SAMPLE_PASSAGE = (
    "Hướng dẫn cấu hình hệ thống giám sát tập trung cho cụm máy chủ Kubernetes (mẫu {n}). "
    "Cài đặt Prometheus và Grafana, khai báo các exporter cho node, MariaDB và Redis, "
    "rồi cấu hình quy tắc cảnh báo gửi qua email khi CPU vượt 80% hoặc ổ đĩa còn dưới 10%. "
    "Sau khi triển khai, kiểm tra dashboard, xác nhận dữ liệu đã về đủ và đặt thời gian "
    "lưu trữ phù hợp để không làm đầy ổ đĩa của máy chủ giám sát. Khi có sự cố, tra cứu "
    "log theo mã cảnh báo và làm theo quy trình xử lý đã thống nhất trong tài liệu vận hành."
)


def _read(row: AiEmbeddingSettings | None) -> EmbeddingSettingsRead:
    overrides = tuning_overrides(row)
    effective = resolve(overrides)
    common = {
        "tuning": overrides,
        "effective": {key: getattr(effective, key) for key in SPEC_BY_KEY},
        "specs": [
            TuningSpecRead(
                key=spec.key,
                label=spec.label,
                default=spec.default,
                minimum=spec.minimum,
                maximum=spec.maximum,
                kind=spec.kind,
                choices=list(spec.choices),
                ollama_only=spec.ollama_only,
                restart=spec.restart,
            )
            for spec in specs()
        ],
    }
    if row is None:
        return EmbeddingSettingsRead(
            source="provider", base_url="", api_key_preview="", has_key=False, model="", **common
        )
    return EmbeddingSettingsRead(
        source=row.source,  # type: ignore[arg-type]
        base_url=row.base_url,
        api_key_preview=row.api_key_preview,
        has_key=bool(row.api_key_encrypted),
        model=row.model,
        **common,
    )


def validate_tuning(values: dict[str, object]) -> dict[str, object]:
    """Reject an unknown knob or an out-of-range value, saying what is allowed."""
    clean: dict[str, object] = {}
    for key, value in values.items():
        spec = SPEC_BY_KEY.get(key)
        if spec is None:
            raise BadRequestError(f"“{key}” is not a setting.")
        if value is None or value == "":
            clean[key] = None
            continue
        if spec.kind == "choice":
            if str(value) not in spec.choices:
                raise BadRequestError(f"{spec.label}: pick one of {', '.join(spec.choices)}.")
            clean[key] = str(value)
            continue
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise BadRequestError(f"{spec.label} must be a number.") from exc
        low, high = spec.minimum, spec.maximum
        if (low is not None and number < low) or (high is not None and number > high):
            raise BadRequestError(f"{spec.label} must be between {low} and {high}.")
        clean[key] = int(number) if spec.kind == "int" else number
    return clean


def ollama_openai_url() -> str:
    return settings.ollama_url.rstrip("/") + "/v1"


class EmbeddingSettingsService:
    def __init__(self, session: AsyncSession, actor: User) -> None:
        self.session = session
        self.actor = actor

    async def _active(self) -> AiConnection | None:
        return (
            await self.session.execute(select(AiConnection).where(AiConnection.is_active.is_(True)))
        ).scalar_one_or_none()

    async def read(self) -> EmbeddingSettingsRead:
        return _read(await get_embedding_settings(self.session))

    async def _endpoint(
        self, source: str, base_url: str, api_key: str | None, row: AiEmbeddingSettings | None
    ) -> tuple[str, str]:
        """The address and key to call for ``source``, or a clear reason there is none."""
        if source == "ollama":
            return ollama_openai_url(), OLLAMA_PLACEHOLDER_KEY
        if source == "provider":
            active = await self._active()
            if active is None:
                raise BadRequestError("Switch on an AI provider first, or choose another source.")
            return active.base_url.strip(), decrypt_key(active)
        url = base_url.strip() or (row.base_url if row else "")
        key = api_key if api_key else (decrypt_embedding_key(row) if row else "")
        if not url:
            raise BadRequestError("Enter the endpoint address.")
        if not key:
            raise BadRequestError("Enter the API key for this endpoint.")
        return url, key

    async def update(self, payload: EmbeddingSettingsUpdate) -> EmbeddingSettingsRead:
        row = await get_embedding_settings(self.session)
        if payload.model:
            url, key = await self._endpoint(payload.source, payload.base_url, payload.api_key, row)
            if payload.source == "ollama":
                try:
                    present = await ollama.installed_models()
                except ollama.OllamaError as exc:
                    raise BadRequestError(
                        "Ollama is not running. Enable it first, then pick its model."
                    ) from exc
                # Ollama lists a model pulled without a tag as ``name:latest``.
                wanted = payload.model.removesuffix(":latest")
                if wanted not in {name.removesuffix(":latest") for name in present}:
                    raise BadRequestError(
                        f"Ollama has not downloaded “{payload.model}” yet. Download it first."
                    )
            await ensure_embeddings(url, key, payload.model)
        if row is None:
            row = AiEmbeddingSettings(id=1)
            self.session.add(row)
        row.source = payload.source
        row.model = payload.model
        if payload.source == "custom":
            if payload.base_url.strip():
                row.base_url = payload.base_url.strip()
            if payload.api_key:
                row.api_key_encrypted = encrypt_password(payload.api_key)
                row.api_key_preview = mask_key(payload.api_key)
        if payload.tuning is not None:
            for key, value in validate_tuning(payload.tuning).items():
                setattr(row, key, value)
        row.updated_by_id = self.actor.id
        await self.session.commit()
        await self.session.refresh(row)
        logger.info(
            "ai_embedding_settings_saved",
            source=row.source,
            model=row.model or None,
            tuning_changed=sorted(payload.tuning) if payload.tuning else None,
        )
        return _read(row)

    async def benchmark(self) -> EmbeddingBenchmark:
        """Time a few realistic passages with the saved source, model and tuning.

        The numbers are what an administrator needs to tune batch size, timeout and
        pages per minute - without reading logs.
        """
        config = await load_config(self.session)
        if not config.embeddings_ready:
            return EmbeddingBenchmark(ok=False, error="Choose and save an embedding model first.")
        passages = [_SAMPLE_PASSAGE.format(n=n) for n in range(BENCHMARK_PASSAGES)]
        started = time.perf_counter()
        try:
            await embed(config, passages)
        except EmbeddingError as exc:
            return EmbeddingBenchmark(ok=False, error=f"{exc} {exc.detail}".strip())
        seconds = time.perf_counter() - started
        per_passage = seconds / len(passages)
        logger.info(
            "ai_embedding_benchmark",
            passages=len(passages),
            seconds=round(seconds, 2),
            batch_size=config.tuning.embed_batch_size,
            source=config.embedding_source,
        )
        return EmbeddingBenchmark(
            ok=True,
            passages=len(passages),
            characters=sum(len(p) for p in passages),
            seconds=round(seconds, 2),
            seconds_per_passage=round(per_passage, 3),
            batch_size=config.tuning.embed_batch_size,
            # A typical page is a handful of passages; 5 is a fair middle for a wiki.
            estimated_minutes_per_100_pages=round(per_passage * 5 * 100 / 60, 1),
        )

    async def models(self, payload: EmbeddingModelsRequest) -> EmbeddingModelsResult:
        """The embedding-capable models a source offers (chat models are left out)."""
        if payload.source == "ollama":
            try:
                names = await ollama.installed_models()
            except ollama.OllamaError as exc:
                return EmbeddingModelsResult(ok=False, error=str(exc))
            return EmbeddingModelsResult(
                ok=True,
                models=[
                    AIModelInfo(id=n, name=n, embedding=True)
                    for n in names
                    if ollama.is_embedding_name(n)
                ],
            )
        row = await get_embedding_settings(self.session)
        try:
            url, key = await self._endpoint(payload.source, payload.base_url, payload.api_key, row)
        except BadRequestError as exc:
            return EmbeddingModelsResult(ok=False, error=exc.message)
        result = await probe(url, key)
        if not result.ok:
            return EmbeddingModelsResult(ok=False, error=result.error)
        return EmbeddingModelsResult(ok=True, models=[m for m in result.models if m.embedding])
