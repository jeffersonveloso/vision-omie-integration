# Integração Vision ⇄ Omie

Middleware da Ecolife que leva os pedidos do **Vision ERP** para o **Omie ERP** — cliente, **pedido de
venda** (NF-e) e **ordem de serviço** (NFS-e) — na base Omie certa pelo CNPJ, e devolve ao Vision a
autorização, rejeição e cancelamento das notas, as baixas e os cancelamentos de baixa.

![Fluxo da integração](docs/integration-flow.png)

* **Rastreável:** cada pedido mostra em que etapa está, a causa de qualquer erro com dica de correção e
  todas as chamadas feitas ao Vision e ao Omie (request/response).
* **Reenvio manual:** de um pedido, dos selecionados ou de todos com a mesma causa.
* **Sem duplicidade:** códigos de integração determinísticos e consulta antes de incluir.
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
```

```bash
npm run dev                 # http://localhost:3000
npm run demo:seed           # cadastra 2 contas, regras e de-para e roda coleta + retorno
```

O banco sem `DATABASE_URL` é um PostgreSQL embarcado (PGlite) em `./.data/pglite`. Para apagar os dados
de teste, apague essa pasta.

Os simuladores trazem 7 pedidos que cobrem os casos principais: pedido de produtos, de serviços, misto
(PV + OS), produto sem de-para (erro de mapeamento), CNPJ sem conta (erro de roteamento), NF rejeitada e
pedido com baixa de parcela.

## Ambiente real

```bash
cp .env.example .env.local   # preencha; nunca versione este arquivo
```

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | PostgreSQL 14+ (`docker compose up -d` sobe um local). Vazio = PGlite. |
| `APP_ENCRYPTION_KEY` | 32 bytes em base64 para criptografar os App Secrets. **Obrigatória em produção** e não pode mudar depois do cadastro das contas. |
| `APP_TIMEZONE` | Fuso das datas (padrão `America/Sao_Paulo`). |
| `VISION_API_URL`, `VISION_USERNAME`, `VISION_PASSWORD` | ControllerAPI do Vision. |
| `OMIE_API_URL` | Padrão `https://app.omie.com.br/api/v1`. |
| `OMIE_READ_CACHE_MS` | Cache de consultas idênticas ao Omie (padrão 55000). |
| `SCHEDULER_ENABLED` | Agendador interno (padrão `true`). |
| `OMIE_WEBHOOK_TOKEN` | Ativa `/api/webhooks/omie?token=…` (opcional). |

```bash
npm run build && npm start
```

Primeiros passos na aplicação:

1. **Configurações** — teste a conexão com o Vision, defina as situações elegíveis, o caminho do CNPJ da
   empresa no pedido e as convenções do retorno (veja os pontos a validar no guia, seção 8).
2. **Contas Omie** — cadastre uma conta por base e use *Testar conexão* (confere o CNPJ da base).
3. **Mapeamentos** — defina categoria e conta corrente (obrigatórias no Omie) e preencha os de-para de
   produtos e serviços de cada conta. Use *Simular mapeamento* em um pedido antes de ligar a coleta.
4. **Painel / Pedidos** — acompanhe, corrija e reenvie.

## Scripts

| Comando | Faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Testes unitários e ponta a ponta (simuladores + banco em memória) |
| `npm run typecheck` | Verificação de tipos |
| `npm run simulators` | Simuladores do Vision e do Omie |
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
tests/                    Testes ponta a ponta
docs/                     Guia de implementação e referências das APIs
```

## Segurança

O App Secret é criptografado (AES-256-GCM), nunca volta pela API e é removido dos logs junto com tokens
e senhas. A interface ainda não tem autenticação: publique atrás de VPN ou proxy autenticado.
