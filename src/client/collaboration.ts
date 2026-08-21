import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CollaborationCursor,
  CollaborationServerMessage,
  CollaborationUser,
  CollaborationViewport,
} from "../shared/types";

export type CollaborationStatus = "connecting" | "connected" | "disconnected";

const collaboratorColours = ["#c94f36", "#2f7564", "#3976a8", "#8056a6", "#b27b1f", "#b54773"];

export function collaboratorColour(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return collaboratorColours[Math.abs(hash) % collaboratorColours.length];
}

function isServerMessage(value: unknown): value is CollaborationServerMessage {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}

export function useMapCollaboration({
  mapId,
  publicToken,
  enabled,
  onDataChanged,
}: {
  mapId: string | null;
  publicToken: string | null;
  enabled: boolean;
  onDataChanged: () => Promise<void>;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const latestRevision = useRef(0);
  const [status, setStatus] = useState<CollaborationStatus>("disconnected");
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<Record<string, CollaborationCursor>>({});
  const [viewports, setViewports] = useState<Record<string, CollaborationViewport>>({});

  useEffect(() => {
    if (!enabled || (!mapId && !publicToken)) return;
    let disposed = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    const guestId = publicToken ? crypto.randomUUID() : null;

    const scheduleRefresh = () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void onDataChanged().catch((error) => {
          console.error("Could not refresh collaborative map data", error);
        });
      }, 60);
    };

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const path = publicToken
        ? `/api/public/maps/${encodeURIComponent(publicToken)}/collaboration?guestId=${encodeURIComponent(guestId!)}`
        : `/api/maps/${encodeURIComponent(mapId!)}/collaboration`;
      const socket = new WebSocket(
        `${protocol}//${window.location.host}${path}`,
      );
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        retryAttempt = 0;
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!isServerMessage(parsed)) return;

        if (parsed.type === "ready") {
          setStatus("connected");
          setSelfUserId(parsed.selfUserId);
          setUsers(parsed.users);
          latestRevision.current = parsed.revision;
          scheduleRefresh();
          return;
        }
        if (parsed.type === "presence") {
          setUsers(parsed.users);
          const active = new Set(parsed.users.map((user) => user.userId));
          setCursors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => active.has(id))));
          setViewports((current) => Object.fromEntries(Object.entries(current).filter(([id]) => active.has(id))));
          return;
        }
        if (parsed.type === "cursor") {
          setCursors((current) => {
            const next = { ...current };
            if (parsed.cursor.lat === null || parsed.cursor.lng === null) delete next[parsed.cursor.userId];
            else next[parsed.cursor.userId] = parsed.cursor;
            return next;
          });
          return;
        }
        if (parsed.type === "viewport") {
          setViewports((current) => ({ ...current, [parsed.viewport.userId]: parsed.viewport }));
          return;
        }
        if (parsed.type === "data_changed" && parsed.revision > latestRevision.current) {
          latestRevision.current = parsed.revision;
          scheduleRefresh();
        }
      });
      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        setStatus("disconnected");
        setUsers([]);
        setCursors({});
        setViewports({});
        if (disposed || event.code === 1008) return;
        const delay = Math.min(10_000, 500 * 2 ** retryAttempt);
        retryAttempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "Map closed");
      setStatus("disconnected");
      setUsers([]);
      setCursors({});
      setViewports({});
    };
  }, [enabled, mapId, onDataChanged, publicToken]);

  const send = useCallback((message: object) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const sendCursor = useCallback((position: { lat: number; lng: number } | null) => {
    send({ type: "cursor", lat: position?.lat ?? null, lng: position?.lng ?? null });
  }, [send]);

  const sendViewport = useCallback((center: { lat: number; lng: number }, zoom: number) => {
    send({ type: "viewport", center, zoom });
  }, [send]);

  return { status, selfUserId, users, cursors, viewports, sendCursor, sendViewport };
}
