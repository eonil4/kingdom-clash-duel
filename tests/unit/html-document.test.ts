import { describe, expect, it } from "vitest";
import { escapeHtml, wrapHtmlDocument } from "../../scripts/html-document.mjs";

describe("wrapHtmlDocument", () => {
  it("emits a self-describing document around the body", () => {
    const html = wrapHtmlDocument({ title: "data/clan_clash/2026-11-06/duels", body: "<table></table>" });

    expect(html.startsWith("<!DOCTYPE html>\n<html lang=\"en\">")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("<title>data/clan_clash/2026-11-06/duels</title>");
    expect(html).toContain("<body>\n<table></table>\n</body>\n</html>\n");
  });

  it("escapes the title and language", () => {
    const html = wrapHtmlDocument({ title: "A&B <x>", body: "", lang: "en" });
    expect(html).toContain("<title>A&amp;B &lt;x&gt;</title>");
    expect(html).toContain('<html lang="en">');
  });
});

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml('A&B <c> "d"')).toBe("A&amp;B &lt;c&gt; &quot;d&quot;");
    expect(escapeHtml("plain-name")).toBe("plain-name");
  });
});
