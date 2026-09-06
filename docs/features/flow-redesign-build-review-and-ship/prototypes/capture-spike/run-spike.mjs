// Plays the human (Node, not Bun — playwright-core hangs under Bun on
// Windows): opens the harness, starts the capture session (the flag
// auto-accepts the one tab-share prompt a real human clicks once), interacts
// with the cross-origin app (clicks + scroll = live state a server-side
// capture could never see), then drag-selects a region.
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = String.raw`C:\Users\user\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`;
const dir = new URL(".", import.meta.url).pathname.slice(1);

// Launch chrome ourselves on a CDP port; new headless (not headless_shell)
// keeps the real compositor, which tab capture needs. Cleanup is by this
// child's pid only — never by process name.
const proc = spawn(CHROME, [
  "--headless=new",
  "--no-first-run",
  "--no-sandbox",
  "--auto-accept-this-tab-capture",
  "--remote-debugging-port=9223",
  `--user-data-dir=${dir}chrome-profile`,
  "--window-size=1280,800",
  "about:blank",
], { stdio: "ignore" });

let browser;
for (let i = 0; ; i++) {
  try {
    browser = await chromium.connectOverCDP("http://localhost:9223", { timeout: 3000 });
    break;
  } catch (e) {
    if (i > 20) throw e;
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log("connected to", browser.version());

try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  page.on("console", (m) => console.log("[page]", m.text()));

  await page.goto("http://localhost:5598/");
  await page.click("#start");
  await page.waitForFunction(() => {
    const t = document.getElementById("state").textContent;
    return t.startsWith("stream live") || t.startsWith("getDisplayMedia failed");
  }, null, { timeout: 15000 });
  console.log("state:", await page.textContent("#state"));

  // Live interaction inside the cross-origin iframe: two clicks, then scroll
  // so BAND BLUE and "clicks: 2" are what the viewport actually shows.
  const app = page.frames().find((f) => f.url().includes("5599"));
  await app.click("body");
  await app.click("body");
  await app.evaluate(() => window.scrollTo(0, 850));
  await page.waitForTimeout(300);

  // Drag-select the top-right area of the panel (counter + band text).
  await page.click("#annotate");
  await page.mouse.move(400, 80);
  await page.mouse.down();
  await page.mouse.move(900, 380, { steps: 10 });
  await page.mouse.up();

  await page.waitForFunction(
    () => document.getElementById("status").textContent.includes("CAPTURE_SAVED"),
    null, { timeout: 10000 },
  );
  console.log("status:", await page.textContent("#status"));
} finally {
  await browser.close().catch(() => {});
  proc.kill();
}
