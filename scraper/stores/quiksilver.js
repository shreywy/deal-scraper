'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Quiksilver';
const STORE_KEY = 'quiksilver';
const CURRENCY = 'CAD';

// Quiksilver Canada sale page
const SALE_URL = 'https://www.quiksilver.com/en-CA/t/sale';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });
  const page = await context.newPage();

  try {
    onProgress('Quiksilver: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Cookie consent
    try {
      await page.click('#onetrust-accept-btn-handler, [class*="accept"], button[id*="accept"]', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(2000);

    // Scroll to load more products (Boardriders platform uses lazy loading)
    onProgress('Quiksilver: loading products…');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Extract deals via DOM
    onProgress('Quiksilver: extracting deals…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const parsePrice = el => {
        if (!el) return null;
        const text = (el.textContent || '').replace(/[^0-9.]/g, '');
        const n = parseFloat(text);
        return isNaN(n) ? null : n;
      };

      const cards = document.querySelectorAll('[class*="product-card"], [data-testid*="product"], .product-tile, .product-item');
      const seen = new Set();

      return [...cards].map(card => {
        const linkEl = card.querySelector('a[href*="/product/"], a[class*="product-link"], a[class*="name"]');
        const url = linkEl?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        const nameEl = card.querySelector('[class*="product-name"], [class*="title"], h3, h2, .name');
        const name = (nameEl?.textContent || linkEl?.textContent || '').trim();
        if (!name) return null;

        const imgEl = card.querySelector('img[src*="quiksilver"], img');
        const image = imgEl?.src || '';

        // Try multiple price selectors
        const salePriceEl = card.querySelector('[class*="sale-price"], [class*="current-price"], .price-sales, [data-price]');
        const origPriceEl = card.querySelector('[class*="original-price"], [class*="was-price"], .price-standard, [class*="strike"]');

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);

        if (!price || !originalPrice || price >= originalPrice) return null;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;

        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'CAD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`quiksilver-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`Quiksilver: found ${tagged.length} deals`);
    return tagged;

  } finally {
    await context.close();
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
