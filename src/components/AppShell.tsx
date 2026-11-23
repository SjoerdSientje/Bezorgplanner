"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import PlanningAgentChat from "@/components/PlanningAgentChat";

const PUBLIC_PREFIXES = [
  "/login",
  "/reset-wachtwoord",
  "/scan",
  "/systeem/mp-schakelaar-7q3fk9z",
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (isPublic) {
    return <main className="app-main app-main-public">{children}</main>;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <div className="app-scale">{children}</div>
      </main>
      <PlanningAgentChat />
    </div>
  );
}
