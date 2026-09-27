/**
 * Mock-mode walk-through (the manual test plan, automated). Run with the dev server up:
 *   VITE_MOCK=1 npx vite --port 5174
 *   CHROME_PATH="/path/to/Chromium" node scripts/mock-drive.mjs      # or `npx playwright-core install chromium` first
 * Creates a candidate, runs Set A as a RECORDED written test with a second page on the candidate
 * link (consent → fake camera/screen → recording pill → typed answer → integrity flags → share
 * stopped/re-shared → time-up + extension → End → upload flush → "All done"), asserting the
 * candidate page never shows the title / model answer / rubric, then scores to a verdict and
 * rates an S1 session. Screenshots land in /tmp/talent-os-rec-*.png.
 *
 * Fake media: the page is started with `window.__talentOsFakeMedia = true`, which makes the
 * (dev/mock-only) media layer return canvas + oscillator streams instead of real devices.
 */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_PATH;
const BASE = process.env.UI_URL ?? 'http://127.0.0.1:5174';
const SHOT = (name) => `/tmp/talent-os-rec-${name}.png`;
const fails = [];
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: EXE || undefined,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
ctx.setDefaultTimeout(10000);
await ctx.addInitScript(() => { window.__talentOsFakeMedia = true; });
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
check(await page.getByTestId('record-A').isChecked(), 'Record checkbox defaults ON for Set A (candidate view)');
check(!(await page.getByTestId('record-S1').isChecked()), 'Record checkbox defaults OFF for S1 (no candidate view)');
await page.screenshot({ path: SHOT('profile') });

await page.getByTestId('start-A').click();
await page.waitForURL(/\/sessions\/s\d+$/);
const sessionId = page.url().split('/').pop();
check(true, 'session created → console ' + page.url());
check((await page.getByTestId('chip-consent').innerText()).includes('pending'), 'console shows Consent pending before the candidate accepts');
await page.getByTestId('start').click();
await page.getByTestId('end').waitFor();
check(await page.locator('.chip', { hasText: 'live' }).first().isVisible(), 'status chip live');
check(await page.getByTestId('section-countdown').isVisible(), 'console shows the section countdown');
const url = await page.getByTestId('candidate-url').inputValue();
check(/\/c\/tok-/.test(url), 'candidate url ' + url);

// ---- candidate: consent → devices → recording ---------------------------------------------------
const cpage = await ctx.newPage();
cpage.on('pageerror', (e) => console.log('C PAGEERROR', e.message));
cpage.on('console', (m) => { if (m.type() === 'error') console.log('C CONSOLE', m.text()); });
await cpage.goto(url);
await cpage.getByTestId('consent').waitFor();
check((await cpage.getByTestId('consent-text').innerText()).includes('recorded'), 'candidate sees the consent notice');
check((await cpage.getByTestId('question').count()) === 0 && (await cpage.getByTestId('rec-pill').count()) === 0, 'nothing shown or recorded before consent');
check(await cpage.getByTestId('consent-continue').isDisabled(), 'Continue disabled until "I agree" is ticked');
await cpage.screenshot({ path: SHOT('candidate-consent'), fullPage: true });
await cpage.getByTestId('consent-agree').check();
await cpage.getByTestId('consent-continue').click();
await cpage.getByTestId('devices').waitFor();
check(true, 'consent accepted → device setup');
await cpage.getByTestId('camera-on').click();
await cpage.getByText('Camera and microphone are on.').waitFor();
await cpage.screenshot({ path: SHOT('candidate-devices'), fullPage: true });
await cpage.getByTestId('screen-share').click();
await cpage.getByTestId('rec-pill').waitFor();
check(true, 'both devices → recording pill visible');
await cpage.getByText('Before we begin').waitFor();
check(true, 'candidate proceeds to the intro screen once recording');
await page.getByTestId('chip-consent').filter({ hasText: '✓' }).waitFor({ timeout: 6000 });
check(true, 'console shows Consent ✓ (polling)');
await page.getByTestId('chip-camera').filter({ hasText: 'live' }).waitFor({ timeout: 15000 });
await page.getByTestId('chip-screen').filter({ hasText: 'live' }).waitFor({ timeout: 15000 });
check(true, 'console shows Camera live and Screen live after the first chunks');
await cpage.getByTestId('upload-status').filter({ hasText: 'uploads up to date' }).waitFor({ timeout: 15000 });
check(true, 'candidate pill says uploads up to date');
check(await cpage.getByTestId('section-countdown').isVisible(), 'candidate shows the section countdown');

