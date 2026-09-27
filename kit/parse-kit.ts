#!/usr/bin/env node
/**
 * kit/parse-kit.ts — Markdown interview kit → KitSeed JSON.
 *
 *   node kit/parse-kit.ts <kit.md> <out.seed.json> [--addon <records.md>]...
 *   node --test kit/*.test.ts               (tests, synthetic fixtures only)
 *
 * Add-on files hold extra question records in the same layout (v1.1: the Stage 0 multiple-choice
 * bank and the Stage 2 make-a-market bank). They need no index table; their sections are marked
 * `addon: true` in the profile and are validated by count instead.
 *
 * Zero dependencies. Runs on Node's native type stripping, so only erasable TypeScript syntax
 * is used (no enums, namespaces or parameter properties). Real kits are confidential: nothing
 * in this file or in kit/fixtures/ may contain real question, answer or rubric text.
 *
 * Record layout (kit Section 0.5):
 *   ### <ID> · <Title>
 *   - id: … | stage: … | set: … | number: … | domain: … | difficulty: … | mode: … | time: N min
 *   **Prompt:** … **Dataset:** ```csv … **Code (python):** ```python … **Model answer:** …
 *   **Scoring:** 3 = … 2 = … 1 = … 0 = …  **Trap / bonus:** …  **What good looks like:** …
 *   mcq records:    **Choices:** A. … B. … C. … D. …  **Answer:** C
 *   market records: **Market:** ```json { "kind": "dice", … } ```
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KitSeed, QuestionSeed, SectionSeed } from '../api/src/contracts/kit-seed.ts';
import type {
  AutoScoring,
  Band,
  CodeBlock,
  Dataset,
  Difficulty,
  DimensionDef,
  Domain,
  DomainGroup,
  MarketConfig,
  Mode,
  Rubric,
  Scoring,
} from '../api/src/contracts/api.ts';

// ---------------------------------------------------------------------------------------------
// Kit profile — what the markdown cannot tell us: section configuration and literal labels.
// Everything else (questions, instructions, dimensions, notes, rubrics, the index) is parsed.
// ---------------------------------------------------------------------------------------------

/** Where a section's interviewerNotes come from in the markdown. */
export type NotesSource =
  /** The paragraph(s) directly under the heading numbered `heading`, before its first sub-heading. */
  | { kind: 'intro'; heading: string }
  /** Every line from the heading numbered `from` up to (not including) the heading numbered `to`. */
  | { kind: 'range'; from: string; to: string };

export interface SectionSpec {
  key: string;
  stage: number;
  label: string;
  candidateLabel: string;
  scoring: Scoring;
  timeMinutes: number | null;
  bands: Band[];
  dimensionIds: number[];
  recommendationOptions: string[];
  domainGroups: DomainGroup[];
  candidateView: boolean;
  showInstructions: boolean;
  notes: NotesSource | null;
  /** v1.2 contract fields (see SectionDef). */
  selfPaced: boolean;
  shuffle: boolean;
  autoScoring: AutoScoring | null;
  candidateInstructions: string | null;
  /** Records come from an `--addon` file, not the base kit: no index rows, checked by count. */
  addon: boolean;
}

/** Defaults for sections whose records live in the base kit. */
const KIT_SECTION = { selfPaced: false, shuffle: false, autoScoring: null, candidateInstructions: null, addon: false } as const;

export interface TakeHomeSpec {
  section: string;
  stage: number;
  domain: Domain;
  mode: Mode;
  /** Heading number of the numbered criteria list (one question per criterion). */
  criteriaHeading: string;
  /** Short titles, one per criterion, in order. */
  titles: string[];
  /** Heading number of the generic 0–3 score table used as every criterion's rubric. */
  rubricHeading: string;
}

export interface KitProfile {
  slug: string;
  /** Seed version (what sessions pin). */
  version: string;
  /** Version the base kit's markdown declares (`**Version X`); lower than `version` once add-ons extend it. */
  baseVersion: string;
  title: string;
  orgName: string;
  job: { title: string; location: string | null };
  /** Heading number of the candidate-instructions paragraph. */
  instructionsHeading: string;
  /** Heading number of the "1. Name · 2. Name …" dimension line. */
  dimensionsHeading: string;
  extraDimensions: DimensionDef[];
  /** Heading number of the machine-readable question index table. */
  indexHeading: string;
  sections: SectionSpec[];
  takeHome: TakeHomeSpec;
  /** Expected question count per section; checked by `assertCounts`. */
  expectedCounts: Record<string, number>;
}

const STAGE2_GROUPS: DomainGroup[] = [
  { domain: 'quant', label: 'Quant' },
  { domain: 'python', label: 'Python' },
];

function stage2Set(key: string, label: string, candidateLabel: string, timeMinutes: number, bands: Band[]): SectionSpec {
  return {
    key,
    stage: 2,
    label,
    candidateLabel,
    scoring: 'rubric',
    timeMinutes,
    bands,
    dimensionIds: [],
    recommendationOptions: [],
    domainGroups: STAGE2_GROUPS,
    candidateView: true,
    showInstructions: true,
    notes: null,
    ...KIT_SECTION,
  };
}

const MCQ_MARKING: AutoScoring = { correct: 1, wrong: -0.25, blank: 0 };

const MCQ_INSTRUCTIONS = [
  '**Aptitude test — 20 questions, 30 minutes.**',
  '',
  'Each question has one correct option. Marking: **+1** for a correct answer, **−0.25** for a wrong answer, **0** for a blank — so only guess when you can rule options out.',
  '',
  'You can move between questions freely and change answers until you submit or the time runs out. Pen and paper allowed. No calculators, spreadsheets, search or AI assistants. Your camera, microphone and screen are recorded.',
].join('\n');

const MARKET_INSTRUCTIONS = [
  '**Market-making exercise — about 20 minutes, live with the interviewer.**',
  '',
  'For each game you will be asked to make a market on a quantity: quote a **bid** (the price you will buy at), an **ask** (the price you will sell at) and a **size**. The interviewer may buy from you at your ask or sell to you at your bid, as many times as they like. As the game goes on, information will be revealed — update your quotes as it arrives. At the end the true value is revealed and your P&L is settled against it.',
  '',
  'Keep your quotes honest and tight: centre them on what you believe the value is, widen when you are uncertain, and tighten as you learn more. Think aloud — how you reason matters as much as the number.',
].join('\n');

