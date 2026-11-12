import type { Metadata } from "next";
import { connection } from "next/server";
import { aiEnabled, aiModels } from "@/lib/ai";
import { demoOffsetDays, now } from "@/lib/clock";
import { dbEnabled } from "@/lib/db";
import { getDashboardData } from "@/lib/dashboard-data";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  // Live PayPal data: render per request, not at build time.
  await connection();
  // PayPal is queried up to real now; overdue days are measured from the demo clock (lib/clock.ts).
  const [today, offset] = await Promise.all([now(), demoOffsetDays()]);
  const data = await getDashboardData(new Date(), today);

  // Only the model ids reach the client; the OpenAI key stays on the server (lib/ai.ts).
  return (
    <Dashboard
      data={data}
      clock={dbEnabled() ? { offset, today: today.toISOString().slice(0, 10) } : undefined}
      licenseKey={process.env.AG_STUDIO}
      aiModels={aiEnabled() ? aiModels() : undefined}
    />
  );
}
