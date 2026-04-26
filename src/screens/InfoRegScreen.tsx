import { useState } from "react";
import { Trash2, FileDown, FileUp, CalendarRange } from "lucide-react";
import { DateRangeModal, type DateRange } from "../components/common/DateRangeModal";
import type { Log, User } from "../types";

interface Props {
  logs: Log[];
  users: User[];
}

function filterLogs(logs: Log[], range: DateRange | null): Log[] {
  if (!range) return [];
  return logs.filter(l => {
    const t = new Date(l.time).getTime();
    if (Number.isNaN(t)) return false;
    if (range.id && l.pin !== range.id) return false;
    if (range.inicio && t < new Date(range.inicio).getTime()) return false;
    if (range.fim && t > new Date(range.fim + "T23:59:59").getTime()) return false;
    return true;
  });
}

export function InfoRegScreen({ logs, users }: Props) {
  const [showModal, setShowModal] = useState(true);
  const [range, setRange] = useState<DateRange | null>(null);
  const userByPin = new Map(users.map(u => [u.pin, u.name]));

  const rows = filterLogs(logs, range);

  return (
    <div className="p-6 space-y-3">
      <div className="up-card p-3 flex flex-wrap items-center gap-2">
        <button className="btn-danger" disabled title="Em breve"><Trash2 size={13} />Apagar registros</button>
        <button className="btn-outline" disabled title="Em breve"><FileDown size={13} />Salvar logs como CSV</button>
        <button className="btn-outline" disabled title="Em breve"><FileUp size={13} />Carregar logs de CSV</button>
        <button className="btn-soft" onClick={() => setShowModal(true)}><CalendarRange size={13} />Filtrar por data</button>
        <span className="text-[12px] text-rose-600 ml-2">Filtra os registros recebidos do REP por intervalo de data e ID.</span>
      </div>

      <div className="up-card overflow-hidden">
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-up-500 text-white">
              <th className="up-th text-left">Hora</th>
              <th className="up-th text-left">ID</th>
              <th className="up-th text-left">Nome</th>
              <th className="up-th text-left">SN</th>
              <th className="up-th text-left">Status</th>
              <th className="up-th text-left">Verify</th>
            </tr>
          </thead>
          <tbody>
            {!range ? (
              <tr><td colSpan={6} className="py-16 text-center text-ink-400 text-[13px]">Selecione um período</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-16 text-center text-ink-400 text-[13px]">No matching records found</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="up-row border-b border-ink-200 dark:border-[#222A36]">
                <td className="up-td font-mono tabular">{r.time}</td>
                <td className="up-td font-mono tabular">{r.pin}</td>
                <td className="up-td font-medium">{userByPin.get(r.pin) || `PIN ${r.pin}`}</td>
                <td className="up-td font-mono">{r.sn}</td>
                <td className="up-td">{r.status}</td>
                <td className="up-td">{r.verify_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <DateRangeModal
          title="Info reg"
          onClose={() => setShowModal(false)}
          onSubmit={(v) => { setRange(v); setShowModal(false); }}
        />
      )}
    </div>
  );
}
