import { maskMobile, normalizeAutoNumber } from './mask-mobile';

describe('maskMobile', () => {
  it('masks interior digits and keeps last 4', () => {
    expect(maskMobile('9876543210')).toBe('98****3210');
    expect(maskMobile('+91 98765 43210')).toBe('91******3210');
  });

  it('never returns the raw number', () => {
    const raw = '9123456780';
    expect(maskMobile(raw)).not.toContain(raw);
    expect(maskMobile(raw)).toContain('*');
  });
});

describe('normalizeAutoNumber', () => {
  it('uppercases and strips spaces/hyphens', () => {
    expect(normalizeAutoNumber('ka-01 ab 1234')).toBe('KA01AB1234');
  });
});
