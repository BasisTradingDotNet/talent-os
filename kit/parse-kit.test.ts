/**
 * Tests for kit/parse-kit.ts against the SYNTHETIC fixture kit/fixtures/sample-kit.md.
 * Run (from the repo root):  node --test kit/*.test.ts
 * (Node 26 treats positional --test arguments as file globs, so a bare directory does not work.)
 * Never put real kit text in here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUANT_TRADER_PROFILE,
  assertCounts,
  countBySection,
  parseCsv,
  parseDimensions,
  parseIndex,
  parseKit,
  splitRubric,
  type KitProfile,
} from './parse-kit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'sample-kit.md'), 'utf8');

/** Same layout as the real kit, synthetic labels and counts. */
const SAMPLE_PROFILE: KitProfile = {
  ...QUANT_TRADER_PROFILE,
  slug: 'sample',
  version: '0.1',
  title: 'Sample Interview Kit (synthetic)',
  takeHome: {
    ...QUANT_TRADER_PROFILE.takeHome,
    titles: ['Totals', 'Duplicate', 'Chart', 'Assumptions', 'Finding', 'Code'],
  },
  expectedCounts: { S1: 2, A: 3, B: 1, C: 1, T: 6, S4: 1 },
};

const seed = parseKit(fixture, SAMPLE_PROFILE);
const q = (key: string) => {
  const found = seed.questions.find((x) => x.key === key);
  assert.ok(found, `question ${key} missing`);
  return found;
};

test('question counts, order and numbering', () => {
  assertCounts(seed, SAMPLE_PROFILE.expectedCounts);
  assert.deepEqual(countBySection(seed), { S1: 2, A: 3, B: 1, C: 1, T: 6, S4: 1 });
  assert.deepEqual(
    seed.questions.map((x) => x.key),
    ['S1.1', 'S1.2', 'A1', 'A2', 'A3', 'B1', 'C1', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'S4.1'],
  );
});

test('kit header, instructions and dimensions', () => {
  assert.equal(seed.slug, 'sample');
  assert.equal(seed.version, '0.1');
  assert.equal(seed.title, 'Sample Interview Kit (synthetic)');
  assert.equal(seed.orgName, 'BTNET');
  assert.equal(
    seed.candidateInstructions,
    'Use a spreadsheet for anything numerical and talk through your reasoning. Ask if anything is unclear.',
  );
  assert.deepEqual(
    seed.dimensions.map((d) => [d.id, d.name]),
    [
      [1, 'Curiosity'],
      [2, 'Arithmetic'],
      [3, 'Tooling'],
      [4, 'Caution'],
      [5, 'Clarity'],
      [6, 'Initiative'],
      [7, 'Fit with the team'],
      [8, 'Leadership view'],
    ],
  );
});

test('sections carry the profile config, computed maxScore and notes from the markdown', () => {
  assert.deepEqual(
    seed.sections.map((s) => [s.key, s.stage, s.scoring, s.maxScore, s.timeMinutes]),
    [
      ['S1', 1, 'dimensions', null, 30],
      ['A', 2, 'rubric', 9, 40],
      ['B', 2, 'rubric', 3, 60],
      ['C', 2, 'rubric', 3, 75],
      ['T', 3, 'rubric', 18, null],
      ['S4', 4, 'dimensions', null, 45],
    ],
  );
  const [s1, a, , , t, s4] = seed.sections;
  assert.equal(s1.interviewerNotes, 'Mode: verbal. Not scored 0–3; rate dimensions 1, 5, 6, 7 and write a recommendation.');
  assert.deepEqual(s1.dimensionIds, [1, 5, 6, 7]);
  assert.deepEqual(s1.recommendationOptions, ['Proceed', 'Hold', 'Decline']);
  assert.equal(a.interviewerNotes, null);
  assert.equal(a.candidateView, true);
  assert.equal(a.showInstructions, true);
  assert.deepEqual(a.bands, [{ min: 24, label: 'Pass — progress to Set B' }]);
  assert.deepEqual(a.domainGroups, [
    { domain: 'quant', label: 'Quant' },
    { domain: 'python', label: 'Python' },
  ]);
  assert.ok(t.interviewerNotes?.startsWith('### 6.1 Brief (send to the candidate)\n\nYou are given `sales.csv`'));
  assert.ok(t.interviewerNotes?.includes('### 6.2 Data specification\n\n- `sales.csv`'));
  assert.ok(t.interviewerNotes?.endsWith('Planted feature: one duplicated row.'));
  assert.ok(!t.interviewerNotes?.includes('6.3'));
  assert.equal(s4.interviewerNotes, 'Mode: verbal. Rated on dimensions 4, 5, 6, 7 plus leadership judgement.');
  assert.deepEqual(s4.dimensionIds, [4, 5, 6, 7, 8]);
  assert.equal(s4.candidateView, false);
  // Property set is exactly SectionSeed's.
  assert.deepEqual(Object.keys(a).sort(), [
    'bands', 'candidateLabel', 'candidateView', 'dimensionIds', 'domainGroups', 'interviewerNotes', 'key',
    'label', 'maxScore', 'recommendationOptions', 'scoring', 'showInstructions', 'stage', 'timeMinutes',
  ]);
});

