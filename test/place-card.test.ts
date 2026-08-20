import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceCard } from "../src/client/components/PlaceCard";

describe("PlaceCard UI Kit boundary", () => {
  it("uses the default vertical layout without assigning the experimental orientation property", () => {
    const markup = renderToStaticMarkup(PlaceCard({ placeId: "ChIJ-test-place" }));

    expect(markup).toContain("<gmp-place-details-compact");
    expect(markup).not.toContain("orientation=");
    expect(markup).toContain('place="ChIJ-test-place"');
    expect(markup).toContain("<gmp-place-standard-content");
  });
});
