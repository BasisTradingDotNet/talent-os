import { useEffect, useState } from 'react';

/** serverNow − local time at fetch: add to Date.now() to get the server's clock. */
export function serverOffset(serverNow: string, fetchTime: number): number {
  return Date.parse(serverNow) - fetchTime;
}

export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** Re-renders once per second. */
export function useTick(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

export interface CountdownState {
  /** Seconds remaining (negative when over). */
  remaining: number;
  over: boolean;
  /** < 60 s left. */
  warning: boolean;
  label: string;
}

export function countdown(timeMinutes: number, presentedAt: string, offset: number, now: number): CountdownState {
  const elapsed = (now + offset - Date.parse(presentedAt)) / 1000;
  const remaining = timeMinutes * 60 - elapsed;
  if (remaining <= 0) return { remaining, over: true, warning: false, label: `+${fmtClock(-remaining)}` };
  return { remaining, over: false, warning: remaining < 60, label: fmtClock(remaining) };
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
