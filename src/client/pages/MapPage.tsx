import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { MapDetail, SelectedPlace } from "../../shared/types";
import { api } from "../api";
import { CategoryDialog } from "../components/CategoryDialog";
import { BackIcon, LayersIcon, MapIcon, MoreIcon, ShareIcon, TrashIcon } from "../components/Icons";
import { MapCanvas } from "../components/MapCanvas";
import { Modal } from "../components/Modal";
import { PlaceDetailsPanel } from "../components/PlaceDetailsPanel";
import { ShareDialog } from "../components/ShareDialog";

export function MapPage({ mapId, navigate }: { mapId: string; navigate: (path: string) => void }) {
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selected, setSelected] = useState<SelectedPlace | null>(null);

  const refresh = useCallback(async () => {
    const next = await api.map(mapId);
    setDetail(next);
  }, [mapId]);

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load map"));
  }, [refresh]);

  const add = useCallback(async (selected: SelectedPlace) => {
    if (!selected.location) throw new Error("Google did not provide a location for this place");
    if (!selected.displayName) throw new Error("Google did not provide a display name for this place");
    const { place } = await api.addPlace(mapId, {
      placeId: selected.placeId,
      displayName: selected.displayName,
      lat: selected.location.lat,
      lng: selected.location.lng,
    });
    setDetail((current) => current ? {
      ...current,
      map: { ...current.map, placeCount: current.map.placeCount + 1 },
      places: [...current.places, place],
    } : current);
  }, [mapId]);

  const update = useCallback(async (placeId: string, input: { note: string | null; categoryId: string | null }) => {
    await api.updatePlace(mapId, placeId, input);
    setDetail((current) => current ? {
      ...current,
      places: current.places.map((place) => place.placeId === placeId ? { ...place, ...input } : place),
    } : current);
  }, [mapId]);

  const remove = useCallback(async (placeId: string) => {
    await api.deletePlace(mapId, placeId);
    setDetail((current) => current ? {
      ...current,
      map: { ...current.map, placeCount: Math.max(0, current.map.placeCount - 1) },
      places: current.places.filter((place) => place.placeId !== placeId),
    } : current);
    setSelected(null);
  }, [mapId]);

  const selectPlace = useCallback((place: SelectedPlace) => {
    setSelected(place);
    if (window.matchMedia("(max-width: 620px)").matches) setSidebarOpen(false);
    const saved = detail?.places.find((item) => item.placeId === place.placeId);
    if (!saved || saved.displayName) return;
    void (async () => {
      try {
        const { Place } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
        const googlePlace = new Place({ id: place.placeId });
        await googlePlace.fetchFields({ fields: ["displayName"] });
        if (!googlePlace.displayName) return;
        await api.updatePlace(mapId, place.placeId, { displayName: googlePlace.displayName });
        setDetail((current) => current ? {
          ...current,
          places: current.places.map((item) => item.placeId === place.placeId
            ? { ...item, displayName: googlePlace.displayName ?? item.displayName }
            : item),
        } : current);
        setSelected((current) => current?.placeId === place.placeId
          ? { ...current, displayName: googlePlace.displayName ?? current.displayName }
          : current);
      } catch {
        // The UI Kit card can still render the place; retry backfill next selection.
      }
    })();
  }, [detail, mapId]);

  if (error) {
    return <main className="fatal-state"><MapIcon/><h1>We couldn’t open this map</h1><p>{error}</p><button className="button primary" onClick={() => navigate("/")}>Back to your maps</button></main>;
  }
  if (!detail) return <main className="loading-state"><span className="loader"/><p>Unfolding your map…</p></main>;

  const canEdit = detail.map.role === "owner" || detail.map.role === "editor";
  const placeGroups = [
    ...detail.categories.map((category) => ({
      id: category.id as string | null,
      name: category.name,
      colour: category.markerStyle ?? "#e8663d",
    })),
    { id: null, name: "Uncategorised", colour: "#b5b5ad" },
  ].map((group) => ({
    ...group,
    places: detail.places
      .filter((place) => place.categoryId === group.id)
      .sort((a, b) => (a.displayName ?? "Saved place").localeCompare(b.displayName ?? "Saved place")),
  }));
  const selectedSavedPlace = selected
    ? detail.places.find((place) => place.placeId === selected.placeId)
    : undefined;

  return (
    <main className={`map-page ${sidebarOpen ? "sidebar-open" : ""}`}>
      <aside className="map-sidebar">
        <header className="sidebar-brand">
          <button className="icon-button" aria-label="Back to maps" onClick={() => navigate("/")}><BackIcon/></button>
          <a className="brand compact-brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}><span className="brand-mark"><MapIcon/></span>Pinboard</a>
        </header>
        <div className="map-title-block">
          <span className="role-badge">{detail.map.role}</span>
          <h1>{detail.map.title}</h1>
          {detail.map.description && <p>{detail.map.description}</p>}
          <div className="map-meta"><span>★</span>{detail.places.length} saved {detail.places.length === 1 ? "place" : "places"}</div>
        </div>
        <div className="sidebar-section places-section">
          <div className="section-heading"><h2>Places</h2>{canEdit && <button className="text-button" onClick={() => setCategoriesOpen(true)}>Manage categories</button>}</div>
          <div className="places-by-category">
            {placeGroups.map((group) => (
              <section className="place-group" key={group.id ?? "uncategorised"}>
                <header><span className="category-dot" style={{ background: group.colour }}/><h3>{group.name}</h3><b>{group.places.length}</b></header>
                {group.places.map((place) => (
                  <button
                    className={selected?.placeId === place.placeId ? "active" : ""}
                    key={place.id}
                    onClick={() => selectPlace({
                      placeId: place.placeId,
                      displayName: place.displayName ?? undefined,
                      location: { lat: place.lat, lng: place.lng },
                    })}
                  >
                    <span>{place.displayName ?? "Saved place"}</span>
                    {place.note && <small>{place.note}</small>}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
        {!detail.places.length && <div className="sidebar-help">
          <div className="help-star">★</div>
          <div><strong>Add places from the map</strong><p>Search above, or click any Google place, then choose “Add to map”.</p></div>
        </div>}
        <footer className="sidebar-footer">
          {detail.map.role === "owner" && <button className="sidebar-action" onClick={() => setShareOpen(true)}><ShareIcon/> Share map</button>}
          {detail.map.role === "owner" && <button className="icon-button" aria-label="Map settings" onClick={() => setSettingsOpen(true)}><MoreIcon/></button>}
        </footer>
      </aside>
      <section className="map-workspace">
        <button className="sidebar-toggle" aria-label="Toggle map details" onClick={() => setSidebarOpen((value) => !value)}><LayersIcon/></button>
        <MapCanvas places={detail.places} categories={detail.categories} onSelect={selectPlace}/>
        {selected && (
          <PlaceDetailsPanel
            selected={selected}
            savedPlace={selectedSavedPlace}
            categories={detail.categories}
            canEdit={canEdit}
            onClose={() => setSelected(null)}
            onAdd={() => add(selected)}
            onUpdate={(input) => update(selected.placeId, input)}
            onRemove={() => remove(selected.placeId)}
          />
        )}
        {detail.map.role === "owner" && <button className="floating-share button secondary" onClick={() => setShareOpen(true)}><ShareIcon/> Share</button>}
      </section>
      {categoriesOpen && <CategoryDialog mapId={mapId} categories={detail.categories} onChange={refresh} onClose={() => setCategoriesOpen(false)}/>} 
      {shareOpen && <ShareDialog mapId={mapId} onClose={() => setShareOpen(false)}/>} 
      {settingsOpen && <MapSettings detail={detail} onSaved={refresh} onDeleted={() => navigate("/")} onClose={() => setSettingsOpen(false)}/>} 
    </main>
  );
}

function MapSettings({ detail, onSaved, onDeleted, onClose }: { detail: MapDetail; onSaved: () => Promise<void>; onDeleted: () => void; onClose: () => void }) {
  const [title, setTitle] = useState(detail.map.title);
  const [description, setDescription] = useState(detail.map.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await api.updateMap(detail.map.id, { title, description: description.trim() || null }); await onSaved(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update map"); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${detail.map.title}” and all its saved places? This cannot be undone.`)) return;
    setBusy(true);
    try { await api.deleteMap(detail.map.id); onDeleted(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete map"); setBusy(false); }
  };
  return <Modal title="Map settings" onClose={onClose}><form className="modal-body form-stack" onSubmit={save}><label className="field"><span>Map name</span><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}/></label><label className="field"><span>Description</span><textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)}/></label>{error && <p className="form-error">{error}</p>}<div className="danger-zone"><button type="button" className="button danger-ghost" disabled={busy} onClick={() => void remove()}><TrashIcon/> Delete map</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div></form></Modal>;
}
