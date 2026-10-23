import { AppException } from './app-exception';

/**
 * Stores therapist credential documents (CPB license, national ID,
 * certificates, CVs) in R2 — port of apps/api's
 * `LocalDocumentStorageService`, which wrote the same documents to local
 * disk under `DOCUMENT_STORAGE_DIR`. The stored key format
 * (`<therapistProfileId>/<uuid>-<sanitized-filename>`) is kept identical so
 * `TherapistDocument.url` means the same thing on both backends.
 */
export interface SavedDocument {
  /** Opaque key stored in TherapistDocument.url — never a directly-fetchable URL. */
  key: string;
}

export interface ReadDocument {
  bytes: ArrayBuffer;
  contentType: string | null;
}

// Same shape as apps/api's KEY_PATTERN. R2 keys aren't filesystem paths, so
// there's no traversal risk the way there was on local disk — this check is
// kept anyway as a data-integrity invariant: a key that doesn't match what
// `save()` ever produces means the `TherapistDocument.url` column was
// corrupted or tampered with, and failing loudly beats silently fetching
// (or deleting) an unexpected R2 object.
const KEY_PATTERN = /^[a-f0-9-]{36}\/[a-f0-9-]{36}-[^/\\]{1,200}$/i;

export class R2DocumentStorageService {
  constructor(private readonly bucket: R2Bucket) {}

  async save(
    therapistId: string,
    originalName: string,
    bytes: ArrayBuffer,
    contentType?: string,
  ): Promise<SavedDocument> {
    const safeName = sanitizeFilename(originalName);
    const key = `${therapistId}/${crypto.randomUUID()}-${safeName}`;
    await this.bucket.put(key, bytes, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
    return { key };
  }

  async read(key: string): Promise<ReadDocument> {
    assertValidKey(key);
    const object = await this.bucket.get(key);
    if (!object) {
      throw AppException.serviceUnavailable('Document content is missing from storage');
    }
    return {
      bytes: await object.arrayBuffer(),
      contentType: object.httpMetadata?.contentType ?? null,
    };
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.bucket.delete(key).catch(() => undefined);
  }
}

function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw AppException.badRequest('Invalid document reference');
  }
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'document';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
  return cleaned || 'document';
}
