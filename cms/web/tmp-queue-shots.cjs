const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = process.env.SHOT_DIR;
const SESSION = JSON.parse(fs.readFileSync(process.env.SESSION_FILE, "utf8"));
const TOKEN = SESSION.accessToken;

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
  } catch {
    browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((session) => {
    localStorage.setItem("cms.session.v1", JSON.stringify(session));
  }, SESSION);
  const page = await context.newPage();

  async function openDisplay(qs) {
    await page.goto("http://127.0.0.1:4173/display?" + qs + "&cb=" + Date.now(), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(500);
    if (!page.url().includes("/display")) throw new Error("not display " + page.url());
  }

  async function waitVideo(ms) {
    await page.waitForSelector("video.display-media", { timeout: ms });
    await page.waitForFunction(() => {
      const vids = [...document.querySelectorAll("video.display-media")];
      const v = vids.find((el) => getComputedStyle(el).opacity !== "0") || vids[0];
      return v && v.readyState >= 2 && v.videoWidth > 0 && !v.error;
    }, null, { timeout: ms });
    await page.waitForTimeout(700);
  }

  async function frameBox() {
    return page.evaluate(() => {
      const frame = document.querySelector(".display-frame");
      if (!frame) return null;
      const r = frame.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), orient: frame.getAttribute("data-orient") };
    });
  }
  async function activeSrc() {
    return page.evaluate(() => {
      const vids = [...document.querySelectorAll("video.display-media")];
      const v = vids.find((el) => getComputedStyle(el).opacity !== "0") || vids[0];
      return v ? (v.currentSrc || v.src) : null;
    });
  }
  async function completeCurrent() {
    return page.evaluate(async (tok) => {
      const dash = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + tok } }).then((r) => r.json());
      const id = dash.currentlyPlaying && dash.currentlyPlaying.id;
      if (!id) return { ok: false, reason: "no_playing", dash };
      const r = await fetch("/api/queue/player/complete", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        body: JSON.stringify({ queueItemId: id }),
      });
      return { ok: r.ok, status: r.status, prev: dash.currentlyPlaying.title, url: dash.currentlyPlaying.mediaUrl, body: await r.json().catch(() => ({})) };
    }, TOKEN);
  }

  await openDisplay("orient=landscape");
  console.log("url", page.url());
  // Snapshot dashboard before wait
  const pre = await page.evaluate(async (tok) => {
    const d = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + tok } }).then((r) => r.json());
    return { playing: d.currentlyPlaying, queued: (d.upcomingQueue || []).map((x) => x.mediaUrl) };
  }, TOKEN);
  console.log("PRE", JSON.stringify(pre));

  await waitVideo(60000);
  const box1 = await frameBox();
  const src1 = await activeSrc();
  console.log("BOX1", JSON.stringify(box1), src1);
  await page.screenshot({ path: path.join(OUT, "display-queue-ad1.png") });
  console.log("saved ad1");

  console.log("ADV1", JSON.stringify(await completeCurrent()));
  await page.waitForTimeout(1500);
  await waitVideo(60000);
  const box2 = await frameBox();
  const src2 = await activeSrc();
  console.log("BOX2", JSON.stringify(box2), src2);
  await page.screenshot({ path: path.join(OUT, "display-queue-ad2.png") });
  console.log("saved ad2");

  console.log("ADV2", JSON.stringify(await completeCurrent()));
  await page.waitForTimeout(1500);
  await waitVideo(60000);
  const box3 = await frameBox();
  const src3 = await activeSrc();
  console.log("BOX3", JSON.stringify(box3), src3);
  await page.screenshot({ path: path.join(OUT, "display-queue-ad3.png") });
  console.log("saved ad3");

  const same = box1 && box2 && box3 && box1.w === box2.w && box2.w === box3.w && box1.h === box2.h && box2.h === box3.h;
  console.log("SAME_BOX", same, JSON.stringify({ box1, box2, box3 }));

  await openDisplay("ops=1&orient=landscape");
  await waitVideo(30000).catch(() => {});
  await page.screenshot({ path: path.join(OUT, "display-queue-orient-ops.png") });
  console.log("saved ops");

  await openDisplay("ops=1&orient=portrait");
  await waitVideo(30000).catch(() => {});
  console.log("BOX_P", JSON.stringify(await frameBox()));
  await page.screenshot({ path: path.join(OUT, "display-queue-orient-portrait.png") });
  console.log("saved portrait");

  await browser.close();
  if (!same) process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
