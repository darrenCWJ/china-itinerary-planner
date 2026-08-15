import { AuthForm } from "@/components/auth/AuthForm";

export default function SignupPage() {
  return (
    <main className="min-h-screen px-4">
      <AuthForm mode="signup" />
    </main>
  );
}
