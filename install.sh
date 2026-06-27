#!/usr/bin/env bash
# llampart Linux+Caddy installer/updater/configurator/uninstaller
# Target: Linux systems with systemd and an existing Caddy installation.
# Managed by llampart project.

set -Eeuo pipefail
IFS=$'\n\t'

INSTALLER_VERSION="0.2.0"
APP_NAME="llampart"
REPO_OWNER="mchowy-troll"
REPO_NAME="llampart"
GITHUB_REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}"
GITHUB_RAW_INSTALL_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/install.sh"

INSTALL_ROOT="/opt/llampart"
RELEASE_ROOT="${INSTALL_ROOT}/releases"
TMP_ROOT="${INSTALL_ROOT}/tmp"
WEB_ROOT="/srv/llampart"
CURRENT_SYMLINK="${WEB_ROOT}/current"
MANIFEST_DIR="/var/lib/llampart"
MANIFEST_PATH="${MANIFEST_DIR}/install-manifest.json"

CADDY_DIR="/etc/caddy"
CADDYFILE="${CADDY_DIR}/Caddyfile"
CADDY_CONF_DIR="${CADDY_DIR}/conf.d"
LLAMPART_CADDY_CONFIG="${CADDY_CONF_DIR}/llampart.caddy"
CADDY_IMPORT_LINE="import /etc/caddy/conf.d/*.caddy"

DEFAULT_LLAMPART_PORT="8100"
DEFAULT_BACKEND_HOST="127.0.0.1"
DEFAULT_BACKEND_PORT="8080"

MODE=""
LLAMPART_PORT=""
BACKEND_HOST=""
BACKEND_PORT=""
LLAMPART_PORT_FROM_ARG=0
BACKEND_HOST_FROM_ARG=0
BACKEND_PORT_FROM_ARG=0

WORK_DIR=""
LOG_FILE=""
COLOR_ENABLED=0
TIMESTAMP=""
VERSION=""
ARTIFACT_URL=""
CHECKSUM_URL=""
ARTIFACT_SHA256=""
PREVIOUS_TARGET=""
DEPLOYED_RELEASE_DIR=""
CADDYFILE_BACKUP=""
LLAMPART_CONFIG_BACKUP=""
CADDYFILE_CREATED=0
LLAMPART_CONFIG_CREATED=0
BACKEND_RESPONDED=0
UI_SMOKE_OK=0

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

on_error() {
  local exit_code=$?
  local line="${1:-unknown}"
  printf '\nERROR: llampart installer failed at line %s with exit code %s.\n' "$line" "$exit_code" >&2
  if [[ -n "${LOG_FILE}" ]]; then
    printf 'Log file: %s\n' "$LOG_FILE" >&2
  fi
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    rm -rf "${WORK_DIR}" || true
  fi
}
trap cleanup EXIT

init_colors() {
  if [[ "${NO_COLOR:-}" != "" ]]; then
    COLOR_ENABLED=0
  elif [[ -t 1 ]]; then
    COLOR_ENABLED=1
  else
    COLOR_ENABLED=0
  fi
}

color() {
  local code="$1"
  shift
  if [[ "$COLOR_ENABLED" == "1" ]]; then
    printf '\033[%sm%s\033[0m' "$code" "$*"
  else
    printf '%s' "$*"
  fi
}

bold() { color "1" "$*"; }
green() { color "32" "$*"; }
yellow() { color "33" "$*"; }
blue() { color "34" "$*"; }
red() { color "31" "$*"; }
cyan() { color "36" "$*"; }
dim() { color "2" "$*"; }

info() { printf '%s\n' "$(blue "==>") $*"; }
success() { printf '%s\n' "$(green "OK") $*"; }
warn() { printf '%s\n' "$(yellow "WARNING") $*"; }
fatal() { printf '%s\n' "$(red "ERROR") $*" >&2; exit 1; }

usage() {
  cat <<EOF_USAGE
llampart installer v${INSTALLER_VERSION}

Usage:
  bash install.sh [mode] [options]
  curl -fsSL ${GITHUB_RAW_INSTALL_URL} | bash -s -- [mode] [options]

Modes:
  --install                  Install llampart
  --update                   Update llampart to the latest release
  --configure                Configure ports and backend proxy
  --uninstall                Remove llampart files and llampart-owned Caddy site
  --help                     Show this help

Options:
  --port PORT                Public llampart/Caddy port (default: ${DEFAULT_LLAMPART_PORT})
  --backend-port PORT        Backend proxy port (default: ${DEFAULT_BACKEND_PORT})
  --backend-host HOST        Backend proxy host (default: ${DEFAULT_BACKEND_HOST})

Requirements:
  Caddy must already be installed.
  Caddy must be available as a systemd service.

The installer will not install Caddy, llama-server, Ollama, LM Studio,
models, Node.js, or unrelated development tooling.
EOF_USAGE
}

