import { Search, MoreVertical, Sun, Moon } from "lucide-react";

interface Props {
  dark: boolean;
  onToggleTheme: () => void;
  onSearch?: () => void;
}

export function TopBar({ dark, onToggleTheme, onSearch }: Props) {
  return (
    <header className="h-12 bg-up-500 text-white flex items-center px-4 shadow-[var(--shadow-card)] relative z-30">
      <div className="flex items-center gap-2 font-semibold tracking-tight text-[15px]">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/15">
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
            <path d="M12 3 L21 19 H3 Z" fill="currentColor" />
          </svg>
        </span>
        <span>Ultraponto Webserver</span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button className="p-2 hover:bg-white/10 rounded-md transition-colors" title="Tema" onClick={onToggleTheme}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="p-2 hover:bg-white/10 rounded-md transition-colors" title="Buscar" onClick={onSearch}>
          <Search size={18} />
        </button>
        <button className="p-2 hover:bg-white/10 rounded-md transition-colors" title="Mais">
          <MoreVertical size={18} />
        </button>
      </div>
    </header>
  );
}
