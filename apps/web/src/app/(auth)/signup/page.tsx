import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthCard title="Create your account">
      <SignupForm />
    </AuthCard>
  );
}
