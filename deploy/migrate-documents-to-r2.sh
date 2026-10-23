#!/usr/bin/env bash
# One-time migration for the Phase 6 API cutover: copies every therapist
# credential document from local disk (DOCUMENT_STORAGE_DIR, written by
# apps/api's LocalDocumentStorageService) into the R2 bucket that
# apps/api-worker's R2DocumentStorageService reads from.
#
# The two services use an identical key format
# (`<therapistProfileId>/<uuid>-<filename>`), so this is a pure 1:1 copy —
# no `TherapistDocument.url` rows need to change. See
# apps/api-worker/src/lib/document-storage.ts for the invariant this
# depends on.
#
# Run this during the cutover maintenance window, after document uploads
# have been frozen (same window as migrate-db-to-neon.sh) — new uploads
# during the copy would be missed.
#
# Usage:
#   cd apps/api-worker   # wrangler needs this workspace's config/deps
#   SOURCE_DIR=/opt/suluhu/therapist-documents \   # or wherever the
#                                                   # suluhu_documents volume
#                                                   # was copied/mounted
#     R2_BUCKET=suluhu-documents \
#     ../../deploy/migrate-documents-to-r2.sh
#
# Requires `wrangler login` or CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID to
# already be set, and the bucket to already exist (README's "One-time setup").
# Safe to re-run: `r2 object put` overwrites by key, and a key only exists
# once per source file, so a re-run just re-uploads the same objects.
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:?Set SOURCE_DIR to the local DOCUMENT_STORAGE_DIR copy}"
R2_BUCKET="${R2_BUCKET:-suluhu-documents}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "SOURCE_DIR '$SOURCE_DIR' does not exist or is not a directory." >&2
  exit 1
fi

total=0
failed=0

# Keys are `<uuid>/<uuid>-<filename>` — exactly two path segments, so a plain
# recursive file listing relative to SOURCE_DIR already gives the R2 key.
while IFS= read -r -d '' file; do
  key="${file#"$SOURCE_DIR"/}"
  total=$((total + 1))
  echo "[$total] $key"
  if ! npx wrangler r2 object put "$R2_BUCKET/$key" --file="$file" --remote >/dev/null; then
    echo "  FAILED: $key" >&2
    failed=$((failed + 1))
  fi
done < <(find "$SOURCE_DIR" -type f -print0)

echo "Uploaded $((total - failed))/$total document(s) to r2://$R2_BUCKET."
if [[ "$failed" -gt 0 ]]; then
  echo "$failed upload(s) failed — re-run this script to retry (it's safe, see header)." >&2
  exit 1
fi