require_option_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    fatal "Missing value for ${option}."
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install|--update|--configure|--uninstall)
        MODE="${1#--}"
        shift
        ;;
      --port)
        require_option_value "$1" "${2:-}"
        LLAMPART_PORT="$2"
        LLAMPART_PORT_FROM_ARG=1
        shift 2
        ;;
      --backend-port)
        require_option_value "$1" "${2:-}"
        BACKEND_PORT="$2"
        BACKEND_PORT_FROM_ARG=1
        shift 2
        ;;
      --backend-host)
        require_option_value "$1" "${2:-}"
        BACKEND_HOST="$2"
        BACKEND_HOST_FROM_ARG=1
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
}

read_interactive() {
  local target_var="$1"
  if [[ -r /dev/tty ]]; then
    IFS= read -r "$target_var" </dev/tty || fatal "Interactive input is unavailable. Re-run from a terminal."
  else
    IFS= read -r "$target_var" || fatal "Interactive input is unavailable. Re-run from a terminal."
  fi
}

confirm() {
  local prompt="$1"
  local default_yes="${2:-1}"
  local suffix="[Y/n]"
  if [[ "$default_yes" != "1" ]]; then
    suffix="[y/N]"
  fi

  local answer=""
  printf '%s %s ' "$prompt" "$suffix"
  read_interactive answer

  case "$answer" in
    "") [[ "$default_yes" == "1" ]] ;;
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

init_logging() {
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

  # Keep the live log user-writable. In piped installs (`curl | bash`), the
  # installer initially runs as the normal user; writing through tee directly
  # into /var/log would fail even if the file was created with sudo.
  LOG_FILE="$(mktemp -t "llampart-installer-${TIMESTAMP}.XXXXXXXX.log")"
  chmod 600 "$LOG_FILE" || true
  exec > >(tee -a "$LOG_FILE") 2>&1
}

run_priv() {
  "${SUDO[@]}" "$@"
}

priv_test() {
  "${SUDO[@]}" test "$@"
}

ensure_sudo() {
  if [[ ${#SUDO[@]} -gt 0 ]]; then
    command -v sudo >/dev/null 2>&1 || fatal "sudo is required. Run as root or install sudo."
    sudo -v
  fi
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fatal "Required command not found: $cmd"
}

preflight_basic() {
  [[ "$(uname -s)" == "Linux" ]] || fatal "Linux is required."
  [[ -d /run/systemd/system ]] || fatal "systemd is required."

  require_command systemctl
  if [[ ${#SUDO[@]} -gt 0 ]]; then
    require_command sudo
  fi
  require_command curl
  require_command tar
  require_command xz
  require_command sha256sum
  require_command awk
  require_command sed
  require_command grep
  require_command find
  require_command mktemp
  require_command date
  require_command readlink
  require_command basename
  require_command dirname
  require_command install
  require_command id
}

caddy_installed() {
  command -v caddy >/dev/null 2>&1
}

caddy_service_exists() {
  systemctl cat caddy.service >/dev/null 2>&1
}

caddy_active() {
  systemctl is-active --quiet caddy
}

caddy_enabled() {
  systemctl is-enabled --quiet caddy
}

require_caddy_dependency() {
  if ! caddy_installed; then
    fatal "Caddy must already be installed and available as a systemd service.

Please install Caddy first, then run this installer again.

Caddy installation guide:
  https://caddyserver.com/docs/install

llampart did not make any changes."
  fi

  if ! caddy_service_exists; then
    fatal "Caddy is installed, but caddy.service was not found.

Please install Caddy using your distribution package or the official Caddy instructions,
then run this installer again.

llampart did not make any changes."
  fi

  if ! caddy_active || ! caddy_enabled; then
    echo
    warn "Caddy is installed, but the systemd service is not active and enabled."
    echo
    echo "The installer can enable and start Caddy now:"
    echo "    systemctl enable --now caddy"
    echo
    if ! confirm "Continue?" 1; then
      fatal "Caddy service is required. llampart did not make any changes."
    fi
    ensure_sudo
    run_priv systemctl enable --now caddy
    success "Caddy service is active and enabled."
  fi
}

manifest_get() {
  local key="$1"
  if [[ -r "$MANIFEST_PATH" ]]; then
    sed -nE "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"(.*)\",?[[:space:]]*$/\1/p" "$MANIFEST_PATH" | head -n 1
  fi
}

existing_install_detected() {
  [[ -f "$MANIFEST_PATH" || -e "$CURRENT_SYMLINK" || -L "$CURRENT_SYMLINK" || -f "$LLAMPART_CADDY_CONFIG" ]]
}

display_mode_name() {
  case "$1" in
    install) echo "Install" ;;
    update) echo "Update" ;;
    configure) echo "Configure" ;;
    uninstall) echo "Uninstall" ;;
    *) echo "$1" ;;
  esac
}

print_intro() {
  local default_choice="$1"

  echo
  bold "llampart installer"; echo
  echo
  echo "This script installs or manages llampart on this computer."
  echo
  yellow "IMPORTANT:"; echo
  echo "    This script WILL NOT install Caddy"
  echo "    This script WILL NOT install llama-server, Ollama, LM Studio, or models"
  echo "    This script WILL NOT install Node.js"
  echo "    This script WILL NOT remove Caddy or unrelated Caddy sites"
  echo
  yellow "REQUIREMENT:"; echo
  echo "    Caddy must already be installed and available as a systemd service."
  echo
  blue "OPTIONS:"; echo
  echo
  echo "    [1] Install"
  echo "    [2] Update"
  echo "    [3] Configure ports and backend proxy"
  echo "    [4] Uninstall"
  echo "    [5] Exit"
  echo
  printf 'Enter choice [%s]: ' "$default_choice"
}

determine_mode() {
  case "$MODE" in
    install|update|configure|uninstall) return 0 ;;
    "") ;;
    *) fatal "Invalid mode: $MODE" ;;
  esac

  local default_choice="1"
  if existing_install_detected; then
    default_choice="2"
  fi

  local choice=""
  while true; do
    print_intro "$default_choice"
    read_interactive choice
    choice="${choice:-$default_choice}"

    case "$choice" in
      1) MODE="install"; break ;;
      2) MODE="update"; break ;;
      3) MODE="configure"; break ;;
      4) MODE="uninstall"; break ;;
      5) echo "Cancelled without changes."; exit 0 ;;
      *) echo "Choose 1-5."; echo ;;
    esac
  done
}

