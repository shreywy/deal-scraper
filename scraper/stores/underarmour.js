'use strict';

const { tag } = require('../tagger');

const SALE_URL = 'https://www.underarmour.ca/en-ca/c/sale/';
const STORE_NAME = 'Under Armour';
const STORE_KEY = 'underarmour';

// UA uses Salesforce Commerce Cloud (SFCC). Products load via JS after
// the initial page render. We use Playwright to wait for the grid then
// extract product data from the page's __NEXT_DATA__ or DOM elements.

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]  Optional progress callback
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
  });
  const page = await context.newPage();

  try {
    onProgress('Under Armour: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss any cookie/consent banners
    try {
      await page.click('[id*="onetrust-accept"]', { timeout: 3000 });
    } catch (_) {}

    // Wait for product grid
    onProgress('Under Armour: waiting for products…');
    await page.waitForSelector('[data-testid="product-card"], .product-card, [class*="ProductCard"], li[class*="product"]', {
      timeout: 20000,
    }).catch(() => {});

    // Scroll to trigger lazy loading
    await autoScroll(page);

    onProgress('Under Armour: extracting products…');

    const deals = await page.evaluate(({ storeName, storeKey }) => {
      // Try multiple selector strategies — UA has changed their markup over time
      const cards = [
        ...document.querySelectorAll('[data-testid="product-card"]'),
        ...document.querySelectorAll('[class*="ProductCard_product"]'),
        ...document.querySelectorAll('li[class*="product-card"]'),
        ...document.querySelectorAll('.product-card'),
      ];

      // Deduplicate by href
      const seen = new Set();
      const unique = [];
      for (const card of cards) {
        const link = card.querySelector('a[href]');
        const href = link?.href || '';
        if (href && !seen.has(href)) {
          seen.add(href);
          unique.push(card);
        }
      }

      return unique.map(card => {
        const link = card.querySelector('a[href]');
        const nameEl = card.querySelector('[data-testid="product-name"], [class*="ProductName"], [class*="product-name"], h2, h3');
        const salePriceEl = card.querySelector('[data-testid="sale-price"], [class*="sale-price"], [class*="SalePrice"], [class*="reduced"]');
        const origPriceEl = card.querySelector('[data-testid="original-price"], [class*="original-price"], [class*="OriginalPrice"], [class*="was-price"], s, del');
        const imgEl = card.querySelector('img[src], img[data-src]');

        const name = nameEl?.textContent?.trim() || '';
        const url = link?.href || '';
        const image = imgEl?.src || imgEl?.dataset?.src || '';

        // Parse prices — strip currency symbols and commas
        const parsePrice = el => {
          if (!el) return null;
          const text = el.textContent.replace(/[^0-9.]/g, '');
          const n = parseFloat(text);
          return isNaN(n) ? null : n;
        };

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);

        if (!name || !url || price === null) return null;

        const discount = originalPrice && originalPrice > price
          ? Math.round((1 - price / originalPrice) * 100)
          : 0;

        // Skip items with no discount — they're not actually on sale
        if (discount <= 0) return null;

        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    // Add tags and IDs
    const results = deals.map(d => ({
      ...d,
      id: slugify(`${d.storeKey}-${d.name}`),
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`Under Armour: found ${results.length} deals`);
    return results;

  } finally {
    await context.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const dist = 400;
      const delay = 150;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  });
  await page.waitForTimeout(1000);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
