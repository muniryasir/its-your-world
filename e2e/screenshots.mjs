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
  { name: "signup-desktop", width: 1440, height: 900, path: "/signup", full: false },
  { name: "login-mobile", width: 390, height: 844, path: "/login", full: false },
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
/** Starts a Starfall run and plays a few pieces so the board isn't empty. */
async function playSome(page, pieces) {
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "End run" }).first().waitFor({ timeout: 15000 });
  const moves = [["ArrowLeft", "ArrowLeft", "ArrowLeft"], ["ArrowRight", "ArrowRight", "ArrowRight"], ["ArrowUp"], [], ["ArrowLeft"], ["ArrowRight", "ArrowUp"], ["ArrowLeft", "ArrowLeft", "ArrowUp"]];
  for (let i = 0; i < pieces; i++) {
    for (const key of moves[i % moves.length]) { await page.keyboard.press(key); await page.waitForTimeout(40); }
    await page.keyboard.press("Space");
    await page.waitForTimeout(90);
  }
  await page.keyboard.press("ArrowDown"); // leave a piece falling for the shot
  await page.waitForTimeout(400);
}
/** Ends the run (unless the board already filled up) and waits for the result. */
async function endRun(page) {
  const end = page.getByRole("button", { name: "End run" }).first();
  if (await end.isVisible()) await end.click();
  await page.getByText("Score verified by replay").waitFor({ timeout: 15000 });
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
await page.getByText("Long-Term Growth").click();
await page.getByRole("heading", { name: "Recent activity" }).waitFor({ timeout: 30000 });
await shot(page, "portfolio-detail-desktop");
await page.goto(BASE + "/portfolio/markets?class=oil", { waitUntil: "networkidle" });
await page.getByRole("link", { name: "Brent Crude" }).waitFor({ timeout: 30000 });
await shot(page, "markets-oil-desktop");
await page.goto(BASE + "/portfolio/markets/XAU", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Key stats" }).waitFor({ timeout: 30000 });
await shot(page, "asset-gold-desktop");
// Hover the chart to capture the tooltip
const plot = page.locator(".price-chart svg");
const box = await plot.boundingBox();
if (box) await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
await page.locator('input[name="trade-value"]').fill("5000");
await shot(page, "asset-gold-hover-desktop", false);

// Arcade (owned by the Arcade app): shelf, Starfall mid-game and after a run
await page.goto(BASE + "/arcade", { waitUntil: "networkidle" });
await page.getByRole("link", { name: "Play Starfall" }).waitFor({ timeout: 30000 });
await shot(page, "arcade-home-desktop");
await page.getByRole("link", { name: "Play Starfall" }).click();
await page.getByRole("heading", { name: "Leaderboard" }).waitFor({ timeout: 30000 });
await shot(page, "starfall-ready-desktop");
await playSome(page, 14);
await shot(page, "starfall-playing-desktop", false);
await endRun(page);
await shot(page, "starfall-result-desktop");

// Console Cricket (console/cricket branch): batting practice before and during a delivery
await page.goto(BASE + "/console/cricket", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Face the first ball" }).waitFor({ timeout: 30000 });
await shot(page, "cricket-ready-desktop");
await page.getByRole("button", { name: "Face the first ball" }).click();
await page.getByText("Running in").waitFor({ timeout: 30000 });
await page.waitForTimeout(1200);
await shot(page, "cricket-runup-desktop", false);
await page.locator(".cc-result").waitFor({ timeout: 30000 });
await shot(page, "cricket-result-desktop", false);
// a fixed delivery that the demo batsman drives into the field: the fielding view, then the result
await page.goto(BASE + "/console/cricket?cc-seed=13&cc-demo", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Face the first ball" }).click();
await page.getByText("Z: run").waitFor({ timeout: 40000 });
await shot(page, "cricket-field-desktop", false);
await page.locator(".cc-result").waitFor({ timeout: 40000 });
await shot(page, "cricket-field-result-desktop", false);
// bowling practice: the demo bowler aims, stops the meter and fields the ball himself
await page.goto(BASE + "/console/cricket?cc-mode=bowl&cc-seed=13&cc-demo", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Bowl the first ball" }).waitFor({ timeout: 30000 });
await shot(page, "cricket-bowl-ready-desktop");
await page.getByRole("button", { name: "Bowl the first ball" }).click();
await page.getByText("Z stops the meter").waitFor({ timeout: 30000 });
await page.waitForTimeout(700);
await shot(page, "cricket-bowl-meter-desktop", false);
await page.getByText("Arrows: run to the ball").waitFor({ timeout: 90000 });
await page.waitForTimeout(400);
await shot(page, "cricket-bowl-field-desktop", false);
await page.locator(".cc-result").waitFor({ timeout: 40000 });
await shot(page, "cricket-bowl-result-desktop", false);

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
await page.goto(BASE + "/portfolio/markets?class=crypto", { waitUntil: "networkidle" });
await page.getByRole("link", { name: "Bitcoin" }).waitFor({ timeout: 30000 });
await shot(page, "markets-crypto-mobile");
await page.goto(BASE + "/portfolio/markets/BTC", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Key stats" }).waitFor({ timeout: 30000 });
await shot(page, "asset-bitcoin-mobile");
await page.goto(BASE + "/portfolio", { waitUntil: "networkidle" });
await page.getByText("Crypto Sandbox").click();
await page.getByRole("heading", { name: "Recent activity" }).waitFor({ timeout: 30000 });
await shot(page, "portfolio-detail-mobile");
await page.goto(BASE + "/arcade/starfall", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Leaderboard" }).waitFor({ timeout: 30000 });
await playSome(page, 8);
await shot(page, "starfall-playing-mobile", false);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 0) throw new Error(`Starfall page is ${overflow}px wider than a 390px phone screen`);
await endRun(page);
await shot(page, "starfall-result-mobile");
await page.goto(BASE + "/console/cricket", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Face the first ball" }).click();
await page.getByText("Running in").waitFor({ timeout: 30000 });
await shot(page, "cricket-mobile");
const ccOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (ccOverflow > 0) throw new Error(`Cricket page is ${ccOverflow}px wider than a 390px phone screen`);

await browser.close();
