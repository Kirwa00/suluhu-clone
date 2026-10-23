import { describe, expect, it } from 'vitest';
import { MockCpbVerificationProvider } from '../src/lib/cpb-verification';

describe('MockCpbVerificationProvider', () => {
  const provider = new MockCpbVerificationProvider();

  it('rejects a license that does not match the CPB/YYYY/NNNN format', async () => {
    const result = await provider.verify({ licenseNumber: 'not-a-license', holderName: 'Asha' });
    expect(result).toMatchObject({ valid: false, status: 'NOT_FOUND', source: 'mock' });
  });

  it('treats a license ending in an even digit as ACTIVE, with an expiry ~2 years out', async () => {
    const result = await provider.verify({ licenseNumber: 'CPB/2020/1234', holderName: 'Asha' });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('ACTIVE');
    expect(result.holderName).toBe('Asha');
    expect(new Date(result.expiry!).getFullYear()).toBe(new Date().getFullYear() + 2);
  });

  it('treats a license ending in an odd digit as EXPIRED, with an expiry ~1 year in the past', async () => {
    const result = await provider.verify({ licenseNumber: 'CPB/2020/1235', holderName: 'Asha' });
    expect(result.valid).toBe(false);
    expect(result.status).toBe('EXPIRED');
    expect(new Date(result.expiry!).getFullYear()).toBe(new Date().getFullYear() - 1);
  });

  it('normalizes case and surrounding whitespace before checking the pattern', async () => {
    const result = await provider.verify({ licenseNumber: '  cpb/2021/421  ', holderName: 'Asha' });
    expect(result.licenseNumber).toBe('CPB/2021/421');
    expect(result.status).not.toBe('NOT_FOUND');
  });
});
