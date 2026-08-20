import type { Category, Invite, MapDetail, MapSummary, Member, SavedPlace, User } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<{ user: User }>("/api/me"),
  login: (credential: string) =>
    request<{ user: User }>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  maps: () => request<{ maps: MapSummary[] }>("/api/maps"),
  createMap: (input: { title: string; description?: string | null }) =>
    request<{ map: MapSummary }>("/api/maps", { method: "POST", body: JSON.stringify(input) }),
  map: (id: string) => request<MapDetail>(`/api/maps/${encodeURIComponent(id)}`),
  updateMap: (id: string, input: { title?: string; description?: string | null }) =>
    request<{ ok: true }>(`/api/maps/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteMap: (id: string) => request<void>(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addPlace: (mapId: string, input: { placeId: string; displayName: string; lat: number; lng: number }) =>
    request<{ place: SavedPlace }>(`/api/maps/${encodeURIComponent(mapId)}/places`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePlace: (
    mapId: string,
    placeId: string,
    input: { displayName?: string; note?: string | null; categoryId?: string | null; sortOrder?: number | null },
  ) =>
    request<{ ok: true }>(
      `/api/maps/${encodeURIComponent(mapId)}/places/${encodeURIComponent(placeId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  deletePlace: (mapId: string, placeId: string) =>
    request<void>(`/api/maps/${encodeURIComponent(mapId)}/places/${encodeURIComponent(placeId)}`, {
      method: "DELETE",
    }),
  createCategory: (mapId: string, input: { name: string; markerStyle: string }) =>
    request<{ category: Category }>(`/api/maps/${encodeURIComponent(mapId)}/categories`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteCategory: (mapId: string, categoryId: string) =>
    request<void>(
      `/api/maps/${encodeURIComponent(mapId)}/categories/${encodeURIComponent(categoryId)}`,
      { method: "DELETE" },
    ),
  sharing: (mapId: string) =>
    request<{ members: Member[]; invites: Invite[] }>(`/api/maps/${encodeURIComponent(mapId)}/members`),
  invite: (mapId: string, input: { email: string; role: "editor" | "viewer" }) =>
    request<{ status: string }>(`/api/maps/${encodeURIComponent(mapId)}/invites`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMember: (mapId: string, userId: string, role: "editor" | "viewer") =>
    request<{ ok: true }>(
      `/api/maps/${encodeURIComponent(mapId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  removeMember: (mapId: string, userId: string) =>
    request<void>(`/api/maps/${encodeURIComponent(mapId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  removeInvite: (mapId: string, inviteId: string) =>
    request<void>(`/api/maps/${encodeURIComponent(mapId)}/invites/${encodeURIComponent(inviteId)}`, {
      method: "DELETE",
    }),
};
