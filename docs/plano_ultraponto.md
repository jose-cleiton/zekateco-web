# Plano de Migração: Ultraponto Webserver

> **Objetivo:** Aplicar o redesign do protótipo (`index.html` deste projeto) ao código real `jose-cleiton/zekateco-web`, mantendo **toda a lógica existente** de WebSocket, ADMS, sync de fotos, banco SQLite — trocando apenas a camada visual por: sidebar laranja sólida, topbar Ultraponto, sistema de abas fecháveis e telas modulares (Início, Usuários, Novo/Editar, Registros em tempo real, Info reg, Relatório, Sistema, Turno, Bloqueio).

---

## 1. Premissas

O backend (`server.ts`) e os endpoints **não mudam**:

- `GET /api/devices` · `GET /api/users` · `GET /api/logs` · `GET /api/config`
- `POST /api/users` · `PUT /api/users/:pin` · `DELETE /api/users/:pin`
- `POST /api/users/:pin/photo` · `POST /api/users/:pin/photo/sync`
- `POST /api/sync-users`
- WebSocket em `ws://host/` com mensagens `hello`, `new_log`, `device_update`, `users_updated`, `photo_op_update`, `user_op_update`

A renomeação para **Ultraponto** é apenas de marca (título, logo, copy) — schema do banco fica igual.

---

## 2. Stack alvo

Mantém: React 19 + Vite + TypeScript + Tailwind v4 + lucide-react + motion + recharts + WebSocket nativo.

Adicionar como dependência (já não usa nada externo novo, mas vamos formalizar):

```bash
npm install
```

Não precisa instalar nada novo. Só vamos reorganizar e usar o Tailwind v4 que já está lá.

---

## 3. Estrutura de pastas (nova)

```
src/
  main.tsx
  App.tsx                       # shell + roteamento de abas
  index.css                     # tokens + classes utilitárias
  types.ts                      # Device, User, Log, PhotoSync, Tab
  api.ts                        # fetch helpers (todas as chamadas /api/*)
  ws.ts                         # hook useWebSocket
  state/
    useAppState.ts              # users, devices, logs, config (com WS reativo)
    useTabs.ts                  # gerencia abas abertas + ativa
  components/
    shell/
      TopBar.tsx
      Sidebar.tsx               # menu Ultraponto com grupos
      TabStrip.tsx               # abas fecháveis
    common/
      Icon.tsx                  # wrapper sobre lucide-react
      SoftFrame.tsx             # frame tracejado com tag (Info / Capacidade)
      DateRangeModal.tsx        # modal "Início / Fim" reusado
      Modal.tsx
      Pagination.tsx
      ProgressBar.tsx
  screens/
    HomeScreen.tsx              # Porta · Sincronizar hora · Info · Capacidade
    UsersListScreen.tsx         # tabela com linha expansível
    NewUserScreen.tsx           # formulário 3 colunas + face placeholder
    EditUserScreen.tsx
    RealtimeScreen.tsx          # logs em tempo real (consome WS new_log)
    InfoRegScreen.tsx           # filtro por data
    RelatorioScreen.tsx         # KPIs + tabela
    DispositivoScreen.tsx
    DadosScreen.tsx
    FwScreen.tsx
    TurnoScreen.tsx
    BloqueioScreen.tsx
public/
  ultraponto-icon.svg
  ultraponto-logo.svg
```

---

## 4. Tokens (CSS — `src/index.css`)

Tailwind v4 usa `@theme`. Cole exatamente isto no `index.css`:

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui;

  --color-up-50:  #FFF6EC;
  --color-up-100: #FFE7CC;
  --color-up-200: #FFD09A;
  --color-up-300: #FFB060;
  --color-up-400: #FF9836;
  --color-up-500: #F58220;  /* brand primary */
  --color-up-600: #E5701A;
  --color-up-700: #C45A12;
  --color-up-800: #9A4810;
  --color-up-900: #6F340A;

  --color-ink-50:  #F8FAFC;
  --color-ink-100: #F1F4F8;
  --color-ink-200: #E4E8EE;
  --color-ink-300: #C9D0DA;
  --color-ink-400: #94A0B0;
  --color-ink-500: #6B7280;
  --color-ink-700: #3A4150;
  --color-ink-900: #1B2230;

  --shadow-card: 0 1px 2px rgba(20,28,40,0.04), 0 4px 12px rgba(20,28,40,0.04);
  --radius-card: 12px;
}

