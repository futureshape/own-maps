import { useEffect, useState } from "react";
import type { Category, SavedPlace, SelectedPlace } from "../../shared/types";
import { CloseIcon } from "./Icons";
import { PlaceCard } from "./PlaceCard";

export function PlaceDetailsPanel({
  selected,
  savedPlace,
  categories,
  canEdit,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
}: {
  selected: SelectedPlace;
  savedPlace?: SavedPlace;
  categories: Category[];
  canEdit: boolean;
  onClose: () => void;
  onAdd: () => Promise<void>;
  onUpdate: (input: { note: string | null; categoryId: string | null }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [note, setNote] = useState(savedPlace?.note ?? "");
  const [categoryId, setCategoryId] = useState(savedPlace?.categoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setNote(savedPlace?.note ?? "");
    setCategoryId(savedPlace?.categoryId ?? "");
    setMessage(null);
  }, [savedPlace, selected.placeId]);

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="place-details-sidebar" aria-label="Selected place details">
      <header className="place-details-header">
        <div>
          <span className="eyebrow">Selected place</span>
          <h2>{savedPlace?.displayName ?? selected.displayName ?? "Google place"}</h2>
        </div>
        <button className="icon-button" aria-label="Close place details" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="place-details-scroll">
        <PlaceCard placeId={selected.placeId} />
        <div className="place-actions">
          {!savedPlace ? (
            canEdit ? (
              <button className="button primary full" disabled={busy || !selected.displayName} onClick={() => void run(onAdd)}>
                <span aria-hidden="true">★</span> {busy ? "Saving…" : "Add to map"}
              </button>
            ) : (
              <p className="popup-hint">Viewer access · this place is not saved</p>
            )
          ) : (
            <>
              <div className="saved-label"><span>★</span> Saved to this map</div>
              {canEdit ? (
                <>
                  <label className="field compact">
                    <span>Category</span>
                    <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                      <option value="">Uncategorised</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field compact">
                    <span>Your note</span>
                    <textarea
                      rows={4}
                      maxLength={2000}
                      placeholder="What makes this place worth remembering?"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                  <div className="popup-buttons">
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void run(() => onUpdate({ note: note.trim() || null, categoryId: categoryId || null }), "Saved")}
                    >
                      Save changes
                    </button>
                    <button className="button danger-ghost" disabled={busy} onClick={() => void run(onRemove)}>
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {savedPlace.note && <p className="viewer-note">“{savedPlace.note}”</p>}
                  <p className="popup-hint">Viewer access</p>
                </>
              )}
            </>
          )}
          {message && <p className="popup-message" role="status">{message}</p>}
        </div>
      </div>
    </aside>
  );
}
