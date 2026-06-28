// Formata timestamp ISO/UTC vindo do backend pra "28/06/2026 14:37:05" no fuso local.
// Usado nas tabelas de logs/registros pra evitar "2026-06-28T17:37:05.000Z" no UI.
export function formatLogTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
