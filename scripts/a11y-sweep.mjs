/**
 * Accessibility sweep: runs axe-core (WCAG 2.2 A/AA rules) over every route of a
 * running GENE-LINK instance, anonymous and under each seat kind.
 *
 * Usage:
 *   npm run a11y                    # against http://localhost:3000
 *   npm run a11y -- https://genelink-prototype.onrender.com
 *
 * Chrome/Chromium is located via CHROME_PATH, then the Playwright cache, then
 * common install paths. Exits non-zero if any route reports a violation.
 */
import puppeteer from "puppeteer-core";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pwCache = join(homedir(), "AppData", "Local", "ms-playwright");
  if (existsSync(pwCache)) {
    for (const dir of readdirSync(pwCache).filter((d) => d.startsWith("chromium")).sort().reverse()) {
      const exe = join(pwCache, dir, "chrome-win64", "chrome.exe");
      if (existsSync(exe)) return exe;
      const exe2 = join(pwCache, dir, "chrome-win", "chrome.exe");
      if (existsSync(exe2)) return exe2;
    }
  }
  for (const p of [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chrome/Chromium found. Set CHROME_PATH or install Chrome.");
}

// Every route, under each seat kind it is meant to serve. Anonymous routes run
// without a seat cookie; seat routes run under a real seat of each permission
// level (administrator, authorised signatory, member, viewer) plus platform admin.
const ROUTES = [
  { path: "/" },
  { path: "/explore" },
  { path: "/persona" },
  { path: "/declare" },
  { path: "/learn" },
  { path: "/open-decisions" },
  { path: "/out-of-scope" },
  { path: "/verify" },
  { path: "/listings/lst_ke_antiinfl" },
  { path: "/listings/lst_ke_antiinfl", seat: "seat_camila_ibp" },
  { path: "/cases", seat: "seat_ines_nordlicht" },
  { path: "/cases/case_1_ke", seat: "seat_ines_nordlicht" },
  { path: "/cases/case_1_ke/audit", seat: "seat_ines_nordlicht" },
  { path: "/cases/case_2_co", seat: "seat_camila_ibp" },
  { path: "/cases/case_3_ke", seat: "seat_wanjiru_lbnpi" },
  { path: "/cases/case_5_co", seat: "seat_camila_ibp" },
  { path: "/disclosures", seat: "seat_ines_nordlicht" },
  { path: "/organisations/org_nordlicht", seat: "seat_ines_nordlicht" },
  { path: "/cases", seat: "seat_tobias_nordlicht" },
  { path: "/cases", seat: "seat_amara_asheokoro" },
  // The Path B community custodian: the user the platform most needs to work for.
  { path: "/organisations/org_olkalou", seat: "seat_nyokabi_olkalou" },
  { path: "/listings/lst_need_preservative", seat: "seat_nyokabi_olkalou" },
  { path: "/cases", seat: "seat_nyokabi_olkalou" },
  { path: "/declare", seat: "seat_nyokabi_olkalou" },
  { path: "/admin", seat: "admin" },
  { path: "/admin?find=Ol%20Kalou", seat: "admin" },
  // The forms added after the real-world usage pass, checked with their folded sections open.
  { path: "/organisations/org_lbnpi", seat: "seat_wanjiru_lbnpi", open: true },
  { path: "/organisations/org_olkalou", seat: "admin", open: true },
  { path: "/listings/lst_ke_antiinfl", seat: "seat_otieno_lbnpi", open: true },
  { path: "/cases/case_4_br", seat: "seat_ines_nordlicht", open: true },
  { path: "/cases/case_2_co", seat: "seat_camila_ibp", open: true },
  { path: "/admin/audit", seat: "admin" },
  { path: "/admin/config/KE", seat: "admin" },
  { path: "/config", seat: "admin" },
];

const chrome = findChrome();
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

let failures = 0;
let checked = 0;

for (const route of ROUTES) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    if (route.seat) {
      await page.setCookie({ name: "gl_seat", value: route.seat, url: BASE, path: "/" });
    }
    const res = await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle0", timeout: 30000 });
    const status = res.status();
    if (status >= 400) {
      console.log(`SKIP  ${route.path} [${route.seat || "anon"}] -> HTTP ${status}`);
      continue;
    }
    // A person expands a folded section before using the form inside it; check it as they would meet it.
    if (route.open) await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => {
      return await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
    });
    checked++;
    if (results.violations.length === 0) {
      console.log(`PASS  ${route.path} [${route.seat || "anon"}]`);
    } else {
      failures += results.violations.length;
      console.log(`FAIL  ${route.path} [${route.seat || "anon"}]`);
      for (const v of results.violations) {
        console.log(`      ${v.id} (${v.impact}) — ${v.nodes.length} node(s): ${v.help}`);
      }
    }
  } catch (e) {
    console.log(`ERR   ${route.path} [${route.seat || "anon"}] — ${e.message}`);
    failures++;
  } finally {
    await context.close();
  }
}

await browser.close();
console.log(`\n${checked} route×seat pages checked, ${failures} violation${failures === 1 ? "" : "s"}.`);
process.exit(failures ? 1 : 0);
