import { chromium } from 'playwright';

const SHOT = process.env.SHOT_OUT;

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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
await loginAndDisplay(page);

const hasRotate = await page
  .locator('.display-root')
  .evaluate((el) => el.classList.contains('display-root--portrait-rotate'));
const hvCount = await page.getByRole('button', { name: /horizontal|vertical/i }).count();
const logoutVisible = await page.getByRole('button', { name: /log out/i }).isVisible();
await page.getByRole('button', { name: /log out/i }).click();
await page.waitForTimeout(300);
const otpTitle = await page.getByText(/enter otp to log out/i).isVisible();
const pinTitle = await page.getByText(/enter pin/i).count();
// Enter demo OTP 123456
for (const d of '123456') {
  await page.getByRole('button', { name: d, exact: true }).click();
}
await page.waitForTimeout(1500);
const onLogin = /\/($|\?)/.test(new URL(page.url()).pathname);
console.log(
  JSON.stringify(
    { hasRotate, hvCount, logoutVisible, otpTitle, pinTitle, onLogin, url: page.url() },
    null,
    2,
  ),
);
await page.screenshot({ path: SHOT, fullPage: false });
await browser.close();
console.log('saved', SHOT);