test('stage 1 record: prompt and what-good-looks-like, everything else null', () => {
  assert.deepEqual(q('S1.1'), {
    key: 'S1.1',
    section: 'S1',
    stage: 1,
    number: 1,
    title: 'Tell me about a spreadsheet',
    domain: 'screening',
    difficulty: null,
    mode: 'verbal',
    timeMinutes: 4,
    prompt: 'Describe a spreadsheet you built that other people used.',
    dataset: null,
    code: null,
    modelAnswer: null,
    rubric: null,
    trapOrBonus: null,
    whatGoodLooksLike: 'Names the users and what broke.',
  });
  assert.equal(q('S1.2').number, 2);
  assert.equal(q('S1.2').whatGoodLooksLike, 'A reason beyond "it sounds fun".');
});

test('stage 2 record with a dataset keeps inline markdown, fence content and the trap note', () => {
  const a1 = q('A1');
  assert.equal(a1.section, 'A');
  assert.equal(a1.stage, 2);
  assert.equal(a1.domain, 'quant');
  assert.equal(a1.difficulty, 'easy');
  assert.equal(a1.mode, 'sheet');
  assert.equal(a1.timeMinutes, 4);
  assert.equal(a1.prompt, 'Paste these four sales into a sheet and compute the **mean** price per cup.');
  assert.deepEqual(a1.dataset, { format: 'csv', text: 'cup,price\n1,3.00\n2,3.50\n3,2.50\n4,4.00' });
  assert.equal(a1.code, null);
  assert.equal(a1.modelAnswer, 'Mean **3.25**.');
  assert.deepEqual(a1.rubric, {
    '3': '3.25 with the 4-cup logic stated.',
    '2': 'right number, no working.',
    '1': 'sums but does not divide (e.g. 13 total).',
    '0': 'otherwise.',
  });
  assert.equal(a1.trapOrBonus, 'Bonus: asks whether prices include tax.');
  assert.equal(a1.whatGoodLooksLike, null);
  assert.equal(q('A2').trapOrBonus, null);
  assert.equal(q('A2').dataset, null);
});

test('code block keeps indentation and blank lines, language from the label', () => {
  const a3 = q('A3');
  assert.deepEqual(a3.code, {
    language: 'python',
    text: 'def total(xs):\n    t = 0\n    for x in xs:\n        t += x\n    return t\n\nprint(total([1, 2, 3]))',
  });
  assert.equal(a3.dataset, null);
  assert.equal(a3.domain, 'python');
  assert.deepEqual(a3.rubric, { '3': 'exact.', '2': 'right number, wrong type.', '1': 'says `[1, 2, 3]`.', '0': 'otherwise.' });
});

test('dataset with a trailing empty field keeps it and validates as a full column', () => {
  const b1 = q('B1');
  assert.equal(b1.dataset?.text, 'shop,cups,note\nnorth,120,busy\nsouth,80,');
  assert.deepEqual(parseCsv(b1.dataset!.text).map((r) => r.length), [3, 3, 3]);
});

test('take-home criteria become T1–T6 with the generic score table as rubric', () => {
  const t = seed.questions.filter((x) => x.section === 'T');
  assert.deepEqual(
    t.map((x) => [x.key, x.number, x.title, x.prompt]),
    [
      ['T1', 1, 'Totals', 'Totals are correct'],
      ['T2', 2, 'Duplicate', 'The duplicate is found'],
      ['T3', 3, 'Chart', 'The chart is readable'],
      ['T4', 4, 'Assumptions', 'Assumptions are stated'],
      ['T5', 5, 'Finding', 'The finding is actionable'],
      ['T6', 6, 'Code', 'The code runs'],
    ],
  );
  for (const x of t) {
    assert.equal(x.stage, 3);
    assert.equal(x.domain, 'takehome');
    assert.equal(x.mode, 'take-home');
    assert.equal(x.difficulty, null);
    assert.equal(x.timeMinutes, null);
    assert.equal(x.modelAnswer, null);
    assert.equal(x.dataset, null);
    assert.equal(x.code, null);
    assert.equal(x.trapOrBonus, null);
    assert.equal(x.whatGoodLooksLike, null);
    assert.deepEqual(x.rubric, {
      '3': 'Fully right, explained clearly',
      '2': 'Right idea, small slip',
      '1': 'Partly right',
      '0': 'Wrong or blank',
    });
  }
  // Each question gets its own rubric object.
  assert.notEqual(t[0].rubric, t[1].rubric);
});

