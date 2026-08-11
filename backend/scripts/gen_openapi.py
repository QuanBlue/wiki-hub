"""Dump the OpenAPI schema to a file.

Usage::

    python -m scripts.gen_openapi ../docs/openapi.json

Keeping a committed copy lets API changes show up in code review and lets
clients be generated in CI without booting the application.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    from app.main import create_app

    target = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    schema = create_app().openapi()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {target} ({len(schema.get('paths', {}))} paths)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
