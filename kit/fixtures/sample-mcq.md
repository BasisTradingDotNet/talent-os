# Sample MCQ add-on (synthetic)

**Version 0.1 · Synthetic fixture for kit/parse-kit.test.ts**

Invented content only. Add-on files carry `### <ID> · <Title>` records with `mode: mcq`, a
`**Choices:**` block lettered from A and a single-letter `**Answer:**`. No index table.

## Stage 0 — Aptitude test

### M1 · Doubling
- id: M1 | stage: 0 | set: M | number: 1 | domain: math | difficulty: easy | mode: mcq | time: 0 min

**Prompt:** What is 2 × 21?

**Choices:**
A. 23
B. 42
C. 44
D. 221

**Answer:** B

**Model answer:** 2 × 21 = **42**. A adds, C doubles 22, D concatenates.

### M2 · One coin
- id: M2 | stage: 0 | set: M | number: 2 | domain: probability | difficulty: medium | mode: mcq | time: 0 min

**Prompt:** A fair coin is tossed twice. Probability of two heads?

**Choices:**
A. 1/2
B. 1/3
C. 1/4
D. 1/8
E. 0

**Answer:** C

**Model answer:** (1/2)² = 1/4.

### M3 · Middle value
- id: M3 | stage: 0 | set: M | number: 3 | domain: statistics | difficulty: hard | mode: mcq | time: 0 min

**Prompt:** Median of 1, 9, 2?

**Choices:**
A. 1
B. 2
C. 4
D. 9

**Answer:** B

**Model answer:** Sorted 1, 2, 9 → middle is 2. C is the mean.