is_valid_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  (( port >= 1024 && port <= 65535 )) || return 1
}

is_valid_backend_host() {
  local host="$1"
  [[ -n "$host" ]] || return 1
  [[ "$host" != *"/"* ]] || return 1
  [[ "$host" != *":"* ]] || return 1
  [[ "$host" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
}

prompt_value() {
  local label="$1"
  local default="$2"
  local target_var="$3"
  local value=""

  printf '%s [%s]: ' "$label" "$default"
  read_interactive value
  value="${value:-$default}"
  printf -v "$target_var" '%s' "$value"
}

load_defaults() {
  local current_port=""
  local current_backend_port=""
  local current_backend_host=""

  current_port="$(manifest_get llampart_port || true)"
  current_backend_port="$(manifest_get backend_port || true)"
  if [[ -z "$current_backend_port" ]]; then
    current_backend_port="$(manifest_get llama_server_port || true)"
  fi
  current_backend_host="$(manifest_get backend_host || true)"
  if [[ -z "$current_backend_host" ]]; then
    current_backend_host="$(manifest_get llama_server_host || true)"
  fi

  : "${current_port:=$DEFAULT_LLAMPART_PORT}"
  : "${current_backend_port:=$DEFAULT_BACKEND_PORT}"
  : "${current_backend_host:=$DEFAULT_BACKEND_HOST}"

  : "${LLAMPART_PORT:=$current_port}"
  : "${BACKEND_PORT:=$current_backend_port}"
  : "${BACKEND_HOST:=$current_backend_host}"

  if [[ "$MODE" == "configure" ]]; then
    if [[ "$LLAMPART_PORT_FROM_ARG" == "0" ]]; then
      prompt_value "llampart public port" "$current_port" LLAMPART_PORT
    fi
    if [[ "$BACKEND_HOST_FROM_ARG" == "0" ]]; then
      prompt_value "backend host" "$current_backend_host" BACKEND_HOST
    fi
    if [[ "$BACKEND_PORT_FROM_ARG" == "0" ]]; then
      prompt_value "backend proxy port" "$current_backend_port" BACKEND_PORT
    fi
  fi

  is_valid_port "$LLAMPART_PORT" || fatal "Invalid llampart port: $LLAMPART_PORT. Use a number from 1024 to 65535."
  is_valid_port "$BACKEND_PORT" || fatal "Invalid backend port: $BACKEND_PORT. Use a number from 1024 to 65535."
  is_valid_backend_host "$BACKEND_HOST" || fatal "Invalid backend host: $BACKEND_HOST"
}

print_plan_action() {
  printf '        %s. %s\n' "$1" "$2"
}

print_plan_actions() {
  case "$MODE" in
    install)
      print_plan_action 1 "download the latest llampart Web UI release"
      print_plan_action 2 "verify the release checksum"
      print_plan_action 3 "install llampart under /opt/llampart"
      print_plan_action 4 "point /srv/llampart/current to the active release"
      print_plan_action 5 "write /etc/caddy/conf.d/llampart.caddy"
      print_plan_action 6 "validate and reload Caddy"
      print_plan_action 7 "show local and home network URLs"
      ;;
    update)
      print_plan_action 1 "download the latest llampart Web UI release"
      print_plan_action 2 "verify the release checksum"
      print_plan_action 3 "install the updated release under /opt/llampart"
      print_plan_action 4 "point /srv/llampart/current to the active release"
      print_plan_action 5 "update /etc/caddy/conf.d/llampart.caddy if needed"
      print_plan_action 6 "validate and reload Caddy"
      print_plan_action 7 "show local and home network URLs"
      ;;
    configure)
      print_plan_action 1 "update the llampart public port if needed"
      print_plan_action 2 "update the backend host and backend proxy port if needed"
      print_plan_action 3 "update /etc/caddy/conf.d/llampart.caddy"
      print_plan_action 4 "validate and reload Caddy"
      print_plan_action 5 "update the llampart install manifest"
      print_plan_action 6 "show local and home network URLs"
      ;;
    uninstall)
      print_plan_action 1 "remove /etc/caddy/conf.d/llampart.caddy"
      print_plan_action 2 "validate and reload Caddy if Caddy is available"
      print_plan_action 3 "remove /srv/llampart/current"
      print_plan_action 4 "remove /var/lib/llampart"
      print_plan_action 5 "remove /opt/llampart"
      print_plan_action 6 "leave Caddy and unrelated Caddy sites untouched"
      ;;
  esac
}

