# Integração Vision ⇄ Omie

Middleware da Ecolife que leva os pedidos do **Vision ERP** para o **Omie ERP** — cliente, **pedido de
venda** (NF-e) e **ordem de serviço** (NFS-e) — na base Omie certa pelo CNPJ, e devolve ao Vision a
autorização, rejeição e cancelamento das notas, as baixas e os cancelamentos de baixa.

![Fluxo da integração](docs/integration-flow.png)

* **Rastreável:** cada pedido mostra em que etapa está, a causa de qualquer erro com dica de correção e
  todas as chamadas feitas ao Vision e ao Omie (request/response).
* **Reenvio manual:** de um pedido, dos selecionados ou de todos com a mesma causa.
* **Sem duplicidade:** códigos de integração determinísticos e consulta antes de incluir.
* **Webhooks do Omie em fila:** a rota grava o evento e responde na hora; um worker (Redis + BullMQ)
  consulta o Omie e devolve ao Vision, com novas tentativas e reprocessamento pela tela.
* **Mapeamento dinâmico:** regras de campo e tabelas de-para por conta, com listas carregadas do Omie
  (categorias, departamentos, projetos, contas correntes, produtos, serviços…).
* **Várias bases Omie:** cadastro de contas com CNPJ, App Key, App Secret (criptografado) e ativação.

