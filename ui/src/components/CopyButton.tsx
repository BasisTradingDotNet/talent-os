import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyText } from '../lib/clipboard';

export function CopyButton({
  text,
  label,
  className = '',
  prominent = false,
}: {
  text: string;
  label: string;
  className?: string;
  prominent?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={`btn ${prominent ? 'btn-primary' : 'btn-sm'} ${className}`}
      onClick={async () => setState((await copyText(text)) ? 'ok' : 'fail')}
      data-copy-state={state}
    >
      {state === 'ok' ? <Check size={14} /> : <Copy size={14} />}
      {state === 'ok' ? 'Copied ✓' : state === 'fail' ? 'Copy failed' : label}
    </button>
  );
}
