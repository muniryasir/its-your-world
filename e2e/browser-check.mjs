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
  await page.getByText("Track your investments").waitFor({ timeout: 30000 });
});

await step("demo user can log in and see dashboard", async () => {
  await page.goto(PUBLIC + "/login", { waitUntil: "load" });
  await page.locator('input[name="username"]').fill("demo");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
  await page.getByText("Long-Term Growth").waitFor({ timeout: 30000 });
});

await step("portfolio page shows holdings", async () => {
  await page.getByText("Long-Term Growth").click();
  await page.getByText("NVIDIA Corp.").waitFor({ timeout: 30000 });
});

if (problems.length) console.log("Non-fatal browser messages:\n" + problems.join("\n"));
console.log("Browser check passed.");
await browser.close();
