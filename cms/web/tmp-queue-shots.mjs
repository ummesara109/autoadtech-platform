const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = process.env.SHOT_DIR;
const TOKEN = process.env.CMS_TOKEN;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // Seed session the same way the app does
  await context.addInitScript((tokenPayload) => {
    // Discover key by probing after load if needed — set several common keys
    const session = {
      accessToken: tokenPayload,
      operator: { autoNumber: "KA01AB1234", displayName: "Operator One" },
      screen: { id: "33333333-3333-4333-8333-333333333331", label: "Rear screen", code: "REAR" },
      vehicle: { autoNumber: "KA01AB1234", displayName: "Fleet Auto 01" },
    };
    localStorage.setItem("cms-session", JSON.stringify(session));
    localStorage.setItem("cms_session", JSON.stringify(session));
    sessionStorage.setItem("cms-session", JSON.stringify(session));
  }, TOKEN);

  const page = await context.newPage();

  // Learn real session key from app source if needed
  await page.goto("http://127.0.0.1:4173/display?orient=landscape&cb=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);

  // If redirected to login, do OTP flow
  if (!page.url().includes("/display")) {
    console.log("login_flow url=" + page.url());
    await page.locator("input").first().fill("KA01AB1234");
    const cont = page.getByRole("button").filter({ hasText: /continue|send|next|otp/i }).first();
    if (await cont.count()) await cont.click();
    else await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const inputs = page.locator("input:visible");
    const n = await inputs.count();
    for (let i = n - 1; i >= 0; i--) {
      const el = inputs.nth(i);
      const ph = ((await el.getAttribute("placeholder")) || "").toLowerCase();
      const nm = ((await el.getAttribute("name")) || "").toLowerCase();
      const im = ((await el.getAttribute("inputmode")) || "").toLowerCase();
      if (ph.includes("otp") || nm.includes("otp") || im === "numeric" || i === n - 1) {
        await el.fill("123456");
        break;
      }
    }
    const verify = page.getByRole("button").filter({ hasText: /verify|login|submit|continue/i }).first();
    if (await verify.count()) await verify.click();
    else await page.keyboard.press("Enter");
    await page.waitForURL(/display/, { timeout: 30000 }).catch(() => {});
    await page.goto("http://127.0.0.1:4173/display?orient=landscape&cb=" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }

  async function waitVideo() {
    await page.waitForSelector("video.display-media", { timeout: 45000 });
    await page.waitForFunction(() => {
      const vids = [...document.querySelectorAll("video.display-media")];
      const active = vids.find((v) => v.classList.contains("opacity-100") || getComputedStyle(v).opacity === "1");
      const v = active || vids[0];
      return v && v.readyState >= 2 && v.videoWidth > 0;
    }, { timeout: 60000 });
    await page.waitForTimeout(800);
  }

  async function frameBox() {
    return page.evaluate(() => {
      const frame = document.querySelector(".display-frame");
      if (!frame) return null;
      const r = frame.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        orient: frame.getAttribute("data-orient"),
        className: frame.className,
      };
    });
  }

  // Shot 1 — PLAYING ad1
  await waitVideo();
  const box1 = await frameBox();
  console.log("BOX1", JSON.stringify(box1));
  const src1 = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video.display-media")];
    const active = vids.find((v) => getComputedStyle(v).opacity !== "0") || vids[0];
    return active ? active.currentSrc || active.src : null;
  });
  console.log("SRC1", src1);
  await page.screenshot({ path: path.join(OUT, "display-queue-ad1.png"), fullPage: false });
  console.log("saved display-queue-ad1.png");

  // Advance via API (injected fetch with bearer)
  async function completeCurrent() {
    return page.evaluate(async (tok) => {
      const dash = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + tok } }).then((r) => r.json());
      const id = dash.currentlyPlaying && dash.currentlyPlaying.id;
      if (!id) return { ok: false, reason: "no_playing", dash };
      const res = await fetch("/api/queue/player/complete", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        body: JSON.stringify({ queueItemId: id }),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body, prevId: id };
    }, TOKEN);
  }

  let adv = await completeCurrent();
  console.log("ADV1", JSON.stringify(adv));
  await page.waitForTimeout(2000);
  await waitVideo();
  const box2 = await frameBox();
  console.log("BOX2", JSON.stringify(box2));
  const src2 = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video.display-media")];
    const active = vids.find((v) => getComputedStyle(v).opacity !== "0") || vids[0];
    return active ? active.currentSrc || active.src : null;
  });
  console.log("SRC2", src2);
  await page.screenshot({ path: path.join(OUT, "display-queue-ad2.png"), fullPage: false });
  console.log("saved display-queue-ad2.png");

  adv = await completeCurrent();
  console.log("ADV2", JSON.stringify(adv));
  await page.waitForTimeout(2000);
  await waitVideo();
  const box3 = await frameBox();
  console.log("BOX3", JSON.stringify(box3));
  const src3 = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video.display-media")];
    const active = vids.find((v) => getComputedStyle(v).opacity !== "0") || vids[0];
    return active ? active.currentSrc || active.src : null;
  });
  console.log("SRC3", src3);
  await page.screenshot({ path: path.join(OUT, "display-queue-ad3.png"), fullPage: false });
  console.log("saved display-queue-ad3.png");

  // Same-size assert
  const same =
    box1 && box2 && box3 &&
    box1.w === box2.w && box2.w === box3.w &&
    box1.h === box2.h && box2.h === box3.h;
  console.log("SAME_BOX", same, JSON.stringify({ box1, box2, box3 }));

  // Ops orient toggle shot (optional evidence) — open ops via URL
  await page.goto("http://127.0.0.1:4173/display?ops=1&orient=landscape&cb=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  await waitVideo().catch(() => {});
  await page.screenshot({ path: path.join(OUT, "display-queue-orient-ops.png"), fullPage: false });
  console.log("saved display-queue-orient-ops.png");

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
