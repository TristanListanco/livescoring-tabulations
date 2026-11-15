import { initBotId } from "botid/client/core";

// Vercel BotID's invisible check on the two sign-ins (see src/lib/bot-check.ts): an organizer's password and a judge's
// code, both sent from their page. Only in builds made on Vercel (next.config.ts), whose server confirms it; elsewhere
// (a laptop on the venue Wi-Fi, local development) nothing loads.
if (process.env.NEXT_PUBLIC_BOT_PROTECTION === "on") {
  initBotId({
    protect: [
      { path: "/admin/login", method: "POST" },
      { path: "/judge", method: "POST" },
    ],
  });
}
