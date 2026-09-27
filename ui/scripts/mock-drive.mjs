/**
 * Mock-mode walk-through (the manual test plan, automated). Run with the dev server up:
 *   VITE_MOCK=1 npx vite --port 5174
 *   CHROME_PATH="/path/to/Chromium" node scripts/mock-drive.mjs      # or `npx playwright-core install chromium` first
 * Creates a candidate, runs Set A with a second page on the candidate link (asserting it shows the
 * prompt + dataset and never the title / model answer / rubric), copies TSV, scores to a verdict,
 * ends, then rates an S1 session. Screenshots land in /tmp/talent-os-ui-*.png.
 */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_PATH;
const BASE = process.env.UI_URL ?? 'http://127.0.0.1:5174';
const fails = [];
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXE || undefined, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
ctx.setDefaultTimeout(8000);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });

await page.goto(BASE + '/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByTestId('new-name').fill('Test Candidate');
await page.getByTestId('create-candidate').click();
await page.waitForURL(/\/candidates\/c\d+$/);
check(true, 'candidate created → profile ' + page.url());
await page.screenshot({ path: '/tmp/talent-os-ui-profile.png' });

await page.getByTestId('start-A').click();
await page.waitForURL(/\/sessions\/s\d+$/);
check(true, 'session created → console ' + page.url());
await page.getByTestId('start').click();
await page.getByTestId('end').waitFor();
check(await page.locator('.chip', { hasText: 'live' }).first().isVisible(), 'status chip live');
await page.getByTestId('next').click();
await page.locator('[data-testid=nav-A1] .chip', { hasText: 'live' }).waitFor();
check(true, 'Next presented A1');
const url = await page.getByTestId('candidate-url').inputValue();
check(/\/c\/tok-/.test(url), 'candidate url ' + url);

const cpage = await ctx.newPage();
cpage.on('pageerror', (e) => console.log('C PAGEERROR', e.message));
await cpage.goto(url);
await cpage.getByTestId('question').waitFor();
const text = await cpage.locator('body').innerText();
check(text.includes('Question 1 of 4'), 'candidate shows Question 1 of 4');
check(text.includes('Paste these five daily returns'), 'candidate shows prompt');
check(await cpage.locator('[data-testid=dataset] table th', { hasText: 'return_pct' }).isVisible(), 'candidate shows dataset table');
check(await cpage.getByTestId('countdown').isVisible(), 'candidate shows countdown');
for (const forbidden of ['Mean and standard deviation', 'STDEV.S', 'sample stdev named', 'five observations say nothing', 'A1', 'Rubric', 'Model answer', 'Test Candidate']) {
  check(!text.includes(forbidden), `candidate view does NOT contain "${forbidden}"`);
}
await cpage.getByRole('button', { name: 'Copy as TSV' }).click();
await cpage.getByRole('button', { name: 'Copied ✓' }).waitFor();
const clip = await cpage.evaluate(() => navigator.clipboard.readText());
check(clip === 'day\treturn_pct\n1\t0.20\n2\t-0.10\n3\t0.05\n4\t0.15\n5\t0.00', 'TSV clipboard content: ' + JSON.stringify(clip));
await cpage.screenshot({ path: '/tmp/talent-os-ui-candidate-question.png', fullPage: true });

// Reveal toggles on the console: hidden by default, reveal all shows them
check((await page.getByTestId('revealed').count()) === 0, 'console hides model answer by default');
await page.getByTestId('reveal-all').click();
check((await page.getByTestId('revealed').count()) === 3, 'reveal all shows 3 hidden blocks for A1');
await page.getByTestId('nav-A2').click();
check((await page.getByTestId('revealed').count()) === 0, 'reveal state resets on selection change');
check(await page.getByText("Candidate is on A1").isVisible(), 'peek banner shows');
await page.getByTestId('present').click();
await page.locator('[data-testid=nav-A2] .chip', { hasText: 'live' }).waitFor();
// candidate follows
await cpage.getByText('Question 2 of 4').waitFor({ timeout: 5000 });
check(true, 'candidate tab followed to Question 2 of 4');
const t2 = await cpage.locator('body').innerText();
check(!t2.includes('At least one head') && !t2.includes('7/8'), 'candidate Q2 hides title and answer');

// Score all: A1=3, A2=2, A3=3, A4=1 → 9/12, band min 9
const scores = { A1: 3, A2: 2, A3: 3, A4: 1 };
for (const [k, s] of Object.entries(scores)) {
  await page.getByTestId('nav-' + k).click();
  await page.getByTestId('score-' + s).click();
  await page.locator(`[data-testid=score-${s}][aria-pressed=true]`).waitFor();
}
await page.getByTestId('question-notes').fill('Solid reasoning, stated assumptions.');
await page.getByTestId('trap').check();
await page.getByText('Saved').first().waitFor();
await page.getByTestId('result-chip').waitFor();
const chip = await page.getByTestId('result-chip').innerText();
const total = await page.getByTestId('running-total').innerText();
check(chip.includes('Pass'), 'result chip: ' + chip);
check(total.replace(/\s+/g, ' ').includes('9/12 · Quant 5/6 · Python 4/6'), 'running total: ' + total);
// keyboard: press 0 on A4 while focus not in a text field → toggles/sets 0
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('0');
await page.locator('[data-testid=score-0][aria-pressed=true]').waitFor();
check(true, 'keyboard score 0 works');
await page.keyboard.press('1');
await page.locator('[data-testid=score-1][aria-pressed=true]').waitFor();
await page.getByTestId('set-notes').fill('Set-level note.');
await page.screenshot({ path: '/tmp/talent-os-ui-console.png', fullPage: true });

// Refresh restores
await page.reload();
await page.getByTestId('result-chip').waitFor();
check((await page.getByTestId('running-total').innerText()).includes('9/12'), 'refresh restores total');
check(await page.locator('[data-testid=nav-A2] .chip', { hasText: 'live' }).isVisible(), 'refresh restores presented marker');

// End with confirm
page.once('dialog', (d) => d.accept());
await page.getByTestId('end').click();
await page.getByRole('button', { name: 'Reopen' }).waitFor();
await cpage.getByText('this part is complete').waitFor();
check(true, 'end → candidate sees ended');
await cpage.screenshot({ path: '/tmp/talent-os-ui-candidate-ended.png' });

// Invalid token
await cpage.goto(BASE + '/c/nope');
await cpage.getByText('This link is not valid').waitFor();
check(true, '404 → friendly message');

// S1 dimension session
const candUrl = (await page.locator('a', { hasText: 'Test Candidate' }).first().getAttribute('href'));
await page.goto(BASE + candUrl);
await page.getByTestId('start-S1').click();
await page.waitForURL(/\/sessions\/s\d+$/);
await page.getByTestId('start').click();
await page.getByTestId('end').waitFor();
check((await page.getByTestId('score-3').count()) === 0, 'S1 has no 0-3 score buttons');
await page.getByTestId('rate-1-4').click();
await page.locator('[data-testid=rate-1-4][aria-pressed=true]').waitFor();
await page.getByTestId('rate-5-3').click();
await page.locator('[data-testid=rate-5-3][aria-pressed=true]').waitFor();
await page.getByTestId('rate-5-3').click();
await page.locator('[data-testid=rate-5-3][aria-pressed=false]').waitFor();
check(true, 'rating click-again clears');
await page.getByTestId('rate-5-5').click();
await page.getByTestId('recommendation').selectOption('Proceed');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/talent-os-ui-console-s1.png', fullPage: true });

// Candidates table + scorecard + settings
await page.goto(BASE + '/');
await page.getByText('Test Candidate').waitFor();
const tbl = (await page.locator('table').innerText()).replace(/\s+/g, ' ');
check(tbl.includes('9/12') && tbl.includes('Proceed'), 'comparison table shows rubric total and recommendation');
await page.screenshot({ path: '/tmp/talent-os-ui-candidates.png', fullPage: true });
await page.goto(BASE + candUrl + '/scorecard');
await page.getByText('Candidate scorecard').waitFor();
await page.screenshot({ path: '/tmp/talent-os-ui-scorecard.png', fullPage: true });
await page.goto(BASE + '/settings');
await page.getByText('Set A — Easy (screening)').waitFor();
await page.screenshot({ path: '/tmp/talent-os-ui-settings.png', fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
