import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Outlet, useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { TopBar } from "../components/shell/TopBar";
import { Sidebar } from "../components/shell/Sidebar";
import { useAppState } from "../state/useAppState";
import { api } from "../api";
import type { Device, User } from "../types";

const THEME_KEY = "ultraponto:theme";

// Tipo do context passado via <Outlet context={...} />; as screens acessam
// com useOutletContext<RepOutletContext>().
export interface RepOutletContext {
  sn: string;
  device: Device | null;
  users: User[];
  logs: import("../types").Log[];
  realtimeLogs: import("../types").Log[];
  serverPort: string;
  readOnly: boolean;
  refresh: () => void;
}

export function RepLayout() {
  const { sn = "" } = useParams<{ sn: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { devices, users, logs, realtimeLogs, serverPort, readOnly, refresh } = useAppState(sn);

  const device = useMemo(() => devices.find(d => d.sn === sn) ?? null, [devices, sn]);

  const [openGroups, setOpenGroups] = useState<string[]>(["usuarios", "relatorio", "sistema"]);
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
    document.title = device?.alias ? `${device.alias} — Ultraponto` : "Ultraponto Webserver";
  }, [device?.alias]);

  // Deriva o "active" do path atual pra highlight na sidebar.
  const active = useMemo(() => {
    const parts = location.pathname.split("/");
    // /rep/<sn>/<active>[/...]
    return parts[3] || "home";
  }, [location.pathname]);

  // Reação a 404 do REP: se após o carregamento o device não existir na lista
  // e a lista já veio (pelo menos vazia — devices !== undefined), redireciona.
  const [checkedDevice, setCheckedDevice] = useState(false);
  useEffect(() => {
    // Segundo tick — dá tempo do refresh inicial.
    const t = setTimeout(() => setCheckedDevice(true), 800);
    return () => clearTimeout(t);
  }, [sn]);

  if (checkedDevice && !device) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50 dark:bg-[#0E1117] p-6">
        <div className="up-card p-8 max-w-md text-center">
          <div className="text-lg font-semibold text-ink-900 dark:text-white mb-2">REP não encontrado</div>
          <div className="text-[13px] text-ink-500 mb-4">SN: <span className="font-mono">{sn}</span></div>
          <Link to="/" className="btn-primary inline-flex">
            <ArrowLeft size={14} /> Ver todos os REPs
          </Link>
        </div>
      </div>
    );
  }

  const context: RepOutletContext = {
    sn,
    device,
    users,
    logs,
    realtimeLogs,
    serverPort,
    readOnly,
    refresh,
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
          onPick={(id) => navigate(`/rep/${encodeURIComponent(sn)}/${id}`)}
          readOnly={readOnly}
        />
        <main className="flex-1 min-w-0 flex flex-col bg-ink-50 dark:bg-[#0E1117]">
          {/* Breadcrumb do REP */}
          <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-[#141A24] border-b border-ink-100 dark:border-[#222A36] text-[12.5px]">
            <Link to="/" className="text-ink-500 hover:text-ink-700 dark:hover:text-white inline-flex items-center gap-1">
              <ArrowLeft size={12} /> Trocar REP
            </Link>
            <span className="text-ink-300">/</span>
            <span className="font-semibold text-ink-900 dark:text-white">
              {device?.alias || sn}
            </span>
            {device?.ip && (
              <span className="text-ink-400 font-mono text-[11.5px]">({device.ip})</span>
            )}
            <span className={`ml-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
              device?.online ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
            }`}>
              {device?.online ? "Online" : "Offline"}
            </span>
            {readOnly && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                <Lock size={11} /> Modo read-only — comandos via Soltech
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto nice-scroll">
            <Outlet context={context} />
          </div>
        </main>
      </div>
    </div>
  );
}

export { Navigate };
