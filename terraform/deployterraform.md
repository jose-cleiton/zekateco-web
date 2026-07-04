# Guia didático — quando eu altero algo no código, o que devo fazer?

Beleza — vamos com calma. Imagina que o **`main`** é o site oficial da empresa em produção (o que os REPs e usuários usam agora). Você **nunca mexe direto nele** — porque se quebrar, tudo cai.

Então o fluxo é como escrever um documento importante.

## Analogia

- **`main`** = documento oficial publicado
- **Branch** = uma cópia rascunho pra você mexer
- **PR (Pull Request)** = "Chefe, olha o que mudei, dá pra publicar?"
- **CI** = revisor automático que checa erros óbvios
- **Merge** = "Aprovado, publica"
- **Deploy** = "Publiquei, tá no ar"

Ninguém mexe no documento oficial direto. Você faz uma cópia, mexe, mostra pra alguém revisar, e só então incorpora ao oficial.

---

## Passo a passo — imagine que você quer mudar 1 palavra no dashboard

### PASSO 1 — Puxar o oficial mais recente

Antes de começar, você precisa ter a versão mais atual do `main`:

```bash
cd /Users/jose-cleiton/dev/zekateco-web
git checkout main
git pull
```

**Por que**: pode ser que outro dev (ou você mesmo em outra máquina) tenha mudado algo. Se você não puxar, vai trabalhar numa versão desatualizada.

### PASSO 2 — Criar sua cópia (branch)

```bash
git switch -c fix/muda-nome-botao
```

**Por que**: agora tudo que você editar fica isolado nessa branch chamada `fix/muda-nome-botao`. O `main` não é afetado. Você pode fazer merda à vontade que não quebra produção.

**Nomes de branch por convenção**:

- `feat/nova-funcionalidade` — algo novo
- `fix/nome-do-bug` — corrigindo bug
- `docs/nome-do-doc` — só documentação
- `chore/limpeza` — organização, sem mudança de comportamento

### PASSO 3 — Editar os arquivos

Abre o VS Code (ou IDE que usar) e muda o que precisar mudar. Salva.

### PASSO 4 — Ver o que você mudou

```bash
git status
```

Isso mostra uma lista dos arquivos que você mexeu. Tipo:

```text
modified: src/screens/HomeScreen.tsx
```

### PASSO 5 — Testar se não quebrou algo óbvio

```bash
npm run lint
```

Isso é o **mesmo teste** que o GitHub vai rodar quando você abrir o PR. Se der erro aqui, corrige antes de enviar.

**Por que**: economiza tempo. Se você envia sem testar, vai esperar 2 minutos pro GitHub descobrir o erro que você poderia ter visto em 20 segundos.

### PASSO 6 — Empacotar suas mudanças em um "commit"

```bash
git add .
git commit -m "fix: muda texto do botao Sincronizar"
```

**O que é um commit**: um "snapshot" do estado atual do código com uma mensagem descrevendo o que mudou. É como salvar um arquivo do Word, mas com histórico.

**A mensagem do commit importa muito** — daqui a 6 meses você vai olhar e agradecer ao "eu do passado" por ter escrito bem.

### PASSO 7 — Enviar sua branch pro GitHub

```bash
git push -u origin fix/muda-nome-botao
```

**O que acontece**: sua branch aparece no GitHub, mas ainda não afeta produção. Só existe lá.

### PASSO 8 — Pedir aprovação (abrir PR)

```bash
gh pr create --repo jose-cleiton/zekateco-web --base main \
  --title "fix: muda texto do botao Sincronizar" \
  --body "Trocamos 'Sincronizar' por 'Atualizar' pra ficar mais claro pro usuario."
```

Isso é o **"Chefe, dá uma olhada?"**. O GitHub cria uma página comparando `main` com sua branch, e automaticamente:

- Roda o `npm run lint` na nuvem (2min)
- Roda `docker build` pra ver se compila
- Deixa um botão **"Merge"** cinza até tudo passar

### PASSO 9 — Esperar os checks passarem

Abre o link do PR (o comando `gh pr create` te dá o link). Fica cerca de 2 minutos. Se der tudo verde ✅, o botão **Merge** fica verde.

Se der vermelho ❌, você:

- Corrige o problema no seu computador
- `git add . && git commit -m "..." && git push` — o CI roda de novo automaticamente
- Repete até ficar verde

### PASSO 10 — Mergear (incorporar na versão oficial)

```bash
gh pr merge $(gh pr view --json number -q .number) \
  --repo jose-cleiton/zekateco-web --merge --admin
```

Isso faz "sua mudança agora faz parte do `main`". Ou seja, é a versão oficial agora.

### PASSO 11 — GitHub avisa que quer publicar

Quando a mudança vira parte do `main`, um workflow chamado `deploy.yml` **quer** ir no servidor e atualizar. Mas ele **pausa** e te pergunta: "Posso mesmo publicar?".

