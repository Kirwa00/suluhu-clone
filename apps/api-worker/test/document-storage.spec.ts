import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { R2DocumentStorageService } from '../src/lib/document-storage';

describe('R2DocumentStorageService', () => {
  const storage = new R2DocumentStorageService(env.DOCUMENTS);
  const therapistId = '11111111-1111-1111-1111-111111111111';

  it('round-trips a saved document and sanitizes the filename into the key', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 fake license').buffer;
    const { key } = await storage.save(
      therapistId,
      '../../etc/passwd weird name!.pdf',
      bytes,
      'application/pdf',
    );

    expect(key).toMatch(
      /^11111111-1111-1111-1111-111111111111\/[0-9a-f-]{36}-passwd_weird_name_\.pdf$/,
    );

    const read = await storage.read(key);
    expect(new TextDecoder().decode(read.bytes)).toBe('%PDF-1.4 fake license');
    expect(read.contentType).toBe('application/pdf');

    await storage.delete(key);
  });

  it('rejects a read for a key that was never produced by save()', async () => {
    await expect(storage.read('not-a-valid-key')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
  });

  it('surfaces a clear error when the DB says a document exists but R2 has no object for it', async () => {
    const missingKey = `${therapistId}/22222222-2222-2222-2222-222222222222-missing.pdf`;
    await expect(storage.read(missingKey)).rejects.toMatchObject({ status: 503 });
  });
});
