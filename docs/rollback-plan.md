# Rollback Plan — Mirror ADMS + Webdriver mode + Tail Daemon

Guia de reversão das mudanças aplicadas em `2026-07-05` pra habilitar
espelhamento de REPs ZKTeco do Soltech pro zekateco-web (via `mirror` do nginx
e/ou daemon de tail-log), modo webdriver e ingestão em batch.

## Servidores envolvidos

| Papel | Host | IP |
|---|---|---|
| **Zekateco-web** (dashboard) | `srv784010.zekateco` | `2.25.208.124` |
| **VPS-DB** (nginx frontend do Soltech + DBs) | `srv1668455.hstgr.cloud` | `72.62.173.226` |
| **VPS-API-2** (backend Soltech Express) | `srv1451747.hstgr.cloud` | `187.77.1.162` |

DNS `api.ultraponto.ultrasistech.com.br` → `72.62.173.226` (VPS-DB).

---

## Rollback 1 — Reverter só o tuning do nginx (worker_connections)

Volta o `worker_connections` do nginx do VPS-DB pro valor original (768). O mirror continua ativo, mas com gargalo — só ~5 dos 108 REPs polando aparecem.

```bash
# No VPS-DB (72.62.173.226):
BAK=$(ls -t /etc/nginx/nginx.conf.bak-* 2>/dev/null | head -1)
if [ -n "$BAK" ]; then
    cp "$BAK" /etc/nginx/nginx.conf
    nginx -t && nginx -s reload && echo "✅ nginx.conf revertido"
else
    echo "❌ Backup não encontrado"
fi
```

---

## Rollback 2 — Desligar o mirror no Soltech (parar de espelhar pra nós)

Volta o vhost `api.ultraponto.ultrasistech.com.br` ao estado antes do mirror. Soltech continua funcionando exatamente como antes, e o zekateco-web deixa de receber tráfego dos REPs.

```bash
# No VPS-DB (72.62.173.226):
BAK=$(ls -t /etc/nginx/sites-available/ultraponto-api.bak-* 2>/dev/null | head -1)
if [ -n "$BAK" ]; then
    cp "$BAK" /etc/nginx/sites-available/ultraponto-api
    nginx -t && nginx -s reload && echo "✅ Mirror desligado — Soltech volta ao normal"
else
    echo "❌ Backup do vhost não encontrado"
fi
```

### Backups disponíveis no VPS-DB (`/etc/nginx/sites-available/`)

- `ultraponto-api.bak-20260705-073616` — **antes de qualquer mirror** (original 100% intacto)
- `ultraponto-api.bak-*-restrict` — versão com mirror em `location /` (antes de restringir a `/iclock/`)
- `ultraponto-api.bak-*-nogetreq` — teste sem espelhar getrequest (abandonado)
- `ultraponto-api.bak-*-getreq-back` — versão que voltou mirror completo com timeouts 1s
- `ultraponto-api.bak-*-resolver` — adicionou `resolver` (tentativa que não resolveu sozinha)
- `ultraponto-api.bak-*-logsub` — adicionou `log_subrequest on` (revelou que mirror já rodava mas silencioso)

Pra voltar ao ponto zero absoluto, restaurar o **`.bak-20260705-073616`**.

---

## Rollback 2.5 — Parar o daemon `zekateco-tail.service` no VPS-DB

Esse daemon lê `/var/log/nginx/access.log` do Soltech e envia batches de SNs vistos pro `POST /api/rep-seen-bulk` do zekateco-web a cada 5s. É o que popula o dashboard com 108+ REPs (o `mirror` do nginx sozinho só entrega ~5 por causa de REPs em loop).

### Parar (sem desinstalar)

```bash
# No VPS-DB (72.62.173.226):
systemctl stop zekateco-tail.service
# Dashboard para de atualizar. Nada quebra no Soltech.
```

### Reiniciar

```bash
systemctl start zekateco-tail.service
systemctl status zekateco-tail.service --no-pager
```

### Ver logs

```bash
# Últimas linhas
journalctl -u zekateco-tail --no-pager -n 20

# Ao vivo
journalctl -u zekateco-tail -f
```

### Desinstalar completamente

