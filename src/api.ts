import type { Device, User, Log } from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  async getDevices(): Promise<Device[]> {
    return jsonOrThrow(await fetch("/api/devices"));
  },
  async getUsers(): Promise<User[]> {
    return jsonOrThrow(await fetch("/api/users"));
  },
  async getLogs(): Promise<Log[]> {
    return jsonOrThrow(await fetch("/api/logs"));
  },
  async getConfig(): Promise<{ port: number }> {
    return jsonOrThrow(await fetch("/api/config"));
  },

  async createUser(data: { pin: string; name: string; privilege?: number; password?: string; card?: string }) {
    return jsonOrThrow(await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }));
  },
  async updateUser(pin: string, data: { name: string; privilege?: number; password?: string; card?: string }) {
    return jsonOrThrow(await fetch(`/api/users/${pin}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }));
  },
  async deleteUser(pin: string) {
    return jsonOrThrow(await fetch(`/api/users/${pin}`, { method: "DELETE" }));
  },

  async uploadPhoto(pin: string, file: File) {
    const fd = new FormData();
    fd.append("photo", file);
    return jsonOrThrow(await fetch(`/api/users/${pin}/photo`, { method: "POST", body: fd }));
  },
  async syncPhoto(pin: string) {
    return jsonOrThrow(await fetch(`/api/users/${pin}/photo/sync`, { method: "POST" }));
  },
  async deletePhoto(pin: string) {
    return jsonOrThrow(await fetch(`/api/users/${pin}/photo`, { method: "DELETE" }));
  },

  async syncUsersFromDevice() {
    return jsonOrThrow(await fetch("/api/sync-users", { method: "POST" }));
  },
};
