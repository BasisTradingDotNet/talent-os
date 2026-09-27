import Papa from 'papaparse';

/** CSV text → rows of cells. Keeps empty trailing fields; drops a trailing empty line only. */
export function parseCsv(text: string): string[][] {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false });
  const rows = res.data.filter((r): r is string[] => Array.isArray(r));
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '') ) rows.pop();
  return rows;
}

/** Tab-separated text that pastes straight into Google Sheets / Excel. */
export function csvToTsv(text: string): string {
  return parseCsv(text)
    .map((row) => row.map((c) => c.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t'))
    .join('\n');
}
