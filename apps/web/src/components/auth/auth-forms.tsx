"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

// Plain email/password forms over the Better Auth client. Google sign-in appears when the
// API has it configured (a failed social call is surfaced, never hidden).

const credentials = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});
const signup = credentials.extend({ name: z.string().min(1, "Your name") });

function useAuthError() {
  const [error, setError] = useState<string | null>(null);
  return { error, setError };
}

export function LoginForm({ next = "/inbox" }: { next?: string }) {
  const router = useRouter();
  const { error, setError } = useAuthError();
  const form = useForm<z.infer<typeof credentials>>({ resolver: zodResolver(credentials) });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await authClient.signIn.email({ email: values.email, password: values.password });
    if (error) return setError(error.message ?? "Sign-in failed");
    router.replace(next);
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
      </Field>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={form.formState.isSubmitting} className="mt-1">
        Sign in
      </Button>
      <GoogleButton />
      <div className="flex justify-between text-xs text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">
          Forgot password?
        </Link>
        <Link href="/signup" className="hover:underline">
          Create an account
        </Link>
      </div>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const { error, setError } = useAuthError();
  const form = useForm<z.infer<typeof signup>>({ resolver: zodResolver(signup) });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await authClient.signUp.email(values);
    if (error) return setError(error.message ?? "Sign-up failed");
    router.replace("/onboarding");
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Name" htmlFor="name" error={form.formState.errors.name?.message}>
        <Input id="name" autoComplete="name" {...form.register("name")} />
      </Field>
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={form.formState.isSubmitting} className="mt-1">
        Create account
      </Button>
      <GoogleButton />
      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email() })) });

  const submit = form.handleSubmit(async ({ email }) => {
    // Better Auth redirects to this URL with `?token=` after validating the emailed link.
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await authClient.requestPasswordReset({ email, redirectTo });
    if (error) return toast.error(error.message ?? "Could not send the reset link");
    setSent(true);
  });

  if (sent) return <p className="text-sm">If that address exists, a reset link is on its way.</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const form = useForm<{ password: string }>({
    resolver: zodResolver(z.object({ password: z.string().min(8, "At least 8 characters") })),
  });

  if (!token) {
    return (
      <p className="text-sm text-destructive">
        This reset link is invalid or has expired.{" "}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }

  const submit = form.handleSubmit(async ({ password }) => {
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) return toast.error(error.message ?? "Could not reset the password");
    toast.success("Password updated. Sign in with the new one.");
    router.replace("/login");
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        Set new password
      </Button>
    </form>
  );
}

function GoogleButton() {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/inbox" });
        if (error) toast.error(error.message ?? "Google sign-in is not configured");
      }}
    >
      Continue with Google
    </Button>
  );
}
