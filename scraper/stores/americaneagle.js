'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'American Eagle';
const STORE_KEY = 'americaneagle';
const CURRENCY = 'CAD';

/**
 * American Eagle CA — Attempts DOM scraping via non-headless browser.
 *
 * ISSUE: American Eagle redirects sale category pages (cat7130019, cat7130020)
 * to homepage when accessed via headless browser. This approach uses a visible
 * browser window which may bypass basic bot detection.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('American Eagle: attempting to scrape sale pages...');

  try {
    const allDeals = await browserScrape(browser, onProgress);
    onProgress(`American Eagle: found ${allDeals.length} deals`);
    return allDeals;
  } catch (err) {
    onProgress(`American Eagle: error - ${err.message}`);
    return [];
  }
}

async function browserScrape(browser, onProgress) {
  // Launch a non-headless context - more likely to bypass bot detection
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  });

  const page = await context.newPage();
  const allDeals = [];
  const seen = new Set();

  const SALE_URLS = [
    { url: 'https://www.ae.com/ca/en/c/men/sale/cat7130019', gender: 'Men' },
    { url: 'https://www.ae.com/ca/en/c/women/sale/cat7130020', gender: 'Women' },
  ];

  try {
    for (const { url, gender } of SALE_URLS) {
      onProgress(`American Eagle: scraping ${gender} sale...`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);

        // Check if redirected
        if (page.url().includes('redirectedFrom')) {
          onProgress(`American Eagle: ${gender} - redirected (bot detected)`);
          continue;
        }

        // Scroll to load lazy products
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
        }

        // Extract products from DOM
        const products = await page.evaluate(({ storeName, storeKey }) => {
          const results = [];
          const productCards = document.querySelectorAll('[data-testid="product-card"], .product-tile, .product-card, article[class*="product"]');

          for (const card of productCards) {
            try {
              const link = card.querySelector('a[href*="/p/"]');
              if (!link) continue;

              const url = link.href;
              if (!url) continue;

              const nameEl = card.querySelector('[data-testid="product-name"], .product-name, h3, h2');
              const name = nameEl?.textContent?.trim() || '';
              if (!name) continue;

              // Look for sale price and original price
              const salePriceEl = card.querySelector('[data-testid="sale-price"], .price-sale, .sale-price, [class*="sale"][class*="price"]');
              const regularPriceEl = card.querySelector('[data-testid="regular-price"], .price-regular, .price-standard, del, s, [class*="compare"][class*="price"]');

              if (!salePriceEl || !regularPriceEl) continue;

              const saleText = salePriceEl.textContent.replace(/[^0-9.]/g, '');
              const regularText = regularPriceEl.textContent.replace(/[^0-9.]/g, '');

              const price = parseFloat(saleText);
              const originalPrice = parseFloat(regularText);

              if (!price || !originalPrice || price >= originalPrice) continue;

              const imgEl = card.querySelector('img');
              const image = imgEl?.src || '';

              results.push({ name, url, image, price, originalPrice });
            } catch (e) {}
          }

          return results;
        }, { storeName: STORE_NAME, storeKey: STORE_KEY });

        for (const p of products) {
          if (seen.has(p.url)) continue;
          seen.add(p.url);

          const discount = Math.round((1 - p.price / p.originalPrice) * 100);

          allDeals.push({
            id: slugify(`${STORE_KEY}-${p.name}`),
            store: STORE_NAME,
            storeKey: STORE_KEY,
            name: p.name,
            url: p.url,
            image: p.image,
            price: p.price,
            originalPrice: p.originalPrice,
            discount,
            currency: CURRENCY,
            priceCAD: p.price,
            originalPriceCAD: p.originalPrice,
            tags: tag({ name: p.name, gender }),
            scrapedAt: new Date().toISOString(),
          });
        }

        onProgress(`American Eagle: ${gender} - ${products.length} products found`);
      } catch (err) {
        onProgress(`American Eagle: ${gender} error - ${err.message}`);
      }
    }
  } finally {
    await page.close();
    await context.close();
  }

  return allDeals;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
