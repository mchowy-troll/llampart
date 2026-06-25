#!/usr/bin/env bash
# llampart Linux+Caddy installer/updater/configurator/uninstaller
# Target: Ubuntu-based and Arch Linux-based systems with systemd.
# Managed by llampart project.

set -Eeuo pipefail
IFS=$'\n\t'

INSTALLER_VERSION="0.1.8"
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
LOG_DIR="/var/log/llampart-installer"

CADDY_DIR="/etc/caddy"
CADDYFILE="${CADDY_DIR}/Caddyfile"
CADDY_CONF_DIR="${CADDY_DIR}/conf.d"
LLAMPART_CADDY_CONFIG="${CADDY_CONF_DIR}/llampart.caddy"
CADDY_IMPORT_LINE="import /etc/caddy/conf.d/*.caddy"

DEFAULT_LLAMPART_PORT="8100"
DEFAULT_BACKEND_HOST="127.0.0.1"
DEFAULT_LLAMA_SERVER_PORT="8080"

MODE=""
VERSION_OVERRIDE="${LLAMPART_VERSION:-}"
LLAMPART_PORT="${LLAMPART_PORT:-}"
LLAMA_SERVER_PORT="${LLAMPART_LLAMA_SERVER_PORT:-}"
BACKEND_HOST="${LLAMPART_BACKEND_HOST:-}"
LANG_CODE="${LLAMPART_LANGUAGE:-}"
ASSUME_YES="${LLAMPART_ASSUME_YES:-0}"
DRY_RUN="${LLAMPART_DRY_RUN:-0}"
NO_COLOR_FLAG="${LLAMPART_NO_COLOR:-0}"
SKIP_CADDY_INSTALL=0
SKIP_CADDY_CONFIG=0
CLEANUP_OLD_RELEASES=0
KEEP_RELEASES="2"
PURGE=0

DISTRO_FAMILY=""
DISTRO_NAME=""
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

usage() {
  cat <<EOF
llampart Linux+Caddy installer v${INSTALLER_VERSION}

Usage:
  bash install.sh [mode] [options]
  curl -fsSL ${GITHUB_RAW_INSTALL_URL} | bash -s -- [mode] [options]

Modes:
  --install                  Fresh install, or install selected version
  --update                   Update to latest or selected version
  --reinstall                Reinstall current/latest/selected version
  --configure                Change Caddy/port configuration only
  --uninstall                Remove llampart-owned Caddy config and installation metadata

Options:
  --version vX.Y.Z           Install/update/reinstall a specific release version
  --port PORT                Public llampart/Caddy port (default: ${DEFAULT_LLAMPART_PORT})
  --llama-server-port PORT   Local llama-server backend port (default: ${DEFAULT_LLAMA_SERVER_PORT})
  --backend-host HOST        Backend host for Caddy reverse proxy (default: ${DEFAULT_BACKEND_HOST})
  --language CODE            en, pl, de, es, fr, it
  --skip-caddy-install       Do not install Caddy if missing
  --skip-caddy-config        Do not write/reload llampart Caddy config
  --cleanup-old-releases     Remove older release directories after success
  --keep-releases N          Number of newest releases to keep during cleanup (default: ${KEEP_RELEASES})
  --purge                    With --uninstall, also delete /opt/llampart release/download files
  --yes                      Non-interactive mode; accept safe defaults
  --dry-run                  Print the plan and exit before privileged changes
  --no-color                 Disable colorized output
  --help                     Show this help

Environment variables:
  LLAMPART_INSTALL_MODE, LLAMPART_VERSION, LLAMPART_PORT,
  LLAMPART_LLAMA_SERVER_PORT, LLAMPART_BACKEND_HOST,
  LLAMPART_LANGUAGE, LLAMPART_ASSUME_YES, LLAMPART_DRY_RUN,
  LLAMPART_NO_COLOR
EOF
}

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

require_option_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    fatal "Missing value for ${option}."
  fi
}

parse_args() {
  if [[ -n "${LLAMPART_INSTALL_MODE:-}" ]]; then
    MODE="$LLAMPART_INSTALL_MODE"
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install|--update|--reinstall|--configure|--uninstall)
        MODE="${1#--}"
        shift
        ;;
      --version)
        require_option_value "$1" "${2:-}"
        VERSION_OVERRIDE="$2"
        shift 2
        ;;
      --port)
        require_option_value "$1" "${2:-}"
        LLAMPART_PORT="$2"
        shift 2
        ;;
      --llama-server-port)
        require_option_value "$1" "${2:-}"
        LLAMA_SERVER_PORT="$2"
        shift 2
        ;;
      --backend-host)
        require_option_value "$1" "${2:-}"
        BACKEND_HOST="$2"
        shift 2
        ;;
      --language)
        require_option_value "$1" "${2:-}"
        LANG_CODE="$2"
        shift 2
        ;;
      --skip-caddy-install)
        SKIP_CADDY_INSTALL=1
        shift
        ;;
      --skip-caddy-config)
        SKIP_CADDY_CONFIG=1
        shift
        ;;
      --cleanup-old-releases)
        CLEANUP_OLD_RELEASES=1
        shift
        ;;
      --keep-releases)
        require_option_value "$1" "${2:-}"
        KEEP_RELEASES="$2"
        shift 2
        ;;
      --purge)
        PURGE=1
        shift
        ;;
      --yes|-y)
        ASSUME_YES=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --no-color)
        NO_COLOR_FLAG=1
        shift
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

