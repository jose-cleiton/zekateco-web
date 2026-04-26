import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useWebSocket } from "../ws";
import type { Device, User, Log } from "../types";

export function useAppState() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [serverPort, setServerPort] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [d, u, l] = await Promise.all([api.getDevices(), api.getUsers(), api.getLogs()]);
      setDevices(d);
      setUsers(u);
      setLogs(l);
    } catch (e) {
      console.error("[refresh]", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.getConfig().then(c => setServerPort(String(c.port))).catch(() => {});
  }, [refresh]);

  useWebSocket((msg) => {
    if (msg.type === "new_log") {
      setLogs(prev => [msg.log, ...prev].slice(0, 100));
    } else if (msg.type === "device_update" || msg.type === "users_updated") {
      refresh();
    } else if (msg.type === "photo_op_update") {
      setUsers(prev => prev.map(u =>
        u.pin === msg.pin
          ? { ...u, photoSync: { status: msg.status, operation_id: msg.operation_id, error_detail: msg.error_detail ?? null } }
          : u
      ));
    } else if (msg.type === "user_op_update") {
      setUsers(prev => prev.map(u =>
        u.pin === msg.pin
          ? { ...u, userSync: { status: msg.status, operation_id: msg.operation_id, error_detail: msg.error_detail ?? null } }
          : u
      ));
    }
  });

  return { devices, users, logs, serverPort, loading, refresh, setUsers };
}
