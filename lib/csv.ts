/**
 * Character-scanning CSV parser. Splitting on newlines first would be wrong:
 * OurAirports quotes free-text columns that can contain both commas and
 * newlines, and doubles embedded quotes ("" for a literal ").
 *
 * A `"` opens quoted mode only when it is the first character of a field —
 * everywhere else a bare `"` is literal content. Treating any bare `"` as an
 * open-quote (an earlier, buggy version of this parser) makes a stray
 * mid-field quote swallow every subsequent comma and newline as literal text
 * until another `"` happens to re-sync the scanner, silently merging
 * multiple logical rows into one corrupted row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { cell += ch; continue; }
      if (text[i + 1] === '"') { cell += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  // A file with no trailing newline still has one row left in hand.
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