export const QUANT_TRADER_PROFILE: KitProfile = {
  slug: 'quant-trader',
  version: '1.1',
  baseVersion: '1.0',
  title: 'Quant Trader Interview Kit — Basis Trading Desk, BTNET',
  orgName: 'BTNET',
  job: { title: 'Quant Trader — Basis Trading Desk', location: 'India, remote' },
  instructionsHeading: '5.0',
  dimensionsHeading: '3.4',
  extraDimensions: [{ id: 8, name: 'Leadership view' }],
  indexHeading: '9.1',
  sections: [
    {
      key: 'M',
      stage: 0,
      label: 'Stage 0 — Aptitude test (MCQ)',
      candidateLabel: 'Aptitude test',
      scoring: 'auto',
      timeMinutes: 30,
      bands: [{ min: 12, label: 'Pass' }],
      dimensionIds: [],
      recommendationOptions: [],
      domainGroups: [
        { domain: 'math', label: 'Maths' },
        { domain: 'probability', label: 'Probability' },
        { domain: 'statistics', label: 'Statistics' },
      ],
      candidateView: true,
      showInstructions: true,
      notes: null,
      selfPaced: true,
      shuffle: true,
      autoScoring: MCQ_MARKING,
      candidateInstructions: MCQ_INSTRUCTIONS,
      addon: true,
    },
    {
      key: 'S1',
      stage: 1,
      label: 'Stage 1 — Intro call',
      candidateLabel: 'Introductory call',
      scoring: 'dimensions',
      timeMinutes: 30,
      bands: [],
      dimensionIds: [1, 5, 6, 7],
      recommendationOptions: ['Proceed', 'Hold', 'Decline'],
      domainGroups: [],
      candidateView: false,
      showInstructions: false,
      notes: { kind: 'intro', heading: '4.' },
      ...KIT_SECTION,
    },
    stage2Set('A', 'Set A — Easy (screening)', 'Written test — Part A', 40, [
      { min: 24, label: 'Pass — progress to Set B' },
    ]),
    stage2Set('B', 'Set B — Medium', 'Written test — Part B', 60, [{ min: 20, label: 'Pass — progress' }]),
    stage2Set('C', 'Set C — Hard', 'Written test — Part C', 75, [
      { min: 15, label: 'Strong hire signal' },
      { min: 20, label: 'Exceptional' },
    ]),
    {
      key: 'X',
      stage: 2,
      label: 'Stage 2 — Make a market (live)',
      candidateLabel: 'Market-making exercise',
      scoring: 'market',
      timeMinutes: 20,
      bands: [],
      dimensionIds: [],
      recommendationOptions: [],
      domainGroups: [],
      candidateView: true,
      showInstructions: true,
      notes: null,
      selfPaced: false,
      shuffle: false,
      autoScoring: null,
      candidateInstructions: MARKET_INSTRUCTIONS,
      addon: true,
    },
    {
      key: 'T',
      stage: 3,
      label: 'Stage 3 — Take-home case',
      candidateLabel: 'Take-home case',
      scoring: 'rubric',
      timeMinutes: null,
      bands: [{ min: 12, label: 'Pass' }],
      dimensionIds: [],
      recommendationOptions: [],
      domainGroups: [],
      candidateView: false,
      showInstructions: false,
      notes: { kind: 'range', from: '6.1', to: '6.3' },
      ...KIT_SECTION,
    },
    {
      key: 'S4',
      stage: 4,
      label: 'Stage 4 — Final round',
      candidateLabel: 'Final round',
      scoring: 'dimensions',
      timeMinutes: 45,
      bands: [],
      dimensionIds: [4, 5, 6, 7, 8],
      recommendationOptions: ['Hire', 'Hire with training plan', 'No hire'],
      domainGroups: [],
      candidateView: false,
      showInstructions: false,
      notes: { kind: 'intro', heading: '7.' },
      ...KIT_SECTION,
    },
  ],
  takeHome: {
    section: 'T',
    stage: 3,
    domain: 'takehome',
    mode: 'take-home',
    criteriaHeading: '6.3',
    titles: [
      'Signed markouts',
      'Edge capture & slippage',
      'Maker/taker attribution',
      'Data-quality traps',
      'Actionable finding',
      'Code & memo clarity',
    ],
    rubricHeading: '3.1',
  },
  expectedCounts: { M: 20, S1: 8, A: 10, B: 10, C: 10, X: 8, T: 6, S4: 7 },
};

// ---------------------------------------------------------------------------------------------
// Markdown document model
// ---------------------------------------------------------------------------------------------

export class KitParseError extends Error {}

function fail(message: string): never {
  throw new KitParseError(message);
}

interface Heading {
  level: number;
  text: string;
  /** 0-based index of the heading line. */
  line: number;
  /** 0-based index one past the last body line (= next heading's line, or lines.length). */
  end: number;
}

interface Doc {
  lines: string[];
  headings: Heading[];
}

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^(#{1,6}) (.+?)\s*$/;

function parseDoc(markdown: string): Doc {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const headings: Heading[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = HEADING_RE.exec(line);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i, end: lines.length });
  });
  if (inFence) fail('Unterminated code fence in kit');
  headings.forEach((h, i) => {
    if (i + 1 < headings.length) h.end = headings[i + 1].line;
  });
  return { lines, headings };
}

/** Body lines of a heading, up to the next heading of any level. Horizontal rules dropped. */
function bodyLines(doc: Doc, h: Heading): string[] {
  return doc.lines.slice(h.line + 1, h.end).filter((l) => l.trim() !== '---');
}

function bodyText(doc: Doc, h: Heading): string {
  return bodyLines(doc, h).join('\n').trim();
}

