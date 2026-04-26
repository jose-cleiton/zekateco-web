import type { ReactNode } from "react";
import { Plus, Image, CloudUpload, Trash2 } from "lucide-react";

export interface UserFormValue {
  pin: string;
  name: string;
  privilege: number;
  password: string;
  card: string;
  // Campos extras só de UI (não persistem no backend ainda)
  depto?: string;
  turno?: string;
  faixa?: string;
  grp?: string;
  modo?: string;
  aniversario?: string;
  inicio?: string;
  fim?: string;
}

const FaceIcon = ({ size = 140 }: { size?: number }) => (
  <svg viewBox="0 0 220 220" width={size} height={size} className="text-ink-700 dark:text-ink-300">
    <g fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M30 30 H72 M30 30 V72" />
      <path d="M190 30 H148 M190 30 V72" />
      <path d="M30 190 H72 M30 190 V148" />
      <path d="M190 190 H148 M190 190 V148" />
    </g>
    <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M110 60 c-22 0 -38 18 -38 40 c0 14 6 26 14 33 v8 c-22 6 -34 18 -38 36 h124 c-4 -18 -16 -30 -38 -36 v-8 c8 -7 14 -19 14 -33 c0 -22 -16 -40 -38 -40 z" />
      <path d="M76 100 c8 -22 24 -28 34 -28 c10 0 26 6 34 28" />
    </g>
  </svg>
);

interface Props {
  value: UserFormValue;
  onChange: (v: UserFormValue) => void;
  mode: "new" | "edit";
  photoUrl?: string;
  onPickPhoto?: (file: File) => void;
  onDeletePhoto?: () => void;
  onSyncPhoto?: () => void;
}

export function UserForm({ value, onChange, mode, photoUrl, onPickPhoto, onDeletePhoto, onSyncPhoto }: Props) {
  const set = (k: keyof UserFormValue, v: string | number) => onChange({ ...value, [k]: v });

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_260px] gap-x-8 gap-y-3">
      <div className="space-y-3">
        <Field label="ID">
          <input className="field tabular" value={value.pin} onChange={e => set("pin", e.target.value)} disabled={mode === "edit"} />
        </Field>
        <Field label="Nome">
          <input className="field" value={value.name} onChange={e => set("name", e.target.value)} placeholder="Nome completo" />
        </Field>
        <Field label="Depto">
          <input className="field" value={value.depto ?? ""} onChange={e => set("depto", e.target.value)} placeholder="(somente UI)" />
        </Field>
        <Field label="Cartão">
          <div className="flex gap-2">
            <input className="field flex-1 tabular" value={value.card} onChange={e => set("card", e.target.value)} placeholder="0" />
          </div>
        </Field>
        <Field label="Senha">
          <input type="password" className="field" value={value.password} onChange={e => set("password", e.target.value)} placeholder="••••••" />
        </Field>
        <Field label="Tipo">
          <select className="field" value={value.privilege} onChange={e => set("privilege", parseInt(e.target.value))}>
            <option value={0}>Usuário</option>
            <option value={14}>Administrador</option>
          </select>
        </Field>
      </div>

      <div className="space-y-3">
        <Field label="Turno">
          <input className="field" value={value.turno ?? ""} onChange={e => set("turno", e.target.value)} placeholder="(somente UI)" />
        </Field>
        <Field label="Faixa">
          <input className="field" value={value.faixa ?? ""} onChange={e => set("faixa", e.target.value)} placeholder="(somente UI)" />
        </Field>
        <Field label="GRP">
          <input className="field" value={value.grp ?? ""} onChange={e => set("grp", e.target.value)} placeholder="(somente UI)" />
        </Field>
        <Field label="Modo de verificação pessoal">
          <select className="field" value={value.modo ?? ""} onChange={e => set("modo", e.target.value)}>
            <option value="">Modo de verificação do dispositivo</option>
            <option value="Face">Face</option>
            <option value="Senha">Senha</option>
            <option value="Cartão">Cartão</option>
            <option value="Multi">Multi (Face + Senha)</option>
          </select>
        </Field>
        <Field label="Aniversário">
          <input type="date" className="field" value={value.aniversario ?? ""} onChange={e => set("aniversario", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <input type="date" className="field" value={value.inicio ?? ""} onChange={e => set("inicio", e.target.value)} />
          </Field>
          <Field label="Fim">
            <input type="date" className="field" value={value.fim ?? ""} onChange={e => set("fim", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <label className="rounded-xl border border-ink-200 dark:border-[#2A3140] bg-ink-50 dark:bg-[#0E1117] p-3 cursor-pointer hover:border-up-300 transition-colors block">
          <input type="file" accept="image/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPickPhoto?.(f);
            e.target.value = "";
          }} />
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-[140px] h-[140px] object-cover rounded-lg" />
          ) : (
            <FaceIcon />
          )}
        </label>
        <div className="flex flex-col gap-2 w-full">
          <label className="btn-soft justify-start cursor-pointer">
            <Image size={13} />Selecione o arquivo
            <input type="file" accept="image/*" className="hidden" onChange={e => {
              const f = e.target.files?.[0];
              if (f) onPickPhoto?.(f);
              e.target.value = "";
            }} />
          </label>
          {mode === "edit" && photoUrl && (
            <button type="button" className="btn-soft justify-start" onClick={onSyncPhoto}>
              <CloudUpload size={13} />Reenviar ao dispositivo
            </button>
          )}
          {photoUrl && (
            <button type="button" className="btn-danger justify-start" onClick={onDeletePhoto}>
              <Trash2 size={13} />Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
