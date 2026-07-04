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
  async syncLogsHistoric(from: string, to?: string): Promise<{ success: boolean; chunks_per_device: number; total_planned: number }> {
    return jsonOrThrow(await fetch("/api/sync-logs-historic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }));
  },

  async setDeviceOptions(sn: string, options: Record<string, string | number>) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }));
  },
  async rebootDevice(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/reboot`, { method: "POST" }));
  },
  async lockDevice(sn: string, locked: boolean) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked }),
    }));
  },
  async listDeviceMedia(sn: string): Promise<{ idx: number; sizeKB: number; ext: string; created_at: string; thumbnail: string | null }[]> {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/media`));
  },
  async uploadDeviceMedia(sn: string, file: File, index?: number) {
    const fd = new FormData();
    fd.append("image", file);
    if (index) fd.append("index", String(index));
    return jsonOrThrow(await fetch(`/api/devices/${sn}/media`, { method: "POST", body: fd }));
  },
  async deleteDeviceMedia(sn: string, idx: number) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/media/${idx}`, { method: "DELETE" }));
  },
  async clearDeviceMedia(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/media/clear`, { method: "POST" }));
  },
  async clearDeviceUserpics(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/userpics/clear`, { method: "POST" }));
  },
};
