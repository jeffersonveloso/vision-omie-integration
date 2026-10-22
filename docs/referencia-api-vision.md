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

## Formato das respostas (confirmado em 21/10/2026)

* **Chaves em PascalCase** (`CodigoPedido`, `Cliente.CPFCNPJ`, `Itens`, `Servicos`, `Parcelas`). O
  adaptador converte para camelCase com a regra do Json.NET (`CPFCNPJ` → `cpfcnpj`,
  `XBloquearFaturamento` → `xBloquearFaturamento`). Dentro da integração e na tela de mapeamento os
  caminhos são sempre camelCase (`cliente.cpfcnpj`, `servicos[].codigoMaterial`).
* **Datas sem fuso** (`2026-10-01T08:47:58.453`). O adaptador acrescenta o deslocamento de
  `APP_TIMEZONE` (`…-03:00`), então a hora não muda conforme o fuso do servidor.
* Os corpos enviados nos retornos continuam em camelCase. Isso funciona porque a ControllerAPI
  (ASP.NET) lê o JSON sem diferenciar maiúsculas e minúsculas.

Exemplos completos (com os dados do cliente trocados): `src/server/infrastructure/vision/__fixtures__/`.

## Consultas

### `GET /api/pedido/busca/atualizados`

| Parâmetro | Tipo | Uso na integração |
|---|---|---|
| `dataInicial` | `aaaa-mm-dd` | início da janela incremental |
| `dataFinal` | `aaaa-mm-dd` | hoje (fuso `APP_TIMEZONE`) |
| `codigoStatus` | inteiro, opcional | uma chamada por situação elegível (Configurações › Coleta) |
| `pagina` | inteiro | 1, 2, 3… |
| `linhas` | inteiro | tamanho da página (padrão 50, ajustável em Configurações › Coleta) |

Resposta:

```json
{
  "Pagina": 1, "Linhas": 50, "TotalRegistros": 146, "TotalPaginas": 3,
  "Pedidos": [
    { "CodigoPedido": 14062, "CodigoEmpresa": 1, "DataCadastro": "2026-10-01T08:46:59.87",
      "DataAtualizacao": "2026-10-01T08:47:58.453", "CodigoStatus": 2, "DescricaoStatus": "CONCLUÍDO / FATURADO" }
  ]
}
```

A coleta pagina até `TotalPaginas`. Não depende de a última página vir incompleta, então funciona mesmo
que o Vision ignore o `linhas` pedido. O resumo não traz o cliente: o nome aparece quando o pedido
completo é lido.

### `GET /api/pedido/busca/{codigoPedido}`

Pedido completo. Campos observados (pedido 14062, só serviço):

| Grupo | Campos |
|---|---|
| Cabeçalho | `Codigo`, `CodigoEmpresa`, `RazaoSocialEmpresa`, `CodigoCliente`, `CodigoUsuarioCadastro`, `DataCadastro`, `DataAtualizacao`, `CodigoStatus`, `DescricaoStatus`, `CodigoOrigemRegistro`, `Observacao`, `ObservacaoFrete`, `CodigoTipoOperacao`, `NumeroTipoOperacao`, `CodigoCarteira`, `CodigoCanalVenda`, `CodigoFormaPagamento`, `CodigoTabelaFrete`, `ValorFrete`, `ValorDesconto`, `ValorOutras`, `CodigoVendedor`, `DescricaoVendedor`, `CodigoIdDestinatario`, `CodigoIdOperacaoPresencial`, `CodigoExecucaoEntreEmpresas` |
| `Cliente` | `Codigo`, `RazaoSocial`, `NomeFantasia`, `CPFCNPJ` (formatado), `InscricaoEstadual`, `InscricaoMunicipal`, `IE`, `IM`, `RG`, `Endereco`, `Numero`, `Complemento`, `Letra`, `Bairro`, `Cidade`, `UF`, `CEP`, `CodigoCidade` (código interno do Vision, não IBGE), `Telefone` (`31-3000-0000`, com hífens), `Celular`, `Fax`, `Email`, `CodigoFormaPagamento`/`DescricaoFormaPagamento`, `CodigoCarteira`/`DescricaoCarteira`, `CodigoNivel`/`DescricaoNivel`, `CodigoRegiao`, `XBloquearFaturamento`, `EntidadeClassificacao.{XContribuinte, XContribuinteFinal, XCupomFiscal}` |
| `Servicos[]` | `Codigo` (id da linha), `CodigoItem` (nº da linha), `Seq` (veio 0), `CodigoServico` (veio **0**), `CodigoMaterial` (**código do serviço**), `DescricaoMaterialVenda`, `Quantidade`, `ValorUnitario`, `ValorTotal`, `PorcentagemDesconto`, `SiglaUnidadeVenda` (`KG`), `CodigoCME`/`DescricaoCME` |
| `Itens[]` | mesma estrutura de linha (o exemplo veio vazio) |
| `Parcelas[]` | veio vazio no pedido com forma de pagamento `SEM FINANCEIRO` |