init_colors() {
  if [[ "${NO_COLOR:-}" != "" || "$NO_COLOR_FLAG" == "1" ]]; then
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
dim() { color "2" "$*"; }

info() { printf '%s\n' "$(blue "==>") $*"; }
success() { printf '%s\n' "$(green "OK") $*"; }
warn() { printf '%s\n' "$(yellow "WARNING") $*"; }
fatal() { printf '%s\n' "$(red "ERROR") $*" >&2; exit 1; }

read_interactive() {
  local target_var="$1"
  if [[ -r /dev/tty ]]; then
    IFS= read -r "$target_var" </dev/tty || fatal "Interactive input is unavailable. Re-run from a terminal or pass --yes with explicit options."
  else
    IFS= read -r "$target_var" || fatal "Interactive input is unavailable. Re-run from a terminal or pass --yes with explicit options."
  fi
}

tr_msg() {
  local key="$1"
  case "${LANG_CODE:-en}:$key" in
    pl:choose_language) echo "Wybierz język instalacji:" ;;
    de:choose_language) echo "Installationssprache wählen:" ;;
    es:choose_language) echo "Elige el idioma de instalación:" ;;
    fr:choose_language) echo "Choisissez la langue d’installation :" ;;
    it:choose_language) echo "Scegli la lingua di installazione:" ;;
    *:choose_language) echo "Choose installation language:" ;;

    pl:port_prompt) echo "Którego portu ma używać llampart?" ;;
    de:port_prompt) echo "Welchen Port soll llampart verwenden?" ;;
    es:port_prompt) echo "¿Qué puerto debe usar llampart?" ;;
    fr:port_prompt) echo "Quel port llampart doit-il utiliser ?" ;;
    it:port_prompt) echo "Quale porta deve usare llampart?" ;;
    *:port_prompt) echo "Which port should llampart use?" ;;

    pl:backend_port_prompt) echo "Którego portu używa llama-server?" ;;
    de:backend_port_prompt) echo "Welchen Port verwendet llama-server?" ;;
    es:backend_port_prompt) echo "¿Qué puerto usa llama-server?" ;;
    fr:backend_port_prompt) echo "Quel port llama-server utilise-t-il ?" ;;
    it:backend_port_prompt) echo "Quale porta usa llama-server?" ;;
    *:backend_port_prompt) echo "Which port is llama-server using?" ;;

    pl:invalid_port) echo "Nieprawidłowy port. Podaj liczbę od 1024 do 65535." ;;
    de:invalid_port) echo "Ungültiger Port. Gib eine Zahl von 1024 bis 65535 ein." ;;
    es:invalid_port) echo "Puerto no válido. Usa un número entre 1024 y 65535." ;;
    fr:invalid_port) echo "Port invalide. Indiquez un nombre entre 1024 et 65535." ;;
    it:invalid_port) echo "Porta non valida. Usa un numero tra 1024 e 65535." ;;
    *:invalid_port) echo "Invalid port. Use a number from 1024 to 65535." ;;

    pl:port_busy) echo "Ten port jest już zajęty albo występuje w istniejącej konfiguracji Caddy. Wybierz inny port." ;;
    de:port_busy) echo "Dieser Port ist bereits belegt oder erscheint in der vorhandenen Caddy-Konfiguration. Bitte wähle einen anderen Port." ;;
    es:port_busy) echo "Ese puerto ya está ocupado o aparece en la configuración existente de Caddy. Elige otro puerto." ;;
    fr:port_busy) echo "Ce port est déjà utilisé ou apparaît dans la configuration Caddy existante. Choisissez un autre port." ;;
    it:port_busy) echo "Questa porta è già occupata o appare nella configurazione Caddy esistente. Scegli un'altra porta." ;;
    *:port_busy) echo "That port is already in use or appears in existing Caddy configuration. Choose another port." ;;

    pl:continue) echo "Kontynuować?" ;;
    de:continue) echo "Fortfahren?" ;;
    es:continue) echo "¿Continuar?" ;;
    fr:continue) echo "Continuer ?" ;;
    it:continue) echo "Continuare?" ;;
    *:continue) echo "Continue?" ;;

    pl:cancelled) echo "Przerwano bez zmian." ;;
    de:cancelled) echo "Abgebrochen, keine Änderungen vorgenommen." ;;
    es:cancelled) echo "Cancelado sin cambios." ;;
    fr:cancelled) echo "Annulé sans modification." ;;
    it:cancelled) echo "Annullato senza modifiche." ;;
    *:cancelled) echo "Cancelled without changes." ;;

    pl:unsupported_distro) echo "Ta dystrybucja nie jest obsługiwana przez instalator llampart. Obsługiwane są tylko systemy Ubuntu-based i Arch Linux-based." ;;
    de:unsupported_distro) echo "Diese Distribution wird vom llampart-Installer nicht unterstützt. Unterstützt werden nur Ubuntu-basierte und Arch-Linux-basierte Systeme." ;;
    es:unsupported_distro) echo "Esta distribución no está soportada por el instalador de llampart. Solo se admiten sistemas basados en Ubuntu y Arch Linux." ;;
    fr:unsupported_distro) echo "Cette distribution n’est pas prise en charge par l’installateur llampart. Seuls les systèmes basés sur Ubuntu et Arch Linux sont pris en charge." ;;
    it:unsupported_distro) echo "Questa distribuzione non è supportata dall'installer di llampart. Sono supportati solo sistemi basati su Ubuntu e Arch Linux." ;;
    *:unsupported_distro) echo "This distribution is not supported by the llampart installer. Only Ubuntu-based and Arch Linux-based systems are supported." ;;

    pl:uninstall_confirm) echo "To usunie konfigurację Caddy należącą do llampart, symlink /srv/llampart/current oraz manifest instalacji. Caddy nie zostanie odinstalowany." ;;
    de:uninstall_confirm) echo "Dies entfernt die llampart-eigene Caddy-Konfiguration, den Symlink /srv/llampart/current und das Installationsmanifest. Caddy wird nicht deinstalliert." ;;
    es:uninstall_confirm) echo "Esto eliminará la configuración de Caddy perteneciente a llampart, el enlace /srv/llampart/current y el manifiesto de instalación. Caddy no se desinstalará." ;;
    fr:uninstall_confirm) echo "Cela supprimera la configuration Caddy appartenant à llampart, le lien /srv/llampart/current et le manifeste d’installation. Caddy ne sera pas désinstallé." ;;
    it:uninstall_confirm) echo "Questo rimuoverà la configurazione Caddy di llampart, il symlink /srv/llampart/current e il manifesto di installazione. Caddy non verrà disinstallato." ;;
    *:uninstall_confirm) echo "This will remove llampart-owned Caddy configuration, the /srv/llampart/current symlink, and the install manifest. Caddy will not be uninstalled." ;;

    *) echo "$key" ;;
  esac
}

