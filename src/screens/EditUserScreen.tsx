import { useState } from "react";
import { Save } from "lucide-react";
import { UserForm, type UserFormValue } from "./UserForm";
import { api } from "../api";
import type { User } from "../types";

interface Props {
  user: User;
  onSaved: () => void;
  onCancel: () => void;
}

export function EditUserScreen({ user, onSaved, onCancel }: Props) {
  const [v, setV] = useState<UserFormValue>({
    pin: user.pin,
    name: user.name,
    privilege: user.privilege,
    password: user.password ?? "",
    card: user.card ?? "",
    depto: "", turno: "", faixa: "", grp: "", modo: "", aniversario: "", inicio: "", fim: "",
  });
  const [pickedPhoto, setPickedPhoto] = useState<File | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | undefined>(user.photo_url);
  const [saving, setSaving] = useState(false);

  const handlePickPhoto = (file: File) => {
    setPickedPhoto(file);
    setPickedPreview(URL.createObjectURL(file));
  };

  const handleDeletePhoto = async () => {
    if (!confirm("Remover foto do usuário (banco e REP)?")) return;
    try { await api.deletePhoto(user.pin); setPickedPreview(undefined); setPickedPhoto(null); }
    catch (e: any) { alert(e.message || "Erro ao remover foto"); }
  };

  const handleSyncPhoto = async () => {
    try { await api.syncPhoto(user.pin); }
    catch (e: any) { alert(e.message || "Erro ao reenviar foto"); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateUser(v.pin, { name: v.name, privilege: v.privilege, password: v.password, card: v.card });
      if (pickedPhoto) {
        try { await api.uploadPhoto(v.pin, pickedPhoto); } catch (e) { console.error(e); }
      }
      onSaved();
    } catch (e: any) {
      alert(e.message || "Erro ao atualizar usuário");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="up-card p-6">
        <UserForm
          value={v}
          onChange={setV}
          mode="edit"
          photoUrl={pickedPreview}
          onPickPhoto={handlePickPhoto}
          onDeletePhoto={handleDeletePhoto}
          onSyncPhoto={handleSyncPhoto}
        />
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-ink-200 dark:border-[#2A3140]">
          <button className="btn-outline" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={13} /> Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}
