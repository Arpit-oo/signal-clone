import Link from "next/link";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <main className="app-loading">
      <h1>Page not found</h1>
      <p>This link does not point to an available page.</p>
      <Link href={routes.chats} className="ui-button ui-button-primary">
        Open messenger
      </Link>
      <Link href={routes.home}>Back to home</Link>
    </main>
  );
}
