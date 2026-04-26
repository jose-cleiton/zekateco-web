import type { ReactNode } from "react";

interface Props {
  tag: string;
  children: ReactNode;
  className?: string;
}

export function SoftFrame({ tag, children, className = "" }: Props) {
  return (
    <div className={`soft-frame ${className}`}>
      <span className="soft-tag">{tag}</span>
      {children}
    </div>
  );
}
