#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGER="${REPO_ROOT}/server/webui/scripts/package-release-llampart.sh"
DIGEST_TOOL="${REPO_ROOT}/server/webui/scripts/static-artifact-digest.mjs"
HARNESS_ROOT="$(mktemp -d -t llampart-provenance-tests-XXXXXXXX)"
OUTPUT_ROOT="$(mktemp -d -t llampart-provenance-output-XXXXXXXX)"

cleanup() {
  rm -rf "$HARNESS_ROOT" "$OUTPUT_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

write_provenance() {
  local version="$1"
  local commit="$2"
  local dirty="$3"
  local artifact_digest="${4:-$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")}"
  cat > "${HARNESS_ROOT}/server/public/.llampart-build.json" <<EOF_PROVENANCE
{
  "appVersion": "${version}",
  "gitCommit": "${commit}",
  "dirty": ${dirty},
  "builtAt": "2026-08-12T00:00:00.000Z",
  "normalizerVersion": 1,
  "artifactDigest": "${artifact_digest}"
}
EOF_PROVENANCE
}

assert_rejected() {
  local label="$1"
  local expected="${2:-}"
  if bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --dry-run --yes >"${OUTPUT_ROOT}/output.log" 2>&1; then
    fail "${label} provenance was accepted"
  fi
  if [[ -n "$expected" ]]; then
    grep -F "$expected" "${OUTPUT_ROOT}/output.log" >/dev/null || fail "${label} failed for the wrong reason"
  fi
  printf 'PASS rejected: %s\n' "$label"
}

# Clone committed data only, never the caller's private worktree. No fixture commit.
git clone --quiet --no-hardlinks "$REPO_ROOT" "$HARNESS_ROOT"
APP_VERSION="$(node -p "require('${HARNESS_ROOT}/server/webui/package.json').version")"
RELEASE_ROOT="llampart-webui-v${APP_VERSION}"
mkdir -p "${HARNESS_ROOT}/server/public/_app"
printf 'index\n' > "${HARNESS_ROOT}/server/public/index.html"
printf 'fallback\n' > "${HARNESS_ROOT}/server/public/200.html"
printf 'asset\n' > "${HARNESS_ROOT}/server/public/_app/app.js"
printf '#!/usr/bin/env sh\n' > "${HARNESS_ROOT}/server/public/_app/worker.sh"
chmod 755 "${HARNESS_ROOT}/server/public/_app/worker.sh"
head_commit="$(git -C "$HARNESS_ROOT" rev-parse HEAD)"

write_provenance "$APP_VERSION" "$head_commit" false
bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --dry-run --yes >/dev/null || fail "matching provenance was rejected"
bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --output-dir "$OUTPUT_ROOT" --yes >/dev/null ||
  fail "matching provenance could not be packaged"
mkdir -p "${OUTPUT_ROOT}/extracted"
tar -xJf "${OUTPUT_ROOT}/${RELEASE_ROOT}.tar.xz" -C "${OUTPUT_ROOT}/extracted"
[[ "$(stat -c %a "${OUTPUT_ROOT}/extracted/${RELEASE_ROOT}/_app/worker.sh")" == "755" ]] ||
  fail "packager did not preserve artifact modes"
cmp -s "${HARNESS_ROOT}/server/public/.llampart-build.json" "${OUTPUT_ROOT}/extracted/${RELEASE_ROOT}/.llampart-build.json" ||
  fail 'packager changed the build provenance marker'
