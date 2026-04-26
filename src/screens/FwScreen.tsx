import { useState } from "react";
import { UploadCloud, Zap } from "lucide-react";

export function FwScreen() {
  const [progress, setProgress] = useState<number | null>(null);

  const start = () => {
    setProgress(0);
    const id = setInterval(() => {
      setProgress(p => {
        if (p === null) return null;
        const next = Math.min(100, p + 4 + Math.random() * 6);
        if (next >= 100) clearInterval(id);
        return next;
      });
    }, 200);
  };

  return (
    <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold mb-3">Atualizar firmware</h3>
        <p className="text-[12.5px] text-ink-500 mb-3">Funcionalidade ainda não implementada no backend. Esta tela é apenas demonstrativa.</p>
        <div className="border-2 border-dashed border-ink-200 dark:border-[#222A36] rounded-xl p-6 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-xl bg-up-50 text-up-600 flex items-center justify-center mb-2"><UploadCloud size={22} /></div>
          <div className="text-[13px] font-semibold">Solte o arquivo aqui</div>
          <div className="text-[12px] text-ink-500">ou</div>
          <button className="btn-soft mt-2" disabled>Selecionar arquivo</button>
        </div>
        <div className="flex justify-end mt-4 gap-2">
          <button className="btn-outline" disabled>Cancelar</button>
          <button className="btn-primary" onClick={start}><Zap size={13} /> Simular atualização</button>
        </div>
        {progress !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-[12px] text-ink-500 mb-1"><span>Atualizando…</span><span className="tabular">{Math.round(progress)}%</span></div>
            <div className="h-2 bg-ink-200 dark:bg-[#222A36] rounded-full overflow-hidden">
              <div className="h-full bg-up-500 transition-all" style={{ width: progress + "%" }} />
            </div>
          </div>
        )}
      </div>

      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold mb-3">Histórico de versões</h3>
        <p className="text-[12.5px] text-ink-500">Sem histórico disponível.</p>
      </div>
    </div>
  );
}
