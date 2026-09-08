import { REQUEST_TIMEOUT_MS } from "../sources/source.js";
import { extractMetaContent, stripHtml, truncate } from "../sources/text.js";

// Pull the text of the URLs a user pastes into the setup chat (their landing page, a
// pricing page). Best effort: a page that fails becomes a warning, never an error.

export interface FetchedPage {
  url: string;
  title: string | undefined;
  text: string;
}

export interface FetchPagesResult {
  pages: FetchedPage[];
  warnings: string[];
}

export const PAGE_MAX_CHARS = 6_000;

export async function fetchPages(
  urls: readonly string[],
  deps: { fetch: typeof fetch; userAgent: string },
  maxChars = PAGE_MAX_CHARS,
): Promise<FetchPagesResult> {
  const result: FetchPagesResult = { pages: [], warnings: [] };

  for (const url of urls) {
    try {
      const res = await deps.fetch(url, {
        headers: { "user-agent": deps.userAgent, accept: "text/html, text/plain;q=0.9, */*;q=0.5" },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        result.warnings.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const title =
        extractMetaContent(html, "og:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
      const description =
        extractMetaContent(html, "og:description") ?? extractMetaContent(html, "description");
      const body = stripHtml(html.replace(/<(nav|footer|header|script|style)[\s\S]*?<\/\1>/gi, " "));
      const text = [description, body].filter(Boolean).join("\n\n");
      if (!text) {
        result.warnings.push(`${url}: no readable text`);
        continue;
      }
      result.pages.push({ url, title: title ? stripHtml(title) : undefined, text: truncate(text, maxChars) });
    } catch (err) {
      result.warnings.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
