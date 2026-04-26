import { useState, Fragment, useRef } from "react";
import {
  UserPlus, Trash2, FileSpreadsheet, Upload, Download, FolderUp,
  Search, Calendar, RefreshCw, LayoutGrid, SlidersHorizontal,
  ChevronsUpDown, Plus, Minus, Pencil, X, Camera, Loader2,
} from "lucide-react";
import { SyncBadge } from "../components/common/SyncBadge";
import { api } from "../api";
import type { User } from "../types";

interface Props {
  users: User[];
  onEdit: (u: User) => void;
  onDelete: (pin: string, name: string) => void;
  onNew: () => void;
  refresh: () => void;
}

export function UsersListScreen({ users, onEdit, onDelete, onNew, refresh }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [perPage, setPerPage] = useState(15);
  const [uploadingPin, setUploadingPin] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const filtered = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.pin.includes(search)
  );

  const toggleExp = (id: string) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };
  const toggleSel = (id: string) => {
    const s = new Set(sel);
    s.has(id) ? s.delete(id) : s.add(id);
    setSel(s);
  };

  const handlePhotoUpload = async (pin: string, file: File) => {
    if (!file.type.startsWith("image/")) { alert("Selecione uma imagem."); return; }
    setUploadingPin(pin);
    try {
      await api.uploadPhoto(pin, file);
      refresh();
    } catch (e: any) {
      alert(e.message || "Erro ao enviar foto");
    } finally {
      setUploadingPin(null);
    }
  };

  const handleSyncPhoto = async (pin: string) => {
    try { await api.syncPhoto(pin); }
    catch (e: any) { alert(e.message || "Erro ao reenviar foto"); }
  };

  const handleDeletePhoto = async (pin: string) => {
    if (!confirm("Remover foto deste usuário (do banco e do REP)?")) return;
    try { await api.deletePhoto(pin); refresh(); }
    catch (e: any) { alert(e.message || "Erro ao remover foto"); }
  };

  const handleBulkDelete = async () => {
    if (sel.size === 0) return;
    if (!confirm(`Excluir ${sel.size} usuário(s)?`)) return;
    for (const pin of sel) {
      try { await api.deleteUser(pin); } catch {}
    }
    setSel(new Set());
    refresh();
  };

  return (
    <div className="p-6 space-y-3">
      {/* Toolbar */}
      <div className="up-card p-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={onNew}><UserPlus size={13} />Adicionar</button>
        <button className="btn-danger" disabled={sel.size === 0} onClick={handleBulkDelete}>
          <Trash2 size={13} />Apagar {sel.size > 0 && `(${sel.size})`}
        </button>
        <button className="btn-outline" disabled title="Em breve"><FileSpreadsheet size={13} />Salvar como Excel</button>
        <button className="btn-outline" disabled title="Em breve"><Upload size={13} />Importar do Excel</button>
        <button className="btn-outline" disabled title="Em breve"><Download size={13} />Baixar todas as fotos</button>
        <button className="btn-outline" disabled title="Em breve"><FolderUp size={13} />Carregar fotos de pastas</button>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <input className="field pl-8 w-56" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          </div>
          <button className="btn-ghost p-2 h-9 w-9 justify-center" title="Filtrar por data"><Calendar size={14} /></button>
          <button className="btn-ghost p-2 h-9 w-9 justify-center" onClick={refresh} title="Recarregar"><RefreshCw size={14} /></button>
          <button className="btn-ghost p-2 h-9 w-9 justify-center" title="Visão"><LayoutGrid size={14} /></button>
          <button className="btn-ghost p-2 h-9 w-9 justify-center" title="Colunas"><SlidersHorizontal size={14} /></button>
        </div>
      </div>

      {/* Table */}
      <div className="up-card overflow-hidden">
        <div className="overflow-x-auto nice-scroll">
          <table className="w-full border-collapse min-w-[1100px]">
            <thead>
              <tr className="bg-up-500 text-white">
                <th className="up-th w-8"><input type="checkbox" className="rounded"
                  checked={filtered.length > 0 && filtered.every(u => sel.has(u.pin))}
                  onChange={(e) => setSel(e.target.checked ? new Set(filtered.map(u => u.pin)) : new Set())}
                /></th>
                <th className="up-th w-10"></th>
                <th className="up-th w-12 text-left">Foto</th>
                <th className="up-th w-20 text-left">ID <ChevronsUpDown size={11} className="inline ml-0.5 opacity-70" /></th>
                <th className="up-th text-left">Nome</th>
                <th className="up-th text-left">Tipo</th>
                <th className="up-th text-left">Cartão</th>
                <th className="up-th text-left">Senha</th>
                <th className="up-th text-left">Foto sync</th>
                <th className="up-th text-left">Cadastro sync</th>
                <th className="up-th w-24 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="py-12 text-center text-ink-400 text-[13px]">Nenhum usuário encontrado</td></tr>
              )}
              {filtered.slice(0, perPage).map(u => (
                <Fragment key={u.pin}>
                  <tr className="up-row border-b border-ink-200 dark:border-[#222A36] group">
                    <td className="up-td"><input type="checkbox" checked={sel.has(u.pin)} onChange={() => toggleSel(u.pin)} className="rounded" /></td>
                    <td className="up-td">
                      <button onClick={() => toggleExp(u.pin)} className="w-5 h-5 inline-flex items-center justify-center rounded border border-ink-300 text-ink-500 hover:bg-up-50 hover:text-up-700 hover:border-up-400">
                        {expanded.has(u.pin) ? <Minus size={11} /> : <Plus size={11} />}
                      </button>
                    </td>
                    <td className="up-td">
                      <label
                        className="relative w-9 h-9 block cursor-pointer group/avatar rounded-full overflow-hidden"
                        title="Clique para enviar foto"
                      >
                        <input
                          ref={el => { fileRefs.current[u.pin] = el; }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingPin === u.pin}
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) handlePhotoUpload(u.pin, f);
                            e.target.value = "";
                          }}
                        />
                        {u.photo_url ? (
                          <img src={u.photo_url} alt={u.name} className="w-9 h-9 rounded-full object-cover ring-1 ring-ink-200" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-up-50 text-up-600 flex items-center justify-center text-[11px] font-bold">
                            {u.name.slice(0, 2).toUpperCase() || "??"}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-ink-900/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center text-white">
                          {uploadingPin === u.pin ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                        </div>
                      </label>
                    </td>
                    <td className="up-td tabular">{u.pin}</td>
                    <td className="up-td font-medium text-ink-900 dark:text-white">{u.name}</td>
                    <td className="up-td">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${u.privilege === 14 ? "bg-up-100 text-up-700" : "bg-ink-100 text-ink-700"}`}>
                        {u.privilege === 14 ? "Admin" : "Usuário"}
                      </span>
                    </td>
                    <td className="up-td tabular">{u.card || "—"}</td>
                    <td className="up-td">{u.password ? "•••" : "—"}</td>
                    <td className="up-td">
                      {u.photo_url
                        ? <SyncBadge sync={u.photoSync ?? { status: "success", operation_id: null, error_detail: null }} showSuccess />
                        : <span className="text-ink-400 text-[12px]">—</span>}
                    </td>
                    <td className="up-td">
                      {u.userSync
                        ? <SyncBadge sync={u.userSync} showSuccess />
                        : <span className="text-ink-400 text-[12px]">—</span>}
                    </td>
                    <td className="up-td">
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {u.photo_url && (
                          <button onClick={() => handleSyncPhoto(u.pin)} className="p-1.5 rounded hover:bg-up-50 text-ink-500 hover:text-up-700" title="Reenviar foto"><RefreshCw size={13} /></button>
                        )}
                        {u.photo_url && (
                          <button onClick={() => handleDeletePhoto(u.pin)} className="p-1.5 rounded hover:bg-rose-50 text-ink-500 hover:text-rose-600" title="Remover foto"><Camera size={13} /></button>
                        )}
                        <button onClick={() => onEdit(u)} className="p-1.5 rounded hover:bg-up-50 text-ink-500 hover:text-up-700" title="Editar"><Pencil size={13} /></button>
                        <button onClick={() => onDelete(u.pin, u.name)} className="p-1.5 rounded hover:bg-rose-50 text-ink-500 hover:text-rose-600" title="Excluir"><X size={13} /></button>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(u.pin) && (
                    <tr className="bg-ink-50 dark:bg-[#0E1117] border-b border-ink-200 dark:border-[#222A36]">
                      <td colSpan={11} className="px-6 py-4">
                        <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[12.5px]">
                          {[
                            ["ID", u.pin, true],
                            ["Nome", u.name],
                            ["Privilégio", u.privilege === 14 ? "Admin" : "Usuário"],
                            ["Cartão", u.card || "—"],
                            ["Senha", u.password ? "•••" : "—"],
                            ["Foto", u.photo_url ? "Sim" : "Não"],
                          ].map(([k, v, mono]) => (
                            <div key={k as string} className="flex gap-2">
                              <span className="font-semibold text-ink-700 dark:text-ink-300 w-44 shrink-0">{k}:</span>
                              <span className={`text-ink-700 dark:text-ink-300 ${mono ? "font-mono tabular" : ""}`}>{v as string}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 flex items-center justify-between text-[12.5px] text-ink-500 border-t border-ink-200 dark:border-[#222A36]">
          <div>Showing 1 to {Math.min(perPage, filtered.length)} of {filtered.length} rows</div>
          <div className="flex items-center gap-2">
            <select className="field w-16 h-8" value={perPage} onChange={e => setPerPage(+e.target.value)}>
              <option value="10">10</option><option value="15">15</option><option value="25">25</option><option value="50">50</option>
            </select>
            <span>rows per page</span>
          </div>
        </div>
      </div>
    </div>
  );
}
