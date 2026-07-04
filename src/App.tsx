import { Navigate, Route, Routes, useOutletContext } from "react-router-dom";
import { RepIndex } from "./routes/RepIndex";
import { RepLayout, type RepOutletContext } from "./routes/RepLayout";
import { RepByIp } from "./routes/RepByIp";

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
import { useNavigate } from "react-router-dom";
import type { User } from "./types";

function useRep() {
  return useOutletContext<RepOutletContext>();
}

function HomeRoute() {
  const { device, users, serverPort, logs } = useRep();
  return <HomeScreen device={device} users={users} serverPort={serverPort} totalLogs={logs.length} />;
}

function UsersListRoute() {
  const { users, refresh, sn } = useRep();
  const navigate = useNavigate();
  return (
    <UsersListScreen
      users={users}
      onEdit={(u) => {
        // Passa o user via state — o EditUserRoute lê de window.history.state.usr.
        navigate(`/rep/${encodeURIComponent(sn)}/edit-usuario`, { state: { user: u } });
      }}
      onDelete={async (pin, name) => {
        if (!confirm(`Excluir "${name}" (PIN ${pin})? Também remove do REP.`)) return;
        try {
          const res = await fetch(`/api/users/${pin}`, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
          refresh();
        } catch (e: any) {
          alert(e.message || "Erro ao excluir");
        }
      }}
      onNew={() => navigate(`/rep/${encodeURIComponent(sn)}/novo-usuario`)}
      refresh={refresh}
    />
  );
}

function NewUserRoute() {
  const { refresh, sn } = useRep();
  const navigate = useNavigate();
  return (
    <NewUserScreen
      onSaved={() => { refresh(); navigate(`/rep/${encodeURIComponent(sn)}/lista-usuarios`); }}
      onCancel={() => navigate(`/rep/${encodeURIComponent(sn)}/lista-usuarios`)}
    />
  );
}

function EditUserRoute() {
  const { refresh, sn } = useRep();
  const navigate = useNavigate();
  // O user passado via location.state; se recarregar, cai no fallback abaixo.
  const state = window.history.state?.usr as { user?: User } | undefined;
  const user = state?.user;
  const goBack = () => navigate(`/rep/${encodeURIComponent(sn)}/lista-usuarios`);
  if (!user) {
    return <div className="p-6 text-ink-500">Selecione um usuário na lista para editar.</div>;
  }
  return (
    <EditUserScreen
      user={user}
      onSaved={() => { refresh(); goBack(); }}
      onCancel={goBack}
    />
  );
}

function RealtimeRoute() {
  const { realtimeLogs, users } = useRep();
  return <RealtimeScreen logs={realtimeLogs} users={users} />;
}

function InfoRegRoute() {
  const { logs, users, refresh } = useRep();
  return <InfoRegScreen logs={logs} users={users} refresh={refresh} />;
}

function RelatorioRoute() {
  const { logs, users, refresh } = useRep();
  return <RelatorioScreen logs={logs} users={users} refresh={refresh} />;
}

function DispositivoRoute() {
  const { device, serverPort, refresh, readOnly } = useRep();
  return <DispositivoScreen device={device} serverPort={serverPort} refresh={refresh} readOnly={readOnly} />;
}

function DadosRoute() {
  const { users, logs } = useRep();
  return <DadosScreen users={users} logs={logs} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RepIndex />} />
      <Route path="/rep/ip/:ip" element={<RepByIp />} />
      <Route path="/rep/:sn" element={<RepLayout />}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<HomeRoute />} />
        <Route path="lista-usuarios" element={<UsersListRoute />} />
        <Route path="novo-usuario" element={<NewUserRoute />} />
        <Route path="edit-usuario" element={<EditUserRoute />} />
        <Route path="rt" element={<RealtimeRoute />} />
        <Route path="info-reg" element={<InfoRegRoute />} />
        <Route path="rel" element={<RelatorioRoute />} />
        <Route path="dispositivo" element={<DispositivoRoute />} />
        <Route path="dados" element={<DadosRoute />} />
        <Route path="fw" element={<FwScreen />} />
        <Route path="*" element={<Navigate to="home" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
