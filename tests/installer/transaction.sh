#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="${REPO_ROOT}/install.sh"
HARNESS_ROOT="$(mktemp -d -t llampart-installer-tests-XXXXXXXX)"
REAL_TAR="$(command -v tar)"

cleanup_harness() {
  if [[ "${KEEP_HARNESS:-0}" == "1" ]]; then
    printf 'Kept harness root: %s\n' "$HARNESS_ROOT" >&2
    return 0
  fi
  rm -rf "$HARNESS_ROOT"
}
trap cleanup_harness EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

write_mock_commands() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"

  cat > "${bin_dir}/caddy" <<'EOF_CADDY'
#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "validate" ]] || exit 0
count_file="${MOCK_STATE_DIR}/caddy-validate-count"
count=0
[[ ! -f "$count_file" ]] || count="$(<"$count_file")"
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"
if [[ "${MOCK_FAILURE:-}" == "validation" && "$count" == "2" ]]; then
  exit 1
fi
EOF_CADDY

  cat > "${bin_dir}/systemctl" <<'EOF_SYSTEMCTL'
#!/usr/bin/env bash
set -euo pipefail

command="${1:-}"
case "$command" in
  cat)
    exit 0
    ;;
  is-active)
    [[ "${2:-}" == "--quiet" ]] && shift
    if [[ "$(<"${MOCK_STATE_DIR}/caddy-active")" == "1" ]]; then
      [[ "${2:-${1:-}}" == "caddy" ]] && printf 'active\n'
      exit 0
    fi
    [[ "${2:-${1:-}}" == "caddy" ]] && printf 'inactive\n'
    exit 3
    ;;
  is-enabled)
    [[ "${2:-}" == "--quiet" ]] && shift
    if [[ "$(<"${MOCK_STATE_DIR}/caddy-enabled")" == "1" ]]; then
      [[ "${2:-${1:-}}" == "caddy" ]] && printf 'enabled\n'
      exit 0
    fi
    [[ "${2:-${1:-}}" == "caddy" ]] && printf 'disabled\n'
    exit 1
    ;;
  enable)
    printf '1\n' > "${MOCK_STATE_DIR}/caddy-enabled"
    if [[ " $* " == *" --now "* ]]; then
      printf '1\n' > "${MOCK_STATE_DIR}/caddy-active"
    fi
    ;;
  disable)
    printf '0\n' > "${MOCK_STATE_DIR}/caddy-enabled"
    ;;
  stop)
    printf '0\n' > "${MOCK_STATE_DIR}/caddy-active"
    ;;
  start)
    printf '1\n' > "${MOCK_STATE_DIR}/caddy-active"
    ;;
  reload|restart)
    count_file="${MOCK_STATE_DIR}/systemctl-${command}-count"
    count=0
    [[ ! -f "$count_file" ]] || count="$(<"$count_file")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$count_file"
    if [[ "${MOCK_FAILURE:-}" == "reload" && "$count" == "1" ]]; then
      exit 1
    fi
    printf '1\n' > "${MOCK_STATE_DIR}/caddy-active"
    ;;
esac
EOF_SYSTEMCTL

  cat > "${bin_dir}/curl" <<'EOF_CURL'
#!/usr/bin/env bash
set -euo pipefail

output=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -w|--retry|--retry-delay)
      shift 2
      ;;
    -* )
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

case "$url" in
  *.tar.xz)
    [[ "${MOCK_FAILURE:-}" != "download" ]] || exit 22
    cp "$MOCK_ARTIFACT" "$output"
    ;;
  *.sha256)
    cp "$MOCK_CHECKSUM" "$output"
    ;;
  http://127.0.0.1:*/)
    if [[ "${MOCK_FAILURE:-}" == "smoke" ]]; then
      printf '503'
    else
      printf '200'
    fi
    ;;
  *)
    printf '000'
    ;;
esac
EOF_CURL

  cat > "${bin_dir}/chown" <<'EOF_CHOWN'