Documentação: [Guia de implementação](docs/GUIA-IMPLEMENTACAO.md) ·
[API do Vision](docs/referencia-api-vision.md) · [API do Omie](docs/referencia-api-omie.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · componentes no padrão shadcn/ui sobre
Radix · TanStack Query e Table · Drizzle ORM (PostgreSQL ou PGlite) · croner · zod · Vitest.

Arquitetura limpa com DDD: o domínio e os casos de uso em `src/server` não dependem do Next.js e podem
ser levados para um backend NestJS sem reescrita (veja o guia, seção 3).

## Rodando localmente com os simuladores

Requer Node.js 20.9+.

```bash
npm install
npm run simulators          # Vision em :4010 e Omie em :4020 (deixe rodando)
```

Crie `.env.local`:

```bash
VISION_API_URL=http://127.0.0.1:4010/ControllerAPI
VISION_USERNAME=OMIE
VISION_PASSWORD=simulador
OMIE_API_URL=http://127.0.0.1:4020/api/v1
OMIE_READ_CACHE_MS=0
# Login: primeiro administrador e token que o demo:seed usa
AUTH_ADMIN_EMAIL=admin@ecolife.local
AUTH_ADMIN_PASSWORD=troque-esta-senha
AUTH_API_TOKEN=um-token-qualquer-com-32-caracteres-ou-mais
```

```bash
npm run dev                 # http://localhost:3000 — entre com AUTH_ADMIN_EMAIL / AUTH_ADMIN_PASSWORD
npm run demo:seed           # cadastra 2 contas, regras e de-para e roda coleta + retorno
```

O banco sem `DATABASE_URL` é um PostgreSQL embarcado (PGlite) em `./.data/pglite`. Para apagar os dados
de teste, apague essa pasta.

## Dependências da etapa de testes (Docker)

A pasta `docker/` tem o compose das duas dependências: PostgreSQL 17 (banco da aplicação) e Redis 7.4
(fila dos webhooks do Omie, com AOF e `noeviction`). Requer Docker com Compose v2.

```bash
npm run deps:up             # sobe os dois e espera ficarem saudáveis
```

No `.env.local` da aplicação:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vision_omie
REDIS_URL=redis://localhost:6379
```

As migrações rodam quando a aplicação inicia (ou com `npm run db:migrate`). Os testes automatizados
também podem usar os dois serviços:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
TEST_REDIS_URL=redis://localhost:6379 npm run test:coverage
```

Cada arquivo de teste cria e apaga o próprio banco e usa um prefixo próprio no Redis, sem tocar nos dados
da aplicação.

* `npm run deps:down` para os serviços e mantém os dados; `docker compose -f docker/compose.yaml down -v`
  apaga os dados.
* Usuário, senha, banco e portas mudam em `docker/.env` (modelo em `docker/.env.example`). Num servidor
  compartilhado, troque a senha do PostgreSQL.
* As portas abrem só em `127.0.0.1`, para a aplicação na mesma máquina.
* O CI sobe as dependências por esse mesmo arquivo.

## Aplicação em Docker

`docker/Dockerfile` gera uma imagem só (Next em modo *standalone*, ~100 MB de aplicação) que roda o
servidor web e, com outro comando, o worker da fila. O perfil `app` do compose sobe tudo: PostgreSQL,
Redis, aplicação e worker.

```bash
cp docker/app.env.example docker/app.env   # preencha: chave, Vision, primeiro administrador...
npm run app:up                             # constrói a imagem e espera tudo ficar saudável
```

A aplicação responde em `http://127.0.0.1:3000` (`APP_PORT` e `APP_BIND` em `docker/.env`). Em
servidor, publique por um proxy com HTTPS (Nginx, Caddy, Traefik) — o webhook do Omie precisa de uma URL
pública — e defina `APP_BASE_URL`.

| Comando dentro do contêiner | Faz |
|---|---|
| `node server.js` | Servidor web (padrão da imagem) |
| `node dist/worker.mjs` | Worker da fila dos webhooks (serviço `worker`; dá para escalar: `--scale worker=2`). Saudável enquanto grava o batimento a cada 15 s, o que só acontece com o Redis respondendo. |
| `node dist/migrate.mjs` | Migrações (a aplicação também aplica ao iniciar) |
| `node dist/users-create.mjs --email … --name …` | Cria usuário ou redefine a senha (pede a senha ou lê `NEW_USER_PASSWORD`) |

Exemplo: `docker compose -f docker/compose.yaml --profile app exec app node dist/users-create.mjs --email ana@ecolife.com.br --name "Ana Souza"`.
O CI constrói a imagem, sobe os quatro serviços e confere login, fila no worker e os scripts a cada push.

Os simuladores respondem no mesmo formato da ControllerAPI real (PascalCase, envelope paginado, pedido
sem CNPJ da empresa) e trazem 8 pedidos: produtos, serviços, misto (PV + OS), produto sem de-para (erro
de mapeamento), empresa sem conta Omie (erro de roteamento), NF rejeitada, pedido com baixa de parcela e
uma cópia do caso real 14062 (serviço em KG cujo total não fecha e forma de pagamento "SEM FINANCEIRO").
O `demo:seed` associa as empresas 1 e 2 às contas na tabela *Empresa Vision → CNPJ*.

## Ambiente real

```bash
cp .env.example .env.local   # preencha; nunca versione este arquivo
```

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | PostgreSQL 14+ (`npm run deps:up` sobe PostgreSQL e Redis locais, veja acima). Vazio = PGlite. |
| `APP_ENCRYPTION_KEY` | 32 bytes em base64 para criptografar os App Secrets. **Obrigatória em produção** e não pode mudar depois do cadastro das contas. |
| `APP_TIMEZONE` | Fuso das datas (padrão `America/Sao_Paulo`). |
| `VISION_API_URL`, `VISION_USERNAME`, `VISION_PASSWORD` | ControllerAPI do Vision. |
| `OMIE_API_URL` | Padrão `https://app.omie.com.br/api/v1`. |
| `OMIE_READ_CACHE_MS` | Cache de consultas idênticas ao Omie (padrão 55000). |
| `SYNC_INITIAL_LOOKBACK_DAYS` | Dias que a primeira coleta busca para trás (padrão 7). Valor inicial: depois de salvar Configurações vale o da tela, e "Recomeçar a coleta" aplica de novo. |
| `SCHEDULER_ENABLED` | Agendador interno (padrão `true`). |
| `OMIE_WEBHOOK_TOKEN` | Ativa `/api/webhooks/omie?token=…` (opcional). |
| `REDIS_URL` | Redis da fila de webhooks (BullMQ). Vazio = fila em memória, só para desenvolvimento. |
| `REDIS_PREFIX` | Prefixo das chaves no Redis (padrão `vision-omie`). |
| `WEBHOOK_WORKER_ENABLED` | Worker da fila no servidor web (padrão `true`). `false` + `npm run worker` para rodar à parte. |
| `SLACK_WEBHOOK_URL` | Incoming Webhook do canal de alertas (segredo). Regras em Configurações › Alertas no Slack. |
| `APP_BASE_URL` | Endereço público da aplicação, para os links nos alertas. |
| `AUTH_MODE` | `local` (padrão): login da própria aplicação. `proxy`: quem autentica é um proxy na frente (oauth2-proxy, Cloudflare Access). |
| `AUTH_ADMIN_EMAIL`, `AUTH_ADMIN_PASSWORD`, `AUTH_ADMIN_NAME` | Primeiro administrador, criado no início só se ainda não houver usuários. Depois são ignoradas. |
| `AUTH_API_TOKEN` | Token (32+ caracteres) para cron externo e scripts: `Authorization: Bearer …`. Não cadastra usuários. |
| `AUTH_SESSION_IDLE_HOURS`, `AUTH_SESSION_MAX_DAYS` | Sessão expira sem uso (padrão 12 h) e, mesmo em uso, no limite (padrão 7 dias). |
| `AUTH_COOKIE_SECURE` | Cookie só em HTTPS. Vazio = automático (HTTPS direto ou `X-Forwarded-Proto: https`). |
| `AUTH_USER_HEADER` | Só com `AUTH_MODE=proxy`: cabeçalho com o usuário do proxy, gravado na auditoria (vazio = cabeçalhos comuns). |

```bash
npm run build && npm start
```

Primeiros passos na aplicação:

0. **Entrar** — com `AUTH_ADMIN_EMAIL` e `AUTH_ADMIN_PASSWORD` (ou um usuário criado com
   `npm run users:create`). Em *Usuários*, cadastre a equipe: cada pessoa recebe uma senha temporária e
   escolhe a própria no primeiro acesso.
1. **Configurações** — teste a conexão com o Vision, confira a janela da primeira coleta (7 dias), defina
   as situações elegíveis, as **condições de pagamento** (por forma de pagamento do Vision e a padrão para
   pedidos sem parcelas) e as convenções do retorno (veja os pontos a validar no guia, seção 8).
2. **Contas Omie** — cadastre uma conta por base e use *Testar conexão* (confere o CNPJ da base).
3. **Mapeamentos** — em cada conta, associe o código da empresa do Vision na tabela *Empresa Vision →
   CNPJ* (o pedido do Vision não traz o CNPJ). Defina categoria e conta corrente (obrigatórias no Omie) e
   preencha os de-para de produtos e serviços (serviços pelo `codigoMaterial` do Vision). Use *Simular mapeamento* em um pedido antes de ligar a coleta.
4. **Painel / Pedidos** — acompanhe, corrija e reenvie.

## Scripts

| Comando | Faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Testes unitários, de rotas `/api` e ponta a ponta (simuladores + banco em memória) |
| `npm run test:coverage` | Os mesmos testes com cobertura (falha abaixo do piso em `vitest.config.mts`) |
| `npm run test:e2e` | Testes das telas com Playwright (rode `npm run build` antes) |
| `npm run typecheck` | Verificação de tipos |
| `npm run simulators` | Simuladores do Vision e do Omie |
| `npm run worker` | Worker da fila de webhooks em processo separado (requer `REDIS_URL`) |
| `npm run deps:up` / `deps:down` | Sobe / para o PostgreSQL e o Redis de `docker/compose.yaml` |
| `npm run app:up` / `app:down` | Sobe / para a aplicação inteira em contêineres (perfil `app`) |
| `npm run users:create -- --email … --name … [--role ADMIN\|OPERATOR]` | Cria usuário ou redefine a senha pelo terminal |
| `npm run build:scripts` | Empacota worker, migrações e cadastro de usuário em `dist/` (usado pela imagem) |
| `npm run demo:seed` | Dados de demonstração na aplicação em execução (`APP_URL`, padrão `http://localhost:3000`) |
| `npm run db:generate` | Gera migração a partir de `schema.ts` |
| `npm run db:migrate` | Aplica as migrações (também aplicadas ao iniciar) |

## Estrutura

```
src/app/                  Telas e rotas /api (camada de apresentação)
src/components/           Componentes de interface
src/server/shared/        Kernel do domínio (Result, CNPJ, datas, portas)
src/server/modules/       Contextos: omie-accounts · mappings · integration · settings
src/server/infrastructure Vision, Omie, banco, agendador, HTTP
src/server/container.ts   Composition root
scripts/                  Simuladores, seed de demonstração, migração
tests/                    Testes ponta a ponta e das rotas /api
e2e/                      Testes das telas (Playwright)
docker/                   Dockerfile e compose (PostgreSQL, Redis, aplicação e worker)
.github/workflows/        CI: tipos, testes com cobertura, PostgreSQL real e telas
docs/                     Guia de implementação e referências das APIs
```

## Testes e CI

* **Vitest** (`npm test`): domínio, adaptadores do Vision/Omie/Slack (incluindo caminhos de erro e as
  respostas reais do Vision), agendador, rotas `/api` chamadas como requisições HTTP e o fluxo completo
  contra os simuladores. Backend e rotas acima de 85% das linhas; o CI falha abaixo do piso.
* **PostgreSQL real:** com `TEST_DATABASE_URL`, cada arquivo de teste cria e apaga o próprio banco.
* **Redis real:** com `TEST_REDIS_URL`, a fila de webhooks também é testada com BullMQ.
* **Playwright** (`npm run build && npm run test:e2e`): sobe simuladores e aplicação, entra pela tela de
  login e percorre painel, pedido com erro, simulação, reenvio, configurações, auditoria, cadastro de
  usuário com troca da senha temporária e a lista no celular.
* **GitHub Actions** (`.github/workflows/ci.yml`): quatro jobs a cada push e pull request — tipos e
  cobertura (com Redis); testes no PostgreSQL e no Redis do `docker/compose.yaml`, com as migrações;
  build e telas (com login); imagem Docker com aplicação e worker rodando.

## Segurança e auditoria

O App Secret é criptografado (AES-256-GCM), nunca volta pela API e é removido dos logs junto com tokens
e senhas.

**Login próprio** (`AUTH_MODE=local`, o padrão):

* **Perfis:** administradores fazem tudo e cadastram usuários; operadores fazem todo o resto.
* **Senhas:** guardadas só como hash scrypt, com no mínimo 10 caracteres. Senha temporária (gerada pelo
  administrador ou no cadastro) obriga a troca no primeiro acesso.
* **Bloqueio:** 5 senhas erradas seguidas bloqueiam o acesso por 15 minutos, também para e-mails que não
  existem, para não revelar quem tem conta.
* **Sessão:** cookie `httpOnly` e `SameSite=Lax` (`Secure` em HTTPS) com um token aleatório; no banco fica
  só o SHA-256 dele. Expira sem uso (12 h) e no limite (7 dias). Desativar o usuário, trocar ou redefinir
  a senha encerra as sessões.
* **API:** toda rota `/api` exige login, menos o login, o `health` e o webhook do Omie (que tem o token
  próprio). Cron e scripts usam `AUTH_API_TOKEN`. Alterações vindas de outro site são recusadas.

Com `AUTH_MODE=proxy` a aplicação confia num proxy autenticado na frente (oauth2-proxy, Cloudflare
Access) e grava na auditoria o usuário do cabeçalho; nesse modo o cabeçalho só vale se o proxy o
sobrescrever.

A **Auditoria** registra entradas, tentativas com senha errada, bloqueios, cadastro de usuários,
alterações de contas, mapeamentos e configurações e as ações manuais nos pedidos, com o autor. Toda
resposta da API traz `x-request-id`; o mesmo código aparece nos logs do servidor e na auditoria.