print_plan() {
  echo
  bold "llampart installer"; echo
  echo
  blue "PLAN:"; echo
  printf '    %-20s %s\n' "MODE:" "$(display_mode_name "$MODE")"
  echo
  printf '    %-20s %s\n' "llampart URL:" "http://localhost:${LLAMPART_PORT}/#/"
  printf '    %-20s %s\n' "backend proxy:" "http://${BACKEND_HOST}:${BACKEND_PORT}"
  echo
  echo "    The installer WILL:"
  echo
  print_plan_actions
  echo
}

confirm_plan_or_exit() {
  local default_yes="1"
  if [[ "$MODE" == "uninstall" ]]; then
    default_yes="0"
  fi

  if ! confirm "Continue?" "$default_yes"; then
    echo "Cancelled without changes."
    exit 0
  fi
}

port_is_listening() {
  local port="$1"
  if ! command -v ss >/dev/null 2>&1; then
    return 1
  fi

  ss -ltnH 2>/dev/null | awk -v target_port="$port" '
    {
      local_addr = $4
      sub(/^.*:/, "", local_addr)
      if (local_addr == target_port) {
        found = 1
      }
    }
    END { exit found ? 0 : 1 }
  '
}

our_config_uses_port() {
  local port="$1"
  priv_test -f "$LLAMPART_CADDY_CONFIG" || return 1
  "${SUDO[@]}" grep -Eq "^[[:space:]]*:${port}[[:space:]]*\{" "$LLAMPART_CADDY_CONFIG"
}

port_in_other_caddy_configs() {
  local port="$1"
  priv_test -d "$CADDY_DIR" || return 1

  local file=""
  while IFS= read -r -d '' file; do
    [[ "$file" == "$LLAMPART_CADDY_CONFIG" ]] && continue
    [[ "$file" == *.llampart-backup-* ]] && continue
    if "${SUDO[@]}" grep -Eq "(^|[[:space:]])(:${port})([[:space:]]*\{|[[:space:]])" "$file" 2>/dev/null; then
      return 0
    fi
  done < <("${SUDO[@]}" find "$CADDY_DIR" -type f \( -name 'Caddyfile' -o -name '*.caddy' \) -print0 2>/dev/null || true)

  return 1
}

validate_public_port_available() {
  [[ "$MODE" == "install" || "$MODE" == "update" || "$MODE" == "configure" ]] || return 0

  if our_config_uses_port "$LLAMPART_PORT"; then
    return 0
  fi
  if port_in_other_caddy_configs "$LLAMPART_PORT"; then
    fatal "Port ${LLAMPART_PORT} appears in another Caddy configuration. Choose another port."
  fi
  if port_is_listening "$LLAMPART_PORT"; then
    fatal "Port ${LLAMPART_PORT} is already listening. Choose another port."
  fi
}

init_work_dir() {
  if [[ -n "$WORK_DIR" ]]; then
    return 0
  fi
  WORK_DIR="$(mktemp -d -t llampart-installer-XXXXXXXX)"
}

resolve_version() {
  info "Resolving latest llampart release..."
  local latest_url=""
  latest_url="$(curl -fsSIL -o /dev/null -w '%{url_effective}' "${GITHUB_REPO_URL}/releases/latest")"
  local tag="${latest_url##*/}"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fatal "Could not resolve latest release version."
  VERSION="$tag"
}

artifact_names() {
  ARTIFACT_URL="${GITHUB_REPO_URL}/releases/download/${VERSION}/llampart-webui-${VERSION}.tar.xz"
  CHECKSUM_URL="${GITHUB_REPO_URL}/releases/download/${VERSION}/llampart-webui-${VERSION}.sha256"
}