choose_language() {
  case "${LANG_CODE:-}" in
    en|pl|de|es|fr|it) return 0 ;;
    "") ;;
    *) warn "Unsupported language '$LANG_CODE'; falling back to English."; LANG_CODE="en"; return 0 ;;
  esac

  if [[ "$ASSUME_YES" == "1" ]]; then
    LANG_CODE="en"
    return 0
  fi

  echo "$(tr_msg choose_language)"
  echo "1) English"
  echo "2) Polski"
  echo "3) Deutsch"
  echo "4) Español"
  echo "5) Français"
  echo "6) Italiano"
  local choice=""
  while true; do
    printf "> "
    read_interactive choice
    case "$choice" in
      1|en|EN|English|english) LANG_CODE="en"; break ;;
      2|pl|PL|Polski|polski) LANG_CODE="pl"; break ;;
      3|de|DE|Deutsch|deutsch) LANG_CODE="de"; break ;;
      4|es|ES|Español|Espanol|español|espanol) LANG_CODE="es"; break ;;
      5|fr|FR|Français|Francais|français|francais) LANG_CODE="fr"; break ;;
      6|it|IT|Italiano|italiano) LANG_CODE="it"; break ;;
      *) echo "1-6" ;;
    esac
  done
}

confirm() {
  local prompt="$1"
  local default_yes="${2:-1}"
  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi
  local suffix="[Y/n]"
  if [[ "$default_yes" != "1" ]]; then
    suffix="[y/N]"
  fi
  local answer=""
  printf "%s %s " "$prompt" "$suffix"
  read_interactive answer
  case "$answer" in
    "") [[ "$default_yes" == "1" ]] ;;
    y|Y|yes|YES|Yes|tak|TAK|t|T|ja|JA|sí|si|SI|oui|OUI) return 0 ;;
    *) return 1 ;;
  esac
}

run_priv() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY-RUN sudo: %q ' "$@"
    printf '\n'
  else
    "${SUDO[@]}" "$@"
  fi
}

priv_test() {
  "${SUDO[@]}" test "$@"
}

ensure_sudo() {
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  if [[ ${#SUDO[@]} -gt 0 ]]; then
    command -v sudo >/dev/null 2>&1 || fatal "sudo is required. Run as root or install sudo."
    sudo -v
  fi
}

init_logging() {
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi

  # Keep the live log user-writable. In piped installs (`curl | bash`), the
  # installer initially runs as the normal user; writing through tee directly
  # into /var/log would fail even if the file was created with sudo.
  LOG_FILE="$(mktemp -t "llampart-installer-${TIMESTAMP}.XXXXXXXX.log")"
  chmod 600 "$LOG_FILE" || true
  exec > >(tee -a "$LOG_FILE") 2>&1
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

detect_distro() {
  local id=""
  local id_like=""
  local pretty=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    id="${ID:-}"
    id_like="${ID_LIKE:-}"
    pretty="${PRETTY_NAME:-${NAME:-unknown}}"
  fi
  DISTRO_NAME="$pretty"
  local haystack=" ${id} ${id_like} "

  case "$haystack" in
    *ubuntu*|*linuxmint*|*pop*|*elementary*|*zorin*|*neon*|*tuxedo*)
      DISTRO_FAMILY="ubuntu"
      ;;
    *arch*|*manjaro*|*endeavouros*|*garuda*|*cachyos*)
      DISTRO_FAMILY="arch"
      ;;
    *)
      DISTRO_FAMILY="unsupported"
      ;;
  esac
}

preflight_distro() {
  detect_distro
  if [[ "$DISTRO_FAMILY" == "unsupported" ]]; then
    fatal "$(tr_msg unsupported_distro) Detected: ${DISTRO_NAME:-unknown}"
  fi
  success "Supported distribution family: ${DISTRO_FAMILY} (${DISTRO_NAME:-unknown})"
}

normalize_version() {
  local raw="$1"
  [[ -n "$raw" ]] || fatal "Empty version."
  if [[ "$raw" != v* ]]; then
    raw="v${raw}"
  fi
  [[ "$raw" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fatal "Invalid version: $raw"
  printf '%s\n' "$raw"
}

resolve_version() {
  if [[ -n "$VERSION_OVERRIDE" ]]; then
    VERSION="$(normalize_version "$VERSION_OVERRIDE")"
    return 0
  fi

  info "Resolving latest llampart release..."
  local latest_url=""
  latest_url="$(curl -fsSIL -o /dev/null -w '%{url_effective}' "${GITHUB_REPO_URL}/releases/latest")"
  local tag="${latest_url##*/}"
  VERSION="$(normalize_version "$tag")"
}

artifact_names() {
  ARTIFACT_URL="${GITHUB_REPO_URL}/releases/download/${VERSION}/llampart-webui-${VERSION}.tar.xz"
  CHECKSUM_URL="${GITHUB_REPO_URL}/releases/download/${VERSION}/llampart-webui-${VERSION}.sha256"
}

manifest_get() {
  local key="$1"
  if [[ -r "$MANIFEST_PATH" ]]; then
    sed -nE "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"(.*)\",?[[:space:]]*$/\1/p" "$MANIFEST_PATH" | head -n 1
  fi
}

existing_install_detected() {
  # Detect only active installation markers. Release directories may be kept
  # intentionally after uninstall unless --purge was used, so they must not
  # force the next run into the update/reinstall/configure/uninstall menu.
  [[ -f "$MANIFEST_PATH" || -e "$CURRENT_SYMLINK" || -L "$CURRENT_SYMLINK" || -f "$LLAMPART_CADDY_CONFIG" ]]
}

determine_mode() {
  case "$MODE" in
    install|update|reinstall|configure|uninstall) return 0 ;;
    "") ;;
    *) fatal "Invalid mode: $MODE" ;;
  esac

  if existing_install_detected; then
    if [[ "$ASSUME_YES" == "1" ]]; then
      MODE="update"
      return 0
    fi
    echo
    echo "Existing llampart installation data was detected."
    echo "1) Update to latest version"
    echo "2) Reinstall"
    echo "3) Change Caddy/port configuration"
    echo "4) Uninstall llampart"
    echo "5) Exit"
    local choice=""
    while true; do
      printf "> "
      read_interactive choice
      case "$choice" in
        1) MODE="update"; break ;;
        2) MODE="reinstall"; break ;;
        3) MODE="configure"; break ;;
        4) MODE="uninstall"; break ;;
        5) echo "$(tr_msg cancelled)"; exit 0 ;;
        *) echo "1-5" ;;
      esac
    done
  else
    MODE="install"
  fi
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

