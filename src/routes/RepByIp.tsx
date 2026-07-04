import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api } from "../api";

type DeviceLite = { sn: string; ip: string; alias: string; locked: boolean; last_seen: string | null; online: boolean };

export function RepByIp() {
  const { ip } = useParams<{ ip: string }>();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "empty" }
    | { status: "many"; devices: DeviceLite[] }
    | { status: "one"; sn: string }
  >({ status: "loading" });

  useEffect(() => {
    if (!ip) return;
    api.getDeviceByIp(ip)
      .then(list => {
        if (list.length === 0) setState({ status: "empty" });
        else if (list.length === 1) setState({ status: "one", sn: list[0].sn });
        else setState({ status: "many", devices: list });
      })
      .catch(() => setState({ status: "empty" }));
  }, [ip]);

  if (state.status === "one") {
    return <Navigate to={`/rep/${encodeURIComponent(state.sn)}/home`} replace />;
  }

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-[#0E1117] p-6">
      <div className="max-w-2xl mx-auto">
        <header className="mb-4">
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">
            REPs no IP {ip}
          </h1>
          <p className="text-[13px] text-ink-500">
            <Link to="/" className="text-up-600 hover:underline">← Ver todos os REPs</Link>
          </p>
        </header>

        {state.status === "loading" && (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">Buscando…</div>
        )}

        {state.status === "empty" && (
          <div className="up-card p-8 text-center text-ink-500 text-[13px]">
            Nenhum REP registrado com este IP.
          </div>
        )}

        {state.status === "many" && (
          <div className="up-card divide-y divide-ink-100 dark:divide-[#222A36]">
            <div className="p-3 text-[12.5px] text-ink-500">
              {state.devices.length} REPs compartilham este IP. Escolha um:
            </div>
            {state.devices.map(d => (
              <Link
                key={d.sn}
                to={`/rep/${encodeURIComponent(d.sn)}/home`}
                className="flex items-center justify-between p-3 hover:bg-ink-50 dark:hover:bg-[#141A24] no-underline"
              >
                <div>
                  <div className="text-[14px] font-semibold text-ink-900 dark:text-white">{d.alias || d.sn}</div>
                  <div className="text-[12px] text-ink-500 font-mono">SN: {d.sn}</div>
                </div>
                <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded ${
                  d.online ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
                }`}>
                  {d.online ? "Online" : "Offline"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