download_artifact() {
  init_work_dir
  artifact_names

  local tarball="${WORK_DIR}/llampart-webui-${VERSION}.tar.xz"
  local checksum="${WORK_DIR}/llampart-webui-${VERSION}.sha256"

  info "Downloading llampart Web UI artifact..."
  curl -fL --retry 3 --retry-delay 2 -o "$tarball" "$ARTIFACT_URL"
  curl -fL --retry 3 --retry-delay 2 -o "$checksum" "$CHECKSUM_URL"

  local expected=""
  local actual=""
  expected="$(awk '{print $1; exit}' "$checksum")"
  actual="$(sha256sum "$tarball" | awk '{print $1}')"

  [[ -n "$expected" ]] || fatal "Checksum file is empty or invalid."
  if [[ "$expected" != "$actual" ]]; then
    fatal "Checksum verification failed for llampart-webui-${VERSION}.tar.xz"
  fi

  ARTIFACT_SHA256="$actual"
  success "Checksum verified."
}

validate_extracted_artifact() {
  local root="$1"
  priv_test -f "${root}/index.html" || fatal "Release artifact is invalid: index.html is missing."
  priv_test -d "${root}/_app" || fatal "Release artifact is invalid: _app/ is missing."
  if ! priv_test -f "${root}/200.html"; then
    warn "200.html was not found in the artifact. Continuing because index.html and _app/ exist."
  fi
}

deploy_release() {
  local tarball="${WORK_DIR}/llampart-webui-${VERSION}.tar.xz"
  local stage="${TMP_ROOT}/extract-${VERSION}-${TIMESTAMP}"
  local tmp_release="${TMP_ROOT}/release-${VERSION}-${TIMESTAMP}"
  local release_dir="${RELEASE_ROOT}/${VERSION}"

  run_priv mkdir -p "$RELEASE_ROOT" "$TMP_ROOT" "$WEB_ROOT"
  run_priv rm -rf "$stage" "$tmp_release"
  run_priv mkdir -p "$stage" "$tmp_release"

  info "Extracting release artifact..."
  run_priv tar -xJf "$tarball" -C "$stage"

  local content_root="$stage"
  local entry_count=0
  local first_entry=""

  while IFS= read -r -d '' entry; do
    entry_count=$((entry_count + 1))
    first_entry="$entry"
  done < <("${SUDO[@]}" find "$stage" -mindepth 1 -maxdepth 1 -print0)

  if [[ "$entry_count" -eq 1 ]] && priv_test -d "$first_entry" && priv_test -f "${first_entry}/index.html"; then
    content_root="$first_entry"
  fi

  validate_extracted_artifact "$content_root"
  run_priv cp -a "${content_root}/." "$tmp_release/"
  run_priv chown -R root:root "$tmp_release"
  run_priv find "$tmp_release" -type d -exec chmod 755 {} \;
  run_priv find "$tmp_release" -type f -exec chmod 644 {} \;

  if priv_test -e "$release_dir"; then
    local backup="${release_dir}.llampart-backup-${TIMESTAMP}"
    run_priv mv "$release_dir" "$backup"
    run_priv mv "$tmp_release" "$release_dir"
    success "Replaced existing release directory. Backup: ${backup}"
  else
    run_priv mv "$tmp_release" "$release_dir"
    success "Installed release files into ${release_dir}"
  fi

  run_priv rm -rf "$stage"
  DEPLOYED_RELEASE_DIR="$release_dir"
}

prepare_current_symlink() {
  run_priv mkdir -p "$WEB_ROOT"
  if priv_test -e "$CURRENT_SYMLINK" && ! priv_test -L "$CURRENT_SYMLINK"; then
    local backup="${CURRENT_SYMLINK}.llampart-backup-${TIMESTAMP}"
    warn "${CURRENT_SYMLINK} exists but is not a symlink. It will be moved to ${backup}."
    if ! confirm "Continue?" 1; then
      fatal "Cannot continue while ${CURRENT_SYMLINK} exists as a non-symlink."
    fi
    run_priv mv "$CURRENT_SYMLINK" "$backup"
  fi
}

switch_current_symlink() {
  prepare_current_symlink
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_SYMLINK" 2>/dev/null || true)"
  run_priv ln -sfn "$DEPLOYED_RELEASE_DIR" "$CURRENT_SYMLINK"
  success "Active Web UI symlink now points to ${DEPLOYED_RELEASE_DIR}"
}

rollback_symlink() {
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    warn "Rolling back active symlink to ${PREVIOUS_TARGET}"
    run_priv ln -sfn "$PREVIOUS_TARGET" "$CURRENT_SYMLINK"
    enable_reload_caddy || true
  fi
}

backup_file_if_exists() {
  local path="$1"
  local backup_var="$2"
  local backup=""

  if priv_test -e "$path"; then
    backup="${path}.llampart-backup-${TIMESTAMP}"
    run_priv cp -a "$path" "$backup"
    printf -v "$backup_var" '%s' "$backup"
    success "Backed up ${path} -> ${backup}"
  fi
}

