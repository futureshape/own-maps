import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Invite, Member } from "../../shared/types";
import { api } from "../api";
import { Modal } from "./Modal";
import { TrashIcon } from "./Icons";

export function ShareDialog({
  mapId,
  publicToken: initialPublicToken,
  onPublicTokenChange,
  onClose,
}: {
  mapId: string;
  publicToken: string | null;
  onPublicTokenChange: (publicToken: string | null) => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicToken, setPublicToken] = useState(initialPublicToken);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const publicUrl = publicToken
    ? `${window.location.origin}/public/${encodeURIComponent(publicToken)}`
    : null;
  const privateExportBase = `/api/maps/${encodeURIComponent(mapId)}/export`;
  const publicFeeds = publicUrl ? [
    { label: "GeoJSON", url: `${publicUrl}/map.geojson` },
    { label: "KML", url: `${publicUrl}/map.kml` },
  ] : [];

  const refresh = useCallback(async () => {
    const response = await api.sharing(mapId);
    setMembers(response.members);
    setInvites(response.invites);
  }, [mapId]);

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load sharing"));
  }, [refresh]);

  useEffect(() => setPublicToken(initialPublicToken), [initialPublicToken]);

  const togglePublicAccess = async () => {
    setBusy(true);
    setError(null);
    setCopyMessage(null);
    try {
      const response = await api.updateMap(mapId, { publicAccess: !publicToken });
      setPublicToken(response.publicToken);
      onPublicTokenChange(response.publicToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update public access");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage(`${label} copied`);
    } catch {
      setCopyMessage("Could not copy automatically. Select and copy the link.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.invite(mapId, { email, role });
      setEmail("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not share map");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: Member, nextRole: "editor" | "viewer") => {
    setBusy(true);
    try {
      await api.updateMember(mapId, member.userId, nextRole);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update member");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: Member) => {
    setBusy(true);
    try {
      await api.removeMember(mapId, member.userId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  };

  const removeInvite = async (invite: Invite) => {
    setBusy(true);
    try {
      await api.removeInvite(mapId, invite.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Share this map" onClose={onClose}>
      <div className="modal-body">
        <section className="public-sharing" aria-labelledby="public-sharing-title">
          <div>
            <h3 id="public-sharing-title">Public link</h3>
            <p>Anyone with the link can view this map without signing in. They cannot make changes.</p>
          </div>
          <label className="public-checkbox">
            <input
              type="checkbox"
              checked={publicToken !== null}
              disabled={busy}
              onChange={() => void togglePublicAccess()}
            />
            Enable public link
          </label>
          {publicUrl && (
            <div className="public-link-row">
              <input
                aria-label="Public map link"
                readOnly
                value={publicUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="button secondary" onClick={() => void copyLink(publicUrl, "Public link")}>
                Copy link
              </button>
            </div>
          )}
        </section>
        <section className="export-sharing" aria-labelledby="export-sharing-title">
          <div>
            <h3 id="export-sharing-title">Export places</h3>
            <p>Use KML with Google My Maps, or GeoJSON with most mapping tools.</p>
          </div>
          <div className="export-actions">
            <a className="button secondary" href={`${privateExportBase}.geojson`} download>Download GeoJSON</a>
            <a className="button secondary" href={`${privateExportBase}.kml`} download>Download KML</a>
          </div>
          {publicFeeds.length > 0 && (
            <div className="public-feeds">
              <h4>Public data feeds</h4>
              <p>These URLs use the same public key and stay in sync with the shared map.</p>
              <div className="feed-list">
                {publicFeeds.map((feed) => (
                  <div className="feed-row" key={feed.label}>
                    <label>
                      <span>{feed.label}</span>
                      <input
                        aria-label={`Public ${feed.label} feed`}
                        readOnly
                        value={feed.url}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </label>
                    <button type="button" className="button secondary" onClick={() => void copyLink(feed.url, `${feed.label} feed URL`)}>
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {copyMessage && <p className="copy-message" role="status">{copyMessage}</p>}
        </section>
        <p className="muted sharing-intro">Or invite someone by the email on their Google account. They’ll get access when they sign in.</p>
        <form className="invite-form" onSubmit={submit}>
          <label className="field grow">
            <span>Email</span>
            <input type="email" required maxLength={254} placeholder="someone@gmail.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field role-field">
            <span>Access</span>
            <select value={role} onChange={(event) => setRole(event.target.value as "editor" | "viewer")}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button className="button primary invite-button" disabled={busy}>Invite</button>
        </form>
        {error && <p className="form-error">{error}</p>}
        <div className="sharing-list">
          <h3>People with access</h3>
          {members.map((member) => (
            <div className="person-row" key={member.userId}>
              {member.avatarUrl ? <img src={member.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{member.email[0]?.toUpperCase()}</span>}
              <div className="person-copy">
                <strong>{member.displayName || member.email}</strong>
                <span>{member.displayName ? member.email : member.role}</span>
              </div>
              {member.role === "owner" ? (
                <span className="role-badge">Owner</span>
              ) : (
                <>
                  <select aria-label={`Role for ${member.email}`} disabled={busy} value={member.role} onChange={(event) => void changeRole(member, event.target.value as "editor" | "viewer")}>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button className="icon-button small" disabled={busy} aria-label={`Remove ${member.email}`} onClick={() => void removeMember(member)}><TrashIcon /></button>
                </>
              )}
            </div>
          ))}
          {invites.map((invite) => (
            <div className="person-row pending" key={invite.id}>
              <span className="avatar-fallback">{invite.email[0]?.toUpperCase()}</span>
              <div className="person-copy"><strong>{invite.email}</strong><span>Invite pending</span></div>
              <span className="role-badge">{invite.role}</span>
              <button className="icon-button small" disabled={busy} aria-label={`Cancel invite for ${invite.email}`} onClick={() => void removeInvite(invite)}><TrashIcon /></button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
