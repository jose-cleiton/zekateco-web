import { Lock, Unlock, Loader2, AlertTriangle } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { Device } from "../../types";
import { api } from "../../api";

interface Props {
  device: Device | null;
}

const REBOOT_COUNTDOWN_SEC = 30;

export function RepLockCard({ device }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOnline = device?.online ?? false;
  const locked = device?.locked ?? true;
  const sn = device?.sn;
  const willLock = !locked;

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const startCountdown = () => {
    setCountdown(REBOOT_COUNTDOWN_SEC);
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const apply = async () => {
    if (!sn) return;
    setConfirming(false);
    setBusy(true);
    setError("");
    try {
      await api.lockDevice(sn, willLock);
      startCountdown();
    } catch (e: any) {
      setError(e.message || "Erro ao enviar comando");
    } finally {
      setBusy(false);
    }
  };

  const rebooting = countdown > 0;

  return (
    <div className="up-card p-5">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${locked ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
          {locked ? <Lock size={20} /> : <Unlock size={20} />}
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-ink-900 dark:text-white">
            Registro ao toque no equipamento
          </div>
          <div className="text-[12.5px] text-ink-500">
            {locked
              ? "Ativo — o REP só registra após alguém tocar a tela. Passantes não são identificados."
              : "Desativado — o REP reconhece automaticamente qualquer pessoa que apareça na frente."}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[12px] font-semibold tabular ${locked ? "text-emerald-600" : "text-ink-400"}`}>
            {locked ? "ATIVO" : "DESATIVADO"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={locked}
            aria-label={locked ? "Desativar registro ao toque" : "Ativar registro ao toque"}
            disabled={!isOnline || busy || rebooting}
            onClick={() => setConfirming(true)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              locked ? "bg-emerald-500" : "bg-ink-300 dark:bg-[#2A3140]"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform ${
                locked ? "translate-x-6" : "translate-x-1"
              }`}
            />
            {busy && (
              <Loader2 size={12} className="animate-spin absolute -right-5 text-ink-500" />
            )}
          </button>
        </div>
      </div>

      {confirming && (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-[13px] text-amber-900 dark:text-amber-100">
              <div className="font-semibold mb-1">
                {willLock ? "Ativar registro ao toque?" : "Desativar registro ao toque?"}
              </div>
              <div className="text-[12.5px]">
                O REP vai reiniciar para aplicar a mudança. Ele ficará offline por cerca de <span className="font-semibold">30 segundos</span> e não registrará pontos nesse intervalo.
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold text-white ${willLock ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600"}`}
                  onClick={apply}
                >
                  Sim, {willLock ? "ativar" : "desativar"} agora
                </button>
                <button
                  className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold text-ink-700 dark:text-ink-200 bg-white dark:bg-[#1A2030] border border-ink-200 dark:border-[#2A3140]"
                  onClick={() => setConfirming(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rebooting && (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/50 flex items-center gap-3">
          <Loader2 size={18} className="text-amber-600 animate-spin" />
          <div className="flex-1 text-[13px] text-amber-900 dark:text-amber-100">
            <div className="font-semibold">Reiniciando REP...</div>
            <div className="text-[12.5px]">Aguarde {countdown}s. O REP volta sozinho.</div>
          </div>
          <div className="text-[20px] font-bold tabular text-amber-700">{countdown}</div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-800/50 text-[12.5px] text-red-700 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
