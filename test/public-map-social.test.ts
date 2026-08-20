import { describe, expect, it } from "vitest";
import {
  buildStaticMapUrl,
  rewritePublicMapHtml,
  type PublicMapSocialData,
} from "../src/worker/public-map-social";

const publicMap: PublicMapSocialData = {
  title: "London favourites",
  description: null,
  updatedAt: 1_755_706_800_000,
  places: [
    { lat: 51.5204, lng: -0.1042 },
    { lat: 51.5010099, lng: -0.1415876 },
  ],
};

describe("public map social previews", () => {
  it("builds a 1200x630 Static Maps request fitted to a tiny pin for every place", () => {
    const url = buildStaticMapUrl(publicMap, "server-key");

    expect(url.origin).toBe("https://maps.googleapis.com");
    expect(url.pathname).toBe("/maps/api/staticmap");
    expect(url.searchParams.get("size")).toBe("600x315");
    expect(url.searchParams.get("scale")).toBe("2");
    expect(url.searchParams.get("markers")).toBe(
      "size:tiny|color:0xe8663d|51.520400,-0.104200|51.501010,-0.141588",
    );
    expect(url.searchParams.get("center")).toBeNull();
    expect(url.searchParams.get("zoom")).toBeNull();
    expect(url.searchParams.get("key")).toBe("server-key");
  });

  it("injects map-specific Open Graph and Twitter metadata", async () => {
    const response = rewritePublicMapHtml(
      new Response(`<!doctype html><html><head><meta name="description" content="Generic"><title>Pinboard Maps</title></head><body></body></html>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      publicMap,
      new URL("https://maps.example.test/public/public-token"),
    );
    const html = await response.text();

    expect(html).toContain("<title>London favourites · Pinboard Maps</title>");
    expect(html).toContain('property="og:title" content="London favourites"');
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(
      'property="og:image" content="https://maps.example.test/public/public-token/preview.png?v=1755706800000"',
    );
    expect(html).not.toContain("server-key");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=30");
  });

  it("escapes user-authored map metadata", async () => {
    const response = rewritePublicMapHtml(
      new Response('<html><head><meta name="description"><title>Default</title></head></html>'),
      { ...publicMap, title: '"><script>alert(1)</script>', description: 'A "quoted" map & more' },
      new URL("https://maps.example.test/public/public-token"),
    );
    const html = await response.text();

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A &quot;quoted&quot; map &amp; more");
  });
});
