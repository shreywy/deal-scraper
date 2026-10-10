'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Foot Locker';
const STORE_KEY = 'footlocker';
const SALE_URL = 'https://www.footlocker.ca/en/category/sale.html';
const MAX_PAGES = 10;

async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({ locale: 'en-CA', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const deals = [];
  const seen = new Set();
  try {
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    for (let n = 0; n < MAX_PAGES; n++) {
      // Deep links (?currentPage=N) render page 0 server-side, so page via the in-app links instead
      if (n > 0) {
        const first = await page.$eval('[data-testid="ProductCardV3"] a', a => a.href).catch(() => '');
        const next = await page.$(`a[href*="currentPage=${n}"]`);
        if (!next) break;
        await next.click();
        await page.waitForFunction(f => document.querySelector('[data-testid="ProductCardV3"] a')?.href !== f, first, { timeout: 15000 }).catch(() => {});
      }
      await page.waitForSelector('[data-testid="ProductCardV3"]', { timeout: 15000 }).catch(() => {});
      const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="ProductCardV3"]')].map(card => {
        const link = card.querySelector('a[href*="/product/"]');
        // sr-only text: "This item is on sale. Price dropped from $165.00 to $99.99"
        const m = (card.querySelector('[data-testid="Sale"]')?.textContent || '').replace(/,/g, '').match(/from \$([\d.]+) to \$([\d.]+)/);
        let name = '';
        try { name = JSON.parse(link?.dataset.productcard || '{}').name || ''; } catch (_) {}
        return link && m && { url: link.href, name, originalPrice: +m[1], price: +m[2], image: card.querySelector('img')?.src || '' };
      }).filter(Boolean));
      const fresh = cards.filter(c => !seen.has(c.url));
      if (!fresh.length) break;
      for (const c of fresh) {
        seen.add(c.url);
        if (!c.name || !(c.originalPrice > c.price)) continue;
        deals.push({
          id: `${STORE_KEY}-${c.url.match(/\/(\w+)\.html/)?.[1] || seen.size}`,
          store: STORE_NAME, storeKey: STORE_KEY, name: c.name, url: c.url, image: c.image,
          price: c.price, originalPrice: c.originalPrice,
          discount: Math.round((1 - c.price / c.originalPrice) * 100),
          currency: 'CAD', priceCAD: c.price, originalPriceCAD: c.originalPrice,
          tags: tag({ name: c.name }),
          scrapedAt: new Date().toISOString(),
        });
      }
      onProgress(`${STORE_NAME}: ${deals.length} deals after page ${n + 1}`);
    }
  } finally {
    await context.close();
  }
  return deals;
}

module.exports = { scrape, STORE_KEY };