// ---- present A1, candidate types an answer -----------------------------------------------------
await page.getByTestId('next').click();
await page.locator('[data-testid=nav-A1] .chip', { hasText: 'live' }).waitFor();
check(true, 'Next presented A1');
await cpage.getByTestId('question').waitFor();
const text = await cpage.locator('body').innerText();
check(text.includes('Question 1 of 4'), 'candidate shows Question 1 of 4');
check(text.includes('Paste these five daily returns'), 'candidate shows prompt');
check(await cpage.locator('[data-testid=dataset] table th', { hasText: 'return_pct' }).isVisible(), 'candidate shows dataset table');
check(await cpage.getByTestId('countdown').isVisible(), 'candidate shows countdown');
check(text.includes('Work in your own spreadsheet as usual'), 'candidate shows the answer hint');
for (const forbidden of ['Mean and standard deviation', 'STDEV.S', 'sample stdev named', 'five observations say nothing', 'A1', 'Rubric', 'Model answer', 'Test Candidate']) {
  check(!text.includes(forbidden), `candidate view does NOT contain "${forbidden}"`);
}
check((await page.getByTestId('answer-panel').innerText()).includes('No answer typed yet'), 'console answer panel empty state');
await cpage.getByTestId('answer-text').fill('mean = 0.06%, stdev = 0.114% (sample)');
await cpage.getByTestId('answer-status').filter({ hasText: 'Saved ✓' }).waitFor({ timeout: 5000 });
check(true, 'candidate answer autosaved');
await page.getByTestId('answer-text-console').filter({ hasText: 'stdev = 0.114%' }).waitFor({ timeout: 4000 });
check(true, 'console shows the typed answer within ~3 s');
check((await page.getByTestId('answer-panel').innerText()).includes('updated'), 'console answer panel shows "updated … ago"');

