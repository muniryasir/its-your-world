// Takes screenshots of key pages for design review (run by CI).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

// CI runs the app with simulated Codespaces settings, so pages are opened at
// the codespace-style URL and every request is answered by the local server.
const BASE = process.env.PUBLIC_URL ?? "https://ci-smoke-3000.app.github.dev";
const LOCAL = "http://localhost:3000";
async function mapToLocal(ctx) {
  await ctx.route(`${BASE}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(BASE, LOCAL), timeout: 30000 });
    await route.fulfill({ response });
  });
}
const OUT = process.env.OUT_DIR ?? "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [
  { name: "home-desktop", width: 1440, height: 900, path: "/", full: true },
  { name: "home-mobile", width: 390, height: 844, path: "/", full: true },
  { name: "login-desktop", width: 1440, height: 900, path: "/login", full: false },
];

for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  await mapToLocal(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + s.path, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500); // fonts
  await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: s.full });
  console.log(`saved ${s.name}`);
  await ctx.close();
}

// Logged-in views
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await mapToLocal(ctx);
const page = await ctx.newPage();
await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await page.locator('input[name="username"]').fill("demo");
await page.locator('input[name="password"]').fill("demo1234");
await page.locator('button[type="submit"], input[type="submit"]').first().click();
await page.getByText("Long-Term Growth").waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/dashboard-desktop.png`, fullPage: true });
console.log("saved dashboard-desktop");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/home-signed-in-desktop.png`, fullPage: false });
console.log("saved home-signed-in-desktop");
await browser.close();
