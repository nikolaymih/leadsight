"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Integrations } from "./integrations";
import { OrgSettings } from "./org-settings";
import { Personal } from "./personal";

const TABS = ["organization", "integrations", "personal"] as const;

export function SettingsView() {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("organization"));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-base font-semibold">Settings</h1>
      <Tabs value={tab} onValueChange={(v) => void setTab(v as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="integrations">Integrations & providers</TabsTrigger>
          <TabsTrigger value="personal">Personal</TabsTrigger>
        </TabsList>
        <TabsContent value="organization" className="mt-4">
          <OrgSettings />
        </TabsContent>
        <TabsContent value="integrations" className="mt-4">
          <Integrations />
        </TabsContent>
        <TabsContent value="personal" className="mt-4">
          <Personal />
        </TabsContent>
      </Tabs>
    </div>
  );
}
