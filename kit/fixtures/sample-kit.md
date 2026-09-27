# Sample Interview Kit (synthetic)

**Version 0.1 · Synthetic fixture for kit/parse-kit.test.ts · Owner: nobody**

Invented content only. Nothing in this file is a real interview question, answer or rubric. It mirrors the layout of a real kit: numbered sections, `### <ID> · <Title>` records with a metadata line and labelled blocks, and a machine-readable index at the end.

---

## 3. Scoring system

### 3.1 Per-question score (Stage 2 and Stage 3)

| Score | Meaning |
|---|---|
| 3 | Fully right, explained clearly |
| 2 | Right idea, small slip |
| 1 | Partly right |
| 0 | Wrong or blank |

### 3.4 Scorecard dimensions (Stage 1 and 4, rated 1–5 by the interviewer)

1. Curiosity · 2. Arithmetic · 3. Tooling · 4. Caution · 5. Clarity · 6. Initiative · 7. Fit with the team

---

## 4. Stage 1 — Intro call (10 minutes)

Mode: verbal. Not scored 0–3; rate dimensions 1, 5, 6, 7 and write a recommendation.

### S1.1 · Tell me about a spreadsheet
- id: S1.1 | stage: 1 | mode: verbal | time: 4 min

**Prompt:** Describe a spreadsheet you built that other people used.

**What good looks like:** Names the users and what broke.

### S1.2 · Why coffee
- id: S1.2 | stage: 1 | mode: verbal | time: 3 min

**Prompt:** Why do you want to work on coffee-shop analytics?

**What good looks like:** A reason beyond "it sounds fun".

---

## 5. Stage 2 — Written test

### 5.0 Candidate instructions (show at the start of each set)

Use a spreadsheet for anything numerical and talk through your reasoning. Ask if anything is unclear.

---

### SET A — Easy (screening) · 15 minutes · pass ≥ 7/9

### A1 · Average cup price
- id: A1 | set: A | number: 1 | domain: quant | difficulty: easy | mode: sheet | time: 4 min

**Prompt:** Paste these four sales into a sheet and compute the **mean** price per cup.

**Dataset:**
```csv
cup,price
1,3.00
2,3.50
3,2.50
4,4.00
```

**Model answer:** Mean **3.25**.

**Scoring:** 3 = 3.25 with the 4-cup logic stated. 2 = right number, no working. 1 = sums but does not divide (e.g. 13 total). 0 = otherwise.

**Trap / bonus:** Bonus: asks whether prices include tax.

### A2 · Two coins
- id: A2 | set: A | number: 2 | domain: quant | difficulty: easy | mode: verbal | time: 2 min

**Prompt:** Two fair coins are tossed. What is the probability of at least one head?

**Model answer:** 1 − 0.25 = **3/4**.

**Scoring:** 3 = 3/4 via the complement. 2 = 3/4 by enumeration. 1 = says 1/2. 0 = otherwise.

### A3 · Loop output
- id: A3 | set: A | number: 3 | domain: python | difficulty: easy | mode: verbal | time: 2 min

**Prompt:** What does this print?

**Code (python):**
```python
def total(xs):
    t = 0
    for x in xs:
        t += x
    return t

print(total([1, 2, 3]))
```

**Model answer:** `6`.

**Scoring:** 3 = exact. 2 = right number, wrong type. 1 = says `[1, 2, 3]`. 0 = otherwise.

---

### SET B — Medium · 20 minutes · pass ≥ 2/3

### B1 · Missing value
- id: B1 | set: B | number: 1 | domain: quant | difficulty: medium | mode: sheet-or-verbal | time: 5 min

**Prompt:** One row has a blank last column. How many columns does the table have, and what do you do with the blank?

**Dataset:**
```csv
shop,cups,note
north,120,busy
south,80,
```

**Model answer:** Three columns; the blank is a missing note, not a missing column. Keep the row.

**Scoring:** 3 = three columns and keeps the row. 2 = three columns, drops the row. 1 = says two columns. 0 = otherwise.

---

### SET C — Hard · 25 minutes · ≥ 2 strong, ≥ 3 exceptional

### C1 · Ordering a queue
- id: C1 | set: C | number: 1 | domain: python | difficulty: hard | mode: verbal | time: 6 min

**Prompt:** Orders arrive out of sequence. Describe how you would keep them in order.

**Model answer:** Buffer by sequence number; release contiguous runs; on a gap, wait then resync.

**Scoring:** 3 = buffer, release rule and gap handling. 2 = buffer and release rule. 1 = "sort them". 0 = otherwise.

**Trap / bonus:** Bonus: mentions duplicates.

---

## 6. Stage 3 — Take-home case

### 6.1 Brief (send to the candidate)

You are given `sales.csv` for one week. Produce a one-page memo with one chart.

### 6.2 Data specification

- `sales.csv`: `timestamp`, `shop`, `cups`, `price`. About 1,000 rows.
- Planted feature: one duplicated row.

### 6.3 Marking rubric (0–3 each, max 18; pass ≥ 12)

1. Totals are correct
2. The duplicate is found
3. The chart is readable
4. Assumptions are stated
5. The finding is actionable
6. The code runs

---

## 7. Stage 4 — Final round (20 minutes)

Mode: verbal. Rated on dimensions 4, 5, 6, 7 plus leadership judgement.

### S4.1 · A mistake you owned
- id: S4.1 | stage: 4 | mode: verbal | time: 6 min

**Prompt:** Tell us about a mistake you made at work and what you did next.

**What good looks like:** Owns it, fixes it, writes it down.

---

## 9. Machine-readable index

### 9.1 Question index

| id | stage | set | num | domain | difficulty | mode | time_min | dataset | code |
|---|---|---|---|---|---|---|---|---|---|
| S1.1 | 1 | — | 1 | screening | — | verbal | 4 | no | no |
| S1.2 | 1 | — | 2 | screening | — | verbal | 3 | no | no |
| A1 | 2 | A | 1 | quant | easy | sheet | 4 | yes | no |
| A2 | 2 | A | 2 | quant | easy | verbal | 2 | no | no |
| A3 | 2 | A | 3 | python | easy | verbal | 2 | no | yes |
| B1 | 2 | B | 1 | quant | medium | sheet-or-verbal | 5 | yes | no |
| C1 | 2 | C | 1 | python | hard | verbal | 6 | no | no |
| S4.1 | 4 | — | 1 | judgement | — | verbal | 6 | no | no |
