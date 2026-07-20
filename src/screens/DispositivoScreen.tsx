import { Hash, Cpu, Globe, Wifi, Clock, RotateCcw, RefreshCw, Loader2, Check, Image as ImageIcon, Upload, Trash2, Plus, X, Info } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { Device } from "../types";
import { api } from "../api";
import { RepLockCard } from "../components/common/RepLockCard";
import { useWebSocket } from "../ws";

interface Props {
  device: Device | null;
  serverPort: string;
  refresh: () => void;
  readOnly?: boolean;
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

export function DispositivoScreen({ device, serverPort, refresh, readOnly = false }: Props) {
  const isOnline = device?.online ?? false;
  const sn = device?.sn;
  const [syncState, setSyncState] = useState<"idle" | "sending" | "waiting" | "done" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [rebootState, setRebootState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [rebootMessage, setRebootMessage] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<Record<string, string> | null>(null);
  const [diagnosticsFetchedAt, setDiagnosticsFetchedAt] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState("30");
  const [idleState, setIdleState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [idleMessage, setIdleMessage] = useState<string>("");

  const loadDiagnostics = useCallback(async () => {
    if (!sn) return;
    try {
      const r = await api.getDeviceDiagnostics(sn);
      setDiagnostics(r.data);
      setDiagnosticsFetchedAt(r.fetchedAt);
      // IdleTime vem junto no GET OPTIONS de diagnóstico — reflete o valor
      // real do REP no campo, em vez de sempre mostrar o default "30".
      if (r.data?.IdleTime) setIdleSeconds(r.data.IdleTime);
    } catch { /* silencioso — card mostra "—" se não tiver dado ainda */ }
  }, [sn]);

  useEffect(() => { loadDiagnostics(); }, [loadDiagnostics]);

  const onRefreshDiagnostics = async () => {
    if (!sn) return;
    setDiagnosticsLoading(true);
    try {
      await api.refreshDeviceDiagnostics(sn);
      // Resposta do REP chega assíncrona via GET OPTIONS; espera um pouco e recarrega.
      setTimeout(async () => { await loadDiagnostics(); setDiagnosticsLoading(false); }, 6000);
    } catch (e: any) {
      setDiagnosticsLoading(false);
      alert(e.message || "Erro ao consultar diagnóstico");
    }
  };

  const onSetIdleTime = async () => {
    if (!sn) return;
    const secs = parseInt(idleSeconds);
    if (!Number.isFinite(secs) || secs < 3 || secs > 3600) {
      setIdleState("error");
      setIdleMessage("Use um valor entre 3 e 3600 segundos");
      return;
    }
    setIdleState("sending");
    setIdleMessage("Enviando...");
    try {
      await api.setIdleTime(sn, secs);
      setIdleState("done");
      setIdleMessage("Enviado — confirme na tela do REP");
      setTimeout(() => { setIdleState("idle"); setIdleMessage(""); }, 4000);
    } catch (e: any) {
      setIdleState("error");
      setIdleMessage(e.message || "Erro ao enviar");
    }
  };

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

  const onReboot = async () => {
    if (!sn) return;
    if (!confirm(`Reiniciar o REP ${sn}? O dispositivo ficará offline por alguns segundos.`)) return;
    setRebootState("sending");
    setRebootMessage("Enviando REBOOT...");
    try {
      await api.rebootDevice(sn);
      setRebootState("done");
      setRebootMessage("REBOOT enfileirado");
      setTimeout(() => { setRebootState("idle"); setRebootMessage(""); }, 4000);
    } catch (e: any) {
      setRebootState("error");
      setRebootMessage(e.message || "Erro");
      setTimeout(() => { setRebootState("idle"); setRebootMessage(""); }, 4000);
    }
  };

  const isSyncing = syncState === "sending" || syncState === "waiting";

  type MediaItem = {
    idx: number; sizeKB: number | null; ext: string | null; created_at: string | null; thumbnail: string | null;
    status: "pending" | "sent" | "success" | "error" | "critical" | "unknown";
    error_detail: string | null;
    tracked: boolean;
  };
  const mediaInput = useRef<HTMLInputElement>(null);
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string>("");

  const loadMedia = useCallback(async () => {
    if (!sn) return;
    try { setMediaList(await api.listDeviceMedia(sn)); }
    catch (e: any) { setMediaError(e.message || "Erro ao carregar imagens"); }
  }, [sn]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  // O ack do devicecmd (Return>=0/<0) chega de forma assíncrona; recarrega a
  // lista quando o backend confirmar sucesso/erro de um upload/delete de adpic,
  // em vez de assumir otimisticamente que o comando enfileirado deu certo.
  useWebSocket((msg) => {
    if (msg.type === "device_update" && msg.sn === sn) { loadMedia(); loadDiagnostics(); }
  }, sn);

  const onPickMedia = () => mediaInput.current?.click();

  const onMediaChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !sn) return;
    setMediaUploading(true);
    setMediaError("");
    try {
      await api.uploadDeviceMedia(sn, file);
      await loadMedia();
    } catch (err: any) {
      setMediaError(err.message || "Erro ao enviar");
    } finally {
      setMediaUploading(false);
    }
  };

  const onDeleteMedia = async (idx: number) => {
    if (!sn) return;
    if (!confirm(`Remover a imagem do slot ${idx}?`)) return;
    try { await api.deleteDeviceMedia(sn, idx); await loadMedia(); }
    catch (e: any) { setMediaError(e.message || "Erro ao remover"); }
  };

  // Só disponível pra imagens já marcadas como "error"/"critical" — remove só
  // do nosso registro, sem confirmação do REP. Existe pra destravar imagens
  // presas quando o REP nunca vai confirmar (ex: firmware sem suporte real a
  // adpic, como visto ao vivo — Return=-11 persistente mesmo após reboot).
  const onForceRemoveMedia = async (idx: number) => {
    if (!sn) return;
    if (!confirm(`Remover o slot ${idx} só do nosso registro? Isso NÃO tenta apagar do REP de novo — use se o REP nunca confirma essa operação.`)) return;
    try { await api.deleteDeviceMedia(sn, idx, true); await loadMedia(); }
    catch (e: any) { setMediaError(e.message || "Erro ao remover"); }
  };

  const onClearMedia = async () => {
    if (!sn) return;
    if (!confirm("Apagar TODAS as imagens do slideshow do REP? (incluindo as de fábrica)")) return;
    try { await api.clearDeviceMedia(sn); await loadMedia(); }
    catch (e: any) { setMediaError(e.message || "Erro ao limpar"); }
  };

  return (
    <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
      {!readOnly && (
        <div className="xl:col-span-2">
          <RepLockCard device={device} />
        </div>
      )}

      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white mb-3">Identificação</h3>
        <SettingRow icon={Hash} label="Número de série" control={<span className="font-mono tabular text-[13px]">{device?.sn || "—"}</span>} />
        <SettingRow icon={Cpu} label="Apelido" control={<span className="font-mono tabular text-[13px]">{device?.alias || "—"}</span>} />
        <SettingRow icon={Globe} label="Endereço IP" control={<span className="font-mono tabular text-[13px]">{device?.ip || "—"}</span>} />
        <SettingRow icon={Wifi} label="Conexão"
          control={<span className={`text-[12.5px] font-medium px-2 py-0.5 rounded-full ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"}`}>{isOnline ? "Online" : "Offline"}</span>} />
        <SettingRow icon={Clock} label="Última vez visto"
          control={<span className="text-[12.5px] tabular">{device?.last_seen ? new Date(device.last_seen).toLocaleString("pt-BR") : "—"}</span>} />
        {!readOnly && (
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
        )}
      </div>

      <div className="up-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white">Diagnóstico</h3>
          <button
            className="btn-soft inline-flex items-center gap-1.5 text-[12.5px]"
            disabled={!isOnline || diagnosticsLoading}
            onClick={onRefreshDiagnostics}
          >
            {diagnosticsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {diagnosticsLoading ? "Consultando..." : "Consultar"}
          </button>
        </div>
        {!diagnostics ? (
          <div className="py-6 text-center text-[13px] text-ink-400 border border-dashed border-ink-200 dark:border-[#2A3140] rounded">
            Clique em "Consultar" pra ler versão de firmware e capacidade do REP.
          </div>
        ) : (
          <>
            <SettingRow icon={Info} label="Firmware" control={<span className="font-mono tabular text-[13px]">{diagnostics.FirmVer || "—"}</span>} />
            <SettingRow icon={Cpu} label="Nome do dispositivo" control={<span className="text-[13px]">{diagnostics["~DeviceName"] || "—"}</span>} />
            <SettingRow icon={Info} label="Modelo" control={<span className="text-[13px]">{diagnostics.MachineType || "—"}</span>} />
            <SettingRow icon={Info} label="Capacidade máx. de usuários" control={<span className="font-mono tabular text-[13px]">{diagnostics["~MaxUserCount"] || "—"}</span>} />
            <SettingRow icon={Info} label="Capacidade máx. de registros" control={<span className="font-mono tabular text-[13px]">{diagnostics["~MaxAttLogCount"] || "—"}</span>} />
            {diagnosticsFetchedAt && (
              <div className="text-[11px] text-ink-400 mt-2">Consultado em {new Date(diagnosticsFetchedAt).toLocaleString("pt-BR")}</div>
            )}
          </>
        )}
      </div>

      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white mb-3">Servidor</h3>
        <SettingRow icon={Globe} label="Porta ADMS" control={<span className="font-mono tabular text-[13px]">{serverPort || "—"}</span>} />
        {!readOnly && (
          <SettingRow icon={RotateCcw} label="Reiniciar dispositivo"
            hint={rebootMessage || "Envia comando REBOOT ao REP"}
            control={
              <button
                className="btn-outline inline-flex items-center gap-1.5"
                onClick={onReboot}
                disabled={!isOnline || rebootState === "sending"}
              >
                {rebootState === "sending" && <Loader2 size={12} className="animate-spin" />}
                {rebootState === "done" && <Check size={12} className="text-emerald-600" />}
                {rebootState === "sending" ? "Enviando..." : rebootState === "done" ? "Enfileirado" : "Reiniciar"}
              </button>
            } />
        )}
        {!readOnly && (
          <SettingRow icon={Clock} label="Intervalo do slideshow"
            hint={idleMessage || 'Segundos que cada imagem do slideshow fica na tela antes de trocar pra próxima (chave "IdleTime", não documentada oficialmente — confirmada por teste ao vivo). Não controla o tempo até o REP ficar ocioso.'}
            control={
              <div className="flex items-center gap-2">
                <input
                  type="number" min={3} max={3600} value={idleSeconds}
                  onChange={e => setIdleSeconds(e.target.value)}
                  className="field w-20 tabular text-[13px]"
                />
                <button
                  className="btn-outline inline-flex items-center gap-1.5"
                  onClick={onSetIdleTime}
                  disabled={!isOnline || idleState === "sending"}
                >
                  {idleState === "sending" && <Loader2 size={12} className="animate-spin" />}
                  {idleState === "done" && <Check size={12} className="text-emerald-600" />}
                  {idleState === "sending" ? "Enviando..." : "Aplicar"}
                </button>
              </div>
            } />
        )}
      </div>

      {!readOnly && (
      <div className="up-card p-5 xl:col-span-2">
        <div className="flex items-center mb-3 gap-2">
          <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white flex-1">
            Aparência do REP
            <span className="ml-2 text-[12px] font-normal text-ink-500">
              {mediaList.filter(m => m.tracked).length} conhecida{mediaList.filter(m => m.tracked).length === 1 ? "" : "s"} · 10 slots
            </span>
          </h3>
          <button
            className="btn-soft inline-flex items-center gap-1.5 text-[12.5px]"
            disabled={!isOnline || mediaUploading}
            onClick={onPickMedia}
          >
            {mediaUploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {mediaUploading ? "Enviando..." : "Adicionar imagem"}
          </button>
          <button
            className="btn-outline inline-flex items-center gap-1.5 text-[12.5px]"
            disabled={!isOnline}
            onClick={onClearMedia}
          >
            <Trash2 size={12} /> Limpar todas
          </button>
          <button
            className="btn-outline inline-flex items-center gap-1.5 text-[12.5px]"
            disabled={!isOnline}
            title="Remove os avatares dos usuários do slideshow do REP. O reconhecimento facial continua funcionando (template biophoto não é afetado)."
            onClick={async () => {
              if (!sn) return;
              if (!confirm("Apagar os avatares dos usuários no slideshow do REP?\n\nO reconhecimento facial continua funcionando — só o avatar visual é removido.")) return;
              try { const r: any = await api.clearDeviceUserpics(sn); alert(`${r.queued} comandos enfileirados. REP aplica em ~30s.`); }
              catch (e: any) { alert(e.message || "Erro"); }
            }}
          >
            <Trash2 size={12} /> Limpar avatares
          </button>
        </div>
        <div className="text-[12px] text-ink-500 mb-3">
          Imagens exibidas no slideshow quando o REP fica ocioso (modo "Registro ao toque" desativado). Cada upload vai para o próximo slot livre.
        </div>
        {mediaError && (
          <div className="mb-2 p-2 rounded bg-red-50 border border-red-200 text-[12px] text-red-700">{mediaError}</div>
        )}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {mediaList.map((m) => (
              <div key={m.idx} className={`relative group rounded border overflow-hidden ${
                m.status === "error" || m.status === "critical" ? "border-red-300" : "border-ink-200 dark:border-[#222A36]"
              } ${m.status === "unknown" ? "border-dashed opacity-60" : ""}`}>
                {m.thumbnail
                  ? <img src={m.thumbnail} alt={`Slot ${m.idx}`} className={`w-full h-32 object-cover ${m.status === "pending" ? "opacity-50" : ""}`} />
                  : <div className="w-full h-32 bg-ink-100 dark:bg-[#1A2030] flex items-center justify-center text-ink-400"><ImageIcon size={20} /></div>}
                <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">#{m.idx}</div>
                {m.tracked
                  ? <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">{m.sizeKB}KB</div>
                  : <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded" title="Slot pode ter uma imagem que nunca passou pelo dashboard (adpic não tem consulta no protocolo)">desconhecido</div>}
                {m.status === "pending" && (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30" title="Aguardando confirmação do REP">
                      <Loader2 size={20} className="text-white animate-spin" />
                    </div>
                    <button
                      onClick={() => onForceRemoveMedia(m.idx)}
                      title="Cancelar — remove da lista mesmo sem confirmação do REP"
                      className="absolute bottom-1 right-1 bg-black/70 hover:bg-black text-white text-[9px] font-medium px-1.5 py-0.5 rounded"
                    >
                      Cancelar
                    </button>
                  </>
                )}
                {(m.status === "error" || m.status === "critical") && (
                  <>
                    <div
                      className="absolute inset-x-0 top-0 bg-red-600 text-white text-[10px] font-semibold px-1.5 py-0.5 text-center"
                      title={m.error_detail ? `Falhou: ${m.error_detail}` : "Falhou no REP"}
                    >
                      Falhou no REP
                    </div>
                    <button
                      onClick={() => onForceRemoveMedia(m.idx)}
                      title="Remover da lista sem confirmação do REP"
                      className="absolute bottom-1 right-1 bg-black/70 hover:bg-black text-white text-[9px] font-medium px-1.5 py-0.5 rounded"
                    >
                      Remover da lista
                    </button>
                  </>
                )}
                <button
                  onClick={() => onDeleteMedia(m.idx)}
                  disabled={!isOnline || m.status === "pending"}
                  title="Remover esta imagem"
                  className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded p-1 opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
        </div>
        <input type="file" ref={mediaInput} accept="image/*" className="hidden" onChange={onMediaChange} />
      </div>
      )}
    </div>
  );
}
