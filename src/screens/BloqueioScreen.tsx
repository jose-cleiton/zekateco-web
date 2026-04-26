import { ShieldPlus, Pencil, X } from "lucide-react";

const BLOCKS_PLACEHOLDER = [
  { id: 1, usuario: "—", motivo: "Placeholder", inicio: "—", fim: "—", status: "Ativo" },
];

export function BloqueioScreen() {
  return (
    <div className="p-6 space-y-3">
      <div className="up-card p-3 flex items-center gap-2">
        <button className="btn-primary" disabled><ShieldPlus size={13} /> Novo bloqueio</button>
        <span className="ml-auto text-[12.5px] text-ink-500">Placeholder · backend ainda não implementado</span>
      </div>
      <div className="up-card overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-up-500 text-white">
              <th className="up-th text-left w-12">#</th>
              <th className="up-th text-left">Usuário</th>
              <th className="up-th text-left">Motivo</th>
              <th className="up-th text-left">Início</th>
              <th className="up-th text-left">Fim</th>
              <th className="up-th text-left">Status</th>
              <th className="up-th w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {BLOCKS_PLACEHOLDER.map(b => (
              <tr key={b.id} className="up-row border-b border-ink-200 dark:border-[#222A36]">
                <td className="up-td tabular">{b.id}</td>
                <td className="up-td font-medium">{b.usuario}</td>
                <td className="up-td">{b.motivo}</td>
                <td className="up-td tabular">{b.inicio}</td>
                <td className="up-td tabular">{b.fim}</td>
                <td className="up-td">
                  <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">{b.status}</span>
                </td>
                <td className="up-td text-right">
                  <button className="p-1.5 rounded hover:bg-up-50 text-ink-500 hover:text-up-700" disabled><Pencil size={13} /></button>
                  <button className="p-1.5 rounded hover:bg-rose-50 text-ink-500 hover:text-rose-600" disabled><X size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
