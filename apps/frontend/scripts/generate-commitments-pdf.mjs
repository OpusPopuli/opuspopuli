/**
 * Renders /our-commitments to a grant-ready PDF (#754).
 *
 * Usage:
 *   1. Start the frontend dev server (or point BASE_URL at a deployed one):
 *        cd apps/frontend && pnpm dev
 *   2. From `apps/frontend`, in another terminal:
 *        pnpm pdf:commitments
 *      Or with an explicit base URL:
 *        BASE_URL=https://opuspopuli.org pnpm pdf:commitments
 *   3. The PDF is written to `docs/legal/commitments-<version>.pdf` in the
 *      repo. Commit the artifact alongside any change that bumps
 *      `COMMITMENTS_VERSION`.
 *
 * Implementation note: this uses the Playwright API directly (not
 * `playwright test`) because we want a single deterministic PDF, not a
 * test run with retries / projects / matrices. Chromium-only — the PDF
 * API is not supported on Firefox / WebKit.
 *
 * The version is read from `lib/commitments-version.json` — the same
 * file `lib/commitments.ts` imports — so the script doesn't need a
 * TypeScript runner and can't drift from what the page displays.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION_FILE = resolve(
  __dirname,
  "..",
  "lib",
  "commitments-version.json",
);
const { version: VERSION } = JSON.parse(readFileSync(VERSION_FILE, "utf8"));
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3200";
const OUTPUT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "legal",
  `commitments-v${VERSION}.pdf`,
);

async function main() {
  const outDir = dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const url = `${BASE_URL}/our-commitments`;
  console.log(`Rendering ${url} → ${OUTPUT_PATH}`);

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="commitments-version-line"]', {
    timeout: 10000,
  });

  await page.pdf({
    path: OUTPUT_PATH,
    format: "Letter",
    printBackground: true,
    margin: {
      top: "0.75in",
      bottom: "0.75in",
      left: "0.75in",
      right: "0.75in",
    },
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="font-size:9px;width:100%;text-align:center;color:#666;">Opus Populi — Public Ethical Commitments</div>',
    footerTemplate:
      '<div style="font-size:9px;width:100%;text-align:center;color:#666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });

  await browser.close();
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