caddyfile_has_import() {
  priv_test -f "$CADDYFILE" || return 1
  "${SUDO[@]}" grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/conf\.d/\*\.caddy([[:space:]]|$)' "$CADDYFILE"
}

ensure_caddy_import() {
  run_priv mkdir -p "$CADDY_DIR" "$CADDY_CONF_DIR"
  backup_file_if_exists "$CADDYFILE" CADDYFILE_BACKUP

  if ! priv_test -f "$CADDYFILE"; then
    CADDYFILE_CREATED=1
    local tmp="${WORK_DIR}/Caddyfile"
    cat > "$tmp" <<EOF_CADDYFILE
# Caddyfile
# llampart installer created this file because it did not exist.
${CADDY_IMPORT_LINE}
EOF_CADDYFILE
    run_priv install -m 644 "$tmp" "$CADDYFILE"
    success "Created ${CADDYFILE} with conf.d import."
    return 0
  fi

  if caddyfile_has_import; then
    success "Caddyfile already imports /etc/caddy/conf.d/*.caddy"
    return 0
  fi

  local tmp_append="${WORK_DIR}/Caddyfile.import"
  printf '\n# llampart installer: import dedicated site configs\n%s\n' "$CADDY_IMPORT_LINE" > "$tmp_append"
  cat "$tmp_append" | "${SUDO[@]}" tee -a "$CADDYFILE" >/dev/null
  success "Appended conf.d import to ${CADDYFILE}."
}