#!/usr/bin/env bash
if [[ "${MOCK_OWNER_MISMATCH:-0}" == "1" && "${*: -1}" == *"/tmp/release-"* ]]; then
  : > "${MOCK_STATE_DIR}/staged-root-ownership"
fi
exit 0
EOF_CHOWN

  cat > "${bin_dir}/tar" <<'EOF_TAR'
#!/usr/bin/env bash
set -euo pipefail

root=""
create_stdout=0
for ((index = 1; index <= $#; index++)); do
  argument="${!index}"
  if [[ "$argument" == "-C" ]]; then
    next_index=$((index + 1))
    root="${!next_index}"
  elif [[ "$argument" == "-cf" ]]; then
    next_index=$((index + 1))
    [[ "${!next_index}" != "-" ]] || create_stdout=1
  fi
done

if [[ "${MOCK_OWNER_MISMATCH:-0}" == "1" && "$create_stdout" == "1" && "$root" == */releases/v1.8.0 ]]; then
  "$REAL_TAR" "$@"
  printf 'mock-owner=65534:65534\n'
  exit 0
fi

exec "$REAL_TAR" "$@"
EOF_TAR

  cat > "${bin_dir}/ss" <<'EOF_SS'
#!/usr/bin/env bash
exit 0
EOF_SS

  cat > "${bin_dir}/mock-sudo" <<'EOF_SUDO'
#!/usr/bin/env bash
set -uo pipefail

sealed=0
if [[ -f "${MOCK_STATE_DIR}/caddy-sealed" ]]; then
  sealed=1
  chmod 700 "$MOCK_PRIV_DIR"
fi

if [[ "${1:-}" == "test" && "$*" == *".llampart-backup-"* ]]; then
  printf 'privileged backup test\n' >> "${MOCK_STATE_DIR}/privileged-backup-tests"
fi

"$@"
status=$?

if [[ "${MOCK_SEAL_CADDY_AFTER_BACKUP:-0}" == "1" && "${1:-}" == "cp" && "${3:-}" == "${MOCK_PRIV_DIR}/Caddyfile" ]]; then
  : > "${MOCK_STATE_DIR}/caddy-sealed"
  sealed=1
fi
if [[ "$sealed" == "1" ]]; then
  chmod 000 "$MOCK_PRIV_DIR"
fi
exit "$status"
EOF_SUDO

  chmod +x "${bin_dir}/caddy" "${bin_dir}/systemctl" "${bin_dir}/curl" "${bin_dir}/chown" "${bin_dir}/tar" "${bin_dir}/ss" "${bin_dir}/mock-sudo"
}

create_artifact() {
  local case_dir="$1"
  local content="${2:-new release}"
  local include_fallback="${3:-1}"
  local artifact_root="${case_dir}/artifact/llampart-webui-v1.8.0"
  mkdir -p "${artifact_root}/_app"
  printf '%s\n' "$content" > "${artifact_root}/index.html"
  if [[ "$include_fallback" == "1" ]]; then
    printf 'fallback\n' > "${artifact_root}/200.html"
  fi
  printf 'asset\n' > "${artifact_root}/_app/app.js"
  tar -cJf "${case_dir}/artifact.tar.xz" -C "${case_dir}/artifact" "llampart-webui-v1.8.0"
  sha256sum "${case_dir}/artifact.tar.xz" > "${case_dir}/artifact.sha256"
}

write_manifest() {
  local root="$1"
  local version="$2"
  local digest="$3"
  mkdir -p "${root}/var/lib/llampart"
  cat > "${root}/var/lib/llampart/install-manifest.json" <<EOF_MANIFEST
{
  "schema_version": "2",
  "app": "llampart",
  "version": "${version}",
  "installed_at": "2026-01-01T00:00:00+00:00",
  "updated_at": "2026-01-01T00:00:00+00:00",
  "install_root": "${root}/opt/llampart",
  "release_root": "${root}/opt/llampart/releases",
  "current_symlink": "${root}/srv/llampart/current",
  "current_target": "${root}/opt/llampart/releases/${version}",
  "caddy_config": "${root}/etc/caddy/conf.d/llampart.caddy",
  "caddyfile": "${root}/etc/caddy/Caddyfile",
  "llampart_port": "8100",
  "backend_host": "127.0.0.1",
  "backend_port": "8080",
  "artifact_url": "fixture://${version}",
  "artifact_sha256": "${digest}",
  "installer_version": "0.2.2"
}
EOF_MANIFEST
}

setup_case() {
  local case_dir="$1"
  local mode="$2"
  local installed_version="${3:-v1.7.0}"
  local installed_digest="${4:-old-digest}"
  local root="${case_dir}/root"

  mkdir -p "${root}/etc/caddy/conf.d" "${case_dir}/state" "${case_dir}/tmp"
  printf 'import %s/etc/caddy/conf.d/*.caddy\n' "$root" > "${root}/etc/caddy/Caddyfile"
  printf '1\n' > "${case_dir}/state/caddy-active"
  printf '1\n' > "${case_dir}/state/caddy-enabled"
  create_artifact "$case_dir"
  write_mock_commands "${case_dir}/bin"

  if [[ "$mode" != "install" ]]; then
    mkdir -p "${root}/opt/llampart/releases/${installed_version}/_app" "${root}/srv/llampart"
    printf 'old release\n' > "${root}/opt/llampart/releases/${installed_version}/index.html"
    printf 'old asset\n' > "${root}/opt/llampart/releases/${installed_version}/_app/app.js"
    ln -s "${root}/opt/llampart/releases/${installed_version}" "${root}/srv/llampart/current"
    cat > "${root}/etc/caddy/conf.d/llampart.caddy" <<EOF_CONFIG
:8100 {
    root * ${root}/srv/llampart/current
    @llampart_api path /props /models /models/* /slots /slots/* /cors-proxy /tools /tools/* /v1/*
    reverse_proxy @llampart_api 127.0.0.1:8080
    file_server
}
EOF_CONFIG
    write_manifest "$root" "$installed_version" "$installed_digest"
  fi
}

run_installer_case() (
  local case_dir="$1"
  local mode="$2"
  local failure="${3:-}"
  local root="${case_dir}/root"

  export PATH="${case_dir}/bin:${PATH}"
  export TMPDIR="${case_dir}/tmp"
  export MOCK_STATE_DIR="${case_dir}/state"
  export MOCK_ARTIFACT="${case_dir}/artifact.tar.xz"
  export MOCK_CHECKSUM="${case_dir}/artifact.sha256"
  export MOCK_FAILURE="$failure"
  export MOCK_PRIV_DIR="${root}/etc/caddy"
  export REAL_TAR

  # Load function definitions without invoking the public main entry point.
  source <(sed '$d' "$INSTALLER")

  SUDO=()
  if [[ "${MOCK_USE_PRIV_RUNNER:-0}" == "1" ]]; then
    SUDO=("${case_dir}/bin/mock-sudo")
    ensure_sudo() { :; }
  fi
  INSTALL_ROOT="${root}/opt/llampart"
  RELEASE_ROOT="${INSTALL_ROOT}/releases"
  TMP_ROOT="${INSTALL_ROOT}/tmp"
  WEB_ROOT="${root}/srv/llampart"
  CURRENT_SYMLINK="${WEB_ROOT}/current"
  MANIFEST_DIR="${root}/var/lib/llampart"
  MANIFEST_PATH="${MANIFEST_DIR}/install-manifest.json"
  CADDY_DIR="${root}/etc/caddy"
  CADDYFILE="${CADDY_DIR}/Caddyfile"
  CADDY_CONF_DIR="${CADDY_DIR}/conf.d"
  LLAMPART_CADDY_CONFIG="${CADDY_CONF_DIR}/llampart.caddy"
  CADDY_IMPORT_LINE="import ${CADDY_CONF_DIR}/*.caddy"
  MODE="$mode"
  LLAMPART_PORT="${LLAMPART_PORT:-8100}"
  BACKEND_HOST="127.0.0.1"
  BACKEND_PORT="8080"
  LLAMPART_PORT_FROM_ARG=1
  BACKEND_HOST_FROM_ARG=1
  BACKEND_PORT_FROM_ARG=1
  TIMESTAMP="20260812-120000"
  WORK_DIR="${case_dir}/work"
  mkdir -p "$WORK_DIR"

  resolve_version() { VERSION="v1.8.0"; }
  confirm_plan_or_exit() { :; }
  confirm() { return 0; }
  lan_urls() { :; }

  case "$mode" in
    install|update) perform_install_like ;;
    configure) perform_configure ;;
    *) fail "unknown test mode: $mode" ;;
  esac
)

assert_tree_unchanged() {
  local before="$1"
  local after="$2"
  if ! diff -ruN "$before" "$after"; then
    fail "filesystem was not fully restored"
  fi
}

run_failure_scenario() {
  local mode="$1"
  local failure="$2"
  local case_dir="${HARNESS_ROOT}/${mode}-${failure}"
  mkdir -p "$case_dir"
  setup_case "$case_dir" "$mode"
  cp -a "${case_dir}/root" "${case_dir}/before"

  run_installer_case "$case_dir" "$mode" "$failure" >"${case_dir}/output.log" 2>&1 &
  local installer_pid=$!
  if wait "$installer_pid"; then
    fail "${mode}/${failure} unexpectedly succeeded"
  fi
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  pass "${mode}/${failure} restores the complete filesystem snapshot"
}

run_same_digest_scenario() {
  local case_dir="${HARNESS_ROOT}/same-version-same-digest"
  mkdir -p "$case_dir"
  setup_case "$case_dir" update v1.8.0 pending-digest
  local digest
  digest="$(sha256sum "${case_dir}/artifact.tar.xz" | awk '{print $1}')"
  write_manifest "${case_dir}/root" v1.8.0 "$digest"
  local release_dir="${case_dir}/root/opt/llampart/releases/v1.8.0"
  rm -rf "$release_dir"
  mkdir -p "$release_dir"
  tar -xJf "${case_dir}/artifact.tar.xz" --strip-components=1 -C "$release_dir"
  find "$release_dir" -type d -exec chmod 755 {} \;
  find "$release_dir" -type f -exec chmod 644 {} \;
  local inode_before
  inode_before="$(stat -c %i "$release_dir")"

  run_installer_case "$case_dir" update >"${case_dir}/output.log" 2>&1 || fail "same-version same-digest update failed"
  [[ "$(stat -c %i "$release_dir")" == "$inode_before" ]] ||
    fail "matching same-version release was replaced"
  pass "matching same-version release is idempotent"
}

run_corrupt_same_digest_repair_scenario() {
  local case_dir="${HARNESS_ROOT}/same-version-corrupt-repair"
  mkdir -p "$case_dir"
  setup_case "$case_dir" update v1.8.0 pending-digest
  local digest
  digest="$(sha256sum "${case_dir}/artifact.tar.xz" | awk '{print $1}')"
  write_manifest "${case_dir}/root" v1.8.0 "$digest"

  run_installer_case "$case_dir" update >"${case_dir}/output.log" 2>&1 || fail "corrupt same-version repair failed"
  [[ "$(<"${case_dir}/root/opt/llampart/releases/v1.8.0/index.html")" == "new release" ]] ||
    fail "corrupt same-version release was not repaired"
  [[ -f "${case_dir}/root/opt/llampart/releases/v1.8.0/200.html" ]] ||
    fail "repaired release does not match staged artifact"
  [[ ! -e "${case_dir}/root/opt/llampart/tmp/replaced-v1.8.0-20260812-120000" ]] ||
    fail "release transaction backup remained after repair"
  pass "corrupt same-version release is repaired from the verified artifact"
}

run_corrupt_same_digest_rollback_scenario() {
  local case_dir="${HARNESS_ROOT}/same-version-corrupt-rollback"
  local release_dir="${case_dir}/root/opt/llampart/releases/v1.8.0"
  mkdir -p "$case_dir"
  setup_case "$case_dir" update v1.8.0 pending-digest
  local digest
  digest="$(sha256sum "${case_dir}/artifact.tar.xz" | awk '{print $1}')"
  write_manifest "${case_dir}/root" v1.8.0 "$digest"
  printf 'extra corrupt content\n' > "${release_dir}/unexpected.txt"
  chmod 711 "$release_dir"
  chmod 600 "${release_dir}/index.html"
  cp -a "${case_dir}/root" "${case_dir}/before"

  if run_installer_case "$case_dir" update smoke >"${case_dir}/output.log" 2>&1; then
    fail "corrupt same-version rollback scenario unexpectedly succeeded"
  fi
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  [[ "$(stat -c %a "$release_dir")" == "711" ]] || fail "restored corrupt release directory mode changed"
  [[ "$(stat -c %a "${release_dir}/index.html")" == "600" ]] || fail "restored corrupt release file mode changed"
  [[ ! -e "${case_dir}/root/opt/llampart/tmp/replaced-v1.8.0-20260812-120000" ]] ||
    fail "release transaction backup remained after rollback"
  pass "later failure restores the exact corrupt same-version release"
}

run_owner_mismatch_repair_scenario() {
  local case_dir="${HARNESS_ROOT}/same-version-owner-repair"
  mkdir -p "$case_dir"
  setup_case "$case_dir" update v1.8.0 pending-digest
  local digest
  digest="$(sha256sum "${case_dir}/artifact.tar.xz" | awk '{print $1}')"
  write_manifest "${case_dir}/root" v1.8.0 "$digest"
  local release_dir="${case_dir}/root/opt/llampart/releases/v1.8.0"
  rm -rf "$release_dir"
  mkdir -p "$release_dir"
  "$REAL_TAR" -xJf "${case_dir}/artifact.tar.xz" --strip-components=1 -C "$release_dir"
  find "$release_dir" -type d -exec chmod 755 {} \;
  find "$release_dir" -type f -exec chmod 644 {} \;
  local inode_before
  inode_before="$(stat -c %i "$release_dir")"

  MOCK_OWNER_MISMATCH=1 run_installer_case "$case_dir" update >"${case_dir}/output.log" 2>&1 ||
    fail "same-version owner repair failed"
  [[ "$(stat -c %i "$release_dir")" != "$inode_before" ]] ||
    fail "release with mismatched ownership was kept"
  [[ -f "${case_dir}/state/staged-root-ownership" ]] ||
    fail "replacement release was not staged with root ownership"
  pass "same-version release with mismatched ownership is repaired"
}

run_owner_mismatch_rollback_scenario() {
  local case_dir="${HARNESS_ROOT}/same-version-owner-rollback"
  mkdir -p "$case_dir"
  setup_case "$case_dir" update v1.8.0 pending-digest
  local digest
  digest="$(sha256sum "${case_dir}/artifact.tar.xz" | awk '{print $1}')"
  write_manifest "${case_dir}/root" v1.8.0 "$digest"
  local release_dir="${case_dir}/root/opt/llampart/releases/v1.8.0"
  rm -rf "$release_dir"
  mkdir -p "$release_dir"
  "$REAL_TAR" -xJf "${case_dir}/artifact.tar.xz" --strip-components=1 -C "$release_dir"
  find "$release_dir" -type d -exec chmod 755 {} \;
  find "$release_dir" -type f -exec chmod 644 {} \;
  local inode_before
  inode_before="$(stat -c %i "$release_dir")"
  cp -a "${case_dir}/root" "${case_dir}/before"

  if MOCK_OWNER_MISMATCH=1 run_installer_case "$case_dir" update smoke >"${case_dir}/output.log" 2>&1; then
    fail "owner mismatch rollback scenario unexpectedly succeeded"
  fi
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  [[ "$(stat -c %i "$release_dir")" == "$inode_before" ]] ||
    fail "rollback did not restore the ownership-mismatched release"
  pass "later failure restores the ownership-mismatched release"
}

run_different_digest_scenario() {
  local case_dir="${HARNESS_ROOT}/same-version-different-digest"
  mkdir -p "$case_dir"
  setup_case "$case_dir" update v1.8.0 different-digest
  cp -a "${case_dir}/root" "${case_dir}/before"

  run_installer_case "$case_dir" update >"${case_dir}/output.log" 2>&1 &
  local installer_pid=$!
  if wait "$installer_pid"; then
    fail "same-version different-digest update unexpectedly succeeded"
  fi
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  pass "same-version different-digest update is safely rejected"
}

run_missing_fallback_scenario() {
  local case_dir="${HARNESS_ROOT}/missing-200-html"
  mkdir -p "$case_dir"
  setup_case "$case_dir" install
  rm -rf "${case_dir}/artifact" "${case_dir}/artifact.tar.xz" "${case_dir}/artifact.sha256"
  create_artifact "$case_dir" "invalid release" 0

  if run_installer_case "$case_dir" install >"${case_dir}/output.log" 2>&1; then
    fail "artifact without 200.html unexpectedly succeeded"
  fi
  [[ ! -e "${case_dir}/root/opt/llampart/releases/v1.8.0" ]] ||
    fail "artifact without 200.html was deployed"
  pass "artifact without 200.html is rejected"
}

run_unknown_port_scenario() {
  local case_dir="${HARNESS_ROOT}/unknown-port-state"
  mkdir -p "$case_dir"
  setup_case "$case_dir" install
  cat > "${case_dir}/bin/ss" <<'EOF_SS'
#!/usr/bin/env bash
exit 1
EOF_SS
  chmod +x "${case_dir}/bin/ss"

  if run_installer_case "$case_dir" install >"${case_dir}/output.log" 2>&1; then
    fail "failed ss check unexpectedly succeeded"
  fi
  [[ ! -e "${case_dir}/root/opt/llampart/releases/v1.8.0" ]] ||
    fail "installer made deployment changes after failed ss check"
  pass "unknown port state blocks installation before deployment"
}

assert_caddy_state() {
  local case_dir="$1"
  local expected_enabled="$2"
  local expected_active="$3"
  [[ "$(<"${case_dir}/state/caddy-enabled")" == "$expected_enabled" ]] ||
    fail "Caddy enabled state was not restored"
  [[ "$(<"${case_dir}/state/caddy-active")" == "$expected_active" ]] ||
    fail "Caddy active state was not restored"
}

run_disabled_caddy_failure_scenario() {
  local failure="$1"
  local case_dir="${HARNESS_ROOT}/disabled-caddy-${failure}"
  mkdir -p "$case_dir"
  setup_case "$case_dir" install
  printf '0\n' > "${case_dir}/state/caddy-enabled"
  printf '0\n' > "${case_dir}/state/caddy-active"
  cp -a "${case_dir}/root" "${case_dir}/before"

  if run_installer_case "$case_dir" install "$failure" >"${case_dir}/output.log" 2>&1; then
    fail "disabled Caddy/${failure} unexpectedly succeeded"
  fi
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  assert_caddy_state "$case_dir" 0 0
  pass "disabled/inactive Caddy is restored after ${failure} failure"
}

create_current_directory() {
  local case_dir="$1"
  local current="${case_dir}/root/srv/llampart/current"
  mkdir -p "${current}/nested"
  printf 'user content\n' > "${current}/nested/file.txt"
  chmod 750 "$current"
  chmod 640 "${current}/nested/file.txt"
}

run_current_directory_failure_scenario() {
  local case_dir="${HARNESS_ROOT}/current-directory-failure"
  mkdir -p "$case_dir"
  setup_case "$case_dir" install
  create_current_directory "$case_dir"
  cp -a "${case_dir}/root" "${case_dir}/before"

  if run_installer_case "$case_dir" install smoke >"${case_dir}/output.log" 2>&1; then
    fail "current directory failure scenario unexpectedly succeeded"
  fi
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  [[ "$(stat -c %a "${case_dir}/root/srv/llampart/current")" == "750" ]] ||
    fail "restored current directory mode changed"
  [[ ! -e "${case_dir}/root/srv/llampart/current.llampart-backup-20260812-120000" ]] ||
    fail "transaction backup remained after rollback"
  pass "failed transaction restores a non-symlink current directory exactly"
}

run_current_directory_success_scenario() {
  local case_dir="${HARNESS_ROOT}/current-directory-success"
  local current="${case_dir}/root/srv/llampart/current"
  local backup="${current}.llampart-backup-20260812-120000"
  local user_backup="${current}.user-owned-backup"
  mkdir -p "$case_dir"
  setup_case "$case_dir" install
  create_current_directory "$case_dir"
  mkdir -p "$user_backup"
  printf 'keep me\n' > "${user_backup}/content.txt"

  run_installer_case "$case_dir" install >"${case_dir}/output.log" 2>&1 ||
    fail "current directory success scenario failed"
  [[ -L "$current" ]] || fail "current was not replaced with a symlink"
  [[ -d "$backup" ]] || fail "announced current directory backup was removed"
  [[ "$(<"${backup}/nested/file.txt")" == "user content" ]] || fail "current directory backup content changed"
  [[ "$(stat -c %a "$backup")" == "750" ]] || fail "current directory backup mode changed"
  [[ "$(<"${user_backup}/content.txt")" == "keep me" ]] || fail "user-owned backup was removed"
  pass "successful transaction preserves non-symlink current and user-owned backups"
}

run_privileged_backup_permission_scenario() {
  local case_dir="${HARNESS_ROOT}/privileged-backup-permissions"
  local caddy_dir="${case_dir}/root/etc/caddy"
  mkdir -p "$case_dir"
  setup_case "$case_dir" configure
  printf '# original restricted Caddyfile\n' > "${caddy_dir}/Caddyfile"
  cp -a "${case_dir}/root" "${case_dir}/before"

  if MOCK_USE_PRIV_RUNNER=1 MOCK_SEAL_CADDY_AFTER_BACKUP=1 run_installer_case "$case_dir" configure validation >"${case_dir}/output.log" 2>&1; then
    fail "privileged backup permission scenario unexpectedly succeeded"
  fi
  if [[ "$(id -u)" != "0" && -e "${caddy_dir}/Caddyfile" ]]; then
    chmod 700 "$caddy_dir"
    fail "unprivileged Caddy existence check did not model a permission failure"
  fi
  chmod 755 "$caddy_dir"
  assert_tree_unchanged "${case_dir}/before" "${case_dir}/root"
  [[ -s "${case_dir}/state/privileged-backup-tests" ]] ||
    fail "rollback did not test restricted Caddy backups through the privileged helper"
  [[ ! -e "${caddy_dir}/Caddyfile.llampart-backup-20260812-120000" ]] ||
    fail "restricted Caddy backup remained after rollback"
  pass "rollback restores and cleans Caddy backups through privileged checks"
}

for mode in install update configure; do
  for failure in validation reload smoke; do
    run_failure_scenario "$mode" "$failure"
  done
done

run_same_digest_scenario
run_corrupt_same_digest_repair_scenario
run_corrupt_same_digest_rollback_scenario
run_owner_mismatch_repair_scenario
run_owner_mismatch_rollback_scenario
run_different_digest_scenario
run_missing_fallback_scenario
run_unknown_port_scenario
run_disabled_caddy_failure_scenario download
run_disabled_caddy_failure_scenario validation
run_current_directory_failure_scenario
run_current_directory_success_scenario
run_privileged_backup_permission_scenario

printf 'All installer transaction tests passed.\n'