Você recebe um email tipo:

> **Deployment awaiting approval** on `zekateco-web`

### PASSO 12 — Autorizar publicação

```bash
# Pega o ID da tarefa pendente
RUN_ID=$(gh run list --repo jose-cleiton/zekateco-web \
  --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')

# Autoriza
ENV_ID=$(gh api /repos/jose-cleiton/zekateco-web/environments \
  -q '.environments[] | select(.name=="production") | .id')

gh api --method POST \
  "/repos/jose-cleiton/zekateco-web/actions/runs/$RUN_ID/pending_deployments" \
  --input - <<EOF
{"environment_ids":[$ENV_ID],"state":"approved","comment":"pode publicar"}
EOF
```

OU simplesmente **clica no email**, vai pra tela do GitHub e clica **Approve**.

### PASSO 13 — Acompanhar a publicação

```bash
gh run watch $RUN_ID --repo jose-cleiton/zekateco-web
```

Isso mostra em tempo real o que tá acontecendo no servidor. Cerca de 40 segundos depois:

```text
✓ Deploy via SSH
✓ Health check — dashboard
✓ Health check — ADMS gateway
```

Pronto — sua mudança tá em produção (<http://2.25.208.124:81>). 🎉

---

## Recapitulando com uma frase por passo

1. **Sincroniza** o oficial
2. **Cria uma cópia** pra mexer
3. **Muda** os arquivos
4. **Confere** o que mudou
5. **Testa** local pra evitar surpresa
6. **Empacota** num commit com mensagem clara
7. **Envia** a cópia pro GitHub
8. **Pede aprovação** (PR)
9. **Espera** os testes automáticos
10. **Mergea** — vira oficial
11. **GitHub pergunta** se pode publicar
12. **Autoriza**
13. **Confirma** que subiu

---

## O que você faz vs. o que é automático

| Ação | Quem faz |
|---|---|
| Sincronizar `main` | Você (1x no começo) |
| Criar branch | Você |
| Editar arquivos | Você |
| Testar local | Você (opcional, mas recomendado) |
| Commitar | Você |
| Push | Você |
| Abrir PR | Você |
| Rodar type-check | Automático |
| Rodar docker build | Automático |
| Comentar plan Terraform | Automático |
| Merge | Você |
| SSH no servidor | Automático |
| Rebuild containers | Automático |
| Health check | Automático |
| **Aprovar publicação** | **Você** (proteção extra) |

Você só faz **3 clicks/comandos importantes**: **criar branch**, **abrir PR**, **aprovar deploy**. O resto é automático.

---

## Casos especiais

### Mudou só docs/README

Não dispara deploy (paths-ignore). Só CI se mexer em código junto. Mesmo assim, abra PR e mergeie normalmente — o histórico fica no Git.

### Mudou algo em `terraform/`

O `terraform-plan.yml` comenta o plan no PR — **leia com atenção** antes de mergear. Após merge:

- **`terraform-apply.yml`** dispara (não o `deploy.yml`)
- Você aprova ele, ele aplica no S3 backend

### Hotfix urgente

Mesmo fluxo, mas título começa com `fix:`. Se for realmente crítico, dá pra pular reviews (você é admin com `--admin` no merge). Nunca mexa direto na `main`.

### Erro no CI

```bash
# Vê o log do último run falhado
gh run view --repo jose-cleiton/zekateco-web --log-failed | head -80

# Corrige local, commita, push (mesmo branch)
git add .
git commit -m "fix: corrige X"
git push
# → o CI roda de novo automaticamente
```

### Rollback (mudança quebrou produção)

```bash
git checkout main
git pull
git revert <sha-do-commit-quebrado>   # cria commit reverso
git push origin main                  # se branch protection permitir
# senão, faz via PR (mesmo fluxo acima)
```

---

## Cheatsheet — os comandos que mais vai usar

```bash
# 1. Nova branch a partir da main atualizada
git checkout main && git pull && git switch -c feat/algo

# 2. Validar antes de push
npm run lint

# 3. Abrir PR
gh pr create --repo jose-cleiton/zekateco-web --base main \
  --title "..." --body "..."

# 4. Merge + aprovar deploy
PR=$(gh pr view --json number -q .number)
gh pr merge $PR --repo jose-cleiton/zekateco-web --merge --admin
```

---

## Regras de ouro

1. **Nunca `git push` direto na `main`** — a branch protection não deixa. Use branch + PR.
2. **Sempre rode `npm run lint` antes de push** — economiza 40s de esperar o CI só pra ver que quebrou.
3. **Commits pequenos e frequentes** > 1 commit gigante — mais fácil reverter.
4. **Descrição no PR importa** — em 6 meses você vai precisar entender por que essa linha existe.
5. **Se falhar no CI, olhe o log ANTES de mexer** — 90% dos erros são bobos (import faltando, tipo errado).
