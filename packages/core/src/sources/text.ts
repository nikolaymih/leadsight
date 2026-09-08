// Small, dependency-free text helpers shared by the adapters. Pure; tested.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Drop tags, decode entities, collapse whitespace. Block-level tags become newlines. */
export function stripHtml(html: string): string {
  const withBreaks = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  return collapseWhitespace(decodeEntities(withBreaks));
}

/** Light Reddit-markdown removal: keep the words, drop the syntax. Links keep their text. */
export function stripMarkdown(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Line-anchored patterns use [ \t], never \s: with the m flag, \s would swallow the
    // newline of the preceding blank line and merge paragraphs.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "• ")
    .replace(/&amp;/g, "&")
    .replace(/&#x200B;|​/gi, "");
  return collapseWhitespace(text);
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `<meta property="og:description" content="…">` (either attribute order). */
export function extractMetaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1] !== undefined) return decodeEntities(m[1]);
  }
  return undefined;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
