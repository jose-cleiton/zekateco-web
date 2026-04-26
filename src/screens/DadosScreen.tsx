import { Database, Upload, Trash2 } from "lucide-react";
import type { User, Log } from "../types";

interface Props {
  users: User[];
  logs: Log[];
}

export function DadosScreen({ users, logs }: Props) {
  const usersWithPhoto = users.filter(u => !!u.photo_url).length;

  return (
    <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="up-card p-5 xl:col-span-2">
        <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white mb-3">Backup & Restauração</h3>
        <div className="space-y-3">
          {[
            { i: Database, t: "Backup completo do banco de dados", h: "Inclui usuários, registros e fotos.", b: "Gerar backup", danger: false },
            { i: Upload, t: "Restaurar a partir de arquivo .db", h: "Substitui os dados atuais.", b: "Selecionar arquivo", danger: false },
            { i: Trash2, t: "Limpar todos os registros", h: "Mantém usuários cadastrados.", b: "Limpar", danger: true },
          ].map(r => {
            const Ic = r.i;
            return (
              <div key={r.t} className="flex items-center gap-3 p-3 rounded-lg border border-ink-200 dark:border-[#222A36]">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${r.danger ? "bg-rose-50 text-rose-600" : "bg-up-50 text-up-600"}`}><Ic size={15} /></div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold">{r.t}</div>
                  <div className="text-[12px] text-ink-500">{r.h}</div>
                </div>
                <button className={r.danger ? "btn-danger" : "btn-soft"} disabled title="Em breve">{r.b}</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="up-card p-5">
        <h3 className="text-[14px] font-semibold text-ink-900 dark:text-white mb-3">Estatísticas do banco</h3>
        <ul className="text-[13px] divide-y divide-ink-200 dark:divide-[#222A36]">
          {[
            ["Registros", logs.length.toLocaleString("pt-BR")],
            ["Usuários", users.length.toLocaleString("pt-BR")],
            ["Fotos", usersWithPhoto.toLocaleString("pt-BR")],
          ].map(([k, v]) => (
            <li key={k} className="flex justify-between py-2"><span className="text-ink-500">{k}</span><span className="font-semibold tabular">{v}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