test('stage 4 record', () => {
  const s41 = q('S4.1');
  assert.equal(s41.section, 'S4');
  assert.equal(s41.stage, 4);
  assert.equal(s41.domain, 'judgement');
  assert.equal(s41.timeMinutes, 6);
  assert.equal(s41.whatGoodLooksLike, 'Owns it, fixes it, writes it down.');
  assert.equal(s41.rubric, null);
});

test('every question has exactly the QuestionSeed fields', () => {
  const expected = [
    'code', 'dataset', 'difficulty', 'domain', 'key', 'mode', 'modelAnswer', 'number', 'prompt', 'rubric',
    'section', 'stage', 'timeMinutes', 'title', 'trapOrBonus', 'whatGoodLooksLike',
  ];
  for (const x of seed.questions) assert.deepEqual(Object.keys(x).sort(), expected, x.key);
});

test('output round-trips through JSON unchanged', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(seed)), seed);
});

// --- splitRubric -------------------------------------------------------------------------------

test('splitRubric: parenthesised numbers and quoted level text do not break the split', () => {
  assert.deepEqual(
    splitRubric('3 = (1), (2) and (3) plus a coherent fix. 2 = two of the three. 1 = one. 0 = "looks fine".'),
    { '3': '(1), (2) and (3) plus a coherent fix.', '2': 'two of the three.', '1': 'one.', '0': '"looks fine".' },
  );
});

test('splitRubric: digits inside levels (3×365, e.g. 365, `[2]`, 1/3, 99%) are not level markers', () => {
  assert.deepEqual(
    splitRubric('3 = both correct with the 3×365 logic stated. 2 = simple correct. 1 = wrong count (e.g. 365 payments). 0 = otherwise.'),
    { '3': 'both correct with the 3×365 logic stated.', '2': 'simple correct.', '1': 'wrong count (e.g. 365 payments).', '0': 'otherwise.' },
  );
  assert.deepEqual(splitRubric('3 = output, cause, and fix. 2 = output and cause. 1 = output only. 0 = says `[2]`.'), {
    '3': 'output, cause, and fix.',
    '2': 'output and cause.',
    '1': 'output only.',
    '0': 'says `[2]`.',
  });
  assert.deepEqual(splitRubric('3 = the number 1/3 and the implication. 2 = the number only. 1 = sets up Bayes. 0 = says 99%.'), {
    '3': 'the number 1/3 and the implication.',
    '2': 'the number only.',
    '1': 'sets up Bayes.',
    '0': 'says 99%.',
  });
  assert.deepEqual(splitRubric('3 = (1), (2) and (4). 2 = two of them. 1 = (1) only. 0 = otherwise.'), {
    '3': '(1), (2) and (4).',
    '2': 'two of them.',
    '1': '(1) only.',
    '0': 'otherwise.',
  });
});

test('splitRubric: multi-line text and surrounding whitespace', () => {
  assert.deepEqual(splitRubric('  3 = a.\n2 = b.\n1 = c.\n0 = d.  '), { '3': 'a.', '2': 'b.', '1': 'c.', '0': 'd.' });
});

test('splitRubric: missing, empty or misordered levels are errors', () => {
  assert.throws(() => splitRubric('3 = a. 2 = b. 0 = d.'), /no "1 = " level/);
  assert.throws(() => splitRubric('2 = b. 3 = a. 1 = c. 0 = d.'), /must start with "3 = "/);
  assert.throws(() => splitRubric('3 = a. 2 = 1 = c. 0 = d.'), /level 2 is empty/);
  assert.throws(() => splitRubric(''), /must start with "3 = "/);
});

// --- helpers -----------------------------------------------------------------------------------

test('parseCsv: trailing empty field and quoted commas', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,\n"x,y",3,4'), [['a', 'b', 'c'], ['1', '2', ''], ['x,y', '3', '4']]);
});

test('parseDimensions: numbered, dot-separated list', () => {
  assert.deepEqual(parseDimensions('1. One · 2. Two & more'), [
    { id: 1, name: 'One' },
    { id: 2, name: 'Two & more' },
  ]);
  assert.throws(() => parseDimensions('1. One · 3. Three'), /contiguous/);
});

