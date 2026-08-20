import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, SavedPlace, SelectedPlace } from "../../shared/types";
import { loadGoogleMaps } from "../google";
import { PlaceSearch } from "./PlaceSearch";

function markerContent(color: string): HTMLElement {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "saved-marker";
  marker.style.setProperty("--marker-color", color);
  marker.innerHTML = '<span aria-hidden="true">★</span><span class="sr-only">Saved place</span>';
  return marker;
}

export function MapCanvas({
  places,
  categories,
  onSelect,
}: {
  places: SavedPlace[];
  categories: Category[];
  onSelect: (place: SelectedPlace) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const fitDone = useRef(false);
  const selectionHandler = useRef<(place: SelectedPlace) => Promise<void>>(async () => {});
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const resolveSelection = useCallback(async (selected: SelectedPlace) => {
    const saved = places.find((place) => place.placeId === selected.placeId);
    if (saved) {
      onSelect({
        placeId: saved.placeId,
        displayName: saved.displayName ?? undefined,
        location: { lat: saved.lat, lng: saved.lng },
      });
      return;
    }
    if (selected.displayName) {
      onSelect(selected);
      return;
    }
    try {
      setSelectionError(null);
      const { Place } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
      const place = new Place({ id: selected.placeId });
      await place.fetchFields({ fields: ["displayName"] });
      if (!place.displayName) throw new Error("Google did not return a display name");
      onSelect({ ...selected, displayName: place.displayName });
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Could not load this place");
    }
  }, [places, onSelect]);

  useEffect(() => {
    selectionHandler.current = resolveSelection;
  }, [resolveSelection]);

  useEffect(() => {
    let disposed = false;
    let mapClick: google.maps.MapsEventListener | null = null;
    void loadGoogleMaps()
      .then(async () => {
        if (disposed || !host.current) return;
        const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        await Promise.all([
          google.maps.importLibrary("marker"),
          google.maps.importLibrary("places"),
        ]);
        if (disposed || !host.current) return;
        const instance = new Map(host.current, {
          center: { lat: 51.5074, lng: -0.1278 },
          zoom: 12,
          mapId: import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID",
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: true,
          clickableIcons: true,
          gestureHandling: "greedy",
        });
        mapClick = instance.addListener("click", (event: google.maps.MapMouseEvent & { placeId?: string; stop?: () => void }) => {
          if (!event.placeId) return;
          event.stop?.();
          void selectionHandler.current({
            placeId: event.placeId,
            location: event.latLng?.toJSON(),
          });
        });
        mapRef.current = instance;
        setMap(instance);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load Google Maps"));
    return () => {
      disposed = true;
      mapClick?.remove();
      markersRef.current.forEach((marker) => { marker.map = null; });
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    let disposed = false;
    markersRef.current.forEach((marker) => { marker.map = null; });
    markersRef.current = [];
    void google.maps.importLibrary("marker").then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      markersRef.current = places.map((place) => {
        const category = categories.find((item) => item.id === place.categoryId);
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: place.lat, lng: place.lng },
          content: markerContent(category?.markerStyle ?? "#e8663d"),
          title: place.displayName ?? place.note ?? "Saved place",
          zIndex: 10,
          collisionBehavior: google.maps.CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL,
        });
        marker.addListener("click", () =>
          void selectionHandler.current({
            placeId: place.placeId,
            displayName: place.displayName ?? undefined,
            location: { lat: place.lat, lng: place.lng },
          }),
        );
        return marker;
      });
      if (!fitDone.current && places.length) {
        const bounds = new google.maps.LatLngBounds();
        places.forEach((place) => bounds.extend({ lat: place.lat, lng: place.lng }));
        map.fitBounds(bounds, 100);
        if (places.length === 1) google.maps.event.addListenerOnce(map, "idle", () => map.setZoom(15));
        fitDone.current = true;
      }
    });
    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => { marker.map = null; });
      markersRef.current = [];
    };
  }, [map, places, categories, onSelect]);

  const handleSearchSelect = useCallback((place: SelectedPlace) => {
    void resolveSelection(place);
  }, [resolveSelection]);

  return (
    <div className="map-canvas-wrap">
      <div ref={host} className="map-canvas" aria-label="Interactive Google Map" />
      {map && <PlaceSearch map={map} onSelect={handleSearchSelect} />}
      <div className="map-legend"><span className="legend-star">★</span> Saved place</div>
      {selectionError && <div className="map-toast" role="alert">{selectionError}</div>}
      {loadError && (
        <div className="map-error">
          <strong>Google Maps couldn’t load</strong>
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
}
