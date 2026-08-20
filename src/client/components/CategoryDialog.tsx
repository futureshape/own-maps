import { useState, type FormEvent } from "react";
import type { Category } from "../../shared/types";
import { api } from "../api";
import { Modal } from "./Modal";
import { TrashIcon } from "./Icons";

const colours = ["#e8663d", "#d9a62e", "#3f8c75", "#3976a8", "#7557a8", "#cf507a"];

export function CategoryDialog({
  mapId,
  categories,
  onChange,
  onClose,
}: {
  mapId: string;
  categories: Category[];
  onChange: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState(colours[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCategory(mapId, { name, markerStyle: colour });
      setName("");
      await onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add category");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category: Category) => {
    setBusy(true);
    try {
      await api.deleteCategory(mapId, category.id);
      await onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove category");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="modal-body">
        <p className="muted">Group places and give their saved markers a colour.</p>
        <div className="category-list">
          {categories.map((category) => (
            <div className="category-row" key={category.id}>
              <span className="category-dot" style={{ background: category.markerStyle ?? colours[0] }} />
              <span>{category.name}</span>
              <button className="icon-button small" aria-label={`Delete ${category.name}`} disabled={busy} onClick={() => void remove(category)}><TrashIcon /></button>
            </div>
          ))}
          {!categories.length && <div className="empty-inline">No categories yet</div>}
        </div>
        <form className="category-form" onSubmit={submit}>
          <label className="field">
            <span>New category</span>
            <input required maxLength={60} placeholder="Coffee, walks, someday…" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <fieldset className="colour-picker">
            <legend>Marker colour</legend>
            {colours.map((item) => (
              <label key={item}>
                <input type="radio" name="colour" value={item} checked={colour === item} onChange={() => setColour(item)} />
                <span style={{ background: item }} />
              </label>
            ))}
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary" disabled={busy}>{busy ? "Adding…" : "Add category"}</button>
        </form>
      </div>
    </Modal>
  );
}
