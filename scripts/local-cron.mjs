// Local stand-in for Vercel Cron: asks the running dev server to publish due posts once a minute
// and, once an hour, to verify the Instagram / Facebook connections and pull post analytics.
// Usage: npm run cron:local   (with `npm run dev` running; posts only go out while both are running)
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const base = process.env.LOCAL_APP_URL ?? "http://localhost:3000";
const routes = ["/api/cron/publish", "/api/cron/jobs-retry"];

async function tick() {
  for (const route of routes) {
    try {
      const res = await fetch(base + route, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
      const body = await res.json().catch(() => ({}));
      const quiet = res.ok && !["processed", "requeued"].some((k) => Number(body?.[k] ?? body?.result?.[k] ?? 0) > 0);
      if (!quiet) console.log(new Date().toLocaleTimeString(), route, res.status, JSON.stringify(body));
    } catch (err) {
      console.log(new Date().toLocaleTimeString(), route, "unreachable:", err.message);
    }
  }
}
// Hourly jobs. The analytics pulls throttle themselves (recent posts hourly, older ones daily),
// so calling both every hour is safe.
const hourlyRoutes = ["/api/cron/connections", "/api/cron/analytics-hot", "/api/cron/analytics-cold"];
async function hourly() {
  for (const route of hourlyRoutes) {
    try {
      const res = await fetch(base + route, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
      console.log(new Date().toLocaleTimeString(), route, res.status, JSON.stringify(await res.json().catch(() => ({}))));
    } catch (err) {
      console.log(new Date().toLocaleTimeString(), route, "unreachable:", err.message);
    }
  }
}
console.log(`local cron: publishing due posts every 60s; checking connections and pulling analytics hourly on ${base}`);
await tick();
await hourly();
setInterval(tick, 60_000);
setInterval(hourly, 3_600_000);
