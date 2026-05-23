#!/bin/bash

set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
WEBUI_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$WEBUI_ROOT/../.." && pwd)"
PRE_COMMIT_HOOK="$REPO_ROOT/.git/hooks/pre-commit"
WEBUI_PATH_FROM_ROOT="server/webui"

if [ ! -d "$REPO_ROOT/.git/hooks" ]; then
	echo "❌ .git/hooks directory not found in $REPO_ROOT"
	exit 1
fi

echo "Installing pre-commit hook for llampart webui..."

cat > "$PRE_COMMIT_HOOK" <<'EOF_HOOK'
#!/bin/bash

set -eu

WEBUI_PATH_FROM_ROOT="server/webui"

if ! git diff --cached --name-only | grep -q "^${WEBUI_PATH_FROM_ROOT}/"; then
	exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
WEBUI_ROOT="$REPO_ROOT/$WEBUI_PATH_FROM_ROOT"

if [ ! -f "$WEBUI_ROOT/package.json" ]; then
	echo "Error: package.json not found in $WEBUI_PATH_FROM_ROOT"
	exit 1
fi

cd "$WEBUI_ROOT"

echo "Formatting, linting, and checking webui code..."
npm run format
npm run lint
npm run check

echo "✅ Webui code formatted and checked successfully"
EOF_HOOK

chmod +x "$PRE_COMMIT_HOOK"

echo "✅ Git hook installed successfully!"
echo "   Pre-commit: $PRE_COMMIT_HOOK"
echo ""
echo "The hook will automatically:"
echo "  • Run format, lint, and check for staged changes under $WEBUI_PATH_FROM_ROOT"
echo "  • Skip untouched commits outside the webui tree"
