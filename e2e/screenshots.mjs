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
async function newPage(width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  await mapToLocal(ctx);
  return ctx.newPage();
}
async function shot(page, name, full = true) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`saved ${name}`);
}
async function signIn(page, user, pass) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
}

// Demo user: world with Portfolio, then the app itself
let page = await newPage();
await signIn(page, "demo", "demo1234");
await page.getByRole("link", { name: "Open Portfolio" }).waitFor({ timeout: 30000 });
await shot(page, "world-demo-desktop");
await page.getByRole("link", { name: "Open Portfolio" }).click();
await page.getByText("Long-Term Growth").waitFor({ timeout: 30000 });
await shot(page, "portfolio-home-desktop");

// New user: empty world, catalog, app gate
page = await newPage();
await page.goto(BASE + "/signup", { waitUntil: "networkidle" });
await page.locator('input[name="username"]').fill("shot" + Date.now());
await page.locator('input[name="password"]').fill("shot-pass-123");
await page.locator('button[type="submit"], input[type="submit"]').first().click();
await page.getByText("Your world is empty").waitFor({ timeout: 30000 });
await shot(page, "world-empty-desktop");
await page.getByRole("button", { name: "Add an app" }).first().click();
await page.getByRole("button", { name: "Add Portfolio" }).waitFor();
await shot(page, "world-catalog-desktop", false);
await page.keyboard.press("Escape");
await page.goto(BASE + "/portfolio", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Add Portfolio to your world" }).waitFor({ timeout: 30000 });
await shot(page, "app-gate-desktop", false);

// Mobile world (demo)
page = await newPage(390, 844);
await signIn(page, "demo", "demo1234");
await page.getByRole("link", { name: "Open Portfolio" }).waitFor({ timeout: 30000 });
await shot(page, "world-demo-mobile");

await browser.close();
