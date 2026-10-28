// Small GitHub-flavored markdown → HTML renderer for agent replies (no dependencies).
// Covers what Claude actually writes: headings, paragraphs, lists (nested, ordered, task),
// fenced code, blockquotes, tables, rules, and inline code / bold / italic / strike / links.
// Everything is HTML-escaped first, so agent text can never inject markup.

import { esc } from './ui.ts';

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Line `i`, or '' past either end (a blank line: what every caller already treats the end as). */
const at = (lines: string[], i: number) => lines[i] ?? '';
const indentOf = (l: string) =>
  (/^\s*/.exec(l)?.[0] ?? '').replace(/\t/g, '    ').length;
const blank = (l?: string) => !l || !l.trim();
const isTableStart = (lines: string[], i: number) =>
  at(lines, i).includes('|') &&
  i + 1 < lines.length &&
  TABLE_SEP.test(at(lines, i + 1)) &&
  at(lines, i + 1).includes('-');
const startsBlock = (lines: string[], i: number) => {
  const l = at(lines, i);
  return (
    FENCE.test(l) ||
    HEADING.test(l) ||
    RULE.test(l) ||
    QUOTE.test(l) ||
    LIST.test(l) ||
    isTableStart(lines, i)
  );
};
/** A list marker line: its indent, its marker, and the whole match (the content starts after it). */
function listMarker(l: string) {
  const m = LIST.exec(l);
  if (!m) return null;
  const [all, indent = '', marker = ''] = m;
  return { all, indent, marker };
}

export function renderMarkdown(src: unknown) {
  return blocks(
    String(src ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n'),
    false,
  );
}

function blocks(lines: string[], tight: boolean): string {
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = at(lines, i);
    if (blank(line)) {
      i++;
      continue;
    }
    let fence: RegExpExecArray | null, heading: RegExpExecArray | null;
    if ((fence = FENCE.exec(line))) {
      const [, indent = '', marker = '', lang = ''] = fence,
        ind = indent.length,
        body: string[] = [];
      for (
        i++;
        i < lines.length && !at(lines, i).trim().startsWith(marker);
        i++
      )
        body.push(at(lines, i).slice(Math.min(ind, indentOf(at(lines, i)))));
      i++;
      out += `<pre><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(body.join('\n'))}</code></pre>`;
    } else if ((heading = HEADING.exec(line))) {
      const [, hashes = '', text = ''] = heading,
        n = hashes.length;
      out += `<h${n}>${inline(text)}</h${n}>`;
      i++;
    } else if (RULE.test(line)) {
      out += '<hr>';
      i++;
    } else if (QUOTE.test(line)) {
      const body: string[] = [];
      while (
        i < lines.length &&
        !blank(at(lines, i)) &&
        (QUOTE.test(at(lines, i)) || !startsBlock(lines, i))
      )
        body.push(at(lines, i++).replace(QUOTE, ''));
      out += `<blockquote>${blocks(body, false)}</blockquote>`;
    } else if (isTableStart(lines, i)) {
      let html: string;
      ({ html, i } = table(lines, i));
      out += html;
    } else if (LIST.test(line)) {
      let html: string;
      ({ html, i } = list(lines, i));
      out += html;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        !blank(at(lines, i)) &&
        (para.length === 0 || !startsBlock(lines, i))
      )
        para.push(at(lines, i++).trim());
      const html = para.map(inline).join('<br>');
      out += tight ? html : `<p>${html}</p>`;
    }
  }
  return out;
}

/** Called on a line LIST matches (blocks() checked). */
function list(lines: string[], i: number) {
  const first = listMarker(at(lines, i));
  const indent = first?.indent.length ?? 0;
  const ordered = /\d/.test(first?.marker ?? '');
  const start = ordered ? parseInt(first?.marker ?? '', 10) : 1;
  /** Another item of this list: same indent, same kind of marker. */
  const sameList = (m: ReturnType<typeof listMarker>) =>
    !!m && m.indent.length === indent && /\d/.test(m.marker) === ordered;
  const items: string[][] = [];
  let loose = false;
  while (i < lines.length) {
    const m = listMarker(at(lines, i));
    if (!m || !sameList(m)) break;
    const col = m.all.length; // content column: continuation lines are dedented by this much
    const body = [at(lines, i).slice(col)];
    i++;
    while (i < lines.length) {
      const l = at(lines, i);
      if (blank(l)) {
        let j = i + 1;
        while (j < lines.length && blank(at(lines, j))) j++;
        if (j < lines.length && indentOf(at(lines, j)) > indent) {
          body.push('');
          i++;
          continue;
        }
        if (sameList(listMarker(at(lines, j)))) loose = true;
        break;
      }
      const ind = indentOf(l);
      if (ind > indent) {
        body.push(l.replace(/^\s+/, () => ' '.repeat(Math.max(0, ind - col))));
        i++;
        continue;
      }
      if (LIST.test(l) || startsBlock(lines, i)) break;
      body.push(l);
      i++; // lazy paragraph continuation
    }
    if (body.some(blank)) loose = true;
    items.push(body);
  }
  while (i < lines.length && blank(at(lines, i))) {
    // swallow the blank lines we stopped on only if the list continues after them
    if (sameList(listMarker(at(lines, i + 1)))) i++;
    else break;
  }
  const lis = items
    .map((body) => {
      let task = '';
      const head = body[0] ?? ''; // an item has its marker line at least
      const t = /^\[([ xX])\]\s+/.exec(head);
      if (t) {
        task =
          t[1] === ' '
            ? '<span class="task">☐</span> '
            : '<span class="task done">☑</span> ';
        body[0] = head.slice(t[0].length);
      }
      return `<li${task ? ' class="task-item"' : ''}>${task}${blocks(body, !loose)}</li>`;
    })
    .join('');
  const tag = ordered ? 'ol' : 'ul';
  return {
    html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${lis}</${tag}>`,
    i,
  };
}

function splitRow(line: string) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s
    .split(/(?<!\\)\|/)
    .map((c: string) => c.trim().replace(/\\\|/g, '|'));
}

function table(lines: string[], i: number) {
  const head = splitRow(at(lines, i));
  const align = splitRow(at(lines, i + 1)).map((c: string) =>
    c.startsWith(':') && c.endsWith(':')
      ? 'center'
      : c.endsWith(':')
        ? 'right'
        : c.startsWith(':')
          ? 'left'
          : '',
  );
  const cell = (tag: string, c: string, k: number) =>
    `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
  let html = `<div class="table"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>`;
  for (
    i += 2;
    i < lines.length && !blank(at(lines, i)) && at(lines, i).includes('|');
    i++
  ) {
    const row = splitRow(at(lines, i));
    html += `<tr>${head.map((_, k) => cell('td', row[k] ?? '', k)).join('')}</tr>`;
  }
  return { html: html + '</tbody></table></div>', i };
}

function inline(text: unknown): string {
  const slots: string[] = [];
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s: string = String(text)
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) =>
      hold(`<code>${esc(code.trim() || code)}</code>`),
    )
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, c) => hold(esc(c)))
    .replace(
      /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
      (_, label, href) => hold(link(href, inline(label))),
    )
    .replace(/<?(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])>?/g, (_, href) =>
      hold(link(href, esc(href))),
    );
  s = esc(s)
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL brackets the placeholders `hold` stashed
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => String(slots[Number(n)]));
}

function link(href: string, label: string) {
  if (!/^(https?:|mailto:|#|\/|\.)/i.test(href)) return label;
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}
