import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || "/processes";

  if (session) {
    redirect(callbackUrl);
  }

  return (
    <div className="relative w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <ThemeToggleButton className="absolute right-4 top-4 h-8 w-8 cursor-pointer text-muted-foreground" />
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Flows &amp; Funds</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your workspace account to continue.
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          await signIn("keycloak", { redirectTo: callbackUrl });
        }}
      >
        <Button type="submit" className="w-full" size="lg">
          Continue with Keycloak
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Default admin: <code>admin@flows-funds.local</code>
        <br />
        You&apos;ll be asked to set a new password on first login.
      </p>
    </div>
  );
}
