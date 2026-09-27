import { BadRequestException } from '@nestjs/common';

export function bad(message: string): never {
  throw new BadRequestException(message);
}

export function asObject(body: unknown, what = 'body'): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad(`${what} must be a JSON object`);
  return body as Record<string, unknown>;
}

export function reqString(o: Record<string, unknown>, key: string, opts: { max?: number } = {}): string {
  const v = o[key];
  if (typeof v !== 'string' || v.trim().length === 0) bad(`${key} is required`);
  if (opts.max && v.length > opts.max) bad(`${key} is too long`);
  return v;
}

/** Optional string; undefined when absent. Empty allowed. */
export function optString(o: Record<string, unknown>, key: string, max = 20000): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') bad(`${key} must be a string`);
  if (v.length > max) bad(`${key} is too long`);
  return v;
}

/** Optional nullable string; undefined when absent, null when null. */
export function optNullableString(
  o: Record<string, unknown>,
  key: string,
  max = 20000,
): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') bad(`${key} must be a string or null`);
  if (v.length > max) bad(`${key} is too long`);
  return v;
}

export function optBool(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') bad(`${key} must be a boolean`);
  return v;
}

/** Optional nullable integer within [min, max]. */
export function optNullableInt(
  o: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    bad(`${key} must be an integer between ${min} and ${max}, or null`);
  }
  return v;
}
