import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import 'highlight.js/styles/github.css';
import { useMemo } from 'react';
import type { CodeBlock as CodeBlockT } from '@contracts/api';
import { CopyButton } from './CopyButton';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);

const ALIASES: Record<string, string> = { py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', yml: 'yaml' };

export function CodeBlock({ code, large = false }: { code: CodeBlockT; large?: boolean }) {
  const html = useMemo(() => {
    const lang = ALIASES[code.language?.toLowerCase()] ?? code.language?.toLowerCase();
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code.text, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* plain */
      }
    }
    return code.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }, [code]);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{code.language || 'code'}</span>
        <CopyButton text={code.text} label="Copy" />
      </div>
      <pre className={`hl p-3 ${large ? 'text-base' : ''}`}>
        <code className="hljs" style={{ background: 'transparent', padding: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
