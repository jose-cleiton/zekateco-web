import { useState, useMemo } from "react";
import { CalendarRange, FileDown, FileSpreadsheet, Printer, List, Users as UsersIcon, LogIn, LogOut } from "lucide-react";
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

export function RelatorioScreen({ logs, users }: Props) {
  const [showModal, setShowModal] = useState(true);
  const [range, setRange] = useState<DateRange | null>(null);

  const userByPin = new Map(users.map(u => [u.pin, u.name]));

  const rows = useMemo(() => filterLogs(logs, range), [logs, range]);

  const kpis = useMemo(() => ([
    { l: "Registros", v: rows.length, icon: List },
    { l: "Únicos",    v: new Set(rows.map(r => r.pin)).size, icon: UsersIcon },
    { l: "Entradas",  v: rows.filter(r => r.status === 0 || r.status === 1).length, icon: LogIn },
    { l: "Saídas",    v: rows.filter(r => r.status === 2).length, icon: LogOut },
  ]), [rows]);

  return (
    <div className="p-6 space-y-3">
      <div className="up-card p-3 flex flex-wrap items-center gap-2">
        <button className="btn-soft" onClick={() => setShowModal(true)}><CalendarRange size={13} />Selecionar período</button>
        <button className="btn-outline" disabled><FileDown size={13} />Exportar PDF</button>
        <button className="btn-outline" disabled><FileSpreadsheet size={13} />Exportar Excel</button>
        <button className="btn-outline" disabled><Printer size={13} />Imprimir</button>
        {range && (
          <span className="ml-auto text-[12.5px] text-ink-500">
            Período: <span className="font-semibold text-ink-900 dark:text-white">{range.inicio || "—"} até {range.fim || "—"}</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {kpis.map(k => {
          const Ic = k.icon;
          return (
            <div key={k.l} className="up-card p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-up-50 text-up-600 flex items-center justify-center"><Ic size={16} /></div>
              <div>
                <div className="text-[11.5px] uppercase tracking-wider text-ink-500 font-semibold">{k.l}</div>
                <div className="text-[22px] font-bold text-ink-900 dark:text-white tabular leading-tight">{k.v}</div>
              </div>
            </div>
          );
        })}
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
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="py-16 text-center text-ink-400 text-[13px]">Selecione um período para gerar o relatório</td></tr>
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
          title="Relatório"
          onClose={() => setShowModal(false)}
          onSubmit={(v) => { setRange(v); setShowModal(false); }}
        />
      )}
    </div>
  );
}
