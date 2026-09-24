import { Onboarding } from "@/components/shell/onboarding";

export const metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-lg py-8">
      <Onboarding />
    </div>
  );
}
