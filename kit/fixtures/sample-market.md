# Sample market add-on (synthetic)

**Version 0.1 · Synthetic fixture for kit/parse-kit.test.ts**

Invented content only. Records with `mode: market` carry a fenced-JSON `**Market:**` block.

## Stage 2 — Make a market

### X1 · One die
- id: X1 | stage: 2 | set: X | number: 1 | domain: quant | difficulty: easy | mode: market | time: 2 min

**Prompt:** Make a market on the value of one hidden six-sided die.

**Market:**
```json
{ "kind": "dice", "dice": 1, "sides": 6 }
```

**Model answer:** Fair 3.5; quote 3 / 4.

### X2 · Cups on the counter
- id: X2 | stage: 2 | set: X | number: 2 | domain: quant | difficulty: medium | mode: market | time: 3 min

**Prompt:** Make a market on the number of cups on the shop counter.

**Market:**
```json
{
  "kind": "estimate",
  "trueValue": 12,
  "unit": "cups",
  "hints": ["More than 10.", "Fewer than 15."]
}
```

**Model answer:** True value 12; a 11 / 14 market after both hints is fine.
