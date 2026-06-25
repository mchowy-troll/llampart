#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="package-release-llampart.sh"
SCRIPT_VERSION="0.1.5"
PROJECT_NAME="llampart"
ARTIFACT_PREFIX="llampart-webui"
DEFAULT_PUBLIC_RELATIVE="server/public"
DEFAULT_RELEASE_ASSETS_RELATIVE="llampart/release-assets"

NO_COLOR=0
DRY_RUN=0
FORCE=0
YES=0
VERSION_OVERRIDE=""
OUTPUT_DIR=""
REPO_DIR=""
PUBLIC_DIR=""
KEEP_STAGE=0
SKIP_LOCK_VERSION_CHECK=0
STAGE_PARENT=""

BOLD=""
DIM=""
RED=""
GREEN=""
YELLOW=""
BLUE=""
RESET=""

usage() {
  cat <<USAGE
llampart release packager v${SCRIPT_VERSION}

Packages the already-built static llampart Web UI from server/public into
release assets for the Linux+Caddy installer.

Usage:
  bash ${SCRIPT_NAME} [options]

Options:
  --version vX.Y.Z             Package this version. Must match package.json unless --skip-lock-version-check is used.
  --repo-dir PATH              Repository root. Auto-detected by default.
  --public-dir PATH            Static Web UI directory. Default: <repo>/server/public
  --output-dir PATH            Output directory. Default: \$HOME/llampart/release-assets
  --force                      Overwrite existing tarball/checksum for the same version
  --dry-run                    Show what would be created without writing files
  --yes                        Non-interactive mode; do not ask for confirmation
  --keep-stage                 Keep temporary staging directory for inspection
  --skip-lock-version-check    Do not require package-lock.json versions to match package.json
  --no-color                   Disable colorized output
  --help                       Show this help

Output:
  llampart-webui-vX.Y.Z.tar.xz
  llampart-webui-vX.Y.Z.sha256

Notes:
  - This script does not run npm ci, tests, lint, or build.
  - Build and validation must happen before packaging.
  - The packaged tarball root is llampart-webui-vX.Y.Z/.
USAGE
}

log() { printf '%b\n' "$*"; }
info() { log "${BLUE}INFO${RESET} $*"; }
ok() { log "${GREEN}OK${RESET} $*"; }
warn() { log "${YELLOW}WARNING${RESET} $*"; }
fail() { log "${RED}ERROR${RESET} $*" >&2; exit 1; }

setup_colors() {
  if [[ "$NO_COLOR" == "1" || -n "${NO_COLOR:-}" || ! -t 1 ]]; then
    return 0
  fi
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BLUE=$'\033[34m'
  RESET=$'\033[0m'
}

on_error() {
  local line="$1"
  fail "Unexpected error at line ${line}."
}
trap 'on_error $LINENO' ERR

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        [[ $# -ge 2 ]] || fail "Missing value for --version."
        VERSION_OVERRIDE="$2"
        shift 2
        ;;
      --repo-dir)
        [[ $# -ge 2 ]] || fail "Missing value for --repo-dir."
        REPO_DIR="$2"
        shift 2
        ;;
      --public-dir)
        [[ $# -ge 2 ]] || fail "Missing value for --public-dir."
        PUBLIC_DIR="$2"
        shift 2
        ;;
      --output-dir)
        [[ $# -ge 2 ]] || fail "Missing value for --output-dir."
        OUTPUT_DIR="$2"
        shift 2
        ;;
      --force)
        FORCE=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --yes)
        YES=1
        shift
        ;;
      --keep-stage)
        KEEP_STAGE=1
        shift
        ;;
      --skip-lock-version-check)
        SKIP_LOCK_VERSION_CHECK=1
        shift
        ;;
      --no-color)
        NO_COLOR=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

normalize_version() {
  local version="$1"
  version="${version#v}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || fail "Invalid version: $1"
  printf 'v%s' "$version"
}

command_required() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

abs_path() {
  local path="$1"
  if [[ -d "$path" ]]; then
    (cd "$path" && pwd -P)
  else
    local dir base
    dir="$(dirname "$path")"
    base="$(basename "$path")"
    (cd "$dir" && printf '%s/%s\n' "$(pwd -P)" "$base")
  fi
}

script_dir() {
  local source="${BASH_SOURCE[0]}"
  while [[ -L "$source" ]]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" && pwd
}

looks_like_repo_root() {
  local dir="$1"
  [[ -f "$dir/README.md" && -f "$dir/server/webui/package.json" ]]
}

