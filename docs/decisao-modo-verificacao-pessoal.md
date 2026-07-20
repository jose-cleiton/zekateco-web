# Decisão: "Modo de verificação pessoal" — por que não funciona por usuário

## Contexto

O campo "Modo de verificação pessoal" existe na UI (UserForm.tsx) mas é decorativo — não persiste no backend, não é enviado pro REP. A pergunta era: por que não implementar isso?

## Resposta técnica

O protocolo ADMS do REP não suporta "modo de verificação **por usuário**" — só por **dispositivo**.

### O que a UI promete
- Permitir que cada usuário tenha um modo diferente (ex: João = 1:N face, Maria = 1:1 face+senha)

### O que o protocolo oferece
- **`SET OPTIONS VerifyStyles=X`** — comando global que muda o modo **de todo o REP**
  - `VerifyStyles=0` → 1:N (qualquer rosto reconhecido abre)
  - `VerifyStyles=1` → 1:1 (exige PIN + rosto)
  - etc.
  
- **Nenhuma variante per-PIN** existe (não há `DATA UPDATE user Pin=X VerifyStyle=Y`)

### Exemplo do problema
Se você configurasse João como "1:1 (PIN+face)" mas Maria como "1:N (só face)":
1. Sistema envia `SET OPTIONS VerifyStyles=1` pro REP (exigir 1:1)
2. João digita PIN + coloca rosto → ✓ entra
3. Maria coloca rosto → ✗ REP exige PIN, que ela não tem
4. Ou você envia `SET OPTIONS VerifyStyles=0` pro REP
5. João digita PIN → ✓ entra (mesmo sem rosto, o REP não exigia)
6. Maria coloca rosto → ✓ entra

Não há como forçar usuários *diferentes* a seguir modos *diferentes* no mesmo REP.

## O que fazer

### Curto prazo (atual)
- **Manter o campo na UI** (já existe, não machuca)
- **Deixa marcado como "não implementado"** — a UI já é clara que é decorativa (não persiste)
- **Documentar essa limitação** (este arquivo)

### Longo prazo (DEV-53)
- Implementar **`SET OPTIONS VerifyStyles=X` por REP** (não por usuário)
  - Tela de config no dashboard: "Modo de verificação para este REP"
  - Dropdown: 1:N / 1:1 / combinado
  - Botão "Sincronizar com REP"
- Remover ou mover o campo "Modo de verificação pessoal" da tela de usuário, já que é config do dispositivo, não do usuário

## Por que está aqui

Este documento existe pra que futuro(a) dev que abra UserForm.tsx saiba: não é "implementação pendente" — é **tecnicamente impossível com o protocolo atual**. Nem tente, nem mude a UI sem avisar.

---
**Decidido em:** 2026-07-20  
**Tarefas relacionadas:** DEV-52 (clock sync), DEV-45, DEV-48
