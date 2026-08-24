#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="angeli-secretaria"
PROJECT_NUMBER="172772694205"
REPOSITORY="franbermudezes-cloud/angeli_secretaria"
POOL_ID="github-actions"
PROVIDER_ID="angeli-secretaria"
SERVICE_ACCOUNT="angeli-integration-gate@${PROJECT_ID}.iam.gserviceaccount.com"
WORKLOAD_POOL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"
WORKLOAD_MEMBER="principalSet://iam.googleapis.com/${WORKLOAD_POOL}/attribute.repository/${REPOSITORY}"
TEST_SECRETS=(
  "angeli-test-google-oauth-client-secret"
  "angeli-test-google-contacts-grant"
  "angeli-test-google-calendar-grant"
  "angeli-test-google-drive-grant"
)

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com >/dev/null

if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create angeli-integration-gate \
    --display-name="Angeli Integration Gate" >/dev/null
fi

if ! gcloud iam workload-identity-pools describe "${POOL_ID}" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global \
    --display-name="GitHub Actions" >/dev/null
fi

if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --workload-identity-pool="${POOL_ID}" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --workload-identity-pool="${POOL_ID}" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.event_name=assertion.event_name" \
    --attribute-condition="assertion.repository == '${REPOSITORY}' && assertion.event_name == 'pull_request'" >/dev/null
fi

gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${WORKLOAD_MEMBER}" >/dev/null

for secret_name in "${TEST_SECRETS[@]}"; do
  if ! gcloud secrets describe "${secret_name}" >/dev/null 2>&1; then
    echo "ERROR: falta el secreto aislado ${secret_name}" >&2
    exit 1
  fi
  if ! gcloud secrets versions list "${secret_name}" \
    --filter="state=ENABLED" --format="value(name)" --limit=1 | grep -q .; then
    echo "ERROR: ${secret_name} no tiene una versión habilitada" >&2
    exit 1
  fi
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
done

provider_name="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --workload-identity-pool="${POOL_ID}" --location=global --format="value(name)")"

if [[ "${provider_name}" != "${WORKLOAD_POOL}/providers/${PROVIDER_ID}" ]]; then
  echo "ERROR: el proveedor federado no coincide con el esperado" >&2
  exit 1
fi

for secret_name in "${TEST_SECRETS[@]}"; do
  if ! gcloud secrets get-iam-policy "${secret_name}" \
    --flatten="bindings[].members" \
    --filter="bindings.role:roles/secretmanager.secretAccessor AND bindings.members:serviceAccount:${SERVICE_ACCOUNT}" \
    --format="value(bindings.role)" | grep -qx "roles/secretmanager.secretAccessor"; then
    echo "ERROR: falta el permiso mínimo sobre ${secret_name}" >&2
    exit 1
  fi
done

echo "ANGELI_GATE_GCP_READY"
