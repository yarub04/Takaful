// project/js/role-guard.js
import { isLoggedIn, getCurrentUser } from "../api/claude_api/auth_api.js";

export function isCharityUser() {
  if (!isLoggedIn()) return false;
  const user = getCurrentUser();
  const roles = user?.roles || [];
  return roles.some(r => (r || "").toUpperCase().includes("CHARITY"));
}

export function isHotelUser() {
  if (!isLoggedIn()) return false;
  const user = getCurrentUser();
  const roles = user?.roles || [];
  return roles.some(r => (r || "").toUpperCase().includes("HOTEL"));
}
