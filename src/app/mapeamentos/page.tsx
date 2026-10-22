"use client";

import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { FieldRulesTab } from "./field-rules-tab";
import { ValueMapsTab } from "./value-maps-tab";

export default function MappingsPage() {
  return (
    <>
      <PageHeader
        title="Mapeamentos"
        description="Como os dados do Vision viram dados do Omie. As regras dizem de onde vem cada campo; as tabelas de-para traduzem códigos, como o produto 123 do Vision para o produto 4422421 do Omie."
      />
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Regras de campos</TabsTrigger>
          <TabsTrigger value="maps">Tabelas de-para</TabsTrigger>
        </TabsList>
        <TabsContent value="rules">
          <FieldRulesTab />
        </TabsContent>
        <TabsContent value="maps">
          <ValueMapsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
