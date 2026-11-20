const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("input").first().fill("KA01AB1234");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const inputs = page.locator("input:visible");
  const n = await inputs.count();
  await inputs.nth(n - 1).fill("123456");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.goto("http://127.0.0.1:4173/display?orient=landscape", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")].map((v) => ({
      src: v.currentSrc || v.src,
      ready: v.readyState,
      err: v.error && v.error.code,
      w: v.videoWidth,
      h: v.videoHeight,
      opacity: getComputedStyle(v).opacity,
      classes: v.className,
    }));
    const frame = document.querySelector(".display-frame");
    return {
      url: location.href,
      htmlSnippet: document.body.innerText.slice(0, 200),
      vids,
      frame: frame ? frame.getBoundingClientRect().toJSON() : null,
      frameClass: frame && frame.className,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
