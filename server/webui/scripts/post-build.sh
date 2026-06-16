#!/usr/bin/env bash
set -euo pipefail

# Build artifact normalization is owned by the dedicated post-build normalizer.
# Vite/SvelteKit own compilation; this step owns the static files served by llampart.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/normalize-static-build.mjs"
