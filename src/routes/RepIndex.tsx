import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Monitor, Wifi, WifiOff } from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../ws";
import type { Device } from "../types";

export function RepIndex() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => api.getDevices().then(setDevices).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => { refresh(); }, []);

  // Sem ?sn= = ouve broadcast global; atualiza a lista quando qualquer REP
  // muda de estado.
  useWebSocket((msg) => {
    if (msg.type === "device_update" || msg.type === "users_updated") refresh();
  });

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-[#0E1117] p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-up-500 flex items-center justify-center">
            <Monitor size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-900 dark:text-white">Ultraponto — Webserver</h1>
            <p className="text-[13px] text-ink-500">Selecione um REP para abrir o painel</p>
          </div>
        </header>

        {loading ? (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">Carregando REPs…</div>
        ) : devices.length === 0 ? (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">
            Nenhum REP conectado ainda. Assim que um dispositivo se conectar, ele aparece aqui.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {devices.map(d => (
              <Link
                key={d.sn}
                to={`/rep/${encodeURIComponent(d.sn)}/home`}
                className="up-card p-4 hover:shadow-md transition-shadow flex flex-col gap-2 no-underline"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[15px] font-semibold text-ink-900 dark:text-white truncate" title={d.alias || d.sn}>
                    {d.alias || d.sn}
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
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
