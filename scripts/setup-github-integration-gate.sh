#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="franbermudezes-cloud/angeli_secretaria"
BRANCH="codex/integration-gate"
CHECK_NAME="integration-gate"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) no está instalado" >&2
  exit 1
fi

gh auth status >/dev/null

gh api --method PATCH "repos/${REPOSITORY}" \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true >/dev/null

protection_file="$(mktemp)"
trap 'rm -f "${protection_file}"' EXIT
cat >"${protection_file}" <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["${CHECK_NAME}"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_conversation_resolution": true,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

gh api --method PUT "repos/${REPOSITORY}/branches/main/protection" \
  --input "${protection_file}" >/dev/null

if ! gh pr view "${BRANCH}" --repo "${REPOSITORY}" >/dev/null 2>&1; then
  gh pr create \
    --repo "${REPOSITORY}" \
    --base main \
    --head "${BRANCH}" \
    --title "ci: enforce isolated integration gate" \
    --body $'## Objetivo\n\nConvierte el arnés aislado en una puerta obligatoria de Pull Requests.\n\n- autentica GitHub Actions mediante Workload Identity Federation;\n- concede al runner lectura solo sobre los cuatro secretos `angeli-test-google-*`;\n- ejecuta pruebas unitarias y `backend/test_harness.py`;\n- conserva el informe JSON como artefacto;\n- bloquea `main` cuando el check falla.\n\nEste primer PR queda expresamente excluido del auto-merge para revisar la puerta una vez.' >/dev/null
fi

required="$(gh api "repos/${REPOSITORY}/branches/main/protection/required_status_checks" \
  --jq '.contexts[]' | grep -Fx "${CHECK_NAME}" || true)"
if [[ "${required}" != "${CHECK_NAME}" ]]; then
  echo "ERROR: main no exige ${CHECK_NAME}" >&2
  exit 1
fi

auto_merge="$(gh api "repos/${REPOSITORY}" --jq '.allow_auto_merge')"
if [[ "${auto_merge}" != "true" ]]; then
  echo "ERROR: auto-merge no quedó activado" >&2
  exit 1
fi

gh pr view "${BRANCH}" --repo "${REPOSITORY}" \
  --json url,state,mergeStateStatus,statusCheckRollup
