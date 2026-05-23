#!/bin/bash

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEBUI_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$WEBUI_ROOT/../.." && pwd)"
HOOK_INSTALLER="$WEBUI_ROOT/scripts/install-git-hooks.sh"
PRE_COMMIT_HOOK="$REPO_ROOT/.git/hooks/pre-commit"

# Development script for llampart webui.
#
# This script starts the webui development servers (Storybook and Vite).
# Start llama-server separately if backend API access is needed.
#
# Usage:
#   bash scripts/dev.sh
#   npm run dev

check_and_install_hooks() {
	if [ ! -d "$REPO_ROOT/.git/hooks" ]; then
		echo "ℹ️  Git hooks directory not found, skipping hook setup"
		return 0
	fi

	if [ -x "$PRE_COMMIT_HOOK" ]; then
		echo "✅ Git hook already installed"
		return 0
	fi

	echo "🔧 Git hook missing, installing it..."
	if bash "$HOOK_INSTALLER"; then
		echo "✅ Git hook installed successfully"
	else
		echo "⚠️  Failed to install git hook, continuing anyway..."
	fi
}

cleanup() {
	echo "🧹 Cleaning up..."
	jobs -pr | xargs -r kill
}

trap cleanup SIGINT SIGTERM EXIT

check_and_install_hooks

cd "$WEBUI_ROOT"

echo "🚀 Starting development servers..."
echo "📝 Note: Start llama-server separately if needed"
echo "🌐 Vite:      http://localhost:5173"
echo "📚 Storybook: http://localhost:6006"

storybook dev -p 6006 --ci &
NODE_OPTIONS="--insecure-http-parser" vite dev --host 0.0.0.0 &

wait