find_repo_root() {
  if [[ -n "$REPO_DIR" ]]; then
    REPO_DIR="$(abs_path "$REPO_DIR")"
    looks_like_repo_root "$REPO_DIR" || fail "Not a llampart repository root: $REPO_DIR"
    return 0
  fi

  local dir
  dir="$(pwd -P)"
  while [[ "$dir" != "/" ]]; do
    if looks_like_repo_root "$dir"; then
      REPO_DIR="$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  dir="$(script_dir)"
  while [[ "$dir" != "/" ]]; do
    if looks_like_repo_root "$dir"; then
      REPO_DIR="$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  fail "Could not auto-detect llampart repository root. Use --repo-dir PATH."
}

choose_default_output_dir() {
  if [[ -n "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$(abs_path "$OUTPUT_DIR")"
    return 0
  fi

  OUTPUT_DIR="$HOME/$DEFAULT_RELEASE_ASSETS_RELATIVE"
}

read_json_field_with_node() {
  local file="$1"
  local expr="$2"
  node -e "const data=require(process.argv[1]); const value=(${expr}); if (value === undefined || value === null) process.exit(2); process.stdout.write(String(value));" "$file"
}

read_package_version() {
  local package_json="$REPO_DIR/server/webui/package.json"
  [[ -f "$package_json" ]] || fail "Missing package.json: $package_json"
  read_json_field_with_node "$package_json" "data.version"
}

validate_versions() {
  local package_version="$1"
  local lock_file="$REPO_DIR/server/webui/package-lock.json"

  if [[ "$SKIP_LOCK_VERSION_CHECK" == "1" ]]; then
    warn "Skipping package-lock version check."
    return 0
  fi

  [[ -f "$lock_file" ]] || fail "Missing package-lock.json: $lock_file"

  local lock_top lock_root
  lock_top="$(read_json_field_with_node "$lock_file" "data.version")"
  lock_root="$(read_json_field_with_node "$lock_file" "data.packages && data.packages[''] && data.packages[''].version")"

  [[ "$lock_top" == "$package_version" ]] || fail "package-lock.json version mismatch: top=${lock_top}, package.json=${package_version}"
  [[ "$lock_root" == "$package_version" ]] || fail "package-lock.json packages[''].version mismatch: root=${lock_root}, package.json=${package_version}"
}

validate_public_dir() {
  if [[ -z "$PUBLIC_DIR" ]]; then
    PUBLIC_DIR="$REPO_DIR/$DEFAULT_PUBLIC_RELATIVE"
  else
    PUBLIC_DIR="$(abs_path "$PUBLIC_DIR")"
  fi

  [[ -d "$PUBLIC_DIR" ]] || fail "Static Web UI directory does not exist: $PUBLIC_DIR"
  [[ -f "$PUBLIC_DIR/index.html" ]] || fail "Missing required static file: $PUBLIC_DIR/index.html"
  [[ -f "$PUBLIC_DIR/200.html" ]] || fail "Missing required static file: $PUBLIC_DIR/200.html"
  [[ -d "$PUBLIC_DIR/_app" ]] || fail "Missing required static assets directory: $PUBLIC_DIR/_app"

  if find "$PUBLIC_DIR" -mindepth 1 -maxdepth 1 -name '.git' -o -name '.github' | grep -q .; then
    fail "Static Web UI directory contains repository metadata. Refusing to package: $PUBLIC_DIR"
  fi
}

validate_tools() {
  command_required node
  command_required tar
  command_required xz
  command_required sha256sum
  command_required mktemp
  command_required find
}

confirm_plan() {
  [[ "$YES" == "1" || "$DRY_RUN" == "1" ]] && return 0

  printf 'Continue? [Y/n] '
  local answer
  read -r answer
  case "$answer" in
    ""|y|Y|yes|YES|Yes) return 0 ;;
    *) fail "Cancelled by user." ;;
  esac
}

create_stage() {
  local package_root="$1"
  local stage_parent
  stage_parent="$(mktemp -d)"
  mkdir -p "$stage_parent/$package_root"

  # Copy the static build without relying on rsync. This preserves regular files,
  # directories, and symlinks from the generated static output.
  tar -C "$PUBLIC_DIR" -cf - . | tar -C "$stage_parent/$package_root" -xf -

  printf '%s\n' "$stage_parent"
}

normalize_permissions() {
  local dir="$1"
  find "$dir" -type d -exec chmod 755 {} \;
  find "$dir" -type f -exec chmod 644 {} \;
}

create_tarball() {
  local stage_parent="$1"
  local package_root="$2"
  local tarball_path="$3"

  # Stable owner/group in the archive avoids leaking local usernames into release assets.
  tar -C "$stage_parent" \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    -cJf "$tarball_path" \
    "$package_root"
}

validate_tarball_shape() {
  local tarball_path="$1"
  local package_root="$2"
  local listing_file

  listing_file="$(mktemp)"
  tar -tf "$tarball_path" > "$listing_file"

  grep -Fx "$package_root/index.html" "$listing_file" >/dev/null || fail "Packaged tarball is missing ${package_root}/index.html"
  grep -Fx "$package_root/200.html" "$listing_file" >/dev/null || fail "Packaged tarball is missing ${package_root}/200.html"
  grep -F "$package_root/_app/" "$listing_file" >/dev/null || fail "Packaged tarball is missing ${package_root}/_app/"

  rm -f "$listing_file"
}

