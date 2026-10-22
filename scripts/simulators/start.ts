/**
 * Sobe os simuladores do Vision (porta 4010) e do Omie (porta 4020) para desenvolvimento local.
 *   npm run simulators
 * e no .env.local:
 *   VISION_API_URL=http://127.0.0.1:4010/ControllerAPI
 *   VISION_USERNAME=OMIE
 *   VISION_PASSWORD=simulador
 *   OMIE_API_URL=http://127.0.0.1:4020/api/v1
 * Contas Omie para cadastrar na tela "Contas Omie" são exibidas abaixo.
 */
import { COMPANIES } from "./fixtures";
import { startOmieSimulator } from "./omie-simulator";
import { startVisionSimulator } from "./vision-simulator";

async function main() {
  const vision = await startVisionSimulator(Number(process.env.VISION_SIM_PORT ?? 4010));
  const omie = await startOmieSimulator(Number(process.env.OMIE_SIM_PORT ?? 4020));
  omie.rejectIntegrationCodes.add("VIS-14105");
  omie.payIntegrationCodes.add("VIS-14106");

  console.log("\nSimuladores no ar:");
  console.log(`  Vision ControllerAPI → ${vision.url}  (usuário OMIE / senha simulador)`);
  console.log(`  Omie API            → ${omie.url}\n`);
  console.log("Contas Omie para cadastrar:");
  for (const c of [COMPANIES.matriz, COMPANIES.filial]) console.log(`  ${c.name}\n    CNPJ ${c.cnpj}  App Key ${c.appKey}  App Secret ${c.appSecret}`);
  console.log("\nO Vision não manda o CNPJ da empresa: associe as empresas 1 e 2 às contas na tabela \"Empresa Vision → CNPJ\".");
  console.log(`Pedido 14104 é da empresa ${COMPANIES.semConta.code} (sem conta → erro de roteamento). Pedido 14103 usa o material 999 (sem de-para → erro de mapeamento).`);
  console.log("Pedido 14105 terá a NF rejeitada. Pedido 14107 repete o caso real 14062: total que não fecha e sem parcelas.\n");
}

void main();