[[ "$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")" == "$(node -p "require('${HARNESS_ROOT}/server/public/.llampart-build.json').artifactDigest")" ]] ||
  fail 'static build digest changed'
[[ "$(node "$DIGEST_TOOL" "${OUTPUT_ROOT}/extracted/${RELEASE_ROOT}")" != "$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")" ]] ||
  fail 'distribution documents were not distinguished from the static build'

for name in LICENSE NOTICE THIRD_PARTY_LICENSES.md; do
  cmp -s "${HARNESS_ROOT}/$name" "${OUTPUT_ROOT}/extracted/${RELEASE_ROOT}/$name" || fail "incorrect packaged notice: $name"
done
(cd "$OUTPUT_ROOT" && sha256sum -c "${RELEASE_ROOT}.sha256") || fail 'archive checksum mismatch'
mkdir "${OUTPUT_ROOT}/repeat"
sleep 2
bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --output-dir "${OUTPUT_ROOT}/repeat" --yes >/dev/null ||
  fail 'repeat packaging failed'
cmp -s "${OUTPUT_ROOT}/${RELEASE_ROOT}.tar.xz" "${OUTPUT_ROOT}/repeat/${RELEASE_ROOT}.tar.xz" ||
  fail 'repeat packaging changed archive bytes'
cmp -s "${OUTPUT_ROOT}/${RELEASE_ROOT}.sha256" "${OUTPUT_ROOT}/repeat/${RELEASE_ROOT}.sha256" ||
  fail 'repeat packaging changed checksum bytes'
printf 'PASS: repeat packaging is byte-identical\n'
find "${OUTPUT_ROOT}/extracted/${RELEASE_ROOT}" -type f -printf '%P\n' | sort >"${OUTPUT_ROOT}/actual-files"
printf '%s\n' .llampart-build.json 200.html LICENSE NOTICE THIRD_PARTY_LICENSES.md _app/app.js _app/worker.sh index.html | sort >"${OUTPUT_ROOT}/expected-files"
cmp -s "${OUTPUT_ROOT}/actual-files" "${OUTPUT_ROOT}/expected-files" || fail 'unexpected files in archive'
if [[ -n "${LLAMPART_TEST_ARTIFACTS:-}" ]]; then
  mkdir -p "$LLAMPART_TEST_ARTIFACTS"
  cp "${OUTPUT_ROOT}/${RELEASE_ROOT}.tar.xz" "${OUTPUT_ROOT}/${RELEASE_ROOT}.sha256" "${OUTPUT_ROOT}/actual-files" "$LLAMPART_TEST_ARTIFACTS/"
fi

# An interrupted archiver must leave neither a partial tarball nor a checksum.
mkdir "${OUTPUT_ROOT}/bin" "${OUTPUT_ROOT}/failed-output"
REAL_TAR="$(command -v tar)"
cat >"${OUTPUT_ROOT}/bin/tar" <<'EOF_TAR'
#!/usr/bin/env bash
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == '-cJf' ]]; then
    next=$((i + 1))
    printf 'partial archive\n' >"${!next}"
    exit 23
  fi
done
exec "$REAL_TAR" "$@"
EOF_TAR
chmod 755 "${OUTPUT_ROOT}/bin/tar"
if PATH="${OUTPUT_ROOT}/bin:$PATH" REAL_TAR="$REAL_TAR" bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --output-dir "${OUTPUT_ROOT}/failed-output" --yes >"${OUTPUT_ROOT}/archive-failure.log" 2>&1; then
  fail 'interrupted archiver was accepted'
fi
[[ -z "$(find "${OUTPUT_ROOT}/failed-output" -type f -print -quit)" ]] || fail 'partial outputs survived archive failure'
printf 'PASS: partial archive failure cleaned up\n'

