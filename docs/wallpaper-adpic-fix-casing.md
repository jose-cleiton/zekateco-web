# Wallpaper (adpic): causa raiz real e correção (DEV-47)

## Resumo

O upload de wallpaper (`DATA UPDATE/DELETE adpic`) falhava com `Return=-11`
("Incorrect data parameter") em 100% das tentativas. A causa raiz **não** era
falta de suporte do firmware — era **case-sensitivity nos nomes dos
parâmetros do comando**. Corrigido. Confirmado funcionando de ponta a ponta,
incluindo verificação física na tela do REP.

## Causa raiz

O PDF genérico do protocolo ("Security PUSH Communication Protocol") documenta
os parâmetros de `adpic` em **minúsculo**:

```
DATA UPDATE adpic index=1	size=454367	extension=jpg	content=...
```

Mas o firmware desse REP (mesmo modelo que já usa `PIN=`, `Type=`, `Index=`,
`Size=`, `Content=` maiúsculo no comando `BIOPHOTO`, que sempre funcionou)
**exige os parâmetros capitalizados** também pra `adpic`:

```
DATA UPDATE adpic Index=1	Size=454367	Extension=jpg	Content=...
```

A versão minúscula é rejeitada com `Return=-11` — um erro genérico o
suficiente ("parâmetro incorreto") pra parecer, à primeira vista, que a
feature inteira não era suportada. Só ficou claro que era especificamente um
problema de *nome* de parâmetro (não da tabela `adpic` em si, nem do
conteúdo/tamanho da imagem) depois de descartar sistematicamente outras
hipóteses:

1. ~~Race condition entre DELETE e UPDATE~~ — serializado (esperar ack do
   DELETE antes do UPDATE), continuou falhando.
2. ~~Estado corrompido no REP~~ — reboot completo, continuou falhando.
3. ~~Tabela errada (`adpic` vs `wallpaper`)~~ — testado `wallpaper`
   diretamente, retornou `Return=-629` ("Incorrect table name", Apêndice
   exclusivo de push communication, `[*,-600]`) — isso na verdade **provou**
   que `adpic` é reconhecido como tabela válida (nunca deu -629), então o
   problema tinha que estar em algum parâmetro dentro do comando.
4. ~~`size=` deveria ser o tamanho do base64, não do buffer original~~ —
   testado, mesmo erro.
5. **Capitalização dos parâmetros** — testado `Index=`/`Size=`/`Extension=`/
   `Content=` (maiúsculo), retornou `Return=0` (sucesso) tanto pra
   `DATA UPDATE adpic` quanto `DATA DELETE adpic`.

## Achado adicional: quando o wallpaper realmente aparece

Mesmo com o comando confirmado (`Return=0`), a imagem **não aparecia** na
tela do REP até desativar "Registro ao toque" (`device.locked=true`). A
própria UI do dashboard já documentava isso corretamente ("Imagens exibidas
no slideshow quando o REP fica ocioso (modo 'Registro ao toque'
desativado)"), mas só percebemos a relevância disso ao testar de ponta a
ponta. Ou seja: o comando grava a imagem no REP independente do modo, mas o
slideshow (exibição) só ativa quando o registro por toque está desligado.

## O que foi corrigido

- `server.ts`: todos os comandos `DATA UPDATE adpic` / `DATA DELETE adpic`
  agora usam parâmetros capitalizados (`Index=`, `Size=`, `Extension=`,
  `Content=`).
- Mantidos (ainda válidos, mesmo não sendo a causa raiz):
  - Rastreamento de status real (pending/success/error) — o pedido original
    do DEV-47, que foi o que permitiu essa investigação ter dados confiáveis
    pra trabalhar em vez de "parece que funcionou".
  - Serialização DELETE→UPDATE — boa prática, evita uma race genuína.
  - Remoção forçada (`?force=true`) pra destravar itens presos em erro —
    continua útil pra qualquer falha real futura (rede, REP offline, etc.).

## Teste de confirmação (2026-07-20)

1. Upload via dashboard real (`POST /api/devices/:sn/media`) → `Return=0`.
2. REP com "Registro ao toque" temporariamente desativado pra teste.
3. **Confirmado visualmente na tela física do REP**: a imagem enviada
   aparece no slideshow.
4. "Registro ao toque" restaurado ao estado original (ativo) logo em
   seguida — a mudança foi só pro teste, não uma alteração permanente de
   comportamento de acesso.

---
**Corrigido em:** 2026-07-20
**Tarefa relacionada:** DEV-47
