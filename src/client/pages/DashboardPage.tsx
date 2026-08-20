import { useEffect, useState, type FormEvent } from "react";
import type { MapSummary } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { ArrowIcon, MapIcon, PlusIcon } from "../components/Icons";
import { Modal } from "../components/Modal";

export function DashboardPage({ navigate }: { navigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.maps().then(({ maps: result }) => setMaps(result)).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load maps"));
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { map } = await api.createMap({ title, description: description.trim() || null });
      navigate(`/maps/${map.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create map");
      setBusy(false);
    }
  };

  return (
    <main className="dashboard">
      <header className="app-header">
        <a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }} className="brand"><span className="brand-mark"><MapIcon /></span>Pinboard</a>
        <div className="account-menu">
          {user?.avatarUrl && <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
          <span>{user?.displayName || user?.email}</span>
          <button className="text-button" onClick={() => void logout()}>Sign out</button>
        </div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-heading"><div><p className="eyebrow">Your collection</p><h1>Your maps</h1><p>Every good adventure starts with a pin.</p></div><button className="button primary" onClick={() => setCreating(true)}><PlusIcon /> New map</button></div>
        {error && <p className="form-error">{error}</p>}
        {maps.length ? (
          <div className="map-grid">
            {maps.map((map, index) => (
              <button className="map-card" key={map.id} onClick={() => navigate(`/maps/${map.id}`)}>
                <div className={`map-card-art art-${index % 4}`}><span>★</span><i/><b/></div>
                <div className="map-card-copy"><span className="role-badge">{map.role}{map.publicAccess ? " · public" : ""}</span><h2>{map.title}</h2><p>{map.description || "A personal map waiting for more places."}</p><div><span>{map.placeCount} {map.placeCount === 1 ? "place" : "places"}</span><ArrowIcon /></div></div>
              </button>
            ))}
            <button className="new-map-card" onClick={() => setCreating(true)}><span><PlusIcon /></span><strong>Create another map</strong></button>
          </div>
        ) : (
          <div className="empty-maps"><div className="empty-map-art"><MapIcon/><span>★</span></div><h2>Make your first map</h2><p>Start a collection for an upcoming trip, hometown favourites, or places you never want to forget.</p><button className="button primary" onClick={() => setCreating(true)}><PlusIcon/> Create a map</button></div>
        )}
      </section>
      {creating && (
        <Modal title="Create a new map" onClose={() => setCreating(false)}>
          <form className="modal-body form-stack" onSubmit={create}>
            <label className="field"><span>Map name</span><input autoFocus required maxLength={120} placeholder="Favourite London places" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="field"><span>Description <small>optional</small></span><textarea rows={3} maxLength={1000} placeholder="What belongs on this map?" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions"><button type="button" className="button secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create map"}</button></div>
          </form>
        </Modal>
      )}
    </main>
  );
}
