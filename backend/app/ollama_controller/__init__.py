"""A tiny sidecar that starts and stops WikiHub's own Ollama container.

It is the only service that mounts the Docker socket. See ``docker_api`` for why
that is safe enough: every Docker parameter is fixed in code.
"""
