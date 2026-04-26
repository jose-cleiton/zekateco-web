import type { ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

export function Modal({ title, onClose, children, width = "w-[480px]" }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center modal-back bg-ink-900/30 dark:bg-black/50">
      <div className={`up-card ${width} overflow-hidden max-h-[90vh] flex flex-col`}>
        <div className="bg-up-50 dark:bg-[#1B2230] border-b border-up-100 dark:border-[#222A36] px-4 py-3 flex items-center">
          <h3 className="text-up-700 dark:text-up-300 font-semibold text-[14px]">{title}</h3>
          <button className="ml-auto p-1 rounded hover:bg-up-100/60 text-up-700" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="overflow-auto nice-scroll">
          {children}
        </div>
      </div>
    </div>
  );
}