port_is_listening() {
  local port="$1"
  if ! command -v ss >/dev/null 2>&1; then
    return 1
  fi

  # Match the local address column reported by ss. Examples:
  #   127.0.0.1:8100
  #   0.0.0.0:8100
  #   [::]:8100
  #   *:8100
  # Keep this inside awk so Bash never expands an awk variable under set -u.
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
  [[ -f "$LLAMPART_CADDY_CONFIG" ]] || return 1
  grep -Eq "^[[:space:]]*:${port}[[:space:]]*\{" "$LLAMPART_CADDY_CONFIG"
}

port_in_other_caddy_configs() {
  local port="$1"
  [[ -d "$CADDY_DIR" ]] || return 1
  local file=""
  local -a find_cmd
  local -a grep_cmd

  # In dry-run, avoid sudo prompts entirely. This keeps dry-run safe and quiet.
  # During real runs, sudo is allowed for read-only inspection of protected Caddy configs.
  if [[ "$DRY_RUN" == "1" ]]; then
    find_cmd=(find "$CADDY_DIR" -type f \( -name 'Caddyfile' -o -name '*.caddy' \) -print0)
    grep_cmd=(grep)
  else
    find_cmd=("${SUDO[@]}" find "$CADDY_DIR" -type f \( -name 'Caddyfile' -o -name '*.caddy' \) -print0)
    grep_cmd=("${SUDO[@]}" grep)
  fi

  while IFS= read -r -d '' file; do
    [[ "$file" == "$LLAMPART_CADDY_CONFIG" ]] && continue
    [[ "$file" == *.llampart-backup-* ]] && continue
    if "${grep_cmd[@]}" -Eq "(^|[[:space:]])(:${port})([[:space:]]*\{|[[:space:]])" "$file" 2>/dev/null; then
      return 0
    fi
  done < <("${find_cmd[@]}" 2>/dev/null || true)
  return 1
}

public_port_available() {
  local port="$1"
  if our_config_uses_port "$port"; then
    return 0
  fi
  if port_in_other_caddy_configs "$port"; then
    return 1
  fi
  if port_is_listening "$port"; then
    return 1
  fi
  return 0
}

prompt_public_port() {
  local default="$1"
  local value="${LLAMPART_PORT:-}"
  while true; do
    if [[ -z "$value" ]]; then
      if [[ "$ASSUME_YES" == "1" ]]; then
        value="$default"
      else
        printf "%s [default: %s]: " "$(tr_msg port_prompt)" "$default"
        read_interactive value
        value="${value:-$default}"
      fi
    fi

    if ! is_valid_port "$value"; then
      if [[ "$ASSUME_YES" == "1" ]]; then
        fatal "$(tr_msg invalid_port): $value"
      fi
      warn "$(tr_msg invalid_port)"
      value=""
      continue
    fi

    if ! public_port_available "$value"; then
      if [[ "$ASSUME_YES" == "1" ]]; then
        fatal "$(tr_msg port_busy): $value"
      fi
      warn "$(tr_msg port_busy)"
      value=""
      continue
    fi

    LLAMPART_PORT="$value"
    break
  done
}

prompt_backend_port() {
  local default="$1"
  local value="${LLAMA_SERVER_PORT:-}"
  while true; do
    if [[ -z "$value" ]]; then
      if [[ "$ASSUME_YES" == "1" ]]; then
        value="$default"
      else
        printf "%s [default: %s]: " "$(tr_msg backend_port_prompt)" "$default"
        read_interactive value
        value="${value:-$default}"
      fi
    fi

    if ! is_valid_port "$value"; then
      if [[ "$ASSUME_YES" == "1" ]]; then
        fatal "$(tr_msg invalid_port): $value"
      fi
      warn "$(tr_msg invalid_port)"
      value=""
      continue
    fi
    LLAMA_SERVER_PORT="$value"
    break
  done
}

load_default_ports_from_manifest() {
  local current_port=""
  local current_backend_port=""
  local current_backend_host=""
  current_port="$(manifest_get llampart_port || true)"
  current_backend_port="$(manifest_get llama_server_port || true)"
  current_backend_host="$(manifest_get llama_server_host || true)"

  : "${current_port:=$DEFAULT_LLAMPART_PORT}"
  : "${current_backend_port:=$DEFAULT_LLAMA_SERVER_PORT}"
  : "${current_backend_host:=$DEFAULT_BACKEND_HOST}"

  if [[ -z "${BACKEND_HOST:-}" ]]; then
    BACKEND_HOST="$current_backend_host"
  fi

  prompt_public_port "$current_port"
  prompt_backend_port "$current_backend_port"

  if ! is_valid_backend_host "$BACKEND_HOST"; then
    fatal "Invalid backend host: $BACKEND_HOST"
  fi
}

