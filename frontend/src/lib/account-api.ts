import { request } from "@/lib/api";

export type SessionUser = { id: string; username: string; isAdmin: boolean };
export type ManagedUser = SessionUser & { createdAt: string; boardCount: number };

export const getSession = () => request<SessionUser>("/api/session");
export const login = (username: string, password: string) =>
  request<SessionUser>("/api/login", "POST", { username, password });
export const register = (username: string, password: string) =>
  request<SessionUser>("/api/register", "POST", { username, password });
export const logout = () => request<void>("/api/logout", "POST");
export const changePassword = (currentPassword: string, newPassword: string) =>
  request<void>("/api/account/password", "POST", { currentPassword, newPassword });
export const deleteAccount = (password: string) =>
  request<void>("/api/account", "DELETE", { password });

const userPath = (userId: string) => `/api/admin/users/${encodeURIComponent(userId)}`;
export const listUsers = () => request<ManagedUser[]>("/api/admin/users");
export const setAdmin = (userId: string, isAdmin: boolean) =>
  request<ManagedUser[]>(userPath(userId), "PATCH", { isAdmin });
export const resetPassword = (userId: string, password: string) =>
  request<void>(`${userPath(userId)}/password`, "POST", { password });
export const removeUser = (userId: string) => request<ManagedUser[]>(userPath(userId), "DELETE");
