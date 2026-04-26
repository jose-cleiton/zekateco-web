import { useState } from "react";
import { Check } from "lucide-react";
import { UserForm, type UserFormValue } from "./UserForm";
import { api } from "../api";

interface Props {
  onSaved: () => void;
  onCancel: () => void;
}

export function NewUserScreen({ onSaved, onCancel }: Props) {
  const [v, setV] = useState<UserFormValue>({
    pin: "", name: "", privilege: 0, password: "", card: "",
    depto: "", turno: "", faixa: "", grp: "", modo: "", aniversario: "", inicio: "", fim: "",
  });
  const [pickedPhoto, setPickedPhoto] = useState<File | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const handlePickPhoto = (file: File) => {
    setPickedPhoto(file);
    setPickedPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!v.pin || !v.name) {
      alert("Preencha ID e Nome.");
      return;
    }
    setSaving(true);
    try {
      await api.createUser({ pin: v.pin, name: v.name, privilege: v.privilege, password: v.password, card: v.card });
      if (pickedPhoto) {
        try { await api.uploadPhoto(v.pin, pickedPhoto); } catch (e) { console.error(e); }
      }
      onSaved();
    } catch (e: any) {
      alert(e.message || "Erro ao criar usuário");
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
          mode="new"
          photoUrl={pickedPreview}
          onPickPhoto={handlePickPhoto}
          onDeletePhoto={() => { setPickedPhoto(null); setPickedPreview(undefined); }}
        />
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-ink-200 dark:border-[#2A3140]">
          <button className="btn-outline" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Check size={13} /> Salvar usuário
          </button>
        </div>
      </div>
    </div>
  );
}
