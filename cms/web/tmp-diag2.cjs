const { chromium } = require("playwright");
const fs = require("fs");
const SESSION = JSON.parse(fs.readFileSync("C:/Users/DELL/Downloads/niyoads-cms-display-pwa/web/tmp-session-full.json", "utf8"));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((session) => {
    localStorage.setItem("cms.session.v1", JSON.stringify(session));
  }, SESSION);
  const page = await context.newPage();
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/") || u.includes(".mp4") || u.includes("display")) {
      console.log("RESP", r.status(), u.slice(0, 120));
    }
  });
  await page.goto("http://127.0.0.1:4173/display?orient=landscape&cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(async () => {
    let dash = null;
    try {
      const raw = localStorage.getItem("cms.session.v1");
      const s = raw ? JSON.parse(raw) : null;
      const r = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + (s && s.accessToken) } });
      dash = { status: r.status, body: await r.json() };
    } catch (e) {
      dash = { error: String(e) };
    }
    const vids = [...document.querySelectorAll("video")].map((v) => ({
      src: v.currentSrc || v.src,
      ready: v.readyState,
      network: v.networkState,
      err: v.error && { code: v.error.code, message: v.error.message },
      w: v.videoWidth,
      h: v.videoHeight,
      opacity: getComputedStyle(v).opacity,
    }));
    return {
      url: location.href,
      text: document.body.innerText.slice(0, 300),
      frame: !!document.querySelector(".display-frame"),
      vids,
      dash,
    };
  });
  console.log("INFO", JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
