import { useState } from "react";
import { X, Send } from "lucide-react";

export interface DateRange {
  id: string;
  inicio: string;
  fim: string;
}

interface Props {
  title: string;
  withId?: boolean;
  onSubmit: (v: DateRange) => void;
  onClose: () => void;
}

export function DateRangeModal({ title, withId = true, onSubmit, onClose }: Props) {
  const [v, setV] = useState<DateRange>({ id: "", inicio: "", fim: "" });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center modal-back bg-ink-900/30 dark:bg-black/50">
      <div className="up-card w-[420px] overflow-hidden">
        <div className="bg-up-50 dark:bg-[#1B2230] border-b border-up-100 dark:border-[#222A36] px-4 py-3 flex items-center">
          <h3 className="text-up-700 dark:text-up-300 font-semibold text-[14px]">{title}</h3>
          <button className="ml-auto p-1 rounded hover:bg-up-100/60 text-up-700" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {withId && (
            <div>
              <label className="label">ID</label>
              <input className="field tabular" placeholder="todos" value={v.id} onChange={e => setV({ ...v, id: e.target.value })} />
            </div>
          )}
          <div>
            <label className="label">Início:</label>
            <input type="date" className="field" value={v.inicio} onChange={e => setV({ ...v, inicio: e.target.value })} />
          </div>
          <div>
            <label className="label">Fim:</label>
            <input type="date" className="field" value={v.fim} onChange={e => setV({ ...v, fim: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-ink-200 dark:border-[#222A36] bg-ink-50 dark:bg-[#0E1117]">
          <button className="btn-ghost" onClick={onClose}>CANCELAR</button>
          <button className="btn-primary" onClick={() => onSubmit(v)}><Send size={13} />ENVIAR</button>
        </div>
      </div>
    </div>
  );
}
