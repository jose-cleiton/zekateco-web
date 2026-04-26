import { CalendarPlus, Copy, Clock, Pencil } from "lucide-react";

const TURNOS_PLACEHOLDER = [
  { id: 1, nome: "Comercial", inicio: "08:00", fim: "18:00", almoco: "12:00–13:00", dias: "Seg–Sex", ativo: true },
  { id: 2, nome: "Diurno",    inicio: "06:00", fim: "14:00", almoco: "10:00–10:30", dias: "Seg–Sáb", ativo: true },
];

export function TurnoScreen() {
  return (
    <div className="p-6 space-y-3">
      <div className="up-card p-3 flex items-center gap-2">
        <button className="btn-primary" disabled><CalendarPlus size={13} /> Cadastrar turno</button>
        <button className="btn-outline" disabled><Copy size={13} /> Duplicar</button>
        <span className="ml-auto text-[12.5px] text-ink-500">Placeholder · backend ainda não implementado</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TURNOS_PLACEHOLDER.map(t => (
          <div key={t.id} className="up-card p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-up-50 text-up-600 flex items-center justify-center"><Clock size={18} /></div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-[14px] font-semibold">{t.nome}</h4>
                  <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${t.ativo ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"}`}>{t.ativo ? "Ativo" : "Inativo"}</span>
                </div>
                <div className="text-[12px] text-ink-500">{t.dias}</div>
              </div>
              <button className="p-1.5 rounded hover:bg-up-50 text-ink-500 hover:text-up-700" disabled><Pencil size={13} /></button>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3 text-[12.5px]">
              <div><div className="text-ink-500">Início</div><div className="font-semibold tabular">{t.inicio}</div></div>
              <div><div className="text-ink-500">Fim</div><div className="font-semibold tabular">{t.fim}</div></div>
              <div><div className="text-ink-500">Almoço</div><div className="font-semibold tabular">{t.almoco}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
