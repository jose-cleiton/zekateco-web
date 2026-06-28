import { Hash, Cpu, Globe, Wifi, Clock, Volume2, Moon, ScanFace, KeyRound, RotateCcw, RefreshCw, Loader2, Check } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Device } from "../types";
import { api } from "../api";

interface Props {
  device: Device | null;
  serverPort: string;
  refresh: () => void;
}

const SettingRow = ({ icon: Icon, label, hint, control }: { icon: any; label: string; hint?: string; control: ReactNode }) => (
  <div className="flex items-center gap-3 py-3 border-b border-ink-200 dark:border-[#222A36] last:border-0">
    <div className="w-9 h-9 rounded-lg bg-up-50 text-up-600 flex items-center justify-center"><Icon size={15} /></div>
    <div className="flex-1">
      <div className="text-[13px] font-semibold text-ink-900 dark:text-white">{label}</div>
      {hint && <div className="text-[12px] text-ink-500">{hint}</div>}
    </div>
    <div>{control}</div>
  </div>
);

export function DispositivoScreen({ device, serverPort, refresh }: Props) {
  const isOnline = device?.online ?? false;
  const [syncState, setSyncState] = useState<"idle" | "sending" | "waiting" | "done" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState<string>("");

  const onSyncDevices = async () => {
    setSyncState("sending");
    setSyncMessage("Enviando comando ao REP...");
    try {
      await api.syncUsersFromDevice();
      setSyncState("waiting");
      setSyncMessage("Aguardando REP enviar a lista...");
      // REP faz long-poll de getrequest; em até ~30s a sync deve concluir.
      // O WebSocket users_updated atualiza a lista globalmente; aqui só refrescamos
      // o status do device e damos feedback visual final.
      setTimeout(() => {
        refresh();
        setSyncState("done");
        setSyncMessage("Sincronizado");
        setTimeout(() => { setSyncState("idle"); setSyncMessage(""); }, 3000);
      }, 8000);
    } catch (e: any) {
      setSyncState("error");
      setSyncMessage(e.message || "Erro ao sincronizar");
      setTimeout(() => { setSyncState("idle"); setSyncMessage(""); }, 4000);
    }
  };

  const isSyncing = syncState === "sending" || syncState === "waiting";

  return (
    <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white mb-3">Identificação</h3>
        <SettingRow icon={Hash} label="Número de série" control={<span className="font-mono tabular text-[13px]">{device?.sn || "—"}</span>} />
        <SettingRow icon={Cpu} label="Apelido" control={<span className="font-mono tabular text-[13px]">{device?.alias || "—"}</span>} />
        <SettingRow icon={Globe} label="Endereço IP" control={<span className="font-mono tabular text-[13px]">{device?.ip || "—"}</span>} />
        <SettingRow icon={Wifi} label="Conexão"
          control={<span className={`text-[12.5px] font-medium px-2 py-0.5 rounded-full ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"}`}>{isOnline ? "Online" : "Offline"}</span>} />
        <SettingRow icon={Clock} label="Última vez visto"
          control={<span className="text-[12.5px] tabular">{device?.last_seen ? new Date(device.last_seen).toLocaleString("pt-BR") : "—"}</span>} />
        <SettingRow icon={RefreshCw} label="Sincronizar usuários do REP" hint={syncMessage || "Puxa a lista atual do dispositivo"}
          control={
            <button
              className="btn-soft inline-flex items-center gap-2"
              onClick={onSyncDevices}
              disabled={!isOnline || isSyncing}
            >
              {isSyncing && <Loader2 size={14} className="animate-spin" />}
              {syncState === "done" && <Check size={14} className="text-emerald-600" />}
              {isSyncing ? "Sincronizando..." : syncState === "done" ? "Pronto" : "Sincronizar"}
            </button>
          } />
      </div>

      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white mb-3">Servidor</h3>
        <SettingRow icon={Globe} label="Porta ADMS" control={<span className="font-mono tabular text-[13px]">{serverPort || "—"}</span>} />
        <SettingRow icon={Volume2} label="Volume do alto-falante" hint="(somente UI)"
          control={<input type="range" min={0} max={100} defaultValue={70} className="w-40 accent-up-500" disabled />} />
        <SettingRow icon={Moon} label="Modo descanso" hint="(somente UI)"
          control={<input type="checkbox" defaultChecked className="w-4 h-4 accent-up-500" disabled />} />
        <SettingRow icon={ScanFace} label="Distância mínima de face" hint="(somente UI)" control={
          <select className="field w-32" disabled><option>30 cm</option></select>
        } />
        <SettingRow icon={KeyRound} label="Senha de administração" hint="(somente UI)" control={<button className="btn-outline" disabled>Alterar</button>} />
        <SettingRow icon={RotateCcw} label="Reiniciar dispositivo" hint="(somente UI)" control={<button className="btn-outline" disabled>Reiniciar</button>} />
      </div>
    </div>
  );
}