for name in LICENSE NOTICE THIRD_PARTY_LICENSES.md; do
  mv "${HARNESS_ROOT}/$name" "${OUTPUT_ROOT}/notice-backup"
  assert_rejected "missing $name" 'Required distribution notice'
  mkdir "${HARNESS_ROOT}/$name"
  assert_rejected "directory $name" 'Required distribution notice'
  rmdir "${HARNESS_ROOT}/$name"
  : >"${HARNESS_ROOT}/$name"
  assert_rejected "empty $name" 'Required distribution notice'
  printf ' \n\t\n' >"${HARNESS_ROOT}/$name"
  assert_rejected "blank $name" 'has no readable content'
  cp "${OUTPUT_ROOT}/notice-backup" "${HARNESS_ROOT}/$name"
  chmod 000 "${HARNESS_ROOT}/$name"
  assert_rejected "unreadable $name" 'Required distribution notice'
  chmod 644 "${HARNESS_ROOT}/$name"
  rm "${HARNESS_ROOT}/$name"
  ln -s "${OUTPUT_ROOT}/notice-backup" "${HARNESS_ROOT}/$name"
  assert_rejected "symlink $name" 'Required distribution notice'
  rm "${HARNESS_ROOT}/$name"
  mv "${OUTPUT_ROOT}/notice-backup" "${HARNESS_ROOT}/$name"
  printf 'conflicting notice\n' >"${HARNESS_ROOT}/server/public/$name"
  assert_rejected "static collision $name" 'Static output conflicts with distribution notice'
  rm "${HARNESS_ROOT}/server/public/$name"
done

printf '\ndirty fixture\n' >>"${HARNESS_ROOT}/README.md"
assert_rejected dirty-worktree 'Repository worktree is dirty'
python3 - "$HARNESS_ROOT" <<'PY'
import pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
(root / 'README.md').write_bytes(subprocess.check_output(['git', '-C', str(root), 'show', 'HEAD:README.md']))
PY

artifact_digest_before_mtime_change="$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")"
touch "${HARNESS_ROOT}/server/public/index.html"
artifact_digest_after_mtime_change="$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")"
[[ "$artifact_digest_before_mtime_change" == "$artifact_digest_after_mtime_change" ]] ||
  fail "artifact digest depends on mtime"

write_provenance "$APP_VERSION" "$head_commit" false
printf 'mutated index\n' > "${HARNESS_ROOT}/server/public/index.html"
assert_rejected index-mutation 'Build artifact digest mismatch'
printf 'index\n' > "${HARNESS_ROOT}/server/public/index.html"

write_provenance "$APP_VERSION" "$head_commit" false
printf 'mutated asset\n' > "${HARNESS_ROOT}/server/public/_app/app.js"
assert_rejected app-mutation 'Build artifact digest mismatch'
printf 'asset\n' > "${HARNESS_ROOT}/server/public/_app/app.js"

write_provenance "$APP_VERSION" "$head_commit" false
chmod 755 "${HARNESS_ROOT}/server/public/_app/app.js"
assert_rejected mode-mutation 'Build artifact digest mismatch'
chmod 644 "${HARNESS_ROOT}/server/public/_app/app.js"

write_provenance "$APP_VERSION" "$head_commit" false "0000000000000000000000000000000000000000000000000000000000000000"
assert_rejected manually-tampered-marker 'Build artifact digest mismatch'

write_provenance "$APP_VERSION" "$head_commit" true
assert_rejected dirty 'Build provenance is dirty'
write_provenance "$APP_VERSION" "0000000000000000000000000000000000000000" false
assert_rejected commit-mismatch 'Build provenance commit mismatch'
write_provenance "0.0.0" "$head_commit" false
assert_rejected version-mismatch 'Build provenance version mismatch'

write_provenance "$APP_VERSION" "$head_commit" false
cp "${HARNESS_ROOT}/server/webui/package-lock.json" "${OUTPUT_ROOT}/lock-backup"
for field in top root; do
  python3 - "$HARNESS_ROOT" "$field" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1]) / 'server/webui/package-lock.json'
data = json.loads(path.read_text())
target = data if sys.argv[2] == 'top' else data['packages']['']
target['version'] = '0.0.0'
path.write_text(json.dumps(data))
PY
  assert_rejected "lock-$field-version" 'version mismatch'
  cp "${OUTPUT_ROOT}/lock-backup" "${HARNESS_ROOT}/server/webui/package-lock.json"
done

rm "${HARNESS_ROOT}/server/public/.llampart-build.json"
assert_rejected missing-marker

printf 'All build provenance tests passed (including exact notices, archive checksum, clean state and invalid notice rejection).\n'
