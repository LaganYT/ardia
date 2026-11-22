import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
const { pickerCall } = await import("./elementPicker.ts");
const { hidingFilter, savablePickedSelector } = await import("./hiddenElements.ts");

const BROWSER_MISSING = !existsSync(chromium.executablePath()) && "Playwright's Chromium isn't installed";

const FIXTURE = `<!doctype html><body>
<main>
  <section data-testid="promo">plain</section>
  <section data-testid="promo/*card">comment opener</section>
  <section data-testid="promo\tcard">tab</section>
  <section data-testid="promo card">line separator</section>
  <section data-testid="promo\u0085card">next line</section>
  <x-ad\u0085box>tag with a next line</x-ad\u0085box>
</main>
</body>`;

const run = (page, code) =>
  page.evaluate((code) => new Promise((resolve) => new Function("post", code)((_, json) => resolve(JSON.parse(json)))), code);

async function pick(page, target) {
  const point = await page.evaluate((target) => {
    const el = [...document.querySelectorAll("main > *")].find((node) => node.textContent === target);
    el.setAttribute("data-fixture-target", "");
    const box = el.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  }, target);
  const result = run(page, pickerCall("start", point));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
  return (await result).selector;
}

const state = (page, selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector("[data-fixture-target]");
    const found = [...document.querySelectorAll(selector)];
    return { unique: found.length === 1 && found[0] === el, hidden: getComputedStyle(el).display === "none" };
  }, selector);

test("a picked element saves as a rule that finds only it, and the page keeps the saved form live", { skip: BROWSER_MISSING, timeout: 30_000 }, async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  for (const target of ["plain", "comment opener", "tab", "line separator", "next line"]) {
    await page.setContent(FIXTURE);
    const picked = await pick(page, target);
    const filter = hidingFilter("example.com", savablePickedSelector(picked) ?? "");
    assert.ok(filter, `${target}: ${JSON.stringify(picked)} saves`);
    const saved = filter.slice(filter.indexOf("##") + 2);
    t.diagnostic(`${target}: ${saved}`);
    if (target === "plain") assert.equal(saved, picked);
    else assert.notEqual(saved, picked);
    if (saved !== picked) {
      await run(page, pickerCall("apply", [saved]));
      await run(page, pickerCall("unhide", [picked]));
    }
    assert.deepEqual(await state(page, saved), { unique: true, hidden: true }, `${target}: the saved form hides it alone`);
    await run(page, pickerCall("unhide", [saved]));
    assert.deepEqual(await state(page, saved), { unique: true, hidden: false }, `${target}: Show brings it back`);
  }
  await page.setContent(FIXTURE);
  const oddTag = await pick(page, "tag with a next line");
  assert.equal(hidingFilter("example.com", savablePickedSelector(oddTag) ?? ""), null, "a tag name the rule can't hold isn't saved");
});
