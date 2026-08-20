import { useEffect, useRef, useState } from "react";
import type { SelectedPlace } from "../../shared/types";

type AutocompleteElement = HTMLElement & {
  placeholder: string;
  locationBias: google.maps.LatLngBounds | null;
};

type SelectEvent = Event & {
  placePrediction: {
    toPlace(): google.maps.places.Place;
  };
};

/** Isolates Google's PlaceAutocompleteElement experimental event surface. */
export function PlaceSearch({
  map,
  onSelect,
}: {
  map: google.maps.Map;
  onSelect: (place: SelectedPlace) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let element: AutocompleteElement | null = null;
    let disposed = false;
    let boundsListener: google.maps.MapsEventListener | null = null;
    const setup = async () => {
      const library = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
      if (disposed || !host.current) return;
      element = new library.PlaceAutocompleteElement() as AutocompleteElement;
      element.placeholder = "Search Google Places";
      host.current.replaceChildren(element);
      boundsListener = map.addListener("bounds_changed", () => {
        if (element) element.locationBias = map.getBounds() ?? null;
      });
      element.addEventListener("gmp-select", async (rawEvent) => {
        try {
          const event = rawEvent as SelectEvent;
          const place = event.placePrediction.toPlace();
          await place.fetchFields({ fields: ["id", "displayName", "location", "viewport"] });
          if (!place.id || !place.location) return;
          if (place.viewport) map.fitBounds(place.viewport, 72);
          else {
            map.setCenter(place.location);
            map.setZoom(17);
          }
          onSelect({
            placeId: place.id,
            displayName: place.displayName ?? undefined,
            location: place.location.toJSON(),
          });
        } catch {
          setError(true);
        }
      });
    };
    void setup();
    return () => {
      disposed = true;
      boundsListener?.remove();
      element?.remove();
    };
  }, [map, onSelect]);

  return (
    <div className="place-search-shell">
      <div ref={host} className="place-search-host" />
      {error && <span className="search-error">Search failed. Try again.</span>}
    </div>
  );
}
