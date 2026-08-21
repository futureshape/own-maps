import { describe, expect, it } from "vitest";
import { mapToGeoJson, mapToKml, type MapExportData } from "../src/worker/map-export";

const exportMap: MapExportData = {
  title: "Cafés & <Parks>",
  description: "A map for coffee & trees",
  updatedAt: 1_755_706_800_000,
  places: [
    {
      id: "place-1",
      googlePlaceId: "ChIJ-cafe&one",
      name: "Ada's <Cafe>",
      lat: 51.5204,
      lng: -0.1042,
      note: "Try tea & cake",
      categoryId: "category-1",
      categoryName: "Coffee & cake",
      markerColor: "#e8663d",
    },
    {
      id: "place-2",
      googlePlaceId: "ChIJ-park",
      name: "The Park",
      lat: 51.501,
      lng: -0.141,
      note: null,
      categoryId: null,
      categoryName: null,
      markerColor: null,
    },
  ],
};

describe("map exports", () => {
  it("serializes places as GeoJSON points with interoperable properties", () => {
    expect(JSON.parse(mapToGeoJson(exportMap))).toEqual({
      type: "FeatureCollection",
      name: "Cafés & <Parks>",
      description: "A map for coffee & trees",
      features: [
        {
          type: "Feature",
          id: "place-1",
          geometry: { type: "Point", coordinates: [-0.1042, 51.5204] },
          properties: {
            name: "Ada's <Cafe>",
            description: "Try tea & cake",
            category: "Coffee & cake",
            "marker-color": "#e8663d",
            google_place_id: "ChIJ-cafe&one",
          },
        },
        expect.objectContaining({
          id: "place-2",
          geometry: { type: "Point", coordinates: [-0.141, 51.501] },
        }),
      ],
    });
  });

  it("serializes valid, escaped KML grouped by category with marker colours", () => {
    const kml = mapToKml(exportMap);

    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(kml).toContain("<name>Cafés &amp; &lt;Parks&gt;</name>");
    expect(kml).toContain("<name>Coffee &amp; cake</name>");
    expect(kml).toContain("<name>Uncategorised</name>");
    expect(kml).toContain("Ada&apos;s &lt;Cafe&gt;");
    expect(kml).toContain("Try tea &amp; cake");
    expect(kml).toContain("<color>ff3d66e8</color>");
    expect(kml).toContain("<coordinates>-0.1042,51.5204,0</coordinates>");
    expect(kml).toContain("ChIJ-cafe&amp;one");
  });
});
