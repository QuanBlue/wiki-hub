#!/bin/sh
# =============================================================================
# WikiHub frontend start-up: fill in build-time placeholders, then run the CMD.
#
# Next.js inlines NEXT_PUBLIC_* values into the compiled JavaScript, so an
# image built once in CI cannot know the address of the ONLYOFFICE Document
# Server on whichever server it is later deployed to. CI therefore builds with
# a placeholder in that spot and this script replaces it with the container's
# own environment variable before the server starts.
#
# An image built without the placeholder (a plain `docker compose build`) has
# nothing to replace, so this script does nothing for it.
# =============================================================================
set -eu

name=NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL
placeholder="__WIKIHUB_RUNTIME_${name}__"

if grep -rqF "$placeholder" .next server.js 2>/dev/null; then
  value="${NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL:-}"

  # The value is spliced into JavaScript string literals and a sed expression,
  # so anything that could end either early is refused rather than escaped.
  case "$value" in
    *[!A-Za-z0-9._~:/?#@%+=,\;-]*)
      echo "wikihub-entrypoint: $name may only contain URL characters (letters, digits and . _ ~ : / ? # @ % + = , ; -)" >&2
      exit 1
      ;;
  esac

  # Empty is legitimate: the UI reports the document editor as not configured.
  grep -rlZF "$placeholder" .next server.js | xargs -0 sed -i "s|$placeholder|$value|g"
fi

exec "$@"