// ---- integrity flags: paste + tab hidden + blur -------------------------------------------------
await cpage.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'hello world');
  document.getElementById('answer-text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('blur'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});
await page.getByTestId('chip-flags').filter({ hasText: 'Flags 3' }).waitFor({ timeout: 8000 });
check(true, 'console shows Flags 3 (paste, tab hidden, window blur)');
await page.getByTestId('chip-flags').click();
await page.getByTestId('flags-drawer').waitFor();
const drawer = await page.getByTestId('flags-drawer').innerText();
check(drawer.includes('11 chars'), 'paste logged as "11 chars" (length only)');
check(!drawer.includes('hello world'), 'pasted content is never shown');
check(drawer.includes('tab_hidden') && drawer.includes('page_loaded') && drawer.includes('devices_ready'), 'drawer lists tab_hidden, page_loaded, devices_ready');
await page.screenshot({ path: SHOT('console-flags'), fullPage: true });
await page.locator('[data-testid=flags-drawer] button').first().click();

// ---- screen share stopped → overlay → re-share = new segment -----------------------------------
await cpage.evaluate(() => window.__talentOsFake.endScreen());
await cpage.getByTestId('overlay-screen').waitFor();
check(true, 'screen share ended → blocking overlay');
await cpage.screenshot({ path: SHOT('candidate-overlay') });
await cpage.getByTestId('reshare-screen').click();
await cpage.getByTestId('overlay-screen').waitFor({ state: 'hidden' });
check(true, 're-share clears the overlay');
await page.locator('[data-testid=segment-screen]').nth(1).waitFor({ timeout: 8000 });
check((await page.getByTestId('segment-screen').count()) === 2, 'console lists 2 screen segments after re-share');
await page.getByTestId('chip-flags').filter({ hasText: 'Flags 4' }).waitFor({ timeout: 8000 });
check(true, 'screen_share_stopped counted as a flag');
check((await page.getByTestId('player-camera').count()) === 1 && (await page.getByTestId('player-screen').count()) === 1, 'recordings panel shows camera and screen players');
await page.getByTestId('jump').click();
check(true, '"Jump to this question" clickable');
await cpage.screenshot({ path: SHOT('candidate-question'), fullPage: true });

// Reveal toggles on the console: hidden by default, reveal all shows them
check((await page.getByTestId('revealed').count()) === 0, 'console hides model answer by default');
await page.getByTestId('reveal-all').click();
check((await page.getByTestId('revealed').count()) === 3, 'reveal all shows 3 hidden blocks for A1');
await page.getByTestId('nav-A2').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=revealed]').length === 0);
check(true, 'reveal state resets on selection change');
check(await page.getByText('Candidate is on A1').isVisible(), 'peek banner shows');
await page.getByTestId('present').click();
await page.locator('[data-testid=nav-A2] .chip', { hasText: 'live' }).waitFor();
await cpage.getByText('Question 2 of 4').waitFor({ timeout: 5000 });
check(true, 'candidate tab followed to Question 2 of 4');
const t2 = await cpage.locator('body').innerText();
check(!t2.includes('At least one head') && !t2.includes('7/8'), 'candidate Q2 hides title and answer');
check((await cpage.getByTestId('answer-text').inputValue()) === '', 'answer box is empty for the new question');
await cpage.getByTestId('answer-text').fill('1 - (1/2)^3 = 7/8');
await cpage.getByTestId('answer-status').filter({ hasText: 'Saved ✓' }).waitFor({ timeout: 5000 });
// Back to A1: the earlier answer is restored from the server.
await page.getByTestId('nav-A1').click();
await page.getByTestId('present').click();
await cpage.getByText('Question 1 of 4').waitFor({ timeout: 5000 });
check((await cpage.getByTestId('answer-text').inputValue()).includes('stdev = 0.114%'), 'returning to A1 restores the saved answer');

// ---- time-up lock and +5 min extension (mock: rewind startedAt) --------------------------------
await page.evaluate((id) => {
  const s = JSON.parse(localStorage.getItem('talent-os-mock-v1'));
  const row = s.sessions.find((x) => x.id === id);
  const sec = s.kit.sections.find((x) => x.key === row.section);
  row.startedAt = new Date(Date.now() - (sec.timeMinutes + row.extensionMinutes) * 60000 - 20000).toISOString();
  row.version += 1;
  localStorage.setItem('talent-os-mock-v1', JSON.stringify(s));
}, sessionId);
await cpage.getByTestId('time-up').waitFor({ timeout: 6000 });
check(await cpage.getByTestId('answer-text').evaluate((el) => el.readOnly), 'time up → answer box locked read-only');
check((await cpage.getByTestId('section-countdown').innerText()).includes("Time's up"), 'candidate countdown shows Time\'s up');
await page.getByTestId('section-countdown').filter({ hasText: "Time's up" }).waitFor({ timeout: 6000 });
check(true, 'console countdown shows Time\'s up');
await cpage.screenshot({ path: SHOT('candidate-timeup'), fullPage: true });
await page.getByTestId('extend').click();
await cpage.getByTestId('time-up').waitFor({ state: 'hidden', timeout: 6000 });
check(!(await cpage.getByTestId('answer-text').evaluate((el) => el.readOnly)), '+5 min → answer box unlocked');
check((await page.getByTestId('extend').innerText()).includes('+5'), 'console shows the extension');

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
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('0');
await page.locator('[data-testid=score-0][aria-pressed=true]').waitFor();
check(true, 'keyboard score 0 works');
await page.keyboard.press('1');
await page.locator('[data-testid=score-1][aria-pressed=true]').waitFor();
await page.getByTestId('set-notes').fill('Set-level note.');
await page.getByTestId('set-notes').blur();
await sleep(2500); // let two polls pass: the note must survive them
check((await page.getByTestId('set-notes').inputValue()) === 'Set-level note.', 'set notes survive polling');
check((await page.getByTestId('question-notes').inputValue()) === 'Solid reasoning, stated assumptions.', 'question notes survive polling');
await page.screenshot({ path: SHOT('console'), fullPage: true });

