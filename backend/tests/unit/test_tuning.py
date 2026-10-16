"""The knobs an administrator can turn: defaults, overrides, and what a bad value does."""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.core.exceptions import BadRequestError
from app.modules.ai import tuning
from app.modules.ai.embedding_settings import validate_tuning


def test_without_overrides_every_knob_is_its_default() -> None:
    effective = tuning.resolve({})

    assert effective == tuning.defaults()
    assert effective.index_batch == settings.search_index_batch
    assert effective.min_similarity == settings.search_semantic_min_similarity
    assert effective.ollama_keep_alive == settings.ollama_keep_alive


def test_an_override_wins_and_none_means_the_default() -> None:
    effective = tuning.resolve({"index_batch": 5, "margin": None, "ollama_keep_alive": "1h"})

    assert effective.index_batch == 5
    assert effective.margin == settings.search_semantic_margin
    assert effective.ollama_keep_alive == "1h"


def test_a_corrupt_stored_value_is_clamped_or_ignored_never_fatal() -> None:
    effective = tuning.resolve(
        {
            "index_batch": 10**9,  # above the maximum
            "min_similarity": -3,  # below the minimum
            "embed_batch_size": "twelve",  # not a number
            "ollama_keep_alive": "forever",  # not a choice
            "no_such_knob": 1,
        }
    )

    assert effective.index_batch == tuning.SPEC_BY_KEY["index_batch"].maximum
    assert effective.min_similarity == tuning.SPEC_BY_KEY["min_similarity"].minimum
    assert effective.embed_batch_size == 16  # the default
    assert effective.ollama_keep_alive == settings.ollama_keep_alive


def test_every_knob_has_a_spec_with_a_sane_default_inside_its_own_range() -> None:
    for spec in tuning.specs():
        assert spec.label
        if spec.kind == "choice":
            assert spec.default in spec.choices
        elif spec.key == "ollama_cpus":
            assert spec.default == 0  # "no limit" is below the usual minimum on purpose
        else:
            assert spec.minimum <= spec.default <= spec.maximum, spec.key
    # Only the Ollama knobs need a restart.
    assert {s.key for s in tuning.specs() if s.restart} == {
        "ollama_memory_gb",
        "ollama_cpus",
        "ollama_keep_alive",
    }
    assert {s.key for s in tuning.specs() if s.ollama_only} == {
        "ollama_memory_gb",
        "ollama_cpus",
        "ollama_keep_alive",
    }


def test_validation_accepts_in_range_values_and_resets_with_none() -> None:
    clean = validate_tuning(
        {"index_batch": 7.0, "margin": 0.2, "ollama_keep_alive": "30m", "min_similarity": None}
    )

    assert clean == {
        "index_batch": 7,
        "margin": 0.2,
        "ollama_keep_alive": "30m",
        "min_similarity": None,
    }
    assert isinstance(clean["index_batch"], int)
    assert validate_tuning({"index_batch": ""}) == {"index_batch": None}


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"no_such_knob": 1}, "is not a setting"),
        ({"index_batch": 0}, "between 1 and 500"),
        ({"index_batch": 100000}, "between 1 and 500"),
        ({"margin": 2}, "between 0.0 and 1.0"),
        ({"embed_batch_size": "many"}, "must be a number"),
        ({"ollama_keep_alive": "forever"}, "pick one of"),
    ],
)
def test_validation_refuses_what_the_form_should_not_have_sent(
    values: dict[str, object], message: str
) -> None:
    with pytest.raises(BadRequestError, match=message):
        validate_tuning(values)
