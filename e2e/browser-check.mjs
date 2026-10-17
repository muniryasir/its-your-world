// Headless-browser check that simulates GitHub Codespaces:
// the page is opened at https://<codespace>-3000.app.github.dev and every
// request to that host is answered by the local dev server on port 3000.
// Prints console errors / failed requests and fails if the app doesn't render.
import { chromium } from "playwright";

const PUBLIC = process.env.PUBLIC_URL ?? "https://ci-smoke-3000.app.github.dev";
const LOCAL = "http://localhost:3000";
const problems = [];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(`${PUBLIC}/**`, async (route) => {
  const url = route.request().url().replace(PUBLIC, LOCAL);
  try {
    const response = await route.fetch({ url, timeout: 30000 });
    await route.fulfill({ response });
  } catch (e) {
    problems.push(`proxy fetch failed: ${url} ${e.message}`);
    await route.abort();
  }
});
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    const body = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 1500)).catch(() => "(no page)");
    console.log(`FAIL  ${name}: ${e.message}\n--- problems ---\n${problems.join("\n")}\n--- html ---\n${body}`);
    await browser.close();
    process.exit(1);
  }
}

await step("landing page renders", async () => {
  const res = await page.goto(PUBLIC + "/", { waitUntil: "load", timeout: 60000 });
  if (!res || res.status() >= 400) throw new Error(`status ${res?.status()}`);
  await page.getByRole("heading", { name: "It's your world." }).waitFor({ timeout: 30000 });
});

await step("login panel explains a wrong password", async () => {
  await page.goto(PUBLIC + "/login", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Welcome back" }).waitFor({ timeout: 30000 });
  await page.locator('input[name="username"]').fill("demo");
  await page.locator('input[name="password"]').fill("wrong-password-1");
  await page.locator('button[type="submit"]').click();
  await page.getByText("don't match").waitFor({ timeout: 15000 });
});

await step("signup panel explains a taken username", async () => {
  await page.goto(PUBLIC + "/signup", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Create your account" }).waitFor({ timeout: 30000 });
  await page.locator('input[name="username"]').fill("demo");
  await page.locator('input[name="password"]').fill("another-pass-1");
  await page.locator('button[type="submit"]').click();
  await page.getByText("That username is taken").waitFor({ timeout: 15000 });
});

await step("demo user logs in to their world", async () => {
  await page.goto(PUBLIC + "/login", { waitUntil: "load" });
  await page.locator('input[name="username"]').fill("demo");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
  await page.getByRole("heading", { name: "Welcome to your world, demo." }).waitFor({ timeout: 30000 });
  if (!page.url().endsWith("/world")) throw new Error("login should land on /world, got " + page.url());
  await page.getByRole("link", { name: "Open Portfolio" }).waitFor({ timeout: 30000 });
});

await step("Portfolio opens from the hub and shows holdings", async () => {
  await page.getByRole("link", { name: "Open Portfolio" }).click();
  await page.getByText("Long-Term Growth").waitFor({ timeout: 30000 });
  await page.getByText("Long-Term Growth").click();
  await page.getByText("NVIDIA Corp.").waitFor({ timeout: 30000 });
});

await step("new user sees an empty world and can add Portfolio", async () => {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto(PUBLIC + "/signup", { waitUntil: "load" });
  const u = "e2e" + Date.now();
  await page.locator('input[name="username"]').fill(u);
  await page.locator('input[name="password"]').fill("e2e-pass-123");
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
  await page.getByText("Your world is empty").waitFor({ timeout: 30000 });

  // An app's page is blocked until it's added
  await page.goto(PUBLIC + "/portfolio", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Add Portfolio to your world" }).waitFor({ timeout: 30000 });

  await page.goto(PUBLIC + "/world", { waitUntil: "load" });
  await page.getByRole("button", { name: "Add an app" }).first().click();
  await page.getByRole("button", { name: "Add Portfolio" }).click();
  await page.getByRole("link", { name: "Open Portfolio" }).waitFor({ timeout: 30000 });
  await page.getByRole("link", { name: "Open Portfolio" }).click();
  await page.getByText("My portfolio").waitFor({ timeout: 30000 });
});

await step("markets list the top 10 of each asset class", async () => {
  await page.goto(PUBLIC + "/portfolio/markets", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Markets" }).waitFor({ timeout: 30000 });
  await page.getByRole("link", { name: "Brent Crude" }).waitFor({ timeout: 30000 });
  await page.getByRole("tab", { name: "Crypto" }).click();
  await page.getByRole("link", { name: "Bitcoin" }).waitFor({ timeout: 30000 });
  const rows = await page.locator(".market-table tbody tr").count();
  if (rows !== 10) throw new Error(`expected 10 crypto rows, got ${rows}`);
});

await step("new user buys and sells Bitcoin with demo cash", async () => {
  await page.getByRole("link", { name: "Bitcoin" }).click();
  await page.getByRole("heading", { name: "Bitcoin", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Key stats" }).waitFor();
  await page.locator('input[name="trade-value"]').fill("2500");
  await page.getByRole("button", { name: "Buy BTC" }).click();
  await page.getByText(/^Bought .* BTC for/).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "Your position" }).waitFor({ timeout: 15000 });

  await page.getByRole("tab", { name: "Sell" }).click();
  await page.getByRole("button", { name: "Sell all" }).click();
  await page.getByText(/^Sold .* BTC for/).waitFor({ timeout: 15000 });

  await page.getByRole("tab", { name: "Buy" }).click();
  await page.locator('input[name="trade-value"]').fill("1000");
  await page.getByRole("button", { name: "Buy BTC" }).click();
  await page.getByText(/^Bought .* BTC for/).waitFor({ timeout: 15000 });
});

await step("the portfolio shows the holding and the trade history", async () => {
  await page.goto(PUBLIC + "/portfolio", { waitUntil: "load" });
  await page.getByText("My portfolio").click();
  await page.getByRole("heading", { name: "Holdings" }).waitFor({ timeout: 30000 });
  await page.locator(".holdings").getByRole("link", { name: "Bitcoin" }).waitFor({ timeout: 30000 });
  await page.getByRole("heading", { name: "Recent activity" }).waitFor();
  const trades = await page.locator(".trades tbody tr").count();
  if (trades !== 3) throw new Error(`expected 3 trades, got ${trades}`);
});

await step("an unknown asset shows a friendly not-found page", async () => {
  await page.goto(PUBLIC + "/portfolio/markets/NOPE", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Asset not found" }).waitFor({ timeout: 30000 });
});

if (problems.length) console.log("Non-fatal browser messages:\n" + problems.join("\n"));
console.log("Browser check passed.");
await browser.close();
