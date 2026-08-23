import type { HtmlSlice, RGB } from "./types";
import { toHex, midColor, WHITE } from "./color";

function edgeColors(s: HtmlSlice): { top: RGB; bottom: RGB } {
  return s.colors || { top: WHITE, bottom: WHITE };
}


export function groupSlicesIntoRows<T extends { absX: number; absY: number }>(slices: T[]): T[][] {
  if (slices.length === 0) return [];
  const rows: T[][] = [];
  let currentRow = [slices[0]];
  for (let i = 1; i < slices.length; i++) {
    if (Math.abs(slices[i].absY - currentRow[0].absY) <= 2) {
      currentRow.push(slices[i]);
    } else {
      currentRow.sort((a, b) => a.absX - b.absX);
      rows.push(currentRow);
      currentRow = [slices[i]];
    }
  }
  currentRow.sort((a, b) => a.absX - b.absX);
  rows.push(currentRow);
  return rows;
}

// --- HTML Generation ---

export function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function generateEmailHTML(
  slices: HtmlSlice[],
  addFooter: boolean,
  maxWidth = 600
): string {
  const emailRows = groupSlicesIntoRows(slices);

  const rows = emailRows.map((row: HtmlSlice[]) => {
    // Compute row-level gradient: top color from first column's top, bottom color from first column's bottom
    const rowColors = edgeColors(row[0]);
    const rowTopColor = toHex(rowColors.top);
    const rowBottomColor = toHex(rowColors.bottom);
    const rowMidColor = toHex(midColor(rowColors.top, rowColors.bottom));

    if (row.length === 1) {
      const s = row[0];
      const imgTag = '<img src="images/' + s.fileName + '" width="' + maxWidth + '" alt="' + escapeAttr(s.alt || "") + '" style="display:block; width:100%; max-width:' + maxWidth + 'px; height:auto; border:0;" />';
      const content = s.linkUrl
        ? '<a href="' + escapeAttr(s.linkUrl) + '" target="_blank" style="text-decoration:none;">' + imgTag + "</a>"
        : imgTag;
      return '        <tr>\n' +
        '          <td align="center" valign="top" bgcolor="' + rowMidColor + '" style="padding:0; margin:0; line-height:0; font-size:0; background:linear-gradient(to bottom, ' + rowTopColor + ', ' + rowBottomColor + ');">\n' +
        '            ' + content + '\n' +
        '          </td>\n' +
        '        </tr>';
    }

    // Multi-column row
    const totalWidth = row.reduce((sum, s) => sum + s.width, 0);
    const columns = row.map((s, i) => {
      let colWidth: number;
      if (i === row.length - 1) {
        colWidth = maxWidth - row.slice(0, i).reduce((sum, c) => sum + Math.round(c.width / totalWidth * maxWidth), 0);
      } else {
        colWidth = Math.round(s.width / totalWidth * maxWidth);
      }
      const pct = (colWidth / maxWidth * 100).toFixed(4);
      const colColors = edgeColors(s);
      const colTopColor = toHex(colColors.top);
      const colBottomColor = toHex(colColors.bottom);
      const colMidColor = toHex(midColor(colColors.top, colColors.bottom));
      const imgTag = '<img src="images/' + s.fileName + '" width="' + colWidth + '" alt="' + escapeAttr(s.alt || "") + '" style="display:block; width:100%; max-width:' + colWidth + 'px; height:auto; border:0;" />';
      const content = s.linkUrl
        ? '<a href="' + escapeAttr(s.linkUrl) + '" target="_blank" style="text-decoration:none;">' + imgTag + "</a>"
        : imgTag;
      return '            <td align="center" valign="top" width="' + colWidth + '" bgcolor="' + colMidColor + '" style="padding:0; margin:0; line-height:0; font-size:0; width:' + pct + '%; background:linear-gradient(to bottom, ' + colTopColor + ', ' + colBottomColor + ');">\n              ' + content + '\n            </td>';
    });

    return '        <tr>\n' +
      '          <td align="center" valign="top" bgcolor="' + rowMidColor + '" style="padding:0; margin:0; line-height:0; font-size:0; background:linear-gradient(to bottom, ' + rowTopColor + ', ' + rowBottomColor + ');">\n' +
      '            <table role="presentation" width="' + maxWidth + '" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:' + maxWidth + 'px;">\n' +
      '              <tr>\n' +
      columns.join("\n") + '\n' +
      '              </tr>\n' +
      '            </table>\n' +
      '          </td>\n' +
      '        </tr>';
  }).join("\n");

  return '<!DOCTYPE html>\n' +
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <meta http-equiv="X-UA-Compatible" content="IE=edge" />\n' +
    '  <title>Email</title>\n' +
    '  <!--[if mso]>\n' +
    '  <style type="text/css">\n' +
    '    table { border-collapse: collapse; }\n' +
    '  </style>\n' +
    '  <![endif]-->\n' +
    '  <style type="text/css">\n' +
    '    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }\n' +
    '    table { border-spacing: 0; border-collapse: collapse; }\n' +
    '    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body style="margin:0; padding:0; background-color:#f4f4f4;">\n' +
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">\n' +
    '    <tr>\n' +
    '      <td align="center" valign="top" style="padding:0;">\n' +
    '        <table role="presentation" width="' + maxWidth + '" cellpadding="0" cellspacing="0" border="0" style="max-width:' + maxWidth + 'px; width:100%; margin:0 auto; background-color:#ffffff;">\n' +
    rows + '\n' +
    '        </table>\n' +
    '      </td>\n' +
    '    </tr>\n' +
    '  </table>' + (addFooter ? '\n  <center>{{${email_footer}}}</center>' : '') + '\n' +
    '</body>\n' +
    '</html>';
}
