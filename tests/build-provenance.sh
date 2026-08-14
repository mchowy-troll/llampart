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
  if bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --dry-run --yes >"${HARNESS_ROOT}/output.log" 2>&1; then
    fail "${label} provenance was accepted"
  fi
}

mkdir -p "${HARNESS_ROOT}/server/webui" "${HARNESS_ROOT}/server/public/_app"
cp "${REPO_ROOT}/server/webui/package.json" "${HARNESS_ROOT}/server/webui/package.json"
cp "${REPO_ROOT}/server/webui/package-lock.json" "${HARNESS_ROOT}/server/webui/package-lock.json"
cp "${REPO_ROOT}/README.md" "${HARNESS_ROOT}/README.md"
printf 'index\n' > "${HARNESS_ROOT}/server/public/index.html"
printf 'fallback\n' > "${HARNESS_ROOT}/server/public/200.html"
printf 'asset\n' > "${HARNESS_ROOT}/server/public/_app/app.js"
printf '#!/usr/bin/env sh\n' > "${HARNESS_ROOT}/server/public/_app/worker.sh"
chmod 755 "${HARNESS_ROOT}/server/public/_app/worker.sh"
printf '/server/public/.llampart-build.json\n' > "${HARNESS_ROOT}/.gitignore"

git -C "$HARNESS_ROOT" init -q
git -C "$HARNESS_ROOT" add .
git -C "$HARNESS_ROOT" -c user.name=llampart -c user.email=tests@llampart.invalid commit -qm fixture
head_commit="$(git -C "$HARNESS_ROOT" rev-parse HEAD)"

write_provenance "1.8.2" "$head_commit" false
bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --dry-run --yes >/dev/null || fail "matching provenance was rejected"
bash "$PACKAGER" --repo-dir "$HARNESS_ROOT" --output-dir "$OUTPUT_ROOT" --yes >/dev/null ||
  fail "matching provenance could not be packaged"
mkdir -p "${OUTPUT_ROOT}/extracted"
tar -xJf "${OUTPUT_ROOT}/llampart-webui-v1.8.2.tar.xz" -C "${OUTPUT_ROOT}/extracted"
[[ "$(stat -c %a "${OUTPUT_ROOT}/extracted/llampart-webui-v1.8.2/_app/worker.sh")" == "755" ]] ||
  fail "packager did not preserve artifact modes"

artifact_digest_before_mtime_change="$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")"
touch "${HARNESS_ROOT}/server/public/index.html"
artifact_digest_after_mtime_change="$(node "$DIGEST_TOOL" "${HARNESS_ROOT}/server/public")"
[[ "$artifact_digest_before_mtime_change" == "$artifact_digest_after_mtime_change" ]] ||
  fail "artifact digest depends on mtime"

write_provenance "1.8.2" "$head_commit" false
printf 'mutated index\n' > "${HARNESS_ROOT}/server/public/index.html"
assert_rejected index-mutation
printf 'index\n' > "${HARNESS_ROOT}/server/public/index.html"

write_provenance "1.8.2" "$head_commit" false
printf 'mutated asset\n' > "${HARNESS_ROOT}/server/public/_app/app.js"
assert_rejected app-mutation
printf 'asset\n' > "${HARNESS_ROOT}/server/public/_app/app.js"

write_provenance "1.8.2" "$head_commit" false
chmod 755 "${HARNESS_ROOT}/server/public/_app/app.js"
assert_rejected mode-mutation
chmod 644 "${HARNESS_ROOT}/server/public/_app/app.js"

write_provenance "1.8.2" "$head_commit" false "0000000000000000000000000000000000000000000000000000000000000000"
assert_rejected manually-tampered-marker

write_provenance "1.8.2" "$head_commit" true
assert_rejected dirty
write_provenance "1.8.2" "0000000000000000000000000000000000000000" false
assert_rejected commit-mismatch
write_provenance "0.0.0" "$head_commit" false
assert_rejected version-mismatch

printf 'All build provenance tests passed.\n'
