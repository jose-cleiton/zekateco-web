import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useWebSocket } from "../ws";
import type { Device, User, Log } from "../types";

export function useAppState(sn?: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [realtimeLogs, setRealtimeLogs] = useState<Log[]>([]);
  const [serverPort, setServerPort] = useState<string>("");
  const [readOnly, setReadOnly] = useState<boolean>(false);
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
    api.getConfig().then(c => {
      setServerPort(String(c.port));
      setReadOnly(!!c.read_only);
    }).catch(() => {});
  }, [refresh]);

  useWebSocket((msg) => {
    if (msg.type === "new_log") {
      setLogs(prev => [msg.log, ...prev].slice(0, 100));
      setRealtimeLogs(prev => [msg.log, ...prev].slice(0, 200));
    } else if (msg.type === "device_update") {
      if (msg.clock_synced_at !== undefined) {
        // Update device directly for clock sync to stop the spinner immediately
        setDevices(prev => prev.map(d => d.sn === msg.sn ? { ...d, clock_synced_at: msg.clock_synced_at } : d));
      } else {
        refresh();
      }
    } else if (msg.type === "users_updated") {
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
  }, sn);

  // Quando o hook é usado dentro de /rep/:sn, filtra os dados pelo REP ativo.
  // O WS já vem filtrado do servidor (rooming), esse filtro cobre o fetch
  // inicial via GET /api/logs e afins.
  const filtered = useMemo(() => {
    if (!sn) return { logs, realtimeLogs, users };
    return {
      logs: logs.filter(l => l.sn === sn),
      realtimeLogs: realtimeLogs.filter(l => l.sn === sn),
      // User é global (identificado por pin), mas o mapa user→REP fica em
      // user.devices[]. Se o user nunca foi sincronizado com nenhum REP,
      // devices é vazio — mantém visível (talvez cadastro pendente).
      users: users.filter(u => !u.devices?.length || u.devices.some(d => d.sn === sn)),
    };
  }, [sn, logs, realtimeLogs, users]);

  return {
    devices,
    users: filtered.users,
    logs: filtered.logs,
    realtimeLogs: filtered.realtimeLogs,
    serverPort,
    readOnly,
    loading,
    refresh,
    setUsers,
  };
}