/** Find the heading whose text starts with a section number such as "3.1", "4." or "9.1". */
function numberedHeading(doc: Doc, num: string): Heading {
  const hits = doc.headings.filter((h) => h.text.startsWith(num + ' '));
  if (hits.length !== 1) fail(`Expected exactly one heading numbered "${num}", found ${hits.length}`);
  return hits[0];
}

function resolveNotes(doc: Doc, src: NotesSource | null): string | null {
  if (!src) return null;
  if (src.kind === 'intro') {
    const text = bodyText(doc, numberedHeading(doc, src.heading));
    if (!text) fail(`Heading "${src.heading}" has no intro paragraph`);
    return text;
  }
  const from = numberedHeading(doc, src.from);
  const to = numberedHeading(doc, src.to);
  if (to.line <= from.line) fail(`Notes range ${src.from}..${src.to} is empty`);
  const text = doc.lines
    .slice(from.line, to.line)
    .filter((l) => l.trim() !== '---')
    .join('\n')
    .trim();
  return text;
}

// ---------------------------------------------------------------------------------------------
// Small parsers (exported for tests)
// ---------------------------------------------------------------------------------------------

/** Parse a GitHub-style markdown table into rows of trimmed cells (header row first). */
export function parseTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  if (rows.length < 2) fail('Expected a markdown table with a header and at least one row');
  return rows;
}

/** Quote-aware CSV split. A trailing empty field counts as a column. */
export function parseCsv(text: string): string[][] {
  return text.split('\n').map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    if (inQuotes) fail(`Unterminated quote in CSV line: ${line}`);
    cells.push(cur);
    return cells;
  });
}

/**
 * Split a Scoring line — `3 = … 2 = … 1 = … 0 = …` — into rubric levels. Levels are found in
 * order, each `N = ` marker preceded by whitespace, so digits inside a level ("(1), (2) and (3)",
 * "3×365", "says `[2]`") never start a new level.
 */
export function splitRubric(text: string): Rubric {
  const t = text.trim();
  if (!t.startsWith('3 = ')) fail(`Scoring text must start with "3 = ": "${t.slice(0, 60)}"`);
  const starts = [0];
  for (const level of ['2', '1', '0']) {
    const re = new RegExp(`(?<=\\s)${level} = `, 'g');
    re.lastIndex = starts[starts.length - 1] + 4;
    const m = re.exec(t);
    if (!m) fail(`Scoring text has no "${level} = " level: "${t.slice(0, 60)}"`);
    starts.push(m.index);
  }
  const levels = starts.map((s, i) => t.slice(s + 4, i + 1 < starts.length ? starts[i + 1] : undefined).trim());
  levels.forEach((l, i) => {
    if (!l) fail(`Scoring level ${3 - i} is empty: "${t.slice(0, 60)}"`);
  });
  return { '3': levels[0], '2': levels[1], '1': levels[2], '0': levels[3] };
}

/** "1. Name · 2. Name · …" → dimension definitions. */
export function parseDimensions(text: string): DimensionDef[] {
  const dims = text
    .trim()
    .split(/\s·\s/)
    .map((part) => {
      const m = /^(\d+)\.\s+(.+)$/.exec(part.trim());
      if (!m) fail(`Cannot parse dimension "${part}"`);
      return { id: Number(m[1]), name: m[2].trim() };
    });
  dims.forEach((d, i) => {
    if (d.id !== i + 1) fail(`Dimension ids must be contiguous from 1; got ${d.id} at position ${i + 1}`);
  });
  return dims;
}

/** The generic 0–3 score table (| Score | Meaning |) → rubric. */
export function parseScoreTable(text: string): Rubric {
  const rows = parseTable(text).slice(1);
  const out: Partial<Record<'3' | '2' | '1' | '0', string>> = {};
  for (const [score, meaning] of rows) {
    if (!/^[0-3]$/.test(score)) fail(`Unexpected score row "${score}" in score table`);
    out[score as '3' | '2' | '1' | '0'] = meaning;
  }
  for (const k of ['3', '2', '1', '0'] as const) if (!out[k]) fail(`Score table is missing level ${k}`);
  return out as Rubric;
}

/** "1. text" lines → criterion texts. */
export function parseNumberedList(text: string): string[] {
  const items: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+)\.\s+(.+)$/.exec(line);
    if (!m) fail(`Expected a numbered list item, got "${line}"`);
    if (Number(m[1]) !== items.length + 1) fail(`Numbered list is not contiguous at "${line}"`);
    items.push(m[2].trim());
  }
  return items;
}

/** "A. text" lines (contiguous letters from A, 2–8 options) → choice texts. */
export function parseChoices(text: string): string[] {
  const choices: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-H])\.\s+(.+)$/.exec(line);
    if (!m) fail(`Expected a choice line like "A. text", got "${line}"`);
    if (m[1] !== String.fromCharCode(65 + choices.length)) fail(`Choices are not lettered contiguously from A at "${line}"`);
    choices.push(m[2].trim());
  }
  if (choices.length < 2) fail('A multiple-choice question needs at least two choices');
  const seen = new Set<string>();
  for (const c of choices) {
    if (seen.has(c)) fail(`Duplicate choice "${c}"`);
    seen.add(c);
  }
  return choices;
}

/** "C" → 0-based index into `choices`. Exactly one letter. */
export function parseAnswer(text: string, choices: string[]): number {
  const t = text.trim();
  if (!/^[A-H]$/.test(t)) fail(`Answer must be a single option letter, got "${t}"`);
  const i = t.charCodeAt(0) - 65;
  if (i >= choices.length) fail(`Answer "${t}" is outside the ${choices.length} choices`);
  return i;
}

