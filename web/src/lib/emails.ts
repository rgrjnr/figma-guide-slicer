// Lifted from the plugin's Emails tab. Its output is exactly the CSV shape the
// Braze user-import flow expects, which is why it lives next to the slicer.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailListResult {
  csv: string;
  valid: string[];
  invalid: string[];
  duplicates: number;
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