print_plan() {
  echo

  if [[ "${LANG_CODE:-en}" == "pl" ]]; then
    case "$MODE" in
      uninstall) bold "llampart zostanie odinstalowany według tego planu:" ;;
      configure) bold "Konfiguracja llampart zostanie zmieniona z tymi ustawieniami:" ;;
      *) bold "llampart zostanie uruchomiony z tymi ustawieniami:" ;;
    esac
    echo
    echo "Tryb:"
    echo "  ${MODE}"
    if [[ "$MODE" != "configure" && "$MODE" != "uninstall" ]]; then
      echo "Wersja:"
      echo "  ${VERSION}"
    fi
    if [[ "$MODE" != "uninstall" ]]; then
      echo "Otwórz llampart:"
      echo "  http://localhost:${LLAMPART_PORT}/#/"
      echo
      echo "Proxy backendu:"
      echo "  http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo
      if [[ "$MODE" == "configure" ]]; then
        echo "Aktywne pliki:"
        echo "  Web UI:"
        echo "    ${CURRENT_SYMLINK}"
        echo "  Konfiguracja Caddy:"
        echo "    ${LLAMPART_CADDY_CONFIG}"
      else
        echo "Ścieżki instalacji:"
        echo "  ${RELEASE_ROOT}/${VERSION}"
        echo "  ${CURRENT_SYMLINK}"
        echo "  ${LLAMPART_CADDY_CONFIG}"
      fi
      echo
      echo "Caddy:"
      if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
        echo "  pomiń konfigurację Caddy"
      else
        echo "  zachowaj istniejący Caddyfile"
        echo "  użyj osobnego pliku konfiguracji llampart"
        echo "  zwaliduj konfigurację przed reload/restart"
        echo "  włącz autostart"
      fi
    else
      echo "Zachowanie odinstalowania:"
      echo "  usuń konfigurację Caddy należącą do llampart"
      echo "  usuń ${CURRENT_SYMLINK}, jeśli jest symlinkiem"
      echo "  usuń manifest instalacji"
      echo "  pozostaw Caddy zainstalowany"
      if [[ "$PURGE" == "1" ]]; then
        echo "  usuń ${INSTALL_ROOT}"
      else
        echo "  pozostaw ${INSTALL_ROOT}, chyba że użyto --purge"
      fi
    fi
    echo
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "Dry-run: żadne uprzywilejowane zmiany nie zostaną wykonane."
    fi
    return 0
  fi

  case "$MODE" in
    uninstall) bold "llampart will be uninstalled with this plan:" ;;
    configure) bold "llampart configuration will be updated with these settings:" ;;
    *) bold "llampart will run with these settings:" ;;
  esac
  echo
  echo "Mode:"
  echo "  ${MODE}"
  if [[ "$MODE" != "configure" && "$MODE" != "uninstall" ]]; then
    echo "Version:"
    echo "  ${VERSION}"
  fi
  if [[ "$MODE" != "uninstall" ]]; then
    echo "Open llampart:"
    echo "  http://localhost:${LLAMPART_PORT}/#/"
    echo
    echo "Backend proxy:"
    echo "  http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
    echo
    if [[ "$MODE" == "configure" ]]; then
      echo "Active files:"
      echo "  Web UI:"
      echo "    ${CURRENT_SYMLINK}"
      echo "  Caddy config:"
      echo "    ${LLAMPART_CADDY_CONFIG}"
    else
      echo "Install paths:"
      echo "  ${RELEASE_ROOT}/${VERSION}"
      echo "  ${CURRENT_SYMLINK}"
      echo "  ${LLAMPART_CADDY_CONFIG}"
    fi
    echo
    echo "Caddy:"
    if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
      echo "  skip Caddy config"
    else
      echo "  preserve existing Caddyfile"
      echo "  use dedicated llampart config file"
      echo "  validate before reload/restart"
      echo "  enable autostart"
    fi
  else
    echo "Uninstall behavior:"
    echo "  remove llampart-owned Caddy config"
    echo "  remove ${CURRENT_SYMLINK} if it is a symlink"
    echo "  remove install manifest"
    echo "  keep Caddy installed"
    if [[ "$PURGE" == "1" ]]; then
      echo "  purge ${INSTALL_ROOT}"
    else
      echo "  keep ${INSTALL_ROOT} unless --purge is used"
    fi
  fi
  echo
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "Dry run: no privileged changes will be made."
  fi
}

confirm_plan_or_exit() {
  if [[ "$MODE" == "uninstall" ]]; then
    echo "$(tr_msg uninstall_confirm)"
  fi
  if ! confirm "$(tr_msg continue)" 1; then
    echo "$(tr_msg cancelled)"
    exit 0
  fi
}

init_work_dir() {
  if [[ -n "${WORK_DIR}" ]]; then
    return 0
  fi
  WORK_DIR="$(mktemp -d -t llampart-installer-XXXXXXXX)"
}

caddy_service_exists() {
  systemctl cat caddy.service >/dev/null 2>&1
}

caddy_installed() {
  command -v caddy >/dev/null 2>&1
}

validate_caddy_service_shape() {
  if caddy_installed && ! caddy_service_exists; then
    fatal "Caddy binary exists, but caddy.service was not found. This installer will not guess a custom service layout. Install/configure Caddy as a systemd service, then rerun."
  fi
}

install_caddy_if_needed() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    return 0
  fi

  validate_caddy_service_shape

  if caddy_installed && caddy_service_exists; then
    success "Caddy is already installed as a systemd service. It will not be reinstalled."
    return 0
  fi

  if [[ "$SKIP_CADDY_INSTALL" == "1" ]]; then
    fatal "Caddy is not installed and --skip-caddy-install was provided. Install Caddy manually, then rerun."
  fi

  info "Installing Caddy for ${DISTRO_FAMILY}..."
  case "$DISTRO_FAMILY" in
    ubuntu)
      run_priv apt-get update
      run_priv apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg ca-certificates
      if [[ "$DRY_RUN" == "1" ]]; then
        echo "DRY-RUN: add Caddy Cloudsmith apt key and repository"
      else
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | "${SUDO[@]}" gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | "${SUDO[@]}" tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      fi
      run_priv chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      run_priv chmod o+r /etc/apt/sources.list.d/caddy-stable.list
      run_priv apt-get update
      run_priv apt-get install -y caddy
      ;;
    arch)
      if [[ "$ASSUME_YES" == "1" ]]; then
        run_priv pacman -Syu --needed --noconfirm caddy
      else
        run_priv pacman -Syu --needed caddy
      fi
      ;;
    *)
      fatal "$(tr_msg unsupported_distro)"
      ;;
  esac

  caddy_installed || fatal "Caddy installation did not provide a caddy binary."
  caddy_service_exists || fatal "Caddy installation did not provide caddy.service."
}

