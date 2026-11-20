/** Never expose a full mobile number to clients. */
export function maskMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const last4 = digits.slice(-4);
  const prefixLen = Math.max(0, digits.length - 4);
  const visiblePrefix = digits.slice(0, Math.min(2, prefixLen));
  return `${visiblePrefix}${'*'.repeat(Math.max(4, prefixLen - visiblePrefix.length))}${last4}`;
}

export function normalizeAutoNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
