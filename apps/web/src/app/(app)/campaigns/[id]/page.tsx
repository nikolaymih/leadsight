import { CampaignSettings } from "@/components/campaigns/campaign-settings";

export const metadata = { title: "Campaign settings" };

export default async function CampaignSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignSettings id={id} />;
}
