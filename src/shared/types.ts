export type MapRole = "owner" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface MapSummary {
  id: string;
  title: string;
  description: string | null;
  role: MapRole;
  publicAccess: boolean;
  placeCount: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  markerStyle: string | null;
}

export interface SavedPlace {
  id: string;
  placeId: string;
  displayName: string | null;
  lat: number;
  lng: number;
  categoryId: string | null;
  note: string | null;
  sortOrder: number | null;
  createdAt: number;
}

export interface MapDetail {
  map: MapSummary;
  categories: Category[];
  places: SavedPlace[];
  publicToken: string | null;
  publicView: boolean;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: MapRole;
}

export interface Invite {
  id: string;
  email: string;
  role: Exclude<MapRole, "owner">;
  createdAt: number;
}

export type SelectedPlace = {
  placeId: string;
  displayName?: string;
  location?: google.maps.LatLngLiteral;
  source?: "search";
};

export interface CollaborationUser {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: MapRole;
  isAnonymous: boolean;
}

export interface CollaborationCursor {
  userId: string;
  lat: number;
  lng: number;
}

export interface CollaborationViewport {
  userId: string;
  center: { lat: number; lng: number };
  zoom: number;
}

export type CollaborationServerMessage =
  | { type: "ready"; selfUserId: string; users: CollaborationUser[]; revision: number }
  | { type: "presence"; users: CollaborationUser[] }
  | { type: "cursor"; cursor: CollaborationCursor | { userId: string; lat: null; lng: null } }
  | { type: "viewport"; viewport: CollaborationViewport }
  | { type: "data_changed"; revision: number };