generate_caddy_config() {
  cat <<EOF_CADDY
# llampart Caddy configuration
# Managed by llampart install.sh

:${LLAMPART_PORT} {
    root * ${CURRENT_SYMLINK}

    @llampart_api path /props /models /models/* /slots /slots/* /cors-proxy /tools /tools/* /v1/*
    reverse_proxy @llampart_api ${BACKEND_HOST}:${BACKEND_PORT}

    file_server
}
EOF_CADDY
}

restore_caddy_backups() {
  warn "Restoring Caddy configuration backups..."

  if [[ -n "$CADDYFILE_BACKUP" && -e "$CADDYFILE_BACKUP" ]]; then
    run_priv cp -a "$CADDYFILE_BACKUP" "$CADDYFILE"
  elif [[ "$CADDYFILE_CREATED" == "1" ]]; then
    run_priv rm -f "$CADDYFILE"
  fi

  if [[ -n "$LLAMPART_CONFIG_BACKUP" && -e "$LLAMPART_CONFIG_BACKUP" ]]; then
    run_priv cp -a "$LLAMPART_CONFIG_BACKUP" "$LLAMPART_CADDY_CONFIG"
  elif [[ "$LLAMPART_CONFIG_CREATED" == "1" ]]; then
    run_priv rm -f "$LLAMPART_CADDY_CONFIG"
  fi
}

validate_existing_caddy_config() {
  if priv_test -f "$CADDYFILE"; then
    info "Validating existing Caddy configuration..."
    local validation_log=""
    validation_log="$(mktemp -t llampart-caddy-validate-before-XXXXXXXX.log)"
    if ! "${SUDO[@]}" caddy validate --config "$CADDYFILE" >"$validation_log" 2>&1; then
      cat "$validation_log" >&2 || true
      rm -f "$validation_log" || true
      fatal "Existing Caddy configuration is invalid. Not editing Caddy files."
    fi
    rm -f "$validation_log" || true
  fi
}

write_and_validate_caddy_config() {
  validate_existing_caddy_config
  ensure_caddy_import
  backup_file_if_exists "$LLAMPART_CADDY_CONFIG" LLAMPART_CONFIG_BACKUP

  if ! priv_test -e "$LLAMPART_CADDY_CONFIG"; then
    LLAMPART_CONFIG_CREATED=1
  fi

  local tmp="${WORK_DIR}/llampart.caddy"
  generate_caddy_config > "$tmp"
  run_priv install -m 644 "$tmp" "$LLAMPART_CADDY_CONFIG"

  info "Validating Caddy configuration after llampart changes..."
  if ! "${SUDO[@]}" caddy validate --config "$CADDYFILE"; then
    restore_caddy_backups
    if priv_test -f "$CADDYFILE"; then
      "${SUDO[@]}" caddy validate --config "$CADDYFILE" || true
    fi
    fatal "Caddy validation failed. Restored previous configuration and did not restart Caddy."
  fi

  success "Caddy configuration is valid."
}

enable_reload_caddy() {
  info "Enabling and reloading Caddy..."
  run_priv systemctl enable --now caddy
  if ! "${SUDO[@]}" systemctl reload caddy; then
    warn "Caddy reload failed; trying restart."
    run_priv systemctl restart caddy
  fi
  success "Caddy service reloaded/restarted."
}

reload_caddy_if_active() {
  if systemctl is-active --quiet caddy; then
    info "Reloading Caddy..."
    if ! "${SUDO[@]}" systemctl reload caddy; then
      warn "Caddy reload failed; trying restart."
      run_priv systemctl restart caddy
    fi
    success "Caddy service reloaded/restarted."
  else
    info "Caddy is not active; not reloading it."
  fi
}

smoke_test_ui() {
  info "Running Web UI smoke test..."
  local code=""
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${LLAMPART_PORT}/" || true)"

  if [[ "$code" == "200" ]]; then
    UI_SMOKE_OK=1
    success "Web UI responded with HTTP 200."
    return 0
  fi

  UI_SMOKE_OK=0
  warn "Web UI smoke test did not return HTTP 200. Got: ${code:-no response}"
  return 1
}

check_backend_warning_only() {
  local code=""
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${BACKEND_HOST}:${BACKEND_PORT}/props" || true)"
  if [[ "$code" != "000" && -n "$code" ]]; then
    BACKEND_RESPONDED=1
    success "Backend responded on /props with HTTP ${code}."
    return 0
  fi

  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${BACKEND_HOST}:${BACKEND_PORT}/v1/models" || true)"
  if [[ "$code" != "000" && -n "$code" ]]; then
    BACKEND_RESPONDED=1
    success "Backend responded on /v1/models with HTTP ${code}."
    return 0
  fi

  BACKEND_RESPONDED=0
  warn "Backend did not respond on ${BACKEND_HOST}:${BACKEND_PORT}. llampart can still be installed successfully."
}

write_manifest() {
  local now=""
  now="$(date -Iseconds)"
  local installed_at=""
  installed_at="$(manifest_get installed_at || true)"

  if [[ -z "$installed_at" || "$MODE" == "install" ]]; then
    installed_at="$now"
  fi

  run_priv mkdir -p "$MANIFEST_DIR"
  local tmp="${WORK_DIR}/install-manifest.json"

  cat > "$tmp" <<EOF_MANIFEST
{
  "schema_version": "2",
  "app": "llampart",
  "version": "${VERSION}",
  "installed_at": "${installed_at}",
  "updated_at": "${now}",
  "install_root": "${INSTALL_ROOT}",
  "release_root": "${RELEASE_ROOT}",
  "current_symlink": "${CURRENT_SYMLINK}",
  "current_target": "${DEPLOYED_RELEASE_DIR}",
  "caddy_config": "${LLAMPART_CADDY_CONFIG}",
  "caddyfile": "${CADDYFILE}",
  "llampart_port": "${LLAMPART_PORT}",
  "backend_host": "${BACKEND_HOST}",
  "backend_port": "${BACKEND_PORT}",
  "artifact_url": "${ARTIFACT_URL}",
  "artifact_sha256": "${ARTIFACT_SHA256}",
  "installer_version": "${INSTALLER_VERSION}"
}
EOF_MANIFEST

  run_priv install -m 644 "$tmp" "$MANIFEST_PATH"
  success "Manifest written to ${MANIFEST_PATH}"
}

update_manifest_config_only() {
  local current_version=""
  current_version="$(manifest_get version || true)"
  VERSION="${current_version:-current}"
  DEPLOYED_RELEASE_DIR="$(readlink -f "$CURRENT_SYMLINK" 2>/dev/null || manifest_get current_target || true)"
  ARTIFACT_URL="$(manifest_get artifact_url || true)"
  ARTIFACT_SHA256="$(manifest_get artifact_sha256 || true)"

  if [[ -z "$DEPLOYED_RELEASE_DIR" ]]; then
    DEPLOYED_RELEASE_DIR="${CURRENT_SYMLINK}"
  fi

  init_work_dir
  write_manifest
}

lan_urls() {
  if ! command -v ip >/dev/null 2>&1; then
    return 0
  fi

  ip -o -4 addr show scope global 2>/dev/null | awk -v port="$LLAMPART_PORT" '
    {
      iface = $2
      cidr = $4
      if (iface ~ /^(lo|docker|br-|veth|virbr|tun|wg|zt|tailscale)/) {
        next
      }
      split(cidr, parts, "/")
      if (parts[1] != "") {
        printf "http://%s:%s/#/\n", parts[1], port
      }
    }
  '
}

caddy_active_status() {
  if systemctl is-active caddy >/dev/null 2>&1; then
    systemctl is-active caddy 2>/dev/null || true
  else
    echo "inactive"
  fi
}

caddy_enabled_status() {
  if systemctl is-enabled caddy >/dev/null 2>&1; then
    systemctl is-enabled caddy 2>/dev/null || true
  else
    echo "disabled"
  fi
}

print_success_summary() {
  local lan=""
  lan="$(lan_urls || true)"

  echo
  bold "llampart is ready"; echo
  echo
  echo "Open llampart:"
  echo
  printf '    %-16s %s\n' "Local:" "$(cyan "http://localhost:${LLAMPART_PORT}/#/")"
  echo
  echo "    Home network:"
  if [[ -n "$lan" ]]; then
    printf '%s\n' "$lan" | sed 's/^/        /'
  else
    echo "        No LAN IPv4 address detected."
  fi
  echo
  printf '    %-16s %s\n' "backend proxy:" "http://${BACKEND_HOST}:${BACKEND_PORT}"
  echo
  echo "Caddy:"
  printf '    %-16s %s\n' "status:" "$(caddy_active_status)"
  printf '    %-16s %s\n' "autostart:" "$(caddy_enabled_status)"
  echo
  echo "Next step:"
  echo "    Start your backend if it is not running yet."
  echo "    If another device cannot open the home network URL, check your firewall."

  if [[ "$BACKEND_RESPONDED" != "1" ]]; then
    echo
    warn "Backend did not respond during the warning-only check. Start your backend, then refresh llampart."
  fi

  if [[ -n "$LOG_FILE" ]]; then
    echo
    dim "Log: ${LOG_FILE}"; echo
  fi
}

print_uninstall_summary() {
  echo
  bold "llampart uninstall completed"; echo
  echo
  echo "Removed llampart files and the llampart-owned Caddy site."
  echo
  echo "Caddy was not removed."
  echo "Unrelated Caddy sites were not removed."

  if [[ -n "$LOG_FILE" ]]; then
    echo
    dim "Log: ${LOG_FILE}"; echo
  fi
}

perform_install_like() {
  resolve_version
  load_defaults
  print_plan
  confirm_plan_or_exit

  require_caddy_dependency
  ensure_sudo
  validate_public_port_available

  init_work_dir
  download_artifact
  deploy_release
  write_and_validate_caddy_config
  switch_current_symlink
  enable_reload_caddy

  if ! smoke_test_ui; then
    if [[ "$MODE" == "update" ]]; then
      rollback_symlink
      fatal "Web UI smoke test failed after update; rollback attempted."
    fi
    fatal "Web UI smoke test failed after install. Caddy was not confirmed healthy for llampart."
  fi

  check_backend_warning_only
  write_manifest
  print_success_summary
}

perform_configure() {
  load_defaults
  print_plan
  confirm_plan_or_exit

  require_caddy_dependency
  ensure_sudo
  validate_public_port_available

  init_work_dir
  write_and_validate_caddy_config
  enable_reload_caddy
  smoke_test_ui || fatal "Web UI smoke test failed after configure."
  check_backend_warning_only
  update_manifest_config_only
  print_success_summary
}

remove_llampart_caddy_config() {
  if caddy_installed && caddy_service_exists; then
    validate_existing_caddy_config
  else
    warn "Caddy is not available as a systemd service; removing llampart files without Caddy validation/reload."
  fi

  backup_file_if_exists "$LLAMPART_CADDY_CONFIG" LLAMPART_CONFIG_BACKUP

  if priv_test -f "$LLAMPART_CADDY_CONFIG"; then
    run_priv rm -f "$LLAMPART_CADDY_CONFIG"
    info "Removed ${LLAMPART_CADDY_CONFIG}"
  fi

  if caddy_installed && caddy_service_exists && priv_test -f "$CADDYFILE"; then
    if ! "${SUDO[@]}" caddy validate --config "$CADDYFILE"; then
      restore_caddy_backups
      fatal "Caddy validation failed after removing llampart config. Restored previous configuration."
    fi
    reload_caddy_if_active
  fi
}

perform_uninstall() {
  load_defaults
  print_plan
  confirm_plan_or_exit

  ensure_sudo
  init_work_dir

  remove_llampart_caddy_config

  if priv_test -L "$CURRENT_SYMLINK"; then
    run_priv rm -f "$CURRENT_SYMLINK"
    info "Removed ${CURRENT_SYMLINK}"
  elif priv_test -e "$CURRENT_SYMLINK"; then
    warn "${CURRENT_SYMLINK} exists but is not a symlink; leaving it untouched."
  fi

  if priv_test -d "$MANIFEST_DIR"; then
    run_priv rm -rf "$MANIFEST_DIR"
    info "Removed ${MANIFEST_DIR}"
  fi

  if priv_test -d "$INSTALL_ROOT"; then
    run_priv rm -rf "$INSTALL_ROOT"
    info "Removed ${INSTALL_ROOT}"
  fi

  print_uninstall_summary
}

main() {
  parse_args "$@"
  init_colors
  init_logging
  preflight_basic
  determine_mode

  case "$MODE" in
    install|update)
      perform_install_like
      ;;
    configure)
      perform_configure
      ;;
    uninstall)
      perform_uninstall
      ;;
    *)
      fatal "Unknown mode: ${MODE}"
      ;;
  esac
}

main "$@"
