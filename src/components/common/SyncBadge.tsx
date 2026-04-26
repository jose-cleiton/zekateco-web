import { Loader2, AlertCircle, XCircle, CheckCircle2 } from "lucide-react";
import type { SyncStatus } from "../../types";

interface Props {
  sync: SyncStatus | null | undefined;
  showSuccess?: boolean;
  size?: "sm" | "xs";
}

export function SyncBadge({ sync, showSuccess = false, size = "sm" }: Props) {
  if (!sync) return null;
  const s = sync.status;
  const px = size === "xs" ? "px-1 py-0.5 text-[9.5px]" : "px-1.5 py-0.5 text-[10px]";
  const ic = size === "xs" ? 8 : 9;

  if (s === "success") {
    if (!showSuccess) return null;
    return (
      <span className={`inline-flex items-center gap-1 font-semibold text-emerald-600 bg-emerald-50 ${px} rounded-full`} title="Sincronizado">
        <CheckCircle2 size={ic} /> ok
      </span>
    );
  }
  if (s === "pending" || s === "sent") return (
    <span className={`inline-flex items-center gap-1 font-semibold text-amber-600 bg-amber-50 ${px} rounded-full`} title="Enviando para o REP...">
      <Loader2 size={ic} className="animate-spin" /> enviando
    </span>
  );
  if (s === "error") return (
    <span className={`inline-flex items-center gap-1 font-semibold text-orange-600 bg-orange-50 ${px} rounded-full`} title={sync.error_detail ?? "Aguardando retry"}>
      <AlertCircle size={ic} /> retry
    </span>
  );
  if (s === "critical") return (
    <span className={`inline-flex items-center gap-1 font-semibold text-rose-600 bg-rose-50 ${px} rounded-full`} title={sync.error_detail ?? "Falha crítica"}>
      <XCircle size={ic} /> falhou
    </span>
  );
  return null;
}
