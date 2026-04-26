import { X } from "lucide-react";
import type { Tab } from "../../types";

interface Props {
  tabs: Tab[];
  active: string;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabStrip({ tabs, active, onPick, onClose }: Props) {
  return (
    <div className="h-10 bg-white border-b border-ink-200 flex items-stretch px-2 dark:bg-[#161B22] dark:border-[#222A36]">
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <div
            key={t.id}
            onClick={() => onPick(t.id)}
            className={`relative flex items-center gap-2 px-3 cursor-pointer text-[13px] ${
              isActive ? "tab-active text-up-600 font-semibold" : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <span>{t.label}</span>
            {t.closable !== false && (
              <span
                className="tab-x w-4 h-4 inline-flex items-center justify-center text-ink-400"
                onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              >
                <X size={12} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
