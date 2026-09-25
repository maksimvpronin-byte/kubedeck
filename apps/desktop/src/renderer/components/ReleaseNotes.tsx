import { createElement, type ReactNode } from "react";
import type { ReleaseNote } from "../types";

// What a new version changes, from the notes on its GitHub release.
//
// GitHub sends the notes as HTML it rendered from Markdown, and that HTML is
// not ours: it is rebuilt here from an allow-list of tags into React elements
// rather than handed to innerHTML. Parsing happens in a <template>, whose
// content is inert - no script runs and no image is fetched while it is read.
// Anything outside the list keeps its text and loses its tag; links keep their
// text too, since a relative link in the notes points into the repository, not
// anywhere this window could open.
export function ReleaseNotes({ notes, t }: { notes: ReleaseNote[]; t: (key: string) => string }) {
  if (!notes.length) return null;
  return (
    <section className="release-notes" aria-label={t("about.releaseNotes")}>
      <h4 className="release-notes-title">{t("about.releaseNotes")}</h4>
      <div className="release-notes-body">
        {notes.map((note) => (
          <article className="release-notes-version" key={note.version}>
            {notes.length > 1 ? <h5 className="release-notes-version-title">{note.version}</h5> : null}
            {renderReleaseNote(note.html)}
          </article>
        ))}
      </div>
    </section>
  );
}

// Heading levels move down: the card's title is an h3, so the notes' own h2
// sections become h5, under the h4 that names the panel.
const TAGS: Record<string, string> = {
  p: "p",
  ul: "ul",
  ol: "ol",
  li: "li",
  h2: "h5",
  h3: "h6",
  h4: "h6",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  code: "code",
  pre: "pre",
  blockquote: "blockquote",
};

const BLOCK_PARENTS = new Set(["#document-fragment", "ul", "ol", "blockquote"]);

// Written for whoever cuts the release - which checks passed, how many tests
// ran - and of no use to someone deciding whether to update.
const MAINTAINER_SECTIONS = /^(verification|проверка)$/i;

export function renderReleaseNote(html: string): ReactNode[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const nodes: ReactNode[] = [];
  let skipping = false;
  template.content.childNodes.forEach((node, index) => {
    if (node instanceof Element) {
      const tag = node.tagName.toLowerCase();
      // The release's title repeats the version the panel already names.
      if (tag === "h1") return;
      if (tag === "h2") skipping = MAINTAINER_SECTIONS.test((node.textContent ?? "").trim());
    }
    if (skipping) return;
    const rendered = renderNode(node, String(index));
    if (rendered !== null) nodes.push(rendered);
  });
  return nodes;
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    // Whitespace between block tags is the formatting of the HTML, not text.
    if (!text.trim() && BLOCK_PARENTS.has(node.parentNode?.nodeName.toLowerCase() ?? "")) return null;
    return text;
  }
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "img" || tag === "svg" || tag === "iframe") return null;
  const children: ReactNode[] = [];
  node.childNodes.forEach((child, index) => {
    const rendered = renderNode(child, `${key}.${index}`);
    if (rendered !== null) children.push(rendered);
  });
  // GitHub renders every line break of the Markdown as <br>, and the notes are
  // wrapped at 80 columns: kept, they would break sentences mid-line.
  if (tag === "br") return " ";
  const mapped = TAGS[tag];
  if (!mapped) return children.length ? createElement("span", { key }, ...children) : null;
  return createElement(mapped, { key }, ...children);
}
