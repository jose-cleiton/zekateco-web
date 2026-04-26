import { useCallback, useState } from "react";
import type { Tab } from "../types";

const LABELS: Record<string, string> = {
  "home": "Início",
  "novo-usuario": "Novo usuário",
  "lista-usuarios": "Usuários",
  "edit-usuario": "Editar",
  "rt": "Registros em tempo real",
  "info-reg": "Info reg",
  "rel": "Relatório",
  "dispositivo": "Dispositivo",
  "dados": "Dados",
  "fw": "Atualizar FW",
};

export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "home", label: "Início", closable: false }]);
  const [active, setActive] = useState<string>("home");

  const open = useCallback((id: string, label?: string) => {
    const finalLabel = label ?? LABELS[id] ?? id;
    setTabs(t => t.some(x => x.id === id) ? t : [...t, { id, label: finalLabel, closable: id !== "home" }]);
    setActive(id);
  }, []);

  const close = useCallback((id: string) => {
    setTabs(t => {
      const next = t.filter(x => x.id !== id);
      setActive(prevActive => {
        if (prevActive !== id) return prevActive;
        return next[next.length - 1]?.id || "home";
      });
      return next;
    });
  }, []);

  return { tabs, active, setActive, open, close };
}

export { LABELS };