// Refresh restores
await page.reload();
await page.getByTestId('result-chip').waitFor();
check((await page.getByTestId('running-total').innerText()).includes('9/12'), 'refresh restores total');
check(await page.locator('[data-testid=nav-A1] .chip', { hasText: 'live' }).isVisible(), 'refresh restores presented marker');

// End with confirm → candidate flushes uploads → All done
page.once('dialog', (d) => d.accept());
await page.getByTestId('end').click();
await page.getByRole('button', { name: 'Reopen' }).waitFor();
await cpage.getByTestId('all-done').waitFor({ timeout: 20000 });
check(true, 'end → candidate flushed uploads and shows "All done"');
check((await cpage.getByTestId('rec-pill').count()) === 0, 'recording pill gone after the end');
await cpage.screenshot({ path: SHOT('candidate-ended') });
await sleep(2500);
await page.reload();
await page.getByTestId('recordings').waitFor();
const segs = (await page.getByTestId('recordings').innerText()).replace(/\s+/g, ' ');
check(!segs.includes('recording') && segs.includes('ended'), 'all segments ended after the session ended: ' + segs.slice(0, 160));
check((await page.getByTestId('segment-camera').count()) === 1 && (await page.getByTestId('segment-screen').count()) === 2, 'segments: 1 camera, 2 screen');
await page.screenshot({ path: SHOT('console-ended'), fullPage: true });

// Invalid token
await cpage.goto(BASE + '/c/nope');
await cpage.getByText('This link is not valid').waitFor();
check(true, '404 → friendly message');

// S1 dimension session (no candidate view → no recording)
const candUrl = (await page.locator('a', { hasText: 'Test Candidate' }).first().getAttribute('href'));
await page.goto(BASE + candUrl);
check((await page.getByTestId('recorded-badge').first().innerText()).includes('rec'), 'profile shows the recorded badge for Set A');
await page.getByTestId('start-S1').click();
await page.waitForURL(/\/sessions\/s\d+$/);
await page.getByTestId('start').click();
await page.getByTestId('end').waitFor();
check((await page.getByTestId('score-3').count()) === 0, 'S1 has no 0-3 score buttons');
check((await page.getByTestId('chip-consent').count()) === 0, 'S1 (not recorded) shows no consent chip');
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
await page.screenshot({ path: SHOT('console-s1'), fullPage: true });

// Candidates table + scorecard + settings
await page.goto(BASE + '/');
await page.getByText('Test Candidate').waitFor();
const tbl = (await page.locator('table').innerText()).replace(/\s+/g, ' ');
check(tbl.includes('9/12') && tbl.includes('Proceed'), 'comparison table shows rubric total and recommendation');
check(tbl.includes('rec') && /\b4\b/.test(tbl), 'comparison table shows recorded icon and 4 flags');
await page.screenshot({ path: SHOT('candidates'), fullPage: true });
await page.goto(BASE + candUrl + '/scorecard');
await page.getByText('Candidate scorecard').waitFor();
await page.getByTestId('scorecard-answers').waitFor();
const sc = await page.getByTestId('scorecard-answers').innerText();
check(sc.includes('stdev = 0.114%') && sc.includes('7/8'), 'scorecard includes the candidate answers for A1 and A2');
await page.screenshot({ path: SHOT('scorecard'), fullPage: true });
await page.goto(BASE + '/settings');
await page.getByText('Set A — Easy (screening)').waitFor();

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