write_checksum() {
  local tarball_path="$1"
  local sha_path="$2"
  (
    cd "$(dirname "$tarball_path")"
    sha256sum "$(basename "$tarball_path")" > "$sha_path"
  )
}

cleanup_partial_outputs() {
  local tarball_path="$1"
  local sha_path="$2"
  rm -f "$tarball_path" "$sha_path"
}

print_plan() {
  local version="$1"
  local package_root="$2"
  local tarball_path="$3"
  local sha_path="$4"

  cat <<PLAN

${BOLD}llampart release assets will be packaged with these settings:${RESET}

Version:
  ${version}

Source:
  Repository:
    ${REPO_DIR}
  Static Web UI:
    ${PUBLIC_DIR}

Output:
  Directory:
    ${OUTPUT_DIR}
  Tarball:
    ${tarball_path}
  Checksum:
    ${sha_path}

Archive root:
  ${package_root}/

Behavior:
  package existing server/public only
  do not run npm install, tests, lint, or build
  do not modify repository source files
PLAN

  if [[ "$DRY_RUN" == "1" ]]; then
    cat <<PLAN

Dry-run: no release files will be written.
PLAN
  fi
}

print_summary() {
  local version="$1"
  local tarball_path="$2"
  local sha_path="$3"
  local sha_value="$4"

  cat <<SUMMARY

────────────────────────────────────────────
✅ llampart release assets created
────────────────────────────────────────────

Version:
  ${version}

Files:
  Tarball:
    ${tarball_path}

  Checksum:
    ${sha_path}

SHA256:
  ${sha_value}

Next step:
  Attach both files to the matching GitHub Release.
────────────────────────────────────────────
SUMMARY
}

main() {
  parse_args "$@"
  setup_colors
  validate_tools
  find_repo_root
  choose_default_output_dir
  validate_public_dir

  local package_version release_version
  package_version="$(read_package_version)"
  validate_versions "$package_version"

  if [[ -n "$VERSION_OVERRIDE" ]]; then
    release_version="$(normalize_version "$VERSION_OVERRIDE")"
    local package_release_version
    package_release_version="$(normalize_version "$package_version")"
    [[ "$release_version" == "$package_release_version" ]] || fail "--version ${release_version} does not match package.json version ${package_release_version}."
  else
    release_version="$(normalize_version "$package_version")"
  fi

  local package_root tarball_name sha_name tarball_path sha_path
  package_root="${ARTIFACT_PREFIX}-${release_version}"
  tarball_name="${package_root}.tar.xz"
  sha_name="${package_root}.sha256"
  tarball_path="$OUTPUT_DIR/$tarball_name"
  sha_path="$OUTPUT_DIR/$sha_name"

  print_plan "$release_version" "$package_root" "$tarball_path" "$sha_path"
  confirm_plan

  if [[ "$DRY_RUN" == "1" ]]; then
    exit 0
  fi

  mkdir -p "$OUTPUT_DIR"

  if [[ "$FORCE" != "1" ]]; then
    [[ ! -e "$tarball_path" ]] || fail "Output tarball already exists. Use --force to overwrite: $tarball_path"
    [[ ! -e "$sha_path" ]] || fail "Output checksum already exists. Use --force to overwrite: $sha_path"
  fi

  STAGE_PARENT="$(create_stage "$package_root")"

  cleanup_stage() {
    [[ -n "$STAGE_PARENT" ]] || return 0
    if [[ "$KEEP_STAGE" == "1" ]]; then
      warn "Keeping staging directory: $STAGE_PARENT"
    else
      rm -rf "$STAGE_PARENT"
    fi
  }
  trap cleanup_stage EXIT

  normalize_permissions "$STAGE_PARENT/$package_root"

  rm -f "$tarball_path" "$sha_path"
  create_tarball "$STAGE_PARENT" "$package_root" "$tarball_path"
  if ! validate_tarball_shape "$tarball_path" "$package_root"; then
    cleanup_partial_outputs "$tarball_path" "$sha_path"
    exit 1
  fi
  write_checksum "$tarball_path" "$sha_path"

  if ! (
    cd "$OUTPUT_DIR"
    sha256sum -c "$sha_name" >/dev/null
  ); then
    cleanup_partial_outputs "$tarball_path" "$sha_path"
    fail "Checksum self-check failed."
  fi

  local sha_value
  sha_value="$(awk '{print $1}' "$sha_path")"

  ok "Created release tarball: $tarball_path"
  ok "Created checksum: $sha_path"
  print_summary "$release_version" "$tarball_path" "$sha_path" "$sha_value"
}

main "$@"
