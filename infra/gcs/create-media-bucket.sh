#!/usr/bin/env bash
# Create the private media bucket (rate-sheet images and PDFs) and the service
# account the API uses to sign upload/download URLs.
#
# Run by a human with Owner (or Storage Admin + Service Account Admin) on the
# project, after `gcloud auth login`:
#
#   PROJECT=my-gcp-project infra/gcs/create-media-bucket.sh
#
# Optional env:
#   BUCKET    bucket name          (default: $PROJECT-insider-media)
#   LOCATION  bucket region        (default: asia-south1)
#   SA_NAME   service account id   (default: insider-media)
#
# Safe to re-run: existing resources are left as they are (lifecycle and IAM
# bindings are re-applied, which is idempotent).
set -euo pipefail

: "${PROJECT:?Set PROJECT to the GCP project id, e.g. PROJECT=my-project $0}"
BUCKET="${BUCKET:-$PROJECT-insider-media}"
LOCATION="${LOCATION:-asia-south1}"
SA_NAME="${SA_NAME:-insider-media}"
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIFECYCLE="$SCRIPT_DIR/lifecycle.json"

command -v gcloud >/dev/null || { echo "gcloud not found: https://cloud.google.com/sdk/docs/install" >&2; exit 1; }
[[ -f "$LIFECYCLE" ]] || { echo "missing $LIFECYCLE" >&2; exit 1; }

echo "Project:  $PROJECT"
echo "Bucket:   gs://$BUCKET ($LOCATION)"
echo "Account:  $SA_EMAIL"
echo

echo "== Enabling APIs (storage, iam, iamcredentials)"
gcloud services enable storage.googleapis.com iam.googleapis.com iamcredentials.googleapis.com --project="$PROJECT"

echo "== Bucket"
if gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "gs://$BUCKET exists, leaving it as is"
else
  gcloud storage buckets create "gs://$BUCKET" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --public-access-prevention
fi
# Enforce the settings on an existing bucket too.
gcloud storage buckets update "gs://$BUCKET" \
  --project="$PROJECT" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --lifecycle-file="$LIFECYCLE"

echo "== Service account"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  echo "$SA_EMAIL exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT" \
    --display-name="Insider API media signer" \
    --description="Insider API: read/write media objects and sign GCS URLs"
fi

echo "== IAM: object admin on the bucket only"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --project="$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin" >/dev/null

echo "== IAM: token creator on itself (sign URLs via IAM signBlob, no key file)"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator" >/dev/null

cat <<NEXT

Done. Next steps (manual):

1. Put these in /etc/insider/api.env on the API host:
     GCS_MEDIA_BUCKET=$BUCKET
     GCP_PROJECT=$PROJECT

2. Give the API these credentials, one of:
   a. API host is a GCE VM: attach the service account to the VM
        gcloud compute instances set-service-account VM_NAME --zone ZONE \\
          --project $PROJECT --service-account $SA_EMAIL --scopes cloud-platform
      (the VM must be stopped first). Signing goes through IAM signBlob,
      allowed by the token-creator binding above.
   b. API host is not on GCP: create a key and point the API at it
        gcloud iam service-accounts keys create /etc/insider/gcs-key.json \\
          --iam-account $SA_EMAIL --project $PROJECT
        chown root:insider /etc/insider/gcs-key.json && chmod 640 /etc/insider/gcs-key.json
      then add GOOGLE_APPLICATION_CREDENTIALS=/etc/insider/gcs-key.json to api.env.
      Keys are long-lived secrets: prefer (a) when possible.
NEXT
