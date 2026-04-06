'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Rhone';
const STORE_KEY = 'rhone';
const CURRENCY = 'CAD'; // Rhone shows CAD prices on their site
const SALE_URL = 'https://www.rhone.com/collections/sale';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const page = await browser.newPage();
  const allDeals = [];
  const seen = new Set();

  try {
    onProgress('Rhone: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'networkidle', timeout: 45000 });

    // Wait for products to load
    await page.waitForSelector('.product-card', { timeout: 10000 }).catch(() => null);

    // Scroll to lazy-load more products
    onProgress('Rhone: scrolling to load all products…');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    onProgress('Rhone: extracting product data from DOM…');

    const products = await page.evaluate(() => {
      const items = [];
      const productElements = Array.from(document.querySelectorAll('.product-card'));

      for (const el of productElements) {
        try {
          // Get product name from aria-label or title
          const ariaLabel = el.getAttribute('aria-label') || '';
          const nameMatch = ariaLabel.match(/Product card: (.+?)(?:\s*--\s*|$)/);
          let name = nameMatch ? nameMatch[1] : '';

          if (!name) {
            // Fallback to any title/name element
            const nameEl = el.querySelector('[class*="title"], [class*="name"]');
            name = nameEl?.textContent?.trim() || '';
          }

          if (!name) continue;

          // Get URL
          const linkEl = el.querySelector('a[href*="/products/"]');
          const href = linkEl?.getAttribute('href');
          if (!href) continue;
          const url = href.startsWith('http') ? href : `https://www.rhone.com${href}`;

          // Get image
          const imgEl = el.querySelector('img');
          const image = imgEl?.src || imgEl?.srcset?.split(' ')[0] || '';

          // Get prices - Rhone uses product-original-price and product-sale-price classes
          const originalPriceEl = el.querySelector('.product-original-price');
          const salePriceEl = el.querySelector('.product-sale-price, .product-discount-price');

          const originalPriceText = originalPriceEl?.textContent?.trim() || '';
          const priceText = salePriceEl?.textContent?.trim() || '';

          items.push({
            name,
            url,
            image,
            priceText,
            originalPriceText
          });
        } catch (_) {}
      }

      return items;
    });

    onProgress(`Rhone: found ${products.length} products, filtering for deals…`);

    for (const p of products) {
      try {
        // Parse prices
        const price = parsePrice(p.priceText);
        const originalPrice = parsePrice(p.originalPriceText);

        // Must have both prices and be on sale
        if (!price || !originalPrice || price >= originalPrice) continue;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) continue;

        const url = p.url;
        if (seen.has(url)) continue;
        seen.add(url);

        const deal = {
          id: slugify(`rhone-${p.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: p.name,
          url,
          image: p.image,
          price,
          originalPrice,
          discount,
          currency: CURRENCY,
          priceCAD: price, // Already in CAD
          originalPriceCAD: originalPrice, // Already in CAD
          gender: 'Men', // Rhone is primarily men's activewear
          tags: tag({ name: p.name, gender: 'Men' }),
          scrapedAt: new Date().toISOString(),
        };

        allDeals.push(deal);
      } catch (_) {}
    }

    onProgress(`Rhone: total ${allDeals.length} deals found`);
  } catch (err) {
    onProgress(`Rhone: Error - ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }

  return allDeals;
}

function parsePrice(str) {
  if (!str) return null;
  const match = str.match(/[\d,]+\.?\d*/);
  if (!match) return null;
  const num = parseFloat(match[0].replace(/,/g, ''));
  return num > 0 ? num : null;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
