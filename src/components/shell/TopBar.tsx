import { Search, MoreVertical, Sun, Moon } from "lucide-react";

interface Props {
  dark: boolean;
  onToggleTheme: () => void;
  onSearch?: () => void;
}

export function TopBar({ dark, onToggleTheme, onSearch }: Props) {
  return (
    <header className="h-12 bg-up-500 text-white flex items-center px-4 shadow-(--shadow-card) relative z-30">
      <div className="flex items-center gap-3">
        <img src="/ultraponto-logo.svg" alt="Ultraponto" className="h-9 w-auto" />
        <span className="text-white/40 text-[18px] font-light leading-none -mt-0.5">|</span>
        <span className="font-semibold tracking-tight text-[13px] text-white/90">
          Webserver
        </span>
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
