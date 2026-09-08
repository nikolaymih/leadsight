import { describe, expect, it } from "vitest";
import { decodeEntities, extractMetaContent, stripHtml, stripMarkdown } from "./text.js";
import { canonicalUrl, unwrapGoogleRedirect } from "./url.js";

describe("text helpers", () => {
  it("strips Reddit markdown but keeps link text", () => {
    const md =
      "I come from **hospitality**.\n\nSee our [landing page](https://example.com) and `code`.\n\n> quoted\n\n* one\n* two\n\n&amp;#x200B;";
    expect(stripMarkdown(md)).toBe(
      "I come from hospitality.\n\nSee our landing page and code.\n\nquoted\n\n• one\n• two",
    );
  });

  it("strips HTML, decodes entities and keeps paragraph breaks", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b> &amp; friends</p><p>Second &#39;line&#39;</p>")).toBe(
      "Hello world & friends\nSecond 'line'",
    );
    expect(decodeEntities("&mdash; &#x2014; &#8212; &unknown;")).toBe("— — — &unknown;");
  });

  it("reads meta content in either attribute order", () => {
    const html = `<meta content="second" name="twitter:description"><meta property="og:description" content="I&#39;m first">`;
    expect(extractMetaContent(html, "og:description")).toBe("I'm first");
    expect(extractMetaContent(html, "twitter:description")).toBe("second");
    expect(extractMetaContent(html, "og:title")).toBeUndefined();
  });
});

describe("url helpers", () => {
  it("unwraps Google redirect links and leaves others alone", () => {
    expect(
      unwrapGoogleRedirect("https://www.google.com/url?rct=j&sa=t&url=https://x.com/a/status/1?s=20&ct=ga"),
    ).toBe("https://x.com/a/status/1?s=20");
    expect(unwrapGoogleRedirect("https://example.com/post")).toBe("https://example.com/post");
    expect(unwrapGoogleRedirect("not a url")).toBe("not a url");
  });

  it("canonicalises: lowercase host, no tracking params, no hash, no trailing slash", () => {
    expect(
      canonicalUrl(
        "https://www.LinkedIn.com/posts/jane_activity-1/?utm_source=share&trk=public_post&fbclid=x#top",
      ),
    ).toBe("https://www.linkedin.com/posts/jane_activity-1");
    expect(canonicalUrl("https://x.com/founder_jo/status/183?s=20&t=abc")).toBe(
      "https://x.com/founder_jo/status/183",
    );
    expect(canonicalUrl("https://example.com/?b=2&a=1")).toBe("https://example.com/?a=1&b=2");
  });
});
