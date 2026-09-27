import { countdown, fmtClock, useTick } from '../lib/time';

export function Countdown({
  timeMinutes,
  presentedAt,
  offset,
  large = false,
}: {
  timeMinutes: number | null;
  presentedAt: string | null;
  offset: number;
  large?: boolean;
}) {
  const now = useTick(timeMinutes !== null && presentedAt !== null);
  if (timeMinutes === null || presentedAt === null) return null;
  const c = countdown(timeMinutes, presentedAt, offset, now);
  const colour = c.over ? 'text-red-600' : c.warning ? 'text-amber-600' : 'text-slate-800';
  return (
    <span
      className={`font-mono tabular-nums ${colour} ${large ? 'text-3xl font-semibold' : 'text-lg font-semibold'}`}
      title={`Time guide ${timeMinutes} min`}
      data-testid="countdown"
      data-over={c.over ? '1' : '0'}
    >
      {c.label}
    </span>
  );
}

export function Elapsed({ since, until, offset = 0 }: { since: string | null; until?: string | null; offset?: number }) {
  const now = useTick(!!since && !until);
  if (!since) return <span className="font-mono tabular-nums text-slate-400">--:--</span>;
  const end = until ? Date.parse(until) : now + offset;
  return <span className="font-mono tabular-nums text-slate-800">{fmtClock((end - Date.parse(since)) / 1000)}</span>;
}