test('parseIndex: dashes become null, yes/no become booleans', () => {
  const rows = parseIndex(
    '| id | stage | set | num | domain | difficulty | mode | time_min | dataset | code |\n|---|---|---|---|---|---|---|---|---|---|\n| S1.1 | 1 | — | 1 | screening | — | verbal | 5 | no | no |\n| A5 | 2 | A | 5 | quant | easy | sheet | 6 | yes | no |',
  );
  assert.deepEqual(rows, [
    { id: 'S1.1', stage: 1, set: null, num: 1, domain: 'screening', difficulty: null, mode: 'verbal', timeMin: 5, dataset: false, code: false },
    { id: 'A5', stage: 2, set: 'A', num: 5, domain: 'quant', difficulty: 'easy', mode: 'sheet', timeMin: 6, dataset: true, code: false },
  ]);
});

// --- validation --------------------------------------------------------------------------------

test('validation: a record that disagrees with its index row fails, naming the field', () => {
  const broken = fixture.replace('| A2 | 2 | A | 2 | quant | easy | verbal | 2 | no | no |', '| A2 | 2 | A | 2 | quant | easy | verbal | 3 | no | no |');
  assert.throws(() => parseKit(broken, SAMPLE_PROFILE), /A2 does not match its index row — time_min: parsed 2 vs index 3/);
  const noCode = fixture.replace('| A3 | 2 | A | 3 | python | easy | verbal | 2 | no | yes |', '| A3 | 2 | A | 3 | python | easy | verbal | 2 | no | no |');
  assert.throws(() => parseKit(noCode, SAMPLE_PROFILE), /A3 does not match its index row — code: parsed true vs index false/);
});

test('validation: a record missing from the index, or an index row without a record, fails', () => {
  const missingRow = fixture.replace('| C1 | 2 | C | 1 | python | hard | verbal | 6 | no | no |\n', '');
  assert.throws(() => parseKit(missingRow, SAMPLE_PROFILE), /C1 has no row in the index table/);
  const extraRow = fixture.replace('| S4.1 | 4 |', '| S4.2 | 4 | — | 2 | judgement | — | verbal | 6 | no | no |\n| S4.1 | 4 |');
  assert.throws(() => parseKit(extraRow, SAMPLE_PROFILE), /Index lists S4.2 but no such record/);
});

test('validation: non-contiguous numbering and unknown labels fail', () => {
  const renumbered = fixture.replace('- id: A3 | set: A | number: 3', '- id: A3 | set: A | number: 4').replace('| A3 | 2 | A | 3 |', '| A3 | 2 | A | 4 |');
  assert.throws(() => parseKit(renumbered, SAMPLE_PROFILE), /Section A: question numbers are not contiguous/);
  const typo = fixture.replace('**Model answer:** Mean **3.25**.', '**Model answr:** Mean **3.25**.');
  assert.throws(() => parseKit(typo, SAMPLE_PROFILE), /A1: unknown block label "Model answr"/);
});

test('validation: leftover labels or stray fences inside a field fail', () => {
  const leftover = fixture.replace('Two fair coins are tossed.', 'Two fair coins are tossed. **Scoring:** inline');
  assert.throws(() => parseKit(leftover, SAMPLE_PROFILE), /A2 prompt contains a leftover label or code fence/);
});

test('validation: rubric-section questions need a model answer and four rubric levels', () => {
  const noAnswer = fixture.replace('**Model answer:** 1 − 0.25 = **3/4**.\n\n', '');
  assert.throws(() => parseKit(noAnswer, SAMPLE_PROFILE), /A2: missing model answer/);
  const threeLevels = fixture.replace(' 1 = says 1/2. 0 = otherwise.', ' 0 = otherwise.');
  assert.throws(() => parseKit(threeLevels, SAMPLE_PROFILE), /no "1 = " level/);
});

test('validation: ragged CSV rows fail', () => {
  const ragged = fixture.replace('south,80,', 'south,80');
  assert.throws(() => parseKit(ragged, SAMPLE_PROFILE), /B1: dataset row 2 has 2 columns, header has 3/);
});

test('validation: title mismatch and expected counts', () => {
  assert.throws(() => parseKit(fixture, QUANT_TRADER_PROFILE), /does not match profile title/);
  assert.throws(() => assertCounts(seed, { ...SAMPLE_PROFILE.expectedCounts, A: 10 }), /Section A: expected 10 questions, got 3/);
});
