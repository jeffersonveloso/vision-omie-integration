# Referência — ControllerAPI do Vision (Ecolife)

Fonte: Swagger em `http://179.108.107.158:8000/ControllerAPI/swagger/ui/index` (v1).
Implementação: `src/server/infrastructure/vision/vision-api-client.ts` · tipos em
`src/server/modules/integration/application/ports.ts` · campos em `vision-field-catalog.ts`.

> As credenciais da ControllerAPI ficam **somente** em variáveis de ambiente (`VISION_USERNAME`,
> `VISION_PASSWORD`). Nunca as versione.

## Autenticação

`POST /api/login` — corpo `{ "usuario": "...", "senha": "..." }`.

**Resposta (confirmada em 21/10/2026):** HTTP 200 com o JWT como string JSON, sem envelope:

```json
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6Ik9NSUUiLC..."
```

Claims do token: `unique_name` (usuário), `role` (`Usuario`), `nbf`, `iat` e `exp` — validade de
120 min (`exp − iat = 7200 s`). Assinatura HS256.

A integração envia o token como `Authorization: Bearer <token>`, reutiliza-o pela duração do JWT menos
5 min (contada no relógio local, então diferença de horário entre os servidores não interfere) e, se
receber `401`, faz login de novo e repete a chamada uma vez. Outros formatos (`token`, `access_token`,
`autenticacao`…) continuam aceitos caso a API mude.

## Consultas

### `GET /api/pedido/busca/atualizados`

| Parâmetro | Tipo | Uso na integração |
|---|---|---|
| `dataInicial` | `aaaa-mm-dd` | início da janela incremental |
| `dataFinal` | `aaaa-mm-dd` | hoje (fuso `APP_TIMEZONE`) |
| `codigoStatus` | inteiro, opcional | uma chamada por situação elegível (Configurações › Coleta) |
| `pagina` | inteiro | 1, 2, 3… |
| `linhas` | inteiro | tamanho da página (padrão 50, ajustável em Configurações › Coleta) |

Resposta aceita: array ou envelope (`pedidos`, `dados`, `data`, `items`, `resultado`). De cada item a
integração lê, com tolerância a variações de nome: `codigoPedido`/`codigo`, `dataAtualizacao`,
`codigoEmpresa`, `codigoStatus`, `descricaoStatus`, nome do cliente.

### `GET /api/pedido/busca/{codigoPedido}`

Pedido completo (definição `Pedido`). Grupos principais:

| Grupo | Campos usados por padrão |
|---|---|
| Cabeçalho | `codigo`, `codigoEmpresa`, `razaoSocialEmpresa`, `codigoCliente`, `dataCadastro`, `dataAtualizacao`, `codigoStatus`, `observacao`, `codigoVendedor`, `valorFrete`, `valorDesconto`, `codigoFormaPagamento` |
| `cliente` (`ClienteDomain`) | `razaoSocial`, `nomeFantasia`, `cpfcnpj`, `inscricaoEstadual`, `inscricaoMunicipal`, endereço completo, `cep`, `telefone`, `email`, `entidadeClassificacao.xContribuinte` |
| `itens[]` (`PedidoItem`) | `seq`, `codigoMaterial`, `descricaoMaterial`, `quantidade`, `valorUnitario`, `valorDesconto`, `unidade` |
| `servicos[]` (`PedidoServico`) | `seq`, `codigoServico`, `descricaoServico`, `quantidade`, `valorUnitario`, `valorDesconto` |
| `parcelas[]` (`PedidoParcela`) | `numeroParcela`, `dataVencimento`, `valor`, `codigoParcela` |

Todos os campos (inclusive os que o Vision venha a acrescentar) aparecem na tela de mapeamento.

**CNPJ da empresa:** a definição `Pedido` não tem um campo de CNPJ da empresa faturadora. A integração
procura, nesta ordem: o caminho configurado em *Configurações › Roteamento* (padrão `cnpjEmpresa`),
`empresa.cnpj`, `cnpj`, e a tabela de-para *Empresa Vision → CNPJ* pelo `codigoEmpresa`.

## Retornos (Omie → Vision)

Todos com Bearer token e JSON. `codigoIntegracao` e `tipoNotaFiscal` vêm de *Configurações › Convenções
do retorno*.

| Endpoint | Definição | Quando é enviado |
|---|---|---|
| `POST /api/pedido/nota/autorizacao` | `AutorizacaoNF` — protocolo, número, série, chave, RPS, espécie, modelo, data, PDF/XML em base64, `parcelas[]` | NF-e com chave e protocolo / NFS-e emitida |
| `POST /api/pedido/nota/rejeicao` | `RejeicaoNF` — `codigoMotivoRejeicao`, `descricaoMotivoRejeicao` | Nota rejeitada (motivo novo) |
| `POST /api/pedido/nota/cancelamento` | `CancelamentoNFe` — justificativa, protocolo, dados da nota, XML | Documento cancelado no Omie |
| `POST /api/pedido/parcela/baixa` | `BaixaLancamento` — `codigoParcela`, `dataPagamento`, `valorPagamento`, `valorJuros`, `valorDesconto`, `codigoContaCorrente` | Baixa nova no Omie |
| `POST /api/pedido/parcela/baixa/cancelar` | `ExclusaoBaixa` — `codigoBaixa` | Baixa informada que deixou de existir no Omie |

`parcelas[]` da autorização (`PedidoParcelaNF`) leva `origemParcela`, `numeroDocumento`, `valorParcela`,
`valorSaldo` e, se houver, o boleto em base64. A conta corrente da baixa é traduzida pela tabela de-para
*Conta corrente (retorno de baixas)* ou pelo padrão das configurações.

A parcela do Vision é pareada pelo número da parcela; sem número, pela data de vencimento
(`parcel-matching.ts`).

## Pontos a confirmar com o suporte do Vision

1. ~~Formato da resposta do login~~ (confirmado: JWT em string JSON) e formato de `busca/atualizados`.
2. Campo com o CNPJ da empresa faturadora no pedido completo.
3. Valores de `codigoIntegracao`, `tipoNotaFiscal` (0/1), `tipo`, `especie`, `modelo` e
   `origemParcela` (0/1/2).
4. Se `parcela/baixa` devolve um `codigoBaixa` para uso no cancelamento.
5. Quais `codigoStatus` indicam pedido pronto para faturar.
