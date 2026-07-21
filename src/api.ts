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
  async getConfig(): Promise<{ port: number; read_only: boolean }> {
    return jsonOrThrow(await fetch("/api/config"));
  },
  async getDeviceByIp(ip: string): Promise<{ sn: string; ip: string; alias: string; locked: boolean; last_seen: string | null; online: boolean }[]> {
    return jsonOrThrow(await fetch(`/api/devices/by-ip/${encodeURIComponent(ip)}`));
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

  async syncUsersFromDevice(sn?: string) {
    return jsonOrThrow(await fetch("/api/sync-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: sn ? JSON.stringify({ sn }) : undefined,
    }));
  },
  async syncLogsHistoric(from: string, to?: string, sn?: string): Promise<{ success: boolean; chunks_per_device?: number; total_planned?: number; mode?: string; sent?: number; results?: unknown }> {
    return jsonOrThrow(await fetch("/api/sync-logs-historic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, sn }),
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
  async syncClock(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/sync-clock`, { method: "POST" }));
  },
  async setIdleTime(sn: string, seconds: number) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/idle-time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds }),
    }));
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
  async deleteDeviceMedia(sn: string, idx: number, force = false) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/media/${idx}${force ? "?force=true" : ""}`, { method: "DELETE" }));
  },
  async clearDeviceMedia(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/media/clear`, { method: "POST" }));
  },
  async clearDeviceUserpics(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/userpics/clear`, { method: "POST" }));
  },
  async refreshDeviceDiagnostics(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/diagnostics/refresh`, { method: "POST" }));
  },
  async getDeviceDiagnostics(sn: string) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/diagnostics`)) as Promise<{ data: Record<string, string> | null; fetchedAt: string | null }>;
  },
  async getDeviceCommands(sn: string, limit = 50) {
    return jsonOrThrow(await fetch(`/api/devices/${sn}/commands?limit=${limit}`)) as Promise<Array<{
      id: number; command: string | null; status: number; return_code: number | null; created_at: string; op_id: number | null;
    }>>;
  },
};
