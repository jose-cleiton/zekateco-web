import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Monitor, Wifi, WifiOff, Search, X } from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../ws";
import type { Device } from "../types";

type StatusFilter = "all" | "online" | "offline";

export function RepIndex() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const refresh = () =>
    api.getDevices()
      .then(setDevices)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { refresh(); }, []);

  useWebSocket((msg) => {
    if (msg.type === "device_update" || msg.type === "users_updated") refresh();
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .filter(d => {
        if (statusFilter === "online" && !d.online) return false;
        if (statusFilter === "offline" && d.online) return false;
        if (!q) return true;
        return (
          (d.alias || "").toLowerCase().includes(q) ||
          d.sn.toLowerCase().includes(q) ||
          (d.ip || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Online primeiro, depois alfabético por alias
        if (a.online !== b.online) return a.online ? -1 : 1;
        return (a.alias || a.sn).localeCompare(b.alias || b.sn, "pt-BR");
      });
  }, [devices, query, statusFilter]);

  const counts = useMemo(() => ({
    total: devices.length,
    online: devices.filter(d => d.online).length,
    offline: devices.filter(d => !d.online).length,
  }), [devices]);

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-[#0E1117] p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-up-500 flex items-center justify-center">
            <Monitor size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink-900 dark:text-white">Ultraponto — Webserver</h1>
            <p className="text-[13px] text-ink-500">Selecione um REP para abrir o painel</p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[12.5px]">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-semibold">
              <Wifi size={12} /> {counts.online} online
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ink-100 text-ink-600 dark:bg-[#141A24] dark:text-ink-400 font-semibold">
              <WifiOff size={12} /> {counts.offline} offline
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-up-50 text-up-700 font-semibold">
              {counts.total} total
            </span>
          </div>
        </header>

        {/* Barra de filtros */}
        <div className="up-card p-3 mb-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filtrar por nome, número de série ou IP…"
              className="w-full h-10 pl-9 pr-9 rounded-lg border border-ink-200 dark:border-[#222A36] bg-white dark:bg-[#141A24] text-[13px] focus:outline-none focus:ring-2 focus:ring-up-500"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-ink-100 dark:hover:bg-[#1A2030]"
                title="Limpar"
              >
                <X size={14} className="text-ink-500" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 bg-ink-100 dark:bg-[#141A24] rounded-lg p-1">
            {(["all", "online", "offline"] as StatusFilter[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 h-8 rounded-md text-[12.5px] font-semibold transition ${
                  statusFilter === s
                    ? "bg-white dark:bg-[#1A2030] text-ink-900 dark:text-white shadow-sm"
                    : "text-ink-500 hover:text-ink-700 dark:hover:text-ink-300"
                }`}
              >
                {s === "all" ? "Todos" : s === "online" ? "Online" : "Offline"}
                <span className="ml-1.5 text-[11px] font-normal opacity-70">
                  ({s === "all" ? counts.total : s === "online" ? counts.online : counts.offline})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Contador do filtro */}
        {(query || statusFilter !== "all") && (
          <div className="text-[12.5px] text-ink-500 mb-3">
            Mostrando <span className="font-semibold text-ink-900 dark:text-white">{filtered.length}</span> de {counts.total} REPs
            {query && <> com <span className="font-mono text-ink-700 dark:text-ink-300">"{query}"</span></>}
          </div>
        )}

        {loading ? (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">Carregando REPs…</div>
        ) : devices.length === 0 ? (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">
            Nenhum REP conectado ainda. Assim que um dispositivo se conectar, ele aparece aqui.
          </div>
        ) : filtered.length === 0 ? (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">
            Nenhum REP corresponde ao filtro.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(d => (
              <Link
                key={d.sn}
                to={`/rep/${encodeURIComponent(d.sn)}/home`}
                className="up-card p-4 hover:shadow-md transition-shadow flex flex-col gap-2 no-underline"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[15px] font-semibold text-ink-900 dark:text-white truncate min-w-0" title={d.alias || d.sn}>
                    {d.alias || d.sn}
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
                    d.online ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
                  }`}>
                    {d.online ? <Wifi size={11} /> : <WifiOff size={11} />}
                    {d.online ? "Online" : "Offline"}
                  </span>
                </div>
                <div className="text-[12px] text-ink-500 space-y-0.5">
                  <div>SN: <span className="font-mono text-ink-700 dark:text-ink-300">{d.sn}</span></div>
                  <div>IP: <span className="font-mono text-ink-700 dark:text-ink-300">{d.ip || "—"}</span></div>
                  {d.last_seen && (
                    <div>Última vez: <span className="text-ink-700 dark:text-ink-300">
                      {new Date(d.last_seen).toLocaleString("pt-BR")}
                    </span></div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