/** Fenced JSON → MarketConfig with every field checked. */
export function parseMarketConfig(json: string): MarketConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return fail(`Market config is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('Market config must be a JSON object');
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort().join(',');
  const isInt = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min;
  if (obj.kind === 'dice') {
    if (keys !== 'dice,kind,sides') fail(`Dice market must have exactly kind, dice, sides; got ${keys}`);
    if (!isInt(obj.dice, 1)) fail('Dice market: "dice" must be an integer >= 1');
    if (!isInt(obj.sides, 2)) fail('Dice market: "sides" must be an integer >= 2');
    return { kind: 'dice', dice: obj.dice as number, sides: obj.sides as number };
  }
  if (obj.kind === 'estimate') {
    if (keys !== 'hints,kind,trueValue,unit') fail(`Estimate market must have exactly kind, trueValue, unit, hints; got ${keys}`);
    if (typeof obj.trueValue !== 'number' || !Number.isFinite(obj.trueValue)) fail('Estimate market: "trueValue" must be a finite number');
    if (typeof obj.unit !== 'string' || !obj.unit.trim()) fail('Estimate market: "unit" must be a non-empty string');
    const hints = obj.hints;
    if (!Array.isArray(hints) || hints.length === 0 || hints.some((h) => typeof h !== 'string' || !h.trim()))
      fail('Estimate market: "hints" must be a non-empty array of non-empty strings');
    return { kind: 'estimate', trueValue: obj.trueValue, unit: obj.unit, hints: [...(hints as string[])] };
  }
  return fail(`Market config kind must be "dice" or "estimate", got ${JSON.stringify(obj.kind)}`);
}

// ---------------------------------------------------------------------------------------------
// Question records
// ---------------------------------------------------------------------------------------------

const RECORD_HEADING_RE = /^(\S+) · (.+)$/;
const LABEL_RE = /^\*\*([^*]+?):\*\*\s*(.*)$/;
const TEXT_LABELS = ['Prompt', 'Model answer', 'Scoring', 'Trap / bonus', 'What good looks like', 'Choices', 'Answer'];
const MODES: Mode[] = ['verbal', 'sheet', 'sheet-or-verbal', 'sheet-and-verbal', 'take-home', 'mcq', 'market'];
const DOMAINS: Domain[] = ['quant', 'python', 'screening', 'judgement', 'takehome', 'math', 'probability', 'statistics'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

interface Fence {
  lang: string;
  lines: string[];
}

interface Block {
  text: string;
  fence: Fence | null;
}

export interface RawRecord {
  id: string;
  title: string;
  meta: Record<string, string>;
  blocks: Map<string, Block>;
  /** Stage number from the enclosing "## N. Stage M …" heading, if any. */
  headingStage: number | null;
}

function parseMeta(line: string, id: string): Record<string, string> {
  const m = /^-\s+(.*)$/.exec(line.trim());
  if (!m) fail(`${id}: expected a "- id: … | …" metadata line, got "${line}"`);
  const meta: Record<string, string> = {};
  for (const part of m[1].split('|')) {
    const kv = /^\s*([a-z_]+):\s*(.*?)\s*$/.exec(part);
    if (!kv) fail(`${id}: cannot parse metadata field "${part.trim()}"`);
    if (kv[1] in meta) fail(`${id}: duplicate metadata field "${kv[1]}"`);
    meta[kv[1]] = kv[2];
  }
  if (meta.id !== id) fail(`${id}: metadata id "${meta.id}" does not match heading`);
  return meta;
}

function parseBlocks(lines: string[], id: string): Map<string, Block> {
  const blocks = new Map<string, Block>();
  let label: string | null = null;
  let text: string[] = [];
  let fence: Fence | null = null;
  let open: Fence | null = null; // fence currently being read

  const flush = () => {
    if (label === null) return;
    if (blocks.has(label)) fail(`${id}: duplicate "${label}" block`);
    blocks.set(label, { text: text.join('\n').trim(), fence });
    label = null;
    text = [];
    fence = null;
  };

  for (const line of lines) {
    if (open) {
      if (FENCE_RE.test(line)) {
        open = null;
        continue;
      }
      open.lines.push(line);
      continue;
    }
    if (FENCE_RE.test(line)) {
      if (label === null) fail(`${id}: code fence before any block label`);
      if (fence) fail(`${id}: "${label}" has more than one code fence`);
      open = { lang: line.trim().slice(3).trim(), lines: [] };
      fence = open;
      continue;
    }
    const m = LABEL_RE.exec(line);
    if (m) {
      flush();
      label = m[1].trim();
      if (m[2].trim()) text.push(m[2].trim());
      continue;
    }
    if (label === null) {
      if (line.trim()) fail(`${id}: text before the first block label: "${line.trim()}"`);
      continue;
    }
    text.push(line);
  }
  if (open) fail(`${id}: unterminated code fence`);
  flush();
  return blocks;
}

/** Every "### <ID> · <Title>" heading whose body opens with "- id: <ID> | …". */
export function extractRecords(markdown: string): RawRecord[] {
  const doc = parseDoc(markdown);
  const records: RawRecord[] = [];
  let headingStage: number | null = null;
  for (const h of doc.headings) {
    if (h.level <= 2) {
      const m = /\bStage (\d+)\b/.exec(h.text);
      headingStage = m ? Number(m[1]) : null;
      continue;
    }
    const rm = RECORD_HEADING_RE.exec(h.text);
    if (!rm) continue;
    const body = bodyLines(doc, h);
    const firstIdx = body.findIndex((l) => l.trim() !== '');
    if (firstIdx < 0 || !/^-\s+id:/.test(body[firstIdx].trim())) continue; // e.g. a set heading
    const id = rm[1];
    const meta = parseMeta(body[firstIdx], id);
    const blocks = parseBlocks(body.slice(firstIdx + 1), id);
    records.push({ id, title: rm[2].trim(), meta, blocks, headingStage });
  }
  return records;
}

// ---------------------------------------------------------------------------------------------
// Index table (kit Section 9.1)
// ---------------------------------------------------------------------------------------------

export interface IndexRow {
  id: string;
  stage: number;
  set: string | null;
  num: number;
  domain: string;
  difficulty: string | null;
  mode: string;
  timeMin: number | null;
  dataset: boolean;
  code: boolean;
}

const INDEX_COLUMNS = ['id', 'stage', 'set', 'num', 'domain', 'difficulty', 'mode', 'time_min', 'dataset', 'code'];

function dash(v: string): string | null {
  return v === '—' || v === '-' || v === '' ? null : v;
}

function yesNo(v: string, id: string, col: string): boolean {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return fail(`Index row ${id}: ${col} must be yes/no, got "${v}"`);
}

function int(v: string, what: string): number {
  if (!/^\d+$/.test(v)) fail(`${what}: expected an integer, got "${v}"`);
  return Number(v);
}

export function parseIndex(text: string): IndexRow[] {
  const [header, ...rows] = parseTable(text);
  if (header.join(',') !== INDEX_COLUMNS.join(','))
    fail(`Index table columns are ${header.join(', ')}; expected ${INDEX_COLUMNS.join(', ')}`);
  const seen = new Set<string>();
  return rows.map((r) => {
    if (r.length !== INDEX_COLUMNS.length) fail(`Index row "${r[0]}" has ${r.length} cells`);
    const [id, stage, set, num, domain, difficulty, mode, timeMin, dataset, code] = r;
    if (seen.has(id)) fail(`Index lists ${id} twice`);
    seen.add(id);
    const t = dash(timeMin);
    return {
      id,
      stage: int(stage, `Index row ${id} stage`),
      set: dash(set),
      num: int(num, `Index row ${id} num`),
      domain,
      difficulty: dash(difficulty),
      mode,
      timeMin: t === null ? null : int(t, `Index row ${id} time_min`),
      dataset: yesNo(dataset, id, 'dataset'),
      code: yesNo(code, id, 'code'),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(value)) fail(`${what}: "${value}" is not one of ${allowed.join(', ')}`);
  return value as T;
}

function buildQuestion(rec: RawRecord, index: Map<string, IndexRow>, profile: KitProfile): QuestionSeed {
  const { id, meta, blocks } = rec;
  const row = index.get(id);

  const stage = meta.stage !== undefined ? int(meta.stage, `${id} stage`) : rec.headingStage;
  if (stage === null) fail(`${id}: no stage in metadata and no enclosing "Stage N" heading`);
  const section = meta.set ?? `S${stage}`;
  if (!profile.sections.some((s) => s.key === section)) fail(`${id}: unknown section "${section}"`);

  let number: number;
  if (meta.number !== undefined) number = int(meta.number, `${id} number`);
  else {
    const m = /\.(\d+)$/.exec(id);
    if (!m) fail(`${id}: no number in metadata and id has no ".N" suffix`);
    number = Number(m[1]);
  }

  const domainText = meta.domain ?? row?.domain;
  if (domainText === undefined) fail(`${id}: no domain in metadata or index`);
  const domain = oneOf(domainText, DOMAINS, `${id} domain`);
  const difficulty = meta.difficulty === undefined ? null : oneOf(meta.difficulty, DIFFICULTIES, `${id} difficulty`);
  if (meta.mode === undefined) fail(`${id}: metadata has no mode`);
  const mode = oneOf(meta.mode, MODES, `${id} mode`);
  if (meta.time === undefined) fail(`${id}: metadata has no time`);
  const tm = /^(\d+) min$/.exec(meta.time);
  if (!tm) fail(`${id}: time must look like "N min", got "${meta.time}"`);
  const timeMinutes = Number(tm[1]);

  const known = new Set(TEXT_LABELS);
  let dataset: Dataset | null = null;
  let code: CodeBlock | null = null;
  let market: MarketConfig | null = null;
  for (const [label, block] of blocks) {
    if (label === 'Market') {
      if (!block.fence) fail(`${id}: Market block has no code fence`);
      if (block.text) fail(`${id}: Market block has text outside its fence`);
      if (block.fence.lang && block.fence.lang !== 'json') fail(`${id}: Market fence language must be json, got "${block.fence.lang}"`);
      try {
        market = parseMarketConfig(block.fence.lines.join('\n'));
      } catch (e) {
        if (e instanceof KitParseError) fail(`${id}: ${e.message}`);
        throw e;
      }
      continue;
    }
    if (label === 'Dataset') {
      if (!block.fence) fail(`${id}: Dataset block has no code fence`);
      if (block.text) fail(`${id}: Dataset block has text outside its fence`);
      const format = block.fence.lang || 'csv';
      if (format !== 'csv') fail(`${id}: Dataset fence language must be csv, got "${format}"`);
      dataset = { format: 'csv', text: block.fence.lines.join('\n').trim() };
      continue;
    }
    const cm = /^Code(?: \(([^)]+)\))?$/.exec(label);
    if (cm) {
      if (!block.fence) fail(`${id}: Code block has no code fence`);
      if (block.text) fail(`${id}: Code block has text outside its fence`);
      const language = cm[1] ?? block.fence.lang;
      if (!language) fail(`${id}: Code block has no language`);
      if (block.fence.lang && block.fence.lang !== language)
        fail(`${id}: Code label language "${language}" differs from fence language "${block.fence.lang}"`);
      const lines = block.fence.lines.map((l) => l.replace(/\s+$/, ''));
      while (lines.length && lines[0] === '') lines.shift();
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      if (!lines.length) fail(`${id}: Code block is empty`);
      code = { language, text: lines.join('\n') };
      continue;
    }
    if (!known.has(label)) fail(`${id}: unknown block label "${label}"`);
    if (block.fence) fail(`${id}: "${label}" block unexpectedly contains a code fence`);
    if (!block.text) fail(`${id}: "${label}" block is empty`);
  }
  const text = (label: string): string | null => blocks.get(label)?.text ?? null;
  const prompt = text('Prompt');
  if (!prompt) fail(`${id}: missing Prompt`);
  const scoring = text('Scoring');

  let choices: string[] | null = null;
  let correctChoice: number | null = null;
  const choicesText = text('Choices');
  const answerText = text('Answer');
  if (mode === 'mcq') {
    if (choicesText === null) fail(`${id}: mcq record has no Choices block`);
    if (answerText === null) fail(`${id}: mcq record has no Answer block`);
    if (scoring !== null) fail(`${id}: mcq records are marked automatically; remove the Scoring block`);
    try {
      choices = parseChoices(choicesText);
      correctChoice = parseAnswer(answerText, choices);
    } catch (e) {
      if (e instanceof KitParseError) fail(`${id}: ${e.message}`);
      throw e;
    }
  } else if (choicesText !== null || answerText !== null) {
    fail(`${id}: Choices/Answer blocks are only allowed on mcq records (mode is "${mode}")`);
  }
  if (mode === 'market') {
    if (!market) fail(`${id}: market record has no Market block`);
    if (scoring !== null) fail(`${id}: market records are settled against the true value; remove the Scoring block`);
  } else if (market) fail(`${id}: Market block is only allowed on market records (mode is "${mode}")`);

  return {
    key: id,
    section,
    stage,
    number,
    title: rec.title,
    domain,
    difficulty,
    mode,
    timeMinutes,
    prompt,
    dataset,
    code,
    modelAnswer: text('Model answer'),
    rubric: scoring === null ? null : splitRubric(scoring),
    trapOrBonus: text('Trap / bonus'),
    whatGoodLooksLike: text('What good looks like'),
    choices,
    correctChoice,
    market,
  };
}

function buildTakeHome(doc: Doc, profile: KitProfile): QuestionSeed[] {
  const th = profile.takeHome;
  const criteria = parseNumberedList(bodyText(doc, numberedHeading(doc, th.criteriaHeading)));
  if (criteria.length !== th.titles.length)
    fail(`Take-home: ${criteria.length} criteria under heading ${th.criteriaHeading} but ${th.titles.length} titles configured`);
  const rubric = parseScoreTable(bodyText(doc, numberedHeading(doc, th.rubricHeading)));
  return criteria.map((prompt, i) => ({
    key: `${th.section}${i + 1}`,
    section: th.section,
    stage: th.stage,
    number: i + 1,
    title: th.titles[i],
    domain: th.domain,
    difficulty: null,
    mode: th.mode,
    timeMinutes: null,
    prompt,
    dataset: null,
    code: null,
    modelAnswer: null,
    rubric: { ...rubric },
    trapOrBonus: null,
    whatGoodLooksLike: null,
    choices: null,
    correctChoice: null,
    market: null,
  }));
}

/**
 * Parse a whole kit plus any add-on record files. Throws KitParseError with a clear message on any
 * structural problem.
 */
export function parseKit(markdown: string, profile: KitProfile = QUANT_TRADER_PROFILE, addons: string[] = []): KitSeed {
  const doc = parseDoc(markdown);

  const h1 = doc.headings.find((h) => h.level === 1);
  if (!h1) fail('Kit has no top-level "# Title" heading');
  if (h1.text !== profile.title) fail(`Kit title "${h1.text}" does not match profile title "${profile.title}"`);
  const vm = /\*\*Version (\S+)/.exec(markdown);
  if (vm && vm[1] !== profile.baseVersion) fail(`Kit says version ${vm[1]} but profile says base version ${profile.baseVersion}`);

  const candidateInstructions = bodyText(doc, numberedHeading(doc, profile.instructionsHeading));
  if (!candidateInstructions) fail('Candidate instructions are empty');

  const dimensions = [...parseDimensions(bodyText(doc, numberedHeading(doc, profile.dimensionsHeading))), ...profile.extraDimensions];

  const indexRows = parseIndex(bodyText(doc, numberedHeading(doc, profile.indexHeading)));
  const index = new Map(indexRows.map((r) => [r.id, r]));

  const addonSections = new Set(profile.sections.filter((s) => s.addon).map((s) => s.key));
  const seenKeys = new Set<string>();
  const questions: QuestionSeed[] = [];
  for (const rec of extractRecords(markdown)) {
    if (seenKeys.has(rec.id)) fail(`Duplicate question id ${rec.id}`);
    seenKeys.add(rec.id);
    const q = buildQuestion(rec, index, profile);
    if (addonSections.has(q.section)) fail(`${q.key}: section ${q.section} is an add-on section; move the record to an --addon file`);
    questions.push(q);
  }
  addons.forEach((addon, i) => {
    const recs = extractRecords(addon);
    if (recs.length === 0) fail(`Add-on file ${i + 1} contains no question records`);
    for (const rec of recs) {
      if (seenKeys.has(rec.id)) fail(`Duplicate question id ${rec.id}`);
      seenKeys.add(rec.id);
      const q = buildQuestion(rec, index, profile);
      if (!addonSections.has(q.section)) fail(`${q.key}: section ${q.section} is not an add-on section`);
      questions.push(q);
    }
  });
  for (const q of buildTakeHome(doc, profile)) {
    if (seenKeys.has(q.key)) fail(`Duplicate question id ${q.key}`);
    seenKeys.add(q.key);
    questions.push(q);
  }

  const order = new Map(profile.sections.map((s, i) => [s.key, i]));
  questions.sort((a, b) => order.get(a.section)! - order.get(b.section)! || a.number - b.number);

  const sections: SectionSeed[] = profile.sections.map((s) => {
    const count = questions.filter((q) => q.section === s.key).length;
    const { notes, addon: _addon, ...rest } = s;
    return { ...rest, maxScore: maxScoreFor(s, count), interviewerNotes: resolveNotes(doc, notes) };
  });

  const seed: KitSeed = {
    slug: profile.slug,
    title: profile.title,
    version: profile.version,
    orgName: profile.orgName,
    job: { ...profile.job },
    candidateInstructions,
    dimensions,
    sections,
    questions,
  };
  validateSeed(seed, indexRows, profile);
  return seed;
}

/** rubric: n × 3; auto: n × points per correct answer; dimensions and market: none. */
function maxScoreFor(s: SectionSpec, count: number): number | null {
  if (s.scoring === 'rubric') return count * 3;
  if (s.scoring === 'auto') return count * (s.autoScoring?.correct ?? 0);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const LEFTOVER_RE = /\*\*(?:Prompt|Dataset|Code(?: \([^)]*\))?|Model answer|Scoring|Trap \/ bonus|What good looks like|Choices|Answer|Market):\*\*|```/;

function checkLeftovers(where: string, value: string | null) {
  if (value !== null && LEFTOVER_RE.test(value)) fail(`${where} contains a leftover label or code fence`);
}

/** Structural checks that hold for any kit. Throws on the first failure. */
export function validateSeed(seed: KitSeed, indexRows: IndexRow[], profile: KitProfile): void {
  const sectionByKey = new Map(seed.sections.map((s) => [s.key, s]));
  const dimIds = new Set(seed.dimensions.map((d) => d.id));
  const specByKey = new Map(profile.sections.map((s) => [s.key, s]));
  for (const s of seed.sections) {
    for (const id of s.dimensionIds) if (!dimIds.has(id)) fail(`Section ${s.key} rates unknown dimension ${id}`);
    checkLeftovers(`Section ${s.key} interviewerNotes`, s.interviewerNotes);
    checkLeftovers(`Section ${s.key} candidateInstructions`, s.candidateInstructions);
    if (s.scoring === 'auto') {
      if (!s.autoScoring) fail(`Section ${s.key}: auto-scored section needs autoScoring`);
      if (s.autoScoring.correct <= 0) fail(`Section ${s.key}: autoScoring.correct must be positive`);
      if (s.timeMinutes === null) fail(`Section ${s.key}: auto-scored section needs a time limit`);
    } else if (s.autoScoring) fail(`Section ${s.key}: only auto-scored sections carry autoScoring`);
    if (s.shuffle && s.scoring !== 'auto') fail(`Section ${s.key}: only auto-scored sections may shuffle`);
    if (s.scoring === 'market' && s.bands.length) fail(`Section ${s.key}: market sections have no bands`);
    if ((s.scoring === 'dimensions' || s.scoring === 'market') && s.maxScore !== null)
      fail(`Section ${s.key}: ${s.scoring} sections have no maxScore`);
  }
  checkLeftovers('candidateInstructions', seed.candidateInstructions);

  // Numbers contiguous 1..n per section, in array order.
  for (const s of seed.sections) {
    const nums = seed.questions.filter((q) => q.section === s.key).map((q) => q.number);
    if (nums.length === 0)
      fail(`Section ${s.key} has no questions${specByKey.get(s.key)?.addon ? ' (pass its records with --addon)' : ''}`);
    nums.forEach((n, i) => {
      if (n !== i + 1) fail(`Section ${s.key}: question numbers are not contiguous (got ${nums.join(', ')})`);
    });
    if (s.scoring === 'rubric' && s.maxScore !== nums.length * 3)
      fail(`Section ${s.key}: maxScore ${s.maxScore} != ${nums.length} questions × 3`);
    if (s.scoring === 'auto' && s.maxScore !== nums.length * s.autoScoring!.correct)
      fail(`Section ${s.key}: maxScore ${s.maxScore} != ${nums.length} questions × ${s.autoScoring!.correct}`);
  }

  // Per-question checks.
  for (const q of seed.questions) {
    const s = sectionByKey.get(q.section);
    if (!s) fail(`${q.key}: unknown section ${q.section}`);
    if (q.stage !== s.stage) fail(`${q.key}: stage ${q.stage} != section ${s.key} stage ${s.stage}`);
    if (!q.prompt.trim()) fail(`${q.key}: empty prompt`);
    if (!q.title.trim()) fail(`${q.key}: empty title`);
    if (s.domainGroups.length && !s.domainGroups.some((g) => g.domain === q.domain))
      fail(`${q.key}: domain "${q.domain}" is not one of section ${s.key}'s domain groups (${s.domainGroups.map((g) => g.domain).join(', ')})`);
    // Mode ↔ section scoring ↔ v1.2 fields.
    if (s.scoring === 'auto' && q.mode !== 'mcq') fail(`${q.key}: auto-scored section ${s.key} only takes mcq records`);
    if (s.scoring === 'market' && q.mode !== 'market') fail(`${q.key}: market section ${s.key} only takes market records`);
    if (q.mode === 'mcq') {
      if (s.scoring !== 'auto') fail(`${q.key}: mcq record in a ${s.scoring} section`);
      if (!q.choices || q.choices.length < 2) fail(`${q.key}: mcq record needs at least two choices`);
      if (q.correctChoice === null || !Number.isInteger(q.correctChoice) || q.correctChoice < 0 || q.correctChoice >= q.choices.length)
        fail(`${q.key}: correctChoice must index one of the ${q.choices.length} choices`);
      if (q.choices.some((c) => !c.trim())) fail(`${q.key}: empty choice`);
      if (new Set(q.choices).size !== q.choices.length) fail(`${q.key}: duplicate choices`);
      if (q.difficulty === null) fail(`${q.key}: mcq record needs a difficulty`);
    } else if (q.choices !== null || q.correctChoice !== null) fail(`${q.key}: choices/correctChoice only on mcq records`);
    if (q.mode === 'market') {
      if (s.scoring !== 'market') fail(`${q.key}: market record in a ${s.scoring} section`);
      if (!q.market) fail(`${q.key}: market record needs a market config`);
      parseMarketConfig(JSON.stringify(q.market)); // shape
    } else if (q.market !== null) fail(`${q.key}: market config only on market records`);
    if (s.scoring === 'auto' || s.scoring === 'market') {
      if (q.rubric) fail(`${q.key}: ${s.scoring} section question must not carry a rubric`);
      if (!(q.modelAnswer ?? '').trim()) fail(`${q.key}: missing model answer`);
      for (const c of q.choices ?? []) checkLeftovers(`${q.key} choice`, c);
      for (const h of q.market?.kind === 'estimate' ? q.market.hints : []) checkLeftovers(`${q.key} hint`, h);
    } else if (s.scoring === 'rubric') {
      if (!q.rubric) fail(`${q.key}: rubric section question without a rubric`);
      for (const k of ['3', '2', '1', '0'] as const)
        if (!q.rubric[k] || !q.rubric[k].trim()) fail(`${q.key}: rubric level ${k} is empty`);
      if (q.section !== profile.takeHome.section && !(q.modelAnswer ?? '').trim()) fail(`${q.key}: missing model answer`);
    } else if (s.scoring === 'dimensions') {
      if (q.rubric || q.modelAnswer || q.trapOrBonus)
        fail(`${q.key}: dimension-scored question must not carry rubric/model answer/trap`);
      if (!(q.whatGoodLooksLike ?? '').trim()) fail(`${q.key}: missing "What good looks like"`);
    }
    if (q.dataset) {
      const rows = parseCsv(q.dataset.text);
      if (rows.length < 2) fail(`${q.key}: dataset needs a header and at least one row`);
      const width = rows[0].length;
      rows.forEach((r, i) => {
        if (r.length !== width) fail(`${q.key}: dataset row ${i} has ${r.length} columns, header has ${width}`);
      });
    }
    if (q.code && !q.code.text.trim()) fail(`${q.key}: empty code block`);
    const fields: [string, string | null][] = [
      ['prompt', q.prompt],
      ['modelAnswer', q.modelAnswer],
      ['trapOrBonus', q.trapOrBonus],
      ['whatGoodLooksLike', q.whatGoodLooksLike],
      ['dataset', q.dataset?.text ?? null],
      ['code', q.code?.text ?? null],
      ...(q.rubric ? (Object.entries(q.rubric) as [string, string][]).map(([k, v]) => [`rubric.${k}`, v] as [string, string]) : []),
    ];
    for (const [name, value] of fields) checkLeftovers(`${q.key} ${name}`, value);
  }

  // Cross-check against the index table (every indexed question, both directions).
  const byKey = new Map(seed.questions.map((q) => [q.key, q]));
  for (const row of indexRows) {
    const q = byKey.get(row.id);
    if (!q) fail(`Index lists ${row.id} but no such record was parsed`);
    const mismatches: string[] = [];
    const cmp = (name: string, got: unknown, want: unknown) => {
      if (got !== want) mismatches.push(`${name}: parsed ${JSON.stringify(got)} vs index ${JSON.stringify(want)}`);
    };
    cmp('stage', q.stage, row.stage);
    cmp('set', q.section.startsWith('S') ? null : q.section, row.set);
    cmp('num', q.number, row.num);
    cmp('domain', q.domain, row.domain);
    cmp('difficulty', q.difficulty, row.difficulty);
    cmp('mode', q.mode, row.mode);
    cmp('time_min', q.timeMinutes, row.timeMin);
    cmp('dataset', q.dataset !== null, row.dataset);
    cmp('code', q.code !== null, row.code);
    if (mismatches.length) fail(`${row.id} does not match its index row — ${mismatches.join('; ')}`);
  }
  for (const q of seed.questions) {
    if (q.section === profile.takeHome.section || specByKey.get(q.section)?.addon) continue;
    if (!indexRows.some((r) => r.id === q.key)) fail(`${q.key} has no row in the index table`);
  }
}

/** Exact per-section counts (e.g. the real kit's 51 questions). */
export function assertCounts(seed: KitSeed, expected: Record<string, number>): void {
  const counts = countBySection(seed);
  for (const [key, want] of Object.entries(expected)) {
    if ((counts[key] ?? 0) !== want) fail(`Section ${key}: expected ${want} questions, got ${counts[key] ?? 0}`);
  }
  for (const key of Object.keys(counts)) if (!(key in expected)) fail(`Unexpected section ${key} in output`);
  const total = Object.values(expected).reduce((a, b) => a + b, 0);
  if (seed.questions.length !== total) fail(`Expected ${total} questions, got ${seed.questions.length}`);
}

export function countBySection(seed: KitSeed): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const q of seed.questions) counts[q.section] = (counts[q.section] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export function summarise(seed: KitSeed): string {
  const lines: string[] = [];
  lines.push(`${seed.title} (v${seed.version}) — ${seed.questions.length} questions`);
  for (const s of seed.sections) {
    const qs = seed.questions.filter((q) => q.section === s.key);
    lines.push(`  ${s.key.padEnd(3)} ${s.label.padEnd(28)} ${String(qs.length).padStart(2)} questions` +
      (s.maxScore !== null ? `  max ${s.maxScore}` : '') + (s.timeMinutes !== null ? `  ${s.timeMinutes} min` : ''));
  }
  const withDataset = seed.questions.filter((q) => q.dataset).map((q) => q.key);
  const withCode = seed.questions.filter((q) => q.code).map((q) => q.key);
  lines.push(`  datasets (${withDataset.length}): ${withDataset.join(', ') || '—'}`);
  lines.push(`  code     (${withCode.length}): ${withCode.join(', ') || '—'}`);
  const mcq = seed.questions.filter((q) => q.mode === 'mcq');
  const markets = seed.questions.filter((q) => q.mode === 'market');
  const tally = (qs: QuestionSeed[], key: (q: QuestionSeed) => string) => {
    const c: Record<string, number> = {};
    for (const q of qs) c[key(q)] = (c[key(q)] ?? 0) + 1;
    return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ');
  };
  if (mcq.length) lines.push(`  mcq      (${mcq.length}): ${tally(mcq, (q) => q.domain)}; ${tally(mcq, (q) => q.difficulty ?? '?')}`);
  if (markets.length) lines.push(`  market   (${markets.length}): ${tally(markets, (q) => q.market!.kind)}`);
  return lines.join('\n');
}

/** `<kit.md> <out.json> [--addon <file>]...` → paths, or null on a usage error. */
export function parseArgs(argv: string[]): { input: string; output: string; addons: string[] } | null {
  const positional: string[] = [];
  const addons: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--addon') {
      if (!argv[i + 1]) return null;
      addons.push(argv[++i]);
    } else if (argv[i].startsWith('--')) return null;
    else positional.push(argv[i]);
  }
  if (positional.length !== 2) return null;
  return { input: positional[0], output: positional[1], addons };
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args) {
    console.error('usage: node kit/parse-kit.ts <kit.md> <out.seed.json> [--addon <records.md>]...');
    return 2;
  }
  const { input, output, addons } = args;
  try {
    const markdown = readFileSync(resolve(input), 'utf8');
    const seed = parseKit(markdown, QUANT_TRADER_PROFILE, addons.map((a) => readFileSync(resolve(a), 'utf8')));
    assertCounts(seed, QUANT_TRADER_PROFILE.expectedCounts);
    writeFileSync(resolve(output), JSON.stringify(seed, null, 2) + '\n');
    console.log(summarise(seed));
    console.log(`wrote ${resolve(output)}`);
    return 0;
  } catch (err) {
    if (err instanceof KitParseError) {
      console.error(`parse-kit: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