```bash
systemctl stop zekateco-tail.service
systemctl disable zekateco-tail.service
rm /etc/systemd/system/zekateco-tail.service
rm -rf /opt/zekateco-tail
systemctl daemon-reload
```

### Ajustar intervalo do batch

Editar `/opt/zekateco-tail/env` e mudar `BATCH_INTERVAL=5` pro valor desejado. Depois:

```bash
systemctl restart zekateco-tail.service
```

### Arquivos instalados no VPS-DB

- `/opt/zekateco-tail/tail-and-post.py` — o daemon Python
- `/opt/zekateco-tail/env` — config (contém o `MIRROR_SECRET`, chmod 600)
- `/etc/systemd/system/zekateco-tail.service` — systemd unit

---

## Rollback 3 — Voltar zekateco-web ao estado antes do webdriver

Desliga o modo webdriver (nginx primary invertido) + volta `READ_ONLY=1` (banner + botões 501).

```bash
# Do Mac (ou qualquer host com SSH pro srv784010):
# 1. READ_ONLY volta a 1
ssh root@2.25.208.124 \
  "sed -i 's/^READ_ONLY=0/READ_ONLY=1/' /opt/zekateco-web/.env && \
   docker compose -f /opt/zekateco-web/docker-compose.yml up -d backend"

# 2. Reverter PR #18 (nginx :8080 backend primary → volta a Soltech primary + mirror pro backend)
cd ~/dev/zekateco-web
git revert <sha-do-PR-18> --no-edit
git push
# Depois aprovar deploy em https://github.com/jose-cleiton/zekateco-web/actions
```

Alternativa mais rápida (sem revert): SSH direto na VPS e restaurar arquivo antigo. Nossa deploy sobrescreve num próximo push, então esse patch é temporário.

---

## Rollback 4 — Limpar todos os 166 REPs importados do dashboard

Se quiser voltar a ver só os REPs que realmente polaram via mirror (remove os importados do DB Soltech que nunca chegaram):

```bash
ssh root@2.25.208.124 "docker exec zekateco-web-db-1 mysql -uroot \
  -p\$(grep MYSQL_ROOT_PASSWORD /opt/zekateco-web/.env | cut -d= -f2) \
  zekateco -e \"DELETE FROM devices WHERE last_seen IS NULL OR ip = '';\""
```

Isso apaga só os importados que nunca polaram. Os que já polaram (têm IP público real do NAT) ficam.

---

## Rollback total (nuclear — volta ao começo de `2026-07-05`)

Ordem correta:

1. **Rollback 2** (mirror desligado no Soltech) — para de vir tráfego pra nós
2. **Rollback 3** (webdriver desligado + read-only) — dashboard volta a ser passivo
3. **Rollback 4** (limpa REPs importados) — dashboard só com `VDE2252800062` do estado antigo

Depois disso, o Soltech opera 100% independente e o zekateco-web fica basicamente inerte (sem receber nada). Zero impacto no ponto eletrônico.

---

## Kill switches por env var (sem editar arquivo)

Do lado do zekateco-web (`srv784010`), 3 variáveis de ambiente em `/opt/zekateco-web/.env`:

| Var | Valor pra desligar | Efeito |
|---|---|---|
| `MIRROR_SECRET` | vazio (`MIRROR_SECRET=`) | `/__mirror/*` retorna 401 pra tudo. Nada é ingerido. |
| `READ_ONLY` | `1` | Todos POST/PUT/DELETE em `/api` viram 501. Botões escondidos. |
| `SOLTECH_GATEWAY_URL` | vazio | `/iclock/getrequest` não consulta Soltech. Só fila local. |

Após alterar `.env`, sempre: `docker compose -f /opt/zekateco-web/docker-compose.yml up -d backend`.

---

## Referências

- Snippet original do mirror aplicado: linhas 70-97 de `/etc/nginx/sites-available/ultraponto-api` no VPS-DB.
- PR do webdriver mode: [#18](https://github.com/jose-cleiton/zekateco-web/pull/18)
- Endpoint `/__mirror/` no nosso lado: `server.ts` linhas 94-116
- Filtro `IGNORED_SNS` (bloqueio SNs de teste): `server.ts` linha 176
