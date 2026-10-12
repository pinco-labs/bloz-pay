// Parse decimal tokens before any floating-point arithmetic. One BLOZ = 1e8 rex.
export function toRex(value) {
  const s = String(value);
  if (!/^\d+(?:\.\d{1,8})?$/.test(s)) throw new Error('Invalid BLOZ amount');
  const [whole, fraction = ''] = s.split('.');
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
}

export function formatBloz(rex) {
  const n = BigInt(rex);
  const sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  return `${sign}${abs / 100000000n}.${String(abs % 100000000n).padStart(8, '0')}`;
}

export function parseRpcJson(text) {
  // Node 24 exposes the original primitive token through the reviver context.
  return JSON.parse(text, (key, value, context) =>
    key === 'value' && typeof value === 'number' ? context.source : value);
}
