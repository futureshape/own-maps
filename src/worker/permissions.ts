import type { MapRole } from "../shared/types";
import { HttpError } from "./http";

export function canEdit(role: MapRole): boolean {
  return role === "owner" || role === "editor";
}

export function canManageMembers(role: MapRole): boolean {
  return role === "owner";
}

export function requireEdit(role: MapRole): void {
  if (!canEdit(role)) throw new HttpError(403, "Editor access required");
}

export function requireOwner(role: MapRole): void {
  if (!canManageMembers(role)) throw new HttpError(403, "Owner access required");
}
