import {
  Home, Users, Calendar, BarChart3, LogIn, Lock,
  UserPlus, List, CalendarPlus, ListChecks,
  Activity, FileText, FileBarChart,
  Monitor, Database, UploadCloud,
  ShieldOff, ShieldPlus, ChevronDown,
  Plus, Minus,
  type LucideIcon,
} from "lucide-react";

interface MenuLeaf { id: string; label: string; icon: LucideIcon }
interface MenuGroup { id: string; label: string; icon: LucideIcon; children: MenuLeaf[]; leaf?: false }
interface MenuLeafItem { id: string; label: string; icon: LucideIcon; leaf: true; children?: undefined }
type MenuItem = MenuGroup | MenuLeafItem;
const isGroup = (m: MenuItem): m is MenuGroup => !m.leaf;

const MENU: MenuItem[] = [
  { id: "home", label: "Início", icon: Home, leaf: true },
  { id: "usuarios", label: "Usuários", icon: Users, children: [
    { id: "novo-usuario", label: "Novo usuário", icon: UserPlus },
    { id: "lista-usuarios", label: "Usuários", icon: List },
  ]},
  { id: "turno", label: "Turno", icon: Calendar, children: [
    { id: "turno-cad", label: "Cadastrar turno", icon: CalendarPlus },
    { id: "turno-list", label: "Lista de turnos", icon: ListChecks },
  ]},
  { id: "relatorio", label: "Relatório", icon: BarChart3, children: [
    { id: "rt", label: "Registros em tempo real", icon: Activity },
    { id: "info-reg", label: "Info reg", icon: FileText },
    { id: "rel", label: "Relatório", icon: FileBarChart },
  ]},
  { id: "sistema", label: "Sistema", icon: LogIn, children: [
    { id: "dispositivo", label: "Dispositivo", icon: Monitor },
    { id: "dados", label: "Dados", icon: Database },
    { id: "fw", label: "Atualizar FW", icon: UploadCloud },
  ]},
  { id: "bloqueio", label: "Bloqueio", icon: Lock, children: [
    { id: "bloq-list", label: "Lista de bloqueios", icon: ShieldOff },
    { id: "bloq-novo", label: "Novo bloqueio", icon: ShieldPlus },
  ]},
];

interface Props {
  active: string;
  openGroups: string[];
  setOpenGroups: (g: string[] | ((prev: string[]) => string[])) => void;
  onPick: (id: string) => void;
}

export function Sidebar({ active, openGroups, setOpenGroups, onPick }: Props) {
  const isOpen = (id: string) => openGroups.includes(id);
  const toggle = (id: string) =>
    setOpenGroups(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <aside className="w-60 shrink-0 bg-up-500 up-sidebar-pattern text-white relative overflow-y-auto nice-scroll">
      <div className="px-3 pt-3">
        <div className="bg-white/10 border border-white/15 rounded-lg px-3 py-2 flex items-center justify-between">
          <div className="leading-tight">
            <div className="text-[11px] uppercase tracking-wide text-white/70">Bem vindo</div>
            <div className="text-[13px] font-semibold">Administrador</div>
          </div>
          <ChevronDown size={16} className="text-white/70" />
        </div>
      </div>

      <nav className="mt-3 px-2 pb-4 space-y-0.5">
        {MENU.map(item => {
          const ItemIcon = item.icon;
          const group = isGroup(item) ? item : null;
          const opened = group ? isOpen(group.id) : false;
          const itemActive = active === item.id || (group ? group.children.some(c => c.id === active) : false);
          return (
            <div key={item.id}>
              <button
                onClick={() => group ? toggle(group.id) : onPick(item.id)}
                className={`w-full flex items-center gap-2.5 h-9 px-3 rounded-md text-[13px] font-medium transition
                  ${itemActive ? "bg-white text-up-700 shadow-sm" : "text-white/95 hover:bg-white/10"}`}
              >
                <ItemIcon size={16} />
                <span className="flex-1 text-left">{item.label}</span>
                {group && (
                  opened
                    ? <Minus size={14} className={itemActive ? "text-up-700" : "text-white/80"} />
                    : <Plus size={14} className={itemActive ? "text-up-700" : "text-white/80"} />
                )}
              </button>
              {group && opened && (
                <div className="ml-3 mt-0.5 mb-1 pl-3 border-l border-white/20 space-y-0.5">
                  {group.children.map(c => {
                    const CIcon = c.icon;
                    return (
                      <button
                        key={c.id}
                        onClick={() => onPick(c.id)}
                        className={`w-full flex items-center gap-2 h-8 pl-2 pr-3 rounded-md text-[12.5px] transition
                          ${active === c.id ? "bg-white text-up-700 font-semibold" : "text-white/85 hover:bg-white/10"}`}
                      >
                        <CIcon size={13} />
                        <span>{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
