// Lifted from the plugin's Emails tab. Its output is exactly the CSV shape the
// Braze user-import flow expects, which is why it lives next to the slicer.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailListResult {
  csv: string;
  valid: string[];
  invalid: string[];
  duplicates: number;
}

/**
 * The list usually arrives as a spreadsheet attached to a request email, so any
 * cell that looks like an address is taken from any sheet — rather than
 * demanding a header or column order the sender has no reason to know about.
 */
export async function readSpreadsheet(file: File): Promise<string> {
  const { read, utils } = await import("xlsx");
  const workbook = read(await file.arrayBuffer(), { type: "array" });
  const found: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, blankrows: false });
    for (const row of rows) {
      for (const cell of row) {
        const text = String(cell ?? "").trim();
        if (EMAIL_REGEX.test(text)) found.push(text);
      }
    }
  }
  return found.join("\n");
}

export function processEmailContent(content: string): EmailListResult {
  const tokens = content
    .split(/[\s,;]+/)
    .map(t => t.trim().replace(/^["'<]+|["'>]+$/g, ""))
    .filter(Boolean);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const token of tokens) {
    const email = token.toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    valid.push(email);
  }

  const csv = ["email,external_id", ...valid.map(e => `${e},${e}`)].join("\n");
  return { csv, valid, invalid, duplicates };
}
