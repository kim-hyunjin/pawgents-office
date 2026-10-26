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

const indentOf = (l: string) =>
  l.match(/^\s*/)![0].replace(/\t/g, '    ').length;
const blank = (l?: string) => !l || !l.trim();
const isTableStart = (lines: string[], i: number) =>
  lines[i].includes('|') &&
  i + 1 < lines.length &&
  TABLE_SEP.test(lines[i + 1]) &&
  lines[i + 1].includes('-');
const startsBlock = (lines: string[], i: number) =>
  FENCE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  RULE.test(lines[i]) ||
  QUOTE.test(lines[i]) ||
  LIST.test(lines[i]) ||
  isTableStart(lines, i);

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
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }
    let m: RegExpExecArray | string | null;
    if ((m = FENCE.exec(line))) {
      const fence = m[2],
        ind = m[1].length,
        body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++)
        body.push(lines[i].slice(Math.min(ind, indentOf(lines[i]))));
      i++;
      out += `<pre><code${m[3] ? ` data-lang="${esc(m[3])}"` : ''}>${esc(body.join('\n'))}</code></pre>`;
    } else if ((m = HEADING.exec(line))) {
      const n = m[1].length;
      out += `<h${n}>${inline(m[2])}</h${n}>`;
      i++;
    } else if (RULE.test(line)) {
      out += '<hr>';
      i++;
    } else if (QUOTE.test(line)) {
      const body: string[] = [];
      while (
        i < lines.length &&
        !blank(lines[i]) &&
        (QUOTE.test(lines[i]) || !startsBlock(lines, i))
      )
        body.push(lines[i++].replace(QUOTE, ''));
      out += `<blockquote>${blocks(body, false)}</blockquote>`;
    } else if (isTableStart(lines, i)) {
      ({ html: m, i } = table(lines, i));
      out += m;
    } else if (LIST.test(line)) {
      ({ html: m, i } = list(lines, i));
      out += m;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        !blank(lines[i]) &&
        (para.length === 0 || !startsBlock(lines, i))
      )
        para.push(lines[i++].trim());
      const html = para.map(inline).join('<br>');
      out += tight ? html : `<p>${html}</p>`;
    }
  }
  return out;
}

function list(lines: string[], i: number) {
  const first = LIST.exec(lines[i])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items: string[][] = [];
  let loose = false;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const col = m[0].length; // content column: continuation lines are dedented by this much
    const body = [lines[i].slice(col)];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) {
        let j = i + 1;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) > indent) {
          body.push('');
          i++;
          continue;
        }
        const next = LIST.exec(lines[j] || '');
        if (next && next[1].length === indent && /\d/.test(next[2]) === ordered)
          loose = true;
        break;
      }
      const ind = indentOf(l);
      if (ind > indent) {
        body.push(
          l.replace(/^\s+/, (ws: string) => ' '.repeat(Math.max(0, ind - col))),
        );
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
  while (i < lines.length && blank(lines[i])) {
    // swallow the blank lines we stopped on only if the list continues after them
    const m = LIST.exec(lines[i + 1] || '');
    if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) i++;
    else break;
  }
  const lis = items
    .map((body) => {
      let task = '';
      const t = /^\[([ xX])\]\s+/.exec(body[0]);
      if (t) {
        task =
          t[1] === ' '
            ? '<span class="task">☐</span> '
            : '<span class="task done">☑</span> ';
        body[0] = body[0].slice(t[0].length);
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
  const head = splitRow(lines[i]);
  const align = splitRow(lines[i + 1]).map((c: string) =>
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
    i < lines.length && !blank(lines[i]) && lines[i].includes('|');
    i++
  ) {
    const row = splitRow(lines[i]);
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
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)]);
}

function link(href: string, label: string) {
  if (!/^(https?:|mailto:|#|\/|\.)/i.test(href)) return label;
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}
