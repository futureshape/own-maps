import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Category,
  CollaborationCursor,
  CollaborationUser,
  CollaborationViewport,
  SavedPlace,
  SelectedPlace,
} from "../../shared/types";
import { collaboratorColour } from "../collaboration";
import { loadGoogleMaps } from "../google";
import { PlaceSearch } from "./PlaceSearch";

function markerContent(color: string): HTMLElement {
  const marker = document.createElement("div");
  marker.className = "saved-marker";
  marker.style.setProperty("--marker-color", color);
  marker.innerHTML = `
    <svg viewBox="0 0 48 58" aria-hidden="true">
      <path class="saved-marker-pin" d="M24 2C11.85 2 2 11.85 2 24c0 16.5 22 32 22 32s22-15.5 22-32C46 11.85 36.15 2 24 2Z" />
      <path class="saved-marker-star" d="m24 11.5 3.35 6.79 7.49 1.09-5.42 5.28 1.28 7.46L24 28.6l-6.7 3.52 1.28-7.46-5.42-5.28 7.49-1.09L24 11.5Z" />
    </svg>
    <span class="sr-only">Saved place</span>
  `;
  return marker;
}

function selectedMarkerContent(): HTMLElement {
  const marker = document.createElement("div");
  marker.className = "selected-marker";
  marker.innerHTML = `
    <svg viewBox="0 0 48 58" aria-hidden="true">
      <path class="selected-marker-pin" d="M24 2C11.85 2 2 11.85 2 24c0 16.5 22 32 22 32s22-15.5 22-32C46 11.85 36.15 2 24 2Z" />
      <circle class="selected-marker-dot" cx="24" cy="24" r="6" />
    </svg>
    <span class="sr-only">Selected search result</span>
  `;
  return marker;
}

function collaboratorCursorContent(user: CollaborationUser): HTMLElement {
  const cursor = document.createElement("div");
  cursor.className = "collaborator-cursor";
  cursor.style.setProperty("--collaborator-colour", collaboratorColour(user.userId));
  cursor.innerHTML = `<svg viewBox="0 0 28 34" aria-hidden="true"><path d="M2 2v25l7.2-6.3 5.1 10.7 4.2-2-5.1-10.6 9.6-.8L2 2Z" /></svg>`;
  const label = document.createElement("span");
  label.textContent = user.displayName ?? "Collaborator";
  cursor.appendChild(label);
  return cursor;
}

