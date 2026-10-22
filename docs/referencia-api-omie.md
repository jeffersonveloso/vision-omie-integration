# Referência — API Omie usada pela integração

Base: `https://app.omie.com.br/api/v1/{serviço}/` (variável `OMIE_API_URL`). Todas as chamadas são
`POST` JSON:

```json
{ "call": "IncluirPedido", "app_key": "…", "app_secret": "…", "param": [ { … } ] }
```

Erros chegam como `{ "faultstring": "…", "faultcode": "SOAP-ENV:Client-…" }` e são classificados em
`src/server/infrastructure/omie/omie-error-classifier.ts` (duplicidade, não encontrado, credencial,
limite de consumo, indisponibilidade, regra de negócio).

Implementação: `src/server/infrastructure/omie/{omie-api-client,omie-rate-limiter,omie-gateway}.ts`.

## Envio

| Serviço | Método | Uso |
|---|---|---|
| `geral/clientes` | `UpsertClienteCpfCnpj` | Cria/atualiza o cliente pelo CPF/CNPJ. `codigo_cliente_integracao = VIS-CLI-{codigoCliente}`. O código Omie fica guardado por conta, e o upsert só se repete quando os dados mudam. |
| `produtos/pedido` | `StatusPedido` (`codigo_pedido_integracao`) | Antes de incluir: o pedido já existe? |
| `produtos/pedido` | `IncluirPedido` | Pedido de venda. `cabecalho.codigo_pedido_integracao = VIS-{codigo}`, itens `det[].ide.codigo_item_integracao = {codigo}-{seq}`, `informacoes_adicionais.codigo_categoria` e `codigo_conta_corrente` obrigatórios, `lista_parcelas` quando a condição é "999 — a vista/parcelas informadas". |
| `servicos/os` | `StatusOS` (`cCodIntOS`) | Antes de incluir: a OS já existe? |
| `servicos/os` | `IncluirOS` | Ordem de serviço. `Cabecalho.cCodIntOS = VIS-{codigo}-OS`, `ServicosPrestados[]` (`nCodServico`, `nQtde`, `nValUnit`), `InformacoesAdicionais.cCodCateg` e `nCodCC`, `Parcelas[]`. |

Inclusão que volta como "já cadastrado" é tratada como sucesso: a integração consulta o documento e
vincula o código existente (idempotência mesmo se a resposta da primeira inclusão se perder).

## Acompanhamento

| Serviço | Método | O que a integração lê |
|---|---|---|
| `produtos/pedido` | `StatusPedido` (`codigo_pedido`) | `ListaNfe[]`: `chave_nfe` (44 dígitos) + `protocolo` → autorizada; `numero_nfe`, `serie`, `dt_emissao`, `cancelada`, links `cPdf`/`cXml`; mensagens sem chave → rejeição. |
| `servicos/os` | `StatusOS` (`nCodOS`, `lPdfDest`, `lMsg`) | `ListaRpsNfse[]`: `nNumNfse`, `cCodVerif`, `nRps`, `cSerie`, `dDtEmissao`, `cStatusRps`, `cCancelada`, `dDtCanc`, mensagens; links de PDF/XML. |
| `financas/mf` | `ListarMovimentos` (`nCodOS`, `cNatureza: "R"`) | Títulos a receber do documento: número, parcela, vencimento, valor, saldo e baixas (`nCodBaixa`, data, valor pago, juros, desconto, conta corrente). |

O webhook (`/api/webhooks/omie`) aceita os eventos do Omie apenas como aviso para antecipar essa
consulta. Ele grava o evento e o coloca numa fila (Redis/BullMQ) antes de responder, como o Omie
recomenda: resposta 2xx em até 7 s; sem ela o Omie refaz 3 vezes e depois manda o evento para a fila de
reprocessamento dele (uma tentativa a cada 10 min por até 5 dias), segurando os eventos seguintes do
mesmo aplicativo enquanto isso. Detalhes em [GUIA-IMPLEMENTACAO.md](./GUIA-IMPLEMENTACAO.md#fila-dos-webhooks-do-omie).
Fonte: [Características e recomendações dos webhooks](https://ajuda.omie.com.br/pt-BR/articles/9565655-caracteristicas-e-recomendacoes-dos-webhooks).

## Listas para o mapeamento

Carregadas da base de cada conta (100 por página, guardadas por 15 min, botão "Atualizar" força nova
leitura):

| Lista | Serviço | Método |
|---|---|---|
| Produtos | `geral/produtos` | `ListarProdutosResumido` |
| Serviços | `servicos/servico` | `ListarCadastroServico` |
| Categorias | `geral/categorias` | `ListarCategorias` (sem as totalizadoras) |
| Departamentos | `geral/departamentos` | `ListarDepartamentos` |
| Projetos | `geral/projetos` | `ListarProjetos` |
| Contas correntes | `geral/contacorrente` | `ListarContasCorrentes` |
| Vendedores | `geral/vendedores` | `ListarVendedores` |
| Condições de parcelamento | `geral/parcelas` | `ListarParcelas` |
| Etapas de faturamento | `produtos/etapafat` | `ListarEtapasFaturamento` |
| Cenários de impostos | `geral/cenarios` | `ListarCenarios` |
| Empresas (teste de conexão) | `geral/empresas` | `ListarEmpresas` — confere se o CNPJ da conta é o da base |

## Limites de consumo

* 240 requisições por minuto por IP + App Key + método; 4 simultâneas.
* 10 erros seguidos no mesmo método → bloqueio de 30 min (HTTP 425).
* A mesma consulta com os mesmos parâmetros em menos de 60 s é recusada.
* Até 100 registros por página nas listagens.
* Aplicativos Trial/FIT têm limites menores.

Veja em [GUIA-IMPLEMENTACAO.md](./GUIA-IMPLEMENTACAO.md#7-consumo-da-api-omie) como a integração se
mantém dentro desses limites.

## Fontes

* Documentação dos serviços: `https://app.omie.com.br/api/v1/{serviço}/` (ex.:
  [produtos/pedido](https://app.omie.com.br/api/v1/produtos/pedido/),
  [servicos/os](https://app.omie.com.br/api/v1/servicos/os/),
  [geral/clientes](https://app.omie.com.br/api/v1/geral/clientes/),
  [financas/mf](https://app.omie.com.br/api/v1/financas/mf/))
* [Limites de consumo da API do Omie](https://ajuda.omie.com.br/pt-BR/articles/8237816-entendendo-os-limites-de-consumo-da-api-do-omie)
* [Developer Omie](https://developer.omie.com.br/)
