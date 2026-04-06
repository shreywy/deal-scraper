'use strict';

const { getUSDtoCAD } = require('../currency');
const { tag } = require('../tagger');

const STORE_NAME = 'PacSun';
const STORE_KEY = 'pacsun';
const CURRENCY = 'USD';
const SALE_URLS = {
  men: 'https://www.pacsun.com/mens/clearance/',
  women: 'https://www.pacsun.com/womens/clearance/',
};

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('PacSun: fetching USD→CAD rate…');
  const rate = await getUSDtoCAD();
  onProgress(`PacSun: 1 USD = ${rate.toFixed(4)} CAD`);

  const allDeals = [];
  const seen = new Set();

  for (const [genderKey, url] of Object.entries(SALE_URLS)) {
    const gender = genderKey === 'men' ? 'Men' : 'Women';
    onProgress(`PacSun: fetching ${gender} clearance…`);

    const page = await browser.newPage();

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Check for bot protection
      const title = await page.title();
      if (title.includes('Access to this page has been denied') || title.includes('Access Denied')) {
        onProgress(`PacSun: Bot protection detected on ${gender} page`);
        await page.close();
        continue;
      }

      // Wait for product grid to load
      await page.waitForSelector('.product-tile, .product, [class*="product-"]', { timeout: 20000 }).catch(() => null);

      // Scroll to trigger lazy loading
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let totalHeight = 0;
          const distance = 500;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 200);
        });
      });

      await page.waitForTimeout(2000);

      const products = await page.evaluate(() => {
        const items = [];
        const tiles = document.querySelectorAll('.product-tile');

        for (const tile of tiles) {
          try {
            const nameEl = tile.querySelector('.pdp-link a, .link');
            const imgEl = tile.querySelector('.tile-image img');
            const priceEl = tile.querySelector('.price .sales .value');
            const originalPriceEl = tile.querySelector('.price .strike-through .value');

            if (!nameEl || !priceEl || !originalPriceEl) continue;

            const name = nameEl.getAttribute('aria-label') || nameEl.textContent?.trim() || '';
            const href = nameEl.getAttribute('href') || '';
            const image = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';
            const priceText = priceEl.textContent?.trim() || '';
            const originalPriceText = originalPriceEl.textContent?.trim() || '';

            const price = parseFloat(priceText.replace(/[$,]/g, ''));
            const originalPrice = parseFloat(originalPriceText.replace(/[$,]/g, ''));

            if (name && href && price > 0 && originalPrice > price) {
              items.push({ name, href, image, price, originalPrice });
            }
          } catch (_) {}
        }

        return items;
      });

      onProgress(`PacSun: found ${products.length} ${gender} products`);

      for (const p of products) {
        const deal = mapProduct(p, rate, gender, seen);
        if (deal) allDeals.push(deal);
      }

    } catch (err) {
      onProgress(`PacSun: Error on ${gender} - ${err.message}`);
    } finally {
      await page.close();
    }
  }

  onProgress(`PacSun: total ${allDeals.length} deals found`);
  return allDeals;
}

function mapProduct(p, rate, gender, seen) {
  try {
    const name = p.name;
    const url = p.href.startsWith('http') ? p.href : `https://www.pacsun.com${p.href}`;

    if (seen.has(url)) return null;
    seen.add(url);

    const price = p.price;
    const originalPrice = p.originalPrice;
    const discount = Math.round((1 - price / originalPrice) * 100);

    if (discount <= 0) return null;

    const image = p.image.startsWith('http') ? p.image : `https://www.pacsun.com${p.image}`;
    const handle = url.split('/').pop() || slugify(name);

    return {
      id: slugify(`pacsun-${name}-${handle}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: Math.round(price * rate * 100) / 100,
      originalPriceCAD: Math.round(originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      gender,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) {
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