export function MapCanvas({
  places,
  categories,
  canEdit,
  onSelect,
  selected,
  collaborators,
  remoteCursors,
  followViewport,
  onCursorMove,
  onViewportChange,
  onStopFollowing,
}: {
  places: SavedPlace[];
  categories: Category[];
  canEdit: boolean;
  onSelect: (place: SelectedPlace) => void;
  selected: SelectedPlace | null;
  collaborators: CollaborationUser[];
  remoteCursors: CollaborationCursor[];
  followViewport: CollaborationViewport | null;
  onCursorMove: (position: { lat: number; lng: number } | null) => void;
  onViewportChange: (center: { lat: number; lng: number }, zoom: number) => void;
  onStopFollowing: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const selectedMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const collaboratorMarkersRef = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const fitDone = useRef(false);
  const selectionHandler = useRef<(place: SelectedPlace) => Promise<void>>(async () => {});
  const cursorHandler = useRef(onCursorMove);
  const viewportHandler = useRef(onViewportChange);
  const stopFollowingHandler = useRef(onStopFollowing);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectedPlaceId = selected?.placeId;
  const selectedLocation = selected?.location;

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
    cursorHandler.current = onCursorMove;
    viewportHandler.current = onViewportChange;
    stopFollowingHandler.current = onStopFollowing;
  }, [onCursorMove, onStopFollowing, onViewportChange]);

  useEffect(() => {
    let disposed = false;
    const collaboratorMarkers = collaboratorMarkersRef.current;
    let mapClick: google.maps.MapsEventListener | null = null;
    let mapMouseMove: google.maps.MapsEventListener | null = null;
    let mapIdle: google.maps.MapsEventListener | null = null;
    let mapDragStart: google.maps.MapsEventListener | null = null;
    let cursorTimer: number | null = null;
    let pendingCursor: google.maps.LatLngLiteral | null = null;
    void loadGoogleMaps()
      .then(async () => {
        if (disposed || !host.current) return;
        const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        if (disposed || !host.current) return;
        const instance = new Map(host.current, {
          center: { lat: 51.5074, lng: -0.1278 },
          zoom: 12,
          mapId: import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID",
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: true,
          clickableIcons: canEdit,
          gestureHandling: "greedy",
        });
        if (canEdit) {
          mapClick = instance.addListener("click", (event: google.maps.MapMouseEvent & { placeId?: string; stop?: () => void }) => {
            if (!event.placeId) return;
            event.stop?.();
            void selectionHandler.current({
              placeId: event.placeId,
              location: event.latLng?.toJSON(),
            });
          });
        }
        mapMouseMove = instance.addListener("mousemove", (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          pendingCursor = event.latLng.toJSON();
          if (cursorTimer !== null) return;
          cursorTimer = window.setTimeout(() => {
            cursorTimer = null;
            if (pendingCursor) cursorHandler.current(pendingCursor);
          }, 50);
        });
        mapIdle = instance.addListener("idle", () => {
          const center = instance.getCenter();
          const zoom = instance.getZoom();
          if (center && zoom !== undefined) viewportHandler.current(center.toJSON(), zoom);
        });
        mapDragStart = instance.addListener("dragstart", () => stopFollowingHandler.current());
        mapRef.current = instance;
        setMap(instance);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load Google Maps"));
    return () => {
      disposed = true;
      mapClick?.remove();
      mapMouseMove?.remove();
      mapIdle?.remove();
      mapDragStart?.remove();
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
      markersRef.current.forEach((marker) => { marker.map = null; });
      collaboratorMarkers.forEach((marker) => { marker.map = null; });
      collaboratorMarkers.clear();
      if (selectedMarkerRef.current) selectedMarkerRef.current.map = null;
      selectedMarkerRef.current = null;
      mapRef.current = null;
    };
  }, [canEdit]);

  useEffect(() => {
    if (!map) return;
    let disposed = false;
    void google.maps.importLibrary("marker").then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      const activeUserIds = new Set(remoteCursors.map((cursor) => cursor.userId));
      for (const [userId, marker] of collaboratorMarkersRef.current) {
        if (activeUserIds.has(userId)) continue;
        marker.map = null;
        collaboratorMarkersRef.current.delete(userId);
      }
      for (const cursor of remoteCursors) {
        const existing = collaboratorMarkersRef.current.get(cursor.userId);
        if (existing) {
          existing.position = { lat: cursor.lat, lng: cursor.lng };
          continue;
        }
        const user = collaborators.find((candidate) => candidate.userId === cursor.userId);
        if (!user) continue;
        collaboratorMarkersRef.current.set(cursor.userId, new AdvancedMarkerElement({
          map,
          position: { lat: cursor.lat, lng: cursor.lng },
          content: collaboratorCursorContent(user),
          title: `${user.displayName ?? "Collaborator"}'s cursor`,
          zIndex: 100,
          collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
        }));
      }
    });
    return () => { disposed = true; };
  }, [collaborators, map, remoteCursors]);

  useEffect(() => {
    if (!map || !followViewport) return;
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const centerChanged = !currentCenter ||
      Math.abs(currentCenter.lat() - followViewport.center.lat) > 0.000001 ||
      Math.abs(currentCenter.lng() - followViewport.center.lng) > 0.000001;
    if (centerChanged || currentZoom !== followViewport.zoom) {
      map.moveCamera({ center: followViewport.center, zoom: followViewport.zoom });
    }
  }, [followViewport, map]);

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
          gmpClickable: true,
        });
        marker.addEventListener("gmp-click", () =>
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

  useEffect(() => {
    const isSaved = places.some((place) => place.placeId === selectedPlaceId);
    if (selectedMarkerRef.current) selectedMarkerRef.current.map = null;
    selectedMarkerRef.current = null;
    if (!map || selected?.source !== "search" || !selectedLocation || isSaved) return;

    let disposed = false;
    void google.maps.importLibrary("marker").then((library) => {
      if (disposed) return;
      const { AdvancedMarkerElement } = library as google.maps.MarkerLibrary;
      selectedMarkerRef.current = new AdvancedMarkerElement({
        map,
        position: selectedLocation,
        content: selectedMarkerContent(),
        title: selected.displayName ?? "Selected search result",
        zIndex: 11,
        collisionBehavior: google.maps.CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL,
      });
    });

    return () => {
      disposed = true;
      if (selectedMarkerRef.current) selectedMarkerRef.current.map = null;
      selectedMarkerRef.current = null;
    };
  }, [map, places, selected, selectedLocation, selectedPlaceId]);

  useEffect(() => {
    if (!map || !selectedPlaceId) return;
    if (selectedLocation) map.setCenter(selectedLocation);

    let observer: ResizeObserver | null = null;
    let panelSize = 0;
    const frame = window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(".place-details-sidebar");
      if (!panel) return;

      const keepSelectedPlaceVisible = () => {
        const isMobile = window.matchMedia("(max-width: 620px)").matches;
        const nextPanelSize = isMobile ? panel.clientHeight : panel.clientWidth;
        const offset = Math.round((nextPanelSize - panelSize) / 2);
        if (offset > 0) map.panBy(isMobile ? 0 : offset, isMobile ? offset : 0);
        panelSize = nextPanelSize;
      };

      keepSelectedPlaceVisible();
      observer = new ResizeObserver(keepSelectedPlaceVisible);
      observer.observe(panel);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [map, selectedLocation, selectedPlaceId]);

  const handleSearchSelect = useCallback((place: SelectedPlace) => {
    void resolveSelection(place);
  }, [resolveSelection]);

  return (
    <div className="map-canvas-wrap" onMouseLeave={() => cursorHandler.current(null)}>
      <div ref={host} className="map-canvas" aria-label="Interactive Google Map" />
      {map && canEdit && <PlaceSearch map={map} onSelect={handleSearchSelect} />}
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
