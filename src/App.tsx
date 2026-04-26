import { useEffect, useState } from "react";
import { TopBar } from "./components/shell/TopBar";
import { Sidebar } from "./components/shell/Sidebar";
import { TabStrip } from "./components/shell/TabStrip";
import { useAppState } from "./state/useAppState";
import { useTabs, LABELS } from "./state/useTabs";
import { api } from "./api";
import type { User } from "./types";

import { HomeScreen } from "./screens/HomeScreen";
import { UsersListScreen } from "./screens/UsersListScreen";
import { NewUserScreen } from "./screens/NewUserScreen";
import { EditUserScreen } from "./screens/EditUserScreen";
import { RealtimeScreen } from "./screens/RealtimeScreen";
import { InfoRegScreen } from "./screens/InfoRegScreen";
import { RelatorioScreen } from "./screens/RelatorioScreen";
import { DispositivoScreen } from "./screens/DispositivoScreen";
import { DadosScreen } from "./screens/DadosScreen";
import { FwScreen } from "./screens/FwScreen";
import { TurnoScreen } from "./screens/TurnoScreen";
import { BloqueioScreen } from "./screens/BloqueioScreen";

const THEME_KEY = "ultraponto:theme";

export default function App() {
  const { devices, users, logs, serverPort, refresh } = useAppState();
  const { tabs, active, setActive, open, close } = useTabs();
  const [openGroups, setOpenGroups] = useState<string[]>(["usuarios", "relatorio", "sistema"]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "dark") html.classList.add("dark");
    else html.classList.remove("dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = "Ultraponto Webserver";
  }, []);

  const device = devices[0] ?? null;

  const handleEditOpen = (u: User) => {
    setEditingUser(u);
    open("edit-usuario", LABELS["edit-usuario"]);
  };

  const handleDeleteUser = async (pin: string, name: string) => {
    if (!confirm(`Excluir "${name}" (PIN ${pin})? Também remove do REP.`)) return;
    try { await api.deleteUser(pin); refresh(); }
    catch (e: any) { alert(e.message || "Erro ao excluir"); }
  };

  const renderScreen = () => {
    switch (active) {
      case "home":
        return <HomeScreen device={device} users={users} serverPort={serverPort} totalLogs={logs.length} />;
      case "novo-usuario":
        return <NewUserScreen
          onSaved={() => { close("novo-usuario"); open("lista-usuarios"); refresh(); }}
          onCancel={() => close("novo-usuario")}
        />;
      case "lista-usuarios":
        return <UsersListScreen
          users={users}
          onEdit={handleEditOpen}
          onDelete={handleDeleteUser}
          onNew={() => open("novo-usuario")}
          refresh={refresh}
        />;
      case "edit-usuario":
        return editingUser
          ? <EditUserScreen
              user={editingUser}
              onSaved={() => { setEditingUser(null); close("edit-usuario"); refresh(); }}
              onCancel={() => { setEditingUser(null); close("edit-usuario"); }}
            />
          : <div className="p-6 text-ink-500">Selecione um usuário na lista para editar.</div>;
      case "turno-cad":
      case "turno-list":
        return <TurnoScreen />;
      case "rt":
        return <RealtimeScreen logs={logs} users={users} />;
      case "info-reg":
        return <InfoRegScreen logs={logs} users={users} />;
      case "rel":
        return <RelatorioScreen logs={logs} users={users} />;
      case "dispositivo":
        return <DispositivoScreen device={device} serverPort={serverPort} refresh={refresh} />;
      case "dados":
        return <DadosScreen users={users} logs={logs} />;
      case "fw":
        return <FwScreen />;
      case "bloq-list":
      case "bloq-novo":
        return <BloqueioScreen />;
      default:
        return <div className="p-6 text-ink-500">Tela não implementada: {active}</div>;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <TopBar
        dark={theme === "dark"}
        onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
        onSearch={() => alert("Busca global — em breve")}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          active={active}
          openGroups={openGroups}
          setOpenGroups={setOpenGroups}
          onPick={(id) => open(id)}
        />
        <main className="flex-1 min-w-0 flex flex-col bg-ink-50 dark:bg-[#0E1117]">
          <TabStrip tabs={tabs} active={active} onPick={setActive} onClose={close} />
          <div className="flex-1 min-h-0 overflow-auto nice-scroll">
            {renderScreen()}
          </div>
        </main>
      </div>
    </div>
  );
}