Todos os campos, inclusive os que o Vision vier a acrescentar, aparecem na tela de mapeamento.

### O que o formato real mudou na integração

| Observação | Tratamento |
|---|---|
| O pedido **não traz o CNPJ da empresa**, só `CodigoEmpresa` e `RazaoSocialEmpresa` | Roteamento pela tabela *Empresa Vision → CNPJ*: em cada conta Omie, cadastre o código da empresa que ela atende (ex.: `1` na conta da Ecolife Soluções Ambientais). Os caminhos de CNPJ em Configurações continuam valendo se o Vision passar a mandar o campo. |
| Serviço vem com `CodigoServico: 0`; o código está em `CodigoMaterial` | O de-para *Serviços* usa `codigoMaterial` por padrão. |
| `Seq: 0` nas linhas | O código de integração do item usa a posição da linha quando `Seq` é 0. |
| `271 × 5,18 = 1.403,78`, mas `ValorTotal = 1.408,70` | Checagem antes do envio. Padrão: bloqueia com a diferença explicada. Em Configurações dá para escolher recalcular a quantidade (271,9498) ou o valor unitário. O Swagger declara `Quantidade` como inteiro, então a hipótese mais provável é que a quantidade em kg esteja sendo truncada (271,95 × 5,18 = 1.408,70). |
| `SEM FINANCEIRO` sem parcelas | A condição 999 (parcelas informadas) exige parcelas: o pedido para com a pendência "Condição de pagamento" até ser mapeada uma condição do Omie para esses casos. Sem parcelas no Vision não há retorno de baixas, e o acompanhamento encerra quando a nota é informada. |
| `Complemento: "N/A"` | Vai como está para o Omie. Se não quiser, crie uma regra para o campo Complemento. |

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

1. ✅ Formato do login e de `busca/atualizados` — confirmados (veja acima).
2. ✅ CNPJ da empresa no pedido — não existe; roteamento pelo código da empresa. Se o Vision puder
   incluir o CNPJ, o roteamento passa a usá-lo sem mudança de código.
3. **`Quantidade` inteira?** No pedido 14062, `Quantidade × ValorUnitario` não fecha o `ValorTotal`.
   Pedir que `Quantidade` (e `ValorUnitario`) venham com as casas decimais reais.
4. **Situações elegíveis:** o exemplo veio com `CodigoStatus 2 — CONCLUÍDO / FATURADO`. Confirmar quais
   situações significam "pronto para faturar no Omie" e se pedidos já faturados por outro caminho devem
   ficar de fora.
5. Valores de `codigoIntegracao`, `tipoNotaFiscal` (0/1), `tipo`, `especie`, `modelo` e
   `origemParcela` (0/1/2).
6. Se `parcela/baixa` devolve um `codigoBaixa` para uso no cancelamento.
7. Se o parâmetro `linhas` é respeitado (o exemplo devolveu `Linhas: 50`).