/* Dark mode via classe (tema controlado pelo app, não pelo OS) */
@custom-variant dark (&:where(.dark, .dark *));

html, body { background: #F4F6F9; font-family: var(--font-sans); color: var(--color-ink-900); }
html.dark, html.dark body { background: #0E1117; color: #E6E9EE; }
.tabular { font-variant-numeric: tabular-nums; }

.up-sidebar-pattern{
  background-image:
    linear-gradient(135deg, rgba(255,255,255,.10) 0 1px, transparent 1px 14px),
    linear-gradient(135deg, rgba(255,255,255,.06) 0 1px, transparent 1px 22px);
  background-size: 28px 28px, 44px 44px;
}

@layer components {
  .field { @apply w-full h-9 px-3 rounded-md border border-ink-200 bg-white text-[13px] text-ink-900 outline-none transition; }
  .field:focus { border-color: var(--color-up-500); box-shadow: 0 0 0 3px rgba(245,130,32,.18); }
  .label { @apply text-[12px] font-semibold text-ink-700 mb-1 block; }

  .btn        { @apply inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-semibold transition select-none; }
  .btn-primary{ @apply btn bg-up-500 text-white hover:bg-up-600 active:bg-up-700; }
  .btn-soft   { @apply btn bg-up-50 text-up-700 hover:bg-up-100 border border-up-100; }
  .btn-ghost  { @apply btn bg-transparent text-ink-700 hover:bg-ink-100; }
  .btn-danger { @apply btn bg-rose-500 text-white hover:bg-rose-600; }
  .btn-outline{ @apply btn bg-white text-ink-700 border border-ink-200 hover:bg-ink-50; }

  .up-card { @apply bg-white border border-ink-200 rounded-xl shadow-[var(--shadow-card)] dark:bg-[#161B22] dark:border-[#222A36]; }
  .up-th   { @apply px-3 py-2 text-[12px] font-semibold text-white/95 select-none whitespace-nowrap; }
  .up-td   { @apply px-3 py-2 text-[13px] text-ink-700 whitespace-nowrap dark:text-ink-300; }
  .up-row:hover { @apply bg-up-50 dark:bg-[#1B2230]; }

  .soft-frame { @apply border border-dashed border-ink-300 dark:border-[#2A3140] rounded-xl p-[18px] relative; }
  .soft-frame > .soft-tag { @apply absolute -top-3 left-3.5 bg-white dark:bg-[#161B22] px-2.5 py-0.5 border border-ink-300 dark:border-[#2A3140] rounded-full text-[11.5px] font-semibold text-ink-700 dark:text-ink-300; }
}
```

---

## 5. Mapeamento direto: protótipo → código real

Cada arquivo do protótipo deste projeto vira um componente TSX:

| Protótipo (HTML) | Real (`src/`) | O que conecta |
|---|---|---|
| `src/shell.jsx`         → `TopBar`, `Sidebar`, `TabStrip` | `components/shell/*.tsx` | Apenas marcação. Sem lógica de dados. |
| `src/screens-home.jsx`  | `screens/HomeScreen.tsx` | Lê `devices[0]` + `users.length` para "Capacidade" |
| `src/screens-users.jsx` `UsersListScreen` | `screens/UsersListScreen.tsx` | `GET /api/users`. Botões: `onEdit`, `onDelete`, `onNew` chamam `PUT/DELETE/POST` |
| `src/screens-users.jsx` `NewUserScreen` | `screens/NewUserScreen.tsx` | `POST /api/users` (campos: pin=ID, name, privilege, password, card). Campos extras (depto/turno/etc.) ficam só no front por enquanto. |
| `src/screens-users.jsx` `EditUserScreen` | `screens/EditUserScreen.tsx` | `PUT /api/users/:pin` |
| `src/screens-reports.jsx` `RealtimeScreen` | `screens/RealtimeScreen.tsx` | Consome WS `new_log` em vez do `setInterval` mock |
| `src/screens-reports.jsx` `InfoRegScreen` | `screens/InfoRegScreen.tsx` | `GET /api/logs?from=...&to=...` (criar query no server) |
| `src/screens-reports.jsx` `RelatorioScreen` | `screens/RelatorioScreen.tsx` | mesmo endpoint + agregação client-side |
| `src/screens-system.jsx` `DispositivoScreen` | `screens/DispositivoScreen.tsx` | `devices[0]` + `GET /api/config` |
| `src/screens-system.jsx` `DadosScreen` | `screens/DadosScreen.tsx` | placeholder; expor `/api/backup` futuramente |
| `src/screens-system.jsx` `FwScreen` | `screens/FwScreen.tsx` | placeholder |
| `src/screens-misc.jsx` `TurnoScreen`, `BloqueioScreen` | `screens/TurnoScreen.tsx`, `screens/BloqueioScreen.tsx` | placeholders (futuro) |

---

## 6. Hooks essenciais

### `state/useAppState.ts`

```ts
import { useEffect, useState } from "react";

export function useAppState() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [serverPort, setServerPort] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const [d, u, l] = await Promise.all([
      fetch("/api/devices").then(r => r.json()),
      fetch("/api/users").then(r => r.json()),
      fetch("/api/logs").then(r => r.json())
    ]);
    setDevices(d); setUsers(u); setLogs(l);
    fetch("/api/config").then(r => r.json()).then(c => setServerPort(String(c.port)));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // WS reativo — mesma lógica que está em App.tsx hoje
  useEffect(() => { /* copy ws.current setup do App.tsx atual */ }, []);

  return { devices, users, logs, serverPort, loading, refresh: fetchAll, setUsers, setLogs };
}
```

### `state/useTabs.ts`

```ts
type Tab = { id: string; label: string; closable?: boolean };

export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "home", label: "Início", closable: false }]);
  const [active, setActive] = useState("home");

  const open = (id: string, label: string) => {
    setTabs(t => t.some(x => x.id === id) ? t : [...t, { id, label, closable: id !== "home" }]);
    setActive(id);
  };
  const close = (id: string) => {
    setTabs(t => {
      const next = t.filter(x => x.id !== id);
      if (active === id) setActive(next[next.length - 1]?.id || "home");
      return next;
    });
  };
  return { tabs, active, setActive, open, close };
}
```

---

## 7. Prompt para o Claude (cole no chat do projeto zekateco-web)

```text
Vou redesenhar o frontend do zekateco-web para a marca **Ultraponto**, mantendo
toda a lógica de backend (server.ts, endpoints /api/*, WebSocket).

Visual de referência: protótipo já desenhado no projeto "web zecateco" — sidebar
laranja sólida (#F58220), topbar laranja, sistema de abas fecháveis no estilo
ZKTeco/Evo, telas modulares.

PASSOS — execute na ordem:

1. Leia /projects/<ID-DO-PROJETO-PROTOTIPO>/index.html e os arquivos em
   /projects/<ID>/src/ (shell.jsx, screens-home.jsx, screens-users.jsx,
   screens-reports.jsx, screens-system.jsx, screens-misc.jsx, app.jsx, data.jsx).
   Estes têm o markup e estilo finais.

2. NÃO toque em server.ts, photos/, zkteco.db nem package.json (deps).
   Mantenha todos os endpoints e WebSocket atuais funcionando.

3. Refatore src/App.tsx em:
   - src/App.tsx (shell + roteamento de abas)
   - src/components/shell/{TopBar,Sidebar,TabStrip}.tsx
   - src/screens/{Home,UsersList,NewUser,EditUser,Realtime,InfoReg,Relatorio,
     Dispositivo,Dados,Fw,Turno,Bloqueio}Screen.tsx
   - src/state/{useAppState,useTabs}.ts
   - src/types.ts, src/api.ts, src/ws.ts

4. Substitua src/index.css pelos tokens Ultraponto (laranja #F58220 + neutros
   warm) usando @theme do Tailwind v4. Cole o bloco que está na seção 4 do
   arquivo PLANO_ULTRAPONTO.md do projeto protótipo.

5. Ligue os dados reais nas telas:
   - HomeScreen → devices[0] + users.length para Capacidade.
   - UsersListScreen → users do estado, ações chamam POST/PUT/DELETE /api/users.
     Mantenha a foto + sync indicators (photoSync.status: success/pending/error/
     critical) que já existiam.
   - NewUserScreen / EditUserScreen → POST e PUT /api/users[/:pin] com os campos
     que o backend espera (pin, name, privilege, password, card). Os campos
     extras de UI (depto, turno, faixa, grp, modo, aniversário, início, fim)
     ficam só no front por enquanto — anote como TODO no componente.
   - RealtimeScreen → consome WS new_log; concatena no topo de logs (limita 100).
   - InfoRegScreen / RelatorioScreen → modal "Início/Fim" abre por padrão; ao
     enviar, filtra logs no client por período (não precisa criar endpoint novo).
   - DispositivoScreen → devices[0] + serverPort (de /api/config).

6. Mantenha o WebSocket reconnect logic (1.5s) e o boot_id reload que já estão
   em App.tsx atual — só mova para src/ws.ts.

7. Logo: troque <Shield/> por um SVG simples — triângulo/seta laranja + texto
   "Ultraponto". Public/ultraponto-icon.svg pode ser:
   <svg viewBox="0 0 24 24"><path d="M12 3 L21 19 H3 Z" fill="#F58220"/></svg>

8. Tweaks: adicione um toggle dark/light no topbar (ícone moon/sun) que
   alterna document.documentElement.classList.toggle("dark") e persiste em
   localStorage("ultraponto:theme").

9. Title da página: <title>Ultraponto Webserver</title>. Em qualquer copy
   visível "ZKTeco ADMS Dashboard" → "Ultraponto Webserver".

10. Não use motion/react para coisas pesadas; mantenha apenas no <AnimatePresence>
    de modais já existentes.

11. Após cada arquivo grande, rode `npm run lint` (tsc --noEmit) mentalmente —
    todos os tipos devem fechar.

12. Por fim, abra src/App.tsx no preview e tire um screenshot da Home renderizada
    com dados mock (devices=[], users=[]) para validar layout.

NÃO crie endpoints novos nesta passada. Se algo precisar, deixe comentário
// TODO(api): … e seguir.
```

---

## 8. Checklist de aceitação

- [ ] Topbar laranja `#F58220` com logo Ultraponto e ícones tema/busca/mais
- [ ] Sidebar laranja sólida com padrão diagonal sutil + card "Bem vindo"
- [ ] Menu com grupos expansíveis: Início, Usuários, Turno, Relatório, Sistema, Bloqueio
- [ ] Sub-itens corretos em cada grupo (ver protótipo)
- [ ] Abas fecháveis no topo (Início fixa, demais com X)
- [ ] Header da tabela laranja `#F58220` (Usuários, Registros, Info reg, Relatório)
- [ ] Linha expansível na lista de usuários
- [ ] Modal "Início/Fim" em Info reg e Relatório
- [ ] WebSocket continua reconectando e atualizando logs em tempo real
- [ ] Foto de usuário continua exibindo badge de sync (success/pending/error/critical)
- [ ] Toggle de tema claro/escuro funcional, persistido
- [ ] Nenhum endpoint do server.ts foi alterado
- [ ] `npm run dev` sobe sem warning, `npm run build` passa

---

## 9. Próximos passos (fora do escopo desta refatoração)

- Endpoint `/api/logs?from=&to=` para filtragem server-side em Info reg / Relatório.
- Tabelas `turnos` e `bloqueios` no SQLite + endpoints CRUD.
- Campos extras de usuário (depto, turno, etc.) no schema — hoje vivem só no front.
- Backup/restore real em `Sistema → Dados`.
- Upload de firmware real em `Sistema → Atualizar FW`.
