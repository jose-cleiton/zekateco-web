import { useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import { SoftFrame } from "../components/common/SoftFrame";
import type { Device, User } from "../types";

interface Props {
  device: Device | null;
  users: User[];
  serverPort: string;
  totalLogs: number;
}

export function HomeScreen({ device, users, serverPort, totalLogs }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const doSync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setLastSync(new Date().toLocaleTimeString("pt-BR"));
    }, 1200);
  };

  const InfoRow = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
    <div className="flex gap-2 py-0.5 text-[13px]">
      <div className="text-ink-700 dark:text-ink-300 font-semibold w-32 shrink-0">{k}:</div>
      <div className={`text-ink-700 dark:text-ink-300 ${mono ? "font-mono tabular" : ""}`}>{v || "—"}</div>
    </div>
  );

  const Bar = ({ used, total, color = "bg-up-500" }: { used: number; total: number; color?: string }) => {
    const pct = total > 0 ? Math.max(2, Math.min(100, (used / total) * 100)) : 0;
    return (
      <div className="h-1.5 w-full bg-ink-200 dark:bg-[#222A36] rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: pct + "%" }} />
      </div>
    );
  };

  const CapRow = ({ label, used, total, color }: { label: string; used: number; total: number; color?: string }) => (
    <div className="grid grid-cols-[170px_1fr_120px] items-center gap-3 py-2">
      <div className="text-[13px] font-medium text-ink-700 dark:text-ink-300">{label}</div>
      <Bar used={used} total={total} color={color} />
      <div className="text-[12.5px] text-ink-500 text-right tabular">
        <span className="text-ink-900 dark:text-white font-semibold">{used.toLocaleString("pt-BR")}</span>
        <span className="text-ink-400"> / {total.toLocaleString("pt-BR")}</span>
      </div>
    </div>
  );

  const usersWithFace = users.filter(u => !!u.photo_url).length;
  const usersWithCard = users.filter(u => !!u.card).length;
  const usersWithPwd = users.filter(u => !!u.password).length;
  const isOnline = device?.online ?? false;

  return (
    <div className="p-6 space-y-6">
      {/* Action row */}
      <div className="up-card p-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary"><Plug size={14} /> Porta</button>
        <button className={`btn-soft ${syncing ? "opacity-70" : ""}`} onClick={doSync}>
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          Sincronizar hora
        </button>
        <div className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500 pulse-dot" : "bg-ink-400"}`} />
            {isOnline ? `Conectado · porta ${serverPort || "—"}` : "Offline"}
          </span>
          {lastSync && <span className="text-ink-400">· última sincronização {lastSync}</span>}
        </div>
      </div>

      {/* Info card */}
      <div className="up-card p-5">
        <SoftFrame tag="Info">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mt-1">
            <div>
              <InfoRow k="Nome" v={device?.alias || "—"} />
              <InfoRow k="Num. Serie" v={device?.sn || "—"} mono />
              <InfoRow k="Status" v={isOnline ? "Online" : "Offline"} />
              <InfoRow k="Última visto" v={device?.last_seen ? new Date(device.last_seen).toLocaleString("pt-BR") : "—"} />
            </div>
            <div>
              <InfoRow k="IP do REP" v={device?.ip || "—"} mono />
              <InfoRow k="Porta servidor" v={serverPort || "—"} mono />
              <InfoRow k="Hora" v={new Date().toLocaleString("pt-BR")} mono />
              <InfoRow k="Local" v={isOnline ? "LAN" : "—"} />
            </div>
          </div>
        </SoftFrame>
      </div>

      {/* Capacity card */}
      <div className="up-card p-5">
        <SoftFrame tag="Capacidade">
          <CapRow label="Usuários" used={users.length} total={15000} color="bg-up-500" />
          <CapRow label="Face" used={usersWithFace} total={15000} color="bg-up-500" />
          <CapRow label="Cartão" used={usersWithCard} total={15000} color="bg-up-400" />
          <CapRow label="Senha" used={usersWithPwd} total={15000} color="bg-up-400" />
          <div className="my-2 border-t border-dashed border-ink-200 dark:border-[#2A3140]" />
          <CapRow label="Todos os registros" used={totalLogs} total={500000} color="bg-emerald-500" />
        </SoftFrame>
      </div>
    </div>
  );
}
