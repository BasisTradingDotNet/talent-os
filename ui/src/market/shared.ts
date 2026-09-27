/** Small formatting helpers shared by the market panels. */
import { useMemo } from 'react';

/** Server clock − local clock, re-derived whenever the server stamps a new `serverNow`. */
export function useServerOffset(serverNow: string): number {
  return useMemo(() => {
    const t = Date.parse(serverNow);
    return Number.isNaN(t) ? 0 : t - Date.now();
  }, [serverNow]);
}

export function secondsSince(iso: string, offset: number, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((now + offset - t) / 1000));
}

export function fmtAgo(s: number): string {
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** Up to `dp` decimals, trailing zeros trimmed. */
export function fmtNum(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(dp).replace(/\.?0+$/, '');
}

export function fmtSigned(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  const s = fmtNum(Math.abs(n), dp);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : '0';
}

export function fmtPct(r: number | null): string {
  return r === null || !Number.isFinite(r) ? '—' : `${Math.round(r * 100)}%`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function positionLabel(p: number): string {
  return p === 0 ? 'flat' : p > 0 ? `+${p} long` : `−${Math.abs(p)} short`;
}
