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
