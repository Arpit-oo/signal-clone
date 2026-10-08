import AuthScreen from "@/components/AuthScreen";
import { safeReturnPath } from "@/lib/routes";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthScreen key="signup" mode="signup" nextPath={safeReturnPath(next)} />
  );
}
