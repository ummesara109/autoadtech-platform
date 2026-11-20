const { chromium } = require('playwright');
const path = require('path');

const media =
  process.env.MEDIA_DIR ||
  path.join(
    'C:',
    'Users',
    'DELL',
    'AppData',
    'Local',
    'Cursor',
    'AgentStores',
    'cursor_agent_stores',
    'bc-7f693088-40df-4d4b-a89b-fb28476df074',
    'files',
    'media',
  );

(async () => {
  const browser = await chromium.launch({ headless: true });

  async function loginAndWait(page) {
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.waitForSelector('input', { timeout: 15000 });
    const inputs = page.locator('input');
    const count = await inputs.count();
    let filled = false;
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const type = (await input.getAttribute('type')) || 'text';
      const name =
        ((await input.getAttribute('name')) || '') +
        ((await input.getAttribute('placeholder')) || '') +
        ((await input.getAttribute('id')) || '');
      if (/password|otp|code/i.test(name) || type === 'password') continue;
      if (type === 'text' || type === 'tel' || type === 'search' || !type) {
        await input.fill('KA01AB1234');
        filled = true;
        break;
      }
    }
    if (!filled) throw new Error('Could not find auto number input');
    await page.getByRole('button', { name: /continue|send|lookup|next|otp/i }).first().click();
    await page.waitForTimeout(1000);
    const otpInputs = page.locator('input');
    const otpCount = await otpInputs.count();
    let otpFilled = false;
    for (let i = 0; i < otpCount; i++) {
      const input = otpInputs.nth(i);
      const type = (await input.getAttribute('type')) || 'text';
      const ph =
        ((await input.getAttribute('placeholder')) || '') +
        ((await input.getAttribute('name')) || '') +
        ((await input.getAttribute('id')) || '') +
        ((await input.getAttribute('inputmode')) || '');
      const val = await input.inputValue().catch(() => '');
      if (val && /KA01/i.test(val)) continue;
      if (
        /otp|code|digit|numeric/i.test(ph) ||
        type === 'tel' ||
        type === 'number' ||
        type === 'text' ||
        type === 'password'
      ) {
        await input.fill('123456');
        otpFilled = true;
        break;
      }
    }
    if (!otpFilled) await otpInputs.nth(otpCount - 1).fill('123456');
    await page.getByRole('button', { name: /verify|confirm|continue|sign|enter|display/i }).first().click();
    await page.waitForURL(/display|dashboard/, { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('text=Waiting for advertisement', { timeout: 20000 });
    await page.waitForSelector('text=MG Road, Bengaluru', { timeout: 15000 });
    await page.waitForTimeout(700);
  }

  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await loginAndWait(page);
    await page.screenshot({
      path: path.join(media, 'display-location-desktop.png'),
      fullPage: false,
    });
    console.log('saved display-location-desktop.png');
    await page.close();
  }

  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await loginAndWait(page);
    await page.screenshot({
      path: path.join(media, 'display-location-phone.png'),
      fullPage: false,
    });
    console.log('saved display-location-phone.png');
    await page.close();
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
