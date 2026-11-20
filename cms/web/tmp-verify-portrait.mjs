import { chromium } from 'playwright';

const SHOT_OUT = process.env.SHOT_OUT;
const SHOT_DESK = process.env.SHOT_DESK;

async function loginAndDisplay(page) {
  const cb = Date.now();
  await page.goto(`http://127.0.0.1:4173/?cb=${cb}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(400);
  await page.locator('input').first().fill('KA01AB1234');
  const continueBtn = page
    .getByRole('button')
    .filter({ hasText: /continue|send|next|otp/i })
    .first();
  if (await continueBtn.count()) await continueBtn.click();
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const inputs = page.locator('input:visible');
  const n = await inputs.count();
  if (n > 0) await inputs.nth(n - 1).fill('123456');
  const verifyBtn = page
    .getByRole('button')
    .filter({ hasText: /verify|login|sign|continue|submit/i })
    .first();
  if (await verifyBtn.count()) await verifyBtn.click();
  else await page.keyboard.press('Enter');
  await page.waitForURL(/\/display/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch({ headless: true });

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await loginAndDisplay(page);
  const root = page.locator('.display-root');
  const hasRotate = await root.evaluate((el) =>
    el.classList.contains('display-root--portrait-rotate'),
  );
  const logoutVisible = await page
    .getByRole('button', { name: /log out/i })
    .isVisible()
    .catch(() => false);
  const stageBox = await page.locator('.display-stage').boundingBox();
  const frameBox = await page
    .locator('.display-frame')
    .boundingBox()
    .catch(() => null);
  const stageTransform = await page
    .locator('.display-stage')
    .evaluate((el) => getComputedStyle(el).transform);
  console.log(
    JSON.stringify(
      { portrait: { hasRotate, logoutVisible, stageBox, frameBox, stageTransform } },
      null,
      2,
    ),
  );
  await page.screenshot({ path: SHOT_OUT, fullPage: false });
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await loginAndDisplay(page);
  const root = page.locator('.display-root');
  const hasRotate = await root.evaluate((el) =>
    el.classList.contains('display-root--portrait-rotate'),
  );
  const logoutVisible = await page
    .getByRole('button', { name: /log out/i })
    .isVisible()
    .catch(() => false);
  console.log(JSON.stringify({ desktop: { hasRotate, logoutVisible } }, null, 2));
  await page.screenshot({ path: SHOT_DESK, fullPage: false });
  await context.close();
}

await browser.close();
console.log('saved', SHOT_OUT, SHOT_DESK);
