import { useState } from "react";
import {
  Search, Calendar, RefreshCw, LayoutGrid, SlidersHorizontal,
  ChevronsUpDown, ScanFace, KeyRound, CreditCard, CheckCircle2,
} from "lucide-react";
import type { Log, User } from "../types";

interface Props {
  logs: Log[];
  users: User[];
}

const verifyTypeLabel = (vt: number) => {
  if (vt === 1) return { label: "Digital", icon: ScanFace };
  if (vt === 2 || vt === 3) return { label: "Senha", icon: KeyRound };
  if (vt === 4 || vt === 11 || vt === 15) return { label: "Face", icon: ScanFace };
  if (vt === 5) return { label: "Cartão", icon: CreditCard };
  return { label: "Auto", icon: ScanFace };
};

const statusToInout = (s: number) => (s === 0 || s === 1 ? "in" : s === 2 ? "out" : "in");

export function RealtimeScreen({ logs, users }: Props) {
  const [search, setSearch] = useState("");
  const userByPin = new Map(users.map(u => [u.pin, u.name]));

  const enriched = logs.map(l => {
    const id = `${l.id}-${l.pin}-${l.time}`;
    return {
      key: id,
      hora: l.time,
      pin: l.pin,
      nome: userByPin.get(l.pin) || `PIN ${l.pin}`,
      ...verifyTypeLabel(l.verify_type),
      inout: statusToInout(l.status),
      evento: statusToInout(l.status) === "in" ? "Entrada" : "Saída",
      not: "OK",
      photo: !!users.find(u => u.pin === l.pin)?.photo_url,
    };
  });

  const filtered = enriched.filter(r => !search || r.nome.toLowerCase().includes(search.toLowerCase()) || r.pin.includes(search));

  return (
    <div className="p-6 space-y-3">
      <div className="up-card p-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-500 mr-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot" />
          Streaming em tempo real
        </span>
        <div className="relative">
          <input className="field pl-8 w-56" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        </div>
        <button className="btn-ghost p-2 h-9 w-9 justify-center"><Calendar size={14} /></button>
        <button className="btn-ghost p-2 h-9 w-9 justify-center"><RefreshCw size={14} /></button>
        <button className="btn-ghost p-2 h-9 w-9 justify-center"><LayoutGrid size={14} /></button>
        <button className="btn-ghost p-2 h-9 w-9 justify-center"><SlidersHorizontal size={14} /></button>
      </div>

      <div className="up-card overflow-hidden">
        <div className="overflow-x-auto nice-scroll">
          <table className="w-full border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-up-500 text-white">
                <th className="up-th text-left" style={{ width: 180 }}>Hora <ChevronsUpDown size={11} className="inline ml-0.5 opacity-70" /></th>
                <th className="up-th text-left" style={{ width: 90 }}>ID</th>
                <th className="up-th text-left">Nome</th>
                <th className="up-th text-left">Identific.</th>
                <th className="up-th text-left">inout</th>
                <th className="up-th text-left">Evento</th>
                <th className="up-th text-left">not</th>
                <th className="up-th text-left">photo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-ink-400 text-[13px]">Nenhum registro encontrado</td></tr>
              ) : filtered.map(r => {
                const Ic = r.icon;
                return (
                  <tr key={r.key} className="up-row border-b border-ink-200 dark:border-[#222A36]">
                    <td className="up-td font-mono tabular">{r.hora}</td>
                    <td className="up-td font-mono tabular">{r.pin}</td>
                    <td className="up-td font-medium text-ink-900 dark:text-white">{r.nome}</td>
                    <td className="up-td">
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium bg-up-50 text-up-700 px-1.5 py-0.5 rounded">
                        <Ic size={11} /> {r.label}
                      </span>
                    </td>
                    <td className="up-td">
                      <span className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded ${r.inout === "in" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{r.inout}</span>
                    </td>
                    <td className="up-td">{r.evento}</td>
                    <td className="up-td">
                      <span className="inline-flex items-center gap-1 text-emerald-600 text-[12px] font-medium"><CheckCircle2 size={12} /> {r.not}</span>
                    </td>
                    <td className="up-td">
                      {r.photo
                        ? <span className="text-ink-500 text-[12px]">ver</span>
                        : <span className="text-ink-300 text-[12px]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
