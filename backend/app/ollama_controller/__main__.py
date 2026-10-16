"""``python -m app.ollama_controller`` - serve the controller on the compose network."""

from __future__ import annotations

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.ollama_controller.app:app", host="0.0.0.0", port=8765, log_config=None)  # noqa: S104
