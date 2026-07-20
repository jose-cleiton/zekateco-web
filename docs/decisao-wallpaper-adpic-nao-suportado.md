# Decisão: wallpaper (adpic) não funciona nesta linha de REP

## Contexto

DEV-47 pedia rastreamento real de sucesso/falha pro upload de wallpaper (adpic),
já que o dashboard mostrava a imagem como aplicada mesmo quando o REP rejeitava
o comando. Isso foi corrigido (ver commits desta branch) — mas ao testar contra
o REP físico real, descobrimos que o problema é mais fundo: **o wallpaper nunca
funciona nesse hardware**, não importa o que a gente envie.

## Evidência (testado ao vivo, 2026-07-20)

- `Return=-11` ("Incorrect data parameter", Apêndice 1 do protocolo oficial
  ZKTeco) em **toda** tentativa de `DATA UPDATE adpic` e `DATA DELETE adpic`,
  incluindo:
  - Imagem de teste mínima e uma imagem real 480×800 gerada corretamente
  - Slots/índices novos, nunca usados antes
  - Comandos enviados um de cada vez (sem DELETE+UPDATE competindo)
  - Depois de um REBOOT completo do REP (descartando estado corrompido)
- O protocolo **não tem como consultar** o que está armazenado em `adpic` — é
  push-only (diferente de `user`/`biophoto`/`biodata`/`transaction`, que têm
  `DATA QUERY`). Não dá pra "perguntar pro REP" o que ele tem.
- Confirmação final: **o usuário verificou fisicamente a tela do REP — a
  imagem enviada pelo dashboard nunca aparece no slideshow.**

## Conclusão

Este modelo/firmware de REP não implementa o comando `adpic` do protocolo
ADMS, apesar de estar documentado na especificação genérica da ZKTeco (que
cobre múltiplos modelos). Isso é consistente com outras limitações já
documentadas desse mesmo firmware neste projeto (ex: `DATA QUERY
tablename=userpic` também não suportado, retorna `Return=-1`).

## O que fica

- **A correção do DEV-47 continua válida e correta** — o dashboard agora
  reflete a realidade (sucesso ou falha), em vez de mentir. Isso é útil se um
  dia testarmos contra um REP que realmente suporte a feature.
- **Serialização DELETE→UPDATE** (aguardar ack do delete antes de mandar o
  update) foi adicionada como melhoria de robustez geral, mesmo não sendo a
  causa raiz aqui — evita uma race real que poderia acontecer em REPs que
  suportam adpic.
- **Remoção forçada** (`DELETE .../media/:idx?force=true`) foi adicionada pra
  destravar imagens presas permanentemente em "error" quando o REP nunca vai
  confirmar — sem isso, um REP como este deixaria a UI com lixo visual pra
  sempre.

## Se isso vier à tona de novo

Antes de investigar "por que o wallpaper não funciona" outra vez: confira
primeiro se é o mesmo modelo/firmware de REP. Se for, **não é bug do
zekateco-web** — é limitação de hardware/firmware documentada aqui.

---
**Decidido em:** 2026-07-20
**Tarefa relacionada:** DEV-47
