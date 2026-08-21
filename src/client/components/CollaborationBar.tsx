import type { CSSProperties } from "react";
import type { CollaborationUser } from "../../shared/types";
import { collaboratorColour, type CollaborationStatus } from "../collaboration";

function initials(user: CollaborationUser): string {
  const label = user.displayName?.trim() || "Guest";
  return label.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function CollaborationBar({
  users,
  selfUserId,
  followingUserId,
  status,
  onFollow,
}: {
  users: CollaborationUser[];
  selfUserId: string | null;
  followingUserId: string | null;
  status: CollaborationStatus;
  onFollow: (userId: string | null) => void;
}) {
  const ordered = [...users].sort((a, b) => {
    if (a.userId === selfUserId) return -1;
    if (b.userId === selfUserId) return 1;
    return (a.displayName ?? "").localeCompare(b.displayName ?? "");
  });
  const followed = users.find((user) => user.userId === followingUserId);

  return (
    <>
      <div className="collaboration-bar" aria-label="People viewing this map">
        <span className={`connection-dot ${status}`} aria-hidden="true" />
        <span className="viewing-count">
          {status === "connected" ? `${users.length} viewing` : status === "connecting" ? "Connecting…" : "Offline"}
        </span>
        <div className="collaborator-avatars">
          {ordered.slice(0, 6).map((user) => {
            const isSelf = user.userId === selfUserId;
            const label = user.displayName || "Map collaborator";
            return (
              <button
                type="button"
                key={user.userId}
                className={`collaborator-avatar ${followingUserId === user.userId ? "following" : ""}`}
                style={{ "--collaborator-colour": collaboratorColour(user.userId) } as CSSProperties}
                title={isSelf ? `${label} (you)` : `Follow ${label}`}
                aria-label={isSelf ? `${label}, you` : `Follow ${label}`}
                disabled={isSelf}
                onClick={() => onFollow(followingUserId === user.userId ? null : user.userId)}
              >
                {user.avatarUrl
                  ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  : <span>{initials(user)}</span>}
              </button>
            );
          })}
          {ordered.length > 6 && <span className="collaborator-overflow">+{ordered.length - 6}</span>}
        </div>
      </div>
      {followed && (
        <div className="follow-indicator" role="status">
          <span style={{ background: collaboratorColour(followed.userId) }} />
          Following {followed.displayName ?? "collaborator"}
          <button type="button" onClick={() => onFollow(null)}>Stop</button>
        </div>
      )}
    </>
  );
}
