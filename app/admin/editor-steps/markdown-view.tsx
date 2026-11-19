"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A small markdown renderer for the editor steps: headings, paragraphs, lists, tables, code blocks,
 * and inline bold / italic / code / links. Enough for the skill files; no HTML is ever injected.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key} className="font-semibold">{inline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    } else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? [];
      const safe = /^(https?:|mailto:|#|\/)/.test(href ?? "");
      out.push(safe ? <a key={key} href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">{label}</a> : <Fragment key={key}>{label}</Fragment>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** Renders one block of markdown (no top-level splitting into sections; see `splitSections`). */
export function MarkdownView({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">{body.join("\n")}</pre>);
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level <= 2 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(<p key={key} className={`${cls} pt-2`}>{inline(h[2], key)}</p>);
      i++;
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr>{head.map((c, j) => <th key={j} className="px-3 py-2 text-left font-medium">{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody className="divide-y">{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: Array<{ indent: number; text: string }> = [];
      while (i < lines.length && lines[i].trim()) {
        const lm = listRe.exec(lines[i]);
        if (lm) items.push({ indent: lm[1].length, text: lm[3] });
        else if (items.length) items[items.length - 1].text += " " + lines[i].trim(); // wrapped line
        else break;
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={key} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 text-sm leading-relaxed marker:text-muted-foreground`}>
          {items.map((it, j) => <li key={j} style={it.indent ? { marginLeft: `${Math.min(it.indent, 8) * 0.5}rem` } : undefined}>{inline(it.text, `${key}i${j}`)}</li>)}
        </Tag>,
      );
      continue;
    }

    if (line.trim().startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key} className="border-l-2 pl-3 text-sm italic text-muted-foreground">{inline(body.join(" "), key)}</blockquote>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s|\s*\||\s*>)/.test(lines[i])) para.push(lines[i++].trim());
    if (para.length === 0) { para.push(line.trim()); i++; }
    blocks.push(<p key={key} className="text-sm leading-relaxed">{inline(para.join(" "), key)}</p>);
  }
  return <div className="flex flex-col gap-3">{blocks}</div>;
}

export interface Section {
  title: string;
  body: string;
}

/** Splits a file into its intro (before the first "## ") and one section per "## " heading. The "# " title is dropped. */
export function splitSections(source: string): { intro: string; sections: Section[] } {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let intro: string[] = [];
  const sections: Section[] = [];
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) inCode = !inCode;
    const h2 = !inCode && /^##\s+(.*)$/.exec(line);
    if (h2) sections.push({ title: h2[1].trim(), body: "" });
    else if (!inCode && /^#\s+/.test(line) && sections.length === 0 && intro.every((l) => !l.trim())) intro = [];
    else if (sections.length) sections[sections.length - 1].body += line + "\n";
    else intro.push(line);
  }
  return { intro: intro.join("\n").trim(), sections };
}
