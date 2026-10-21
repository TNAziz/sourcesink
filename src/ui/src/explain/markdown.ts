/**
 * SourceSink — minimal, safe Markdown renderer for model descriptions.
 *
 * `describeModel` emits a deliberately small Markdown subset: `##` headings,
 * `- ` bullets, paragraphs, `**bold**`, `*italic*` and `` `code` ``. This
 * parser understands exactly that subset and returns React elements, so all
 * text is escaped by React — nothing is ever assigned to `innerHTML`.
 */

import { createElement, Fragment, type ReactNode } from "react";

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string };

export type Block =
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "bullets"; items: Inline[][] }
  | { type: "paragraph"; inlines: Inline[] };

/** Split one line into text / strong / emphasis / code spans. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer !== "") out.push({ type: "text", text: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ type: "strong", text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i) {
        flush();
        out.push({ type: "em", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Parse the description subset into typed blocks. */
export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let bullets: Inline[][] = [];
  let paragraph: string[] = [];

  const flushBullets = (): void => {
    if (bullets.length > 0) blocks.push({ type: "bullets", items: bullets });
    bullets = [];
  };
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    }
    paragraph = [];
  };
  const flush = (): void => {
    flushBullets();
    flushParagraph();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        inlines: parseInline(heading[2]),
      });
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      bullets.push(parseInline(line.slice(2)));
      continue;
    }

    flushBullets();
    paragraph.push(line);
  }
  flush();

  return blocks;
}

function renderInline(inlines: Inline[]): ReactNode[] {
  return inlines.map((inline, i) => {
    if (inline.type === "text") return inline.text;
    const tag = inline.type === "strong" ? "strong" : inline.type === "em" ? "em" : "code";
    return createElement(tag, { key: i }, inline.text);
  });
}

/** Render description Markdown to React elements (no raw HTML). */
export function renderMarkdown(markdown: string): ReactNode[] {
  return parseMarkdown(markdown).map((block, i) => {
    if (block.type === "heading") {
      const tag = `h${Math.min(6, Math.max(1, block.level))}`;
      return createElement(tag, { key: i }, renderInline(block.inlines));
    }
    if (block.type === "bullets") {
      return createElement(
        "ul",
        { key: i },
        block.items.map((item, j) => createElement("li", { key: j }, renderInline(item))),
      );
    }
    return createElement("p", { key: i }, renderInline(block.inlines));
  });
}

/** Convenience wrapper used by the Describe panel. */
export function Markdown({ markdown }: { markdown: string }): ReactNode {
  return createElement(Fragment, null, renderMarkdown(markdown));
}