validate_existing_caddy_config() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    return 0
  fi
  if ! caddy_installed; then
    return 0
  fi
  if priv_test -f "$CADDYFILE"; then
    info "Validating existing Caddy configuration before editing..."
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
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    return 0
  fi

  run_priv mkdir -p "$CADDY_DIR" "$CADDY_CONF_DIR"
  backup_file_if_exists "$CADDYFILE" CADDYFILE_BACKUP

  if ! priv_test -f "$CADDYFILE"; then
    CADDYFILE_CREATED=1
    local tmp="${WORK_DIR}/Caddyfile"
    cat > "$tmp" <<EOF
# Caddyfile
# llampart installer created this file because it did not exist.
${CADDY_IMPORT_LINE}
EOF
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
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY-RUN: append import to ${CADDYFILE}"
  else
    cat "$tmp_append" | "${SUDO[@]}" tee -a "$CADDYFILE" >/dev/null
  fi
  success "Appended conf.d import to ${CADDYFILE}."
}

generate_caddy_config() {
  cat <<EOF
# llampart Caddy configuration
# Managed by llampart install.sh
# Safe to edit, but future --configure may rewrite this file.

:${LLAMPART_PORT} {
    root * ${CURRENT_SYMLINK}

    @llampart_api path /props /models /cors-proxy /v1/*
    reverse_proxy @llampart_api ${BACKEND_HOST}:${LLAMA_SERVER_PORT}

    file_server
}
EOF
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

write_and_validate_caddy_config() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    warn "Skipping Caddy configuration because --skip-caddy-config was provided."
    return 0
  fi

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
    if caddy_installed && priv_test -f "$CADDYFILE"; then
      "${SUDO[@]}" caddy validate --config "$CADDYFILE" || true
    fi
    fatal "Caddy validation failed. Restored previous configuration and did not restart Caddy."
  fi
  success "Caddy configuration is valid."
}

enable_reload_caddy() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    return 0
  fi
  info "Enabling and reloading Caddy..."
  run_priv systemctl enable --now caddy
  if ! "${SUDO[@]}" systemctl reload caddy; then
    warn "Caddy reload failed; trying restart."
    run_priv systemctl restart caddy
  fi
  success "Caddy service reloaded/restarted."
}

reload_caddy_without_enabling() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    return 0
  fi
  if systemctl is-active caddy >/dev/null 2>&1; then
    info "Reloading active Caddy service..."
    if ! "${SUDO[@]}" systemctl reload caddy; then
      warn "Caddy reload failed; trying restart."
      run_priv systemctl restart caddy
    fi
    success "Caddy service reloaded/restarted."
  else
    info "Caddy is not active; not starting or enabling it during uninstall."
  fi
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
    if [[ "$MODE" == "reinstall" ]]; then
      local backup="${release_dir}.llampart-backup-${TIMESTAMP}"
      run_priv mv "$release_dir" "$backup"
      run_priv mv "$tmp_release" "$release_dir"
      success "Replaced existing release directory. Backup: ${backup}"
    else
      validate_extracted_artifact "$release_dir"
      run_priv rm -rf "$tmp_release"
      success "Release directory already exists and is valid: ${release_dir}"
    fi
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
    if [[ "$ASSUME_YES" != "1" ]]; then
      warn "${CURRENT_SYMLINK} exists but is not a symlink. It will be moved to ${backup}."
      if ! confirm "$(tr_msg continue)" 1; then
        fatal "Cannot continue while ${CURRENT_SYMLINK} exists as a non-symlink."
      fi
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

smoke_test_ui() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    UI_SMOKE_OK=0
    return 0
  fi
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
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}/props" || true)"
  if [[ "$code" != "000" && -n "$code" ]]; then
    BACKEND_RESPONDED=1
    success "Backend responded on /props with HTTP ${code}."
    return 0
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}/v1/models" || true)"
  if [[ "$code" != "000" && -n "$code" ]]; then
    BACKEND_RESPONDED=1
    success "Backend responded on /v1/models with HTTP ${code}."
    return 0
  fi
  BACKEND_RESPONDED=0
  warn "llama-server did not respond on ${BACKEND_HOST}:${LLAMA_SERVER_PORT}. The Web UI can still be installed successfully."
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
  cat > "$tmp" <<EOF
{
  "schema_version": "1",
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
  "llama_server_host": "${BACKEND_HOST}",
  "llama_server_port": "${LLAMA_SERVER_PORT}",
  "artifact_url": "${ARTIFACT_URL}",
  "artifact_sha256": "${ARTIFACT_SHA256}",
  "installer_version": "${INSTALLER_VERSION}"
}
EOF
  run_priv install -m 644 "$tmp" "$MANIFEST_PATH"
  success "Manifest written to ${MANIFEST_PATH}"
}

update_manifest_config_only() {
  local current_version=""
  current_version="$(manifest_get version || true)"
  VERSION="${current_version:-unknown}"
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
  local active=""
  local enabled=""
  local lan=""
  active="$(caddy_active_status)"
  enabled="$(caddy_enabled_status)"
  lan="$(lan_urls || true)"

  case "$LANG_CODE" in
    pl)
      echo "────────────────────────────────────────────"
      green "✅ Instalacja llampart zakończona"; echo
      echo "────────────────────────────────────────────"
      echo
      echo "Wersja:"
      echo "  llampart ${VERSION}"
      echo
      echo "Otwórz llampart:"
      echo "  Lokalnie:"
      green "    http://localhost:${LLAMPART_PORT}/#/"; echo
      echo
      echo "  W sieci lokalnej:"
      if [[ -n "$lan" ]]; then printf '%s\n' "$lan" | sed 's/^/    /'; else echo "    Nie wykryto adresu IPv4 LAN."; fi
      echo
      echo "Caddy:"
      echo "  Status:"
      echo "    ${active}"
      echo
      echo "  Autostart:"
      echo "    ${enabled}"
      echo
      echo "Proxy backendu:"
      echo "  llama-server:"
      echo "    http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo
      echo "Zainstalowane pliki:"
      echo "  Web UI:"
      echo "    ${CURRENT_SYMLINK}"
      echo
      echo "  Konfiguracja Caddy:"
      echo "    ${LLAMPART_CADDY_CONFIG}"
      echo
      echo "Następny krok:"
      echo "  Uruchom llama-server, jeśli jeszcze nie działa."
      echo "  Następnie otwórz llampart w przeglądarce i wpisz API Key, jeśli jest wymagany."
      echo "────────────────────────────────────────────"
      ;;
    de)
      echo "────────────────────────────────────────────"
      green "✅ llampart-Installation abgeschlossen"; echo
      echo "────────────────────────────────────────────"
      echo "Version: llampart ${VERSION}"
      echo "Lokal: http://localhost:${LLAMPART_PORT}/#/"
      echo "LAN:"
      if [[ -n "$lan" ]]; then printf '%s\n' "$lan" | sed 's/^/  /'; else echo "  Keine LAN-IPv4-Adresse erkannt."; fi
      echo "Caddy: ${active}, Autostart: ${enabled}"
      echo "Backend-Proxy: http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo "────────────────────────────────────────────"
      ;;
    es)
      echo "────────────────────────────────────────────"
      green "✅ Instalación de llampart completada"; echo
      echo "────────────────────────────────────────────"
      echo "Versión: llampart ${VERSION}"
      echo "Local: http://localhost:${LLAMPART_PORT}/#/"
      echo "LAN:"
      if [[ -n "$lan" ]]; then printf '%s\n' "$lan" | sed 's/^/  /'; else echo "  No se detectó una dirección IPv4 LAN."; fi
      echo "Caddy: ${active}, autoinicio: ${enabled}"
      echo "Proxy backend: http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo "────────────────────────────────────────────"
      ;;
    fr)
      echo "────────────────────────────────────────────"
      green "✅ Installation de llampart terminée"; echo
      echo "────────────────────────────────────────────"
      echo "Version : llampart ${VERSION}"
      echo "Local : http://localhost:${LLAMPART_PORT}/#/"
      echo "LAN :"
      if [[ -n "$lan" ]]; then printf '%s\n' "$lan" | sed 's/^/  /'; else echo "  Aucune adresse IPv4 LAN détectée."; fi
      echo "Caddy : ${active}, démarrage automatique : ${enabled}"
      echo "Proxy backend : http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo "────────────────────────────────────────────"
      ;;
    it)
      echo "────────────────────────────────────────────"
      green "✅ Installazione di llampart completata"; echo
      echo "────────────────────────────────────────────"
      echo "Versione: llampart ${VERSION}"
      echo "Locale: http://localhost:${LLAMPART_PORT}/#/"
      echo "LAN:"
      if [[ -n "$lan" ]]; then printf '%s\n' "$lan" | sed 's/^/  /'; else echo "  Nessun indirizzo IPv4 LAN rilevato."; fi
      echo "Caddy: ${active}, avvio automatico: ${enabled}"
      echo "Proxy backend: http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo "────────────────────────────────────────────"
      ;;
    *)
      echo "────────────────────────────────────────────"
      green "✅ llampart installation completed"; echo
      echo "────────────────────────────────────────────"
      echo
      echo "Version:"
      echo "  llampart ${VERSION}"
      echo
      echo "Open llampart:"
      echo "  Local:"
      green "    http://localhost:${LLAMPART_PORT}/#/"; echo
      echo
      echo "  LAN:"
      if [[ -n "$lan" ]]; then printf '%s\n' "$lan" | sed 's/^/    /'; else echo "    No LAN IPv4 address detected."; fi
      echo
      echo "Caddy:"
      echo "  Status:"
      echo "    ${active}"
      echo
      echo "  Autostart:"
      echo "    ${enabled}"
      echo
      echo "Backend proxy:"
      echo "  llama-server:"
      echo "    http://${BACKEND_HOST}:${LLAMA_SERVER_PORT}"
      echo
      echo "Installed files:"
      echo "  Web UI:"
      echo "    ${CURRENT_SYMLINK}"
      echo
      echo "  Caddy config:"
      echo "    ${LLAMPART_CADDY_CONFIG}"
      echo
      echo "Next step:"
      echo "  Start llama-server if it is not running yet."
      echo "  Then open llampart in your browser and configure API Key if needed."
      echo "────────────────────────────────────────────"
      ;;
  esac

  if [[ "$BACKEND_RESPONDED" != "1" ]]; then
    warn "Backend did not respond during the warning-only check. Start llama-server, then refresh llampart."
  fi
  if [[ -n "$LOG_FILE" ]]; then
    dim "Log: ${LOG_FILE}"; echo
  fi
}

print_configure_summary() {
  success "llampart Caddy configuration updated."
  print_success_summary
}

print_uninstall_summary() {
  case "$LANG_CODE" in
    pl)
      echo "────────────────────────────────────────────"
      green "✅ Odinstalowanie llampart zakończone"; echo
      echo "────────────────────────────────────────────"
      echo "Caddy pozostał zainstalowany. Usunięto konfigurację llampart, aktywny symlink i manifest."
      [[ "$PURGE" == "1" ]] && echo "Usunięto również ${INSTALL_ROOT}."
      echo "────────────────────────────────────────────"
      ;;
    *)
      echo "────────────────────────────────────────────"
      green "✅ llampart uninstall completed"; echo
      echo "────────────────────────────────────────────"
      echo "Caddy remains installed. Removed llampart configuration, active symlink, and manifest."
      [[ "$PURGE" == "1" ]] && echo "Also removed ${INSTALL_ROOT}."
      echo "────────────────────────────────────────────"
      ;;
  esac
  if [[ -n "$LOG_FILE" ]]; then
    dim "Log: ${LOG_FILE}"; echo
  fi
}

cleanup_old_releases() {
  [[ "$CLEANUP_OLD_RELEASES" == "1" ]] || return 0
  [[ "$KEEP_RELEASES" =~ ^[0-9]+$ ]] || fatal "--keep-releases must be a number."
  (( KEEP_RELEASES >= 1 )) || fatal "--keep-releases must be at least 1."
  priv_test -d "$RELEASE_ROOT" || return 0

  info "Cleaning old releases; keeping ${KEEP_RELEASES} newest release directories."
  local current=""
  current="$(readlink -f "$CURRENT_SYMLINK" 2>/dev/null || true)"
  local list_file="${WORK_DIR}/release-list.txt"
  "${SUDO[@]}" find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'v*' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn > "$list_file"
  local index=0
  local path=""
  while IFS=' ' read -r _ path; do
    index=$((index + 1))
    if (( index <= KEEP_RELEASES )); then
      continue
    fi
    if [[ -n "$current" && "$(readlink -f "$path" 2>/dev/null || true)" == "$current" ]]; then
      continue
    fi
    run_priv rm -rf "$path"
    success "Removed old release: $path"
  done < "$list_file"
}

perform_install_like() {
  if [[ "$MODE" == "update" ]]; then
    local installed_version=""
    installed_version="$(manifest_get version || true)"
    resolve_version
    if [[ -n "$installed_version" && "$installed_version" == "$VERSION" && -z "$VERSION_OVERRIDE" ]]; then
      success "llampart is already at latest version: ${VERSION}"
      if [[ "$ASSUME_YES" == "1" ]]; then
        exit 0
      fi
      echo "1) Reinstall ${VERSION}"
      echo "2) Change Caddy/port configuration"
      echo "3) Exit"
      local choice=""
      while true; do
        printf "> "
        read_interactive choice
        case "$choice" in
          1) MODE="reinstall"; break ;;
          2) MODE="configure"; perform_configure; return 0 ;;
          3) exit 0 ;;
          *) echo "1-3" ;;
        esac
      done
    fi
  else
    if [[ "$MODE" == "reinstall" && -z "$VERSION_OVERRIDE" ]]; then
      local current_version=""
      current_version="$(manifest_get version || true)"
      if [[ -n "$current_version" ]]; then
        VERSION="$(normalize_version "$current_version")"
      else
        resolve_version
      fi
    else
      resolve_version
    fi
  fi

  load_default_ports_from_manifest
  artifact_names
  print_plan
  if [[ "$DRY_RUN" == "1" ]]; then
    exit 0
  fi
  confirm_plan_or_exit

  install_caddy_if_needed
  download_artifact
  deploy_release
  write_and_validate_caddy_config
  switch_current_symlink
  enable_reload_caddy

  if ! smoke_test_ui; then
    if [[ "$MODE" == "update" || "$MODE" == "reinstall" ]]; then
      rollback_symlink
      fatal "Web UI smoke test failed after ${MODE}; rollback attempted."
    fi
    fatal "Web UI smoke test failed after install. Caddy was not confirmed healthy for llampart."
  fi

  check_backend_warning_only
  write_manifest
  cleanup_old_releases
  print_success_summary
}

perform_configure() {
  VERSION="$(manifest_get version || true)"
  VERSION="${VERSION:-current}"
  load_default_ports_from_manifest
  print_plan
  if [[ "$DRY_RUN" == "1" ]]; then
    exit 0
  fi
  confirm_plan_or_exit
  init_work_dir
  install_caddy_if_needed
  write_and_validate_caddy_config
  enable_reload_caddy
  smoke_test_ui || fatal "Web UI smoke test failed after configure."
  check_backend_warning_only
  update_manifest_config_only
  print_configure_summary
}

remove_llampart_caddy_config() {
  if [[ "$SKIP_CADDY_CONFIG" == "1" ]]; then
    return 0
  fi
  if ! caddy_installed; then
    warn "Caddy binary not found; removing llampart files without Caddy reload."
    return 0
  fi
  validate_caddy_service_shape
  validate_existing_caddy_config
  backup_file_if_exists "$LLAMPART_CADDY_CONFIG" LLAMPART_CONFIG_BACKUP
  if priv_test -f "$LLAMPART_CADDY_CONFIG"; then
    run_priv rm -f "$LLAMPART_CADDY_CONFIG"
    info "Removed ${LLAMPART_CADDY_CONFIG}"
  fi
  if priv_test -f "$CADDYFILE"; then
    if ! "${SUDO[@]}" caddy validate --config "$CADDYFILE"; then
      restore_caddy_backups
      fatal "Caddy validation failed after removing llampart config. Restored previous configuration."
    fi
    reload_caddy_without_enabling
  fi
}

perform_uninstall() {
  print_plan
  if [[ "$DRY_RUN" == "1" ]]; then
    exit 0
  fi
  confirm_plan_or_exit

  remove_llampart_caddy_config

  if priv_test -L "$CURRENT_SYMLINK"; then
    run_priv rm -f "$CURRENT_SYMLINK"
    info "Removed ${CURRENT_SYMLINK}"
  elif priv_test -e "$CURRENT_SYMLINK"; then
    warn "${CURRENT_SYMLINK} exists but is not a symlink; leaving it untouched."
  fi

  if priv_test -f "$MANIFEST_PATH"; then
    run_priv rm -f "$MANIFEST_PATH"
    info "Removed ${MANIFEST_PATH}"
  fi
  if priv_test -d "$MANIFEST_DIR"; then
    run_priv rmdir "$MANIFEST_DIR" 2>/dev/null || true
  fi

  if [[ "$PURGE" == "1" ]]; then
    if priv_test -d "$INSTALL_ROOT"; then
      run_priv rm -rf "$INSTALL_ROOT"
      info "Purged ${INSTALL_ROOT}"
    fi
  fi

  print_uninstall_summary
}

main() {
  parse_args "$@"
  init_colors
  choose_language
  init_logging
  preflight_basic
  preflight_distro
  ensure_sudo
  determine_mode

  case "$MODE" in
    install|update|reinstall)
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
