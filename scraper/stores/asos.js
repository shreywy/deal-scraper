'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'ASOS';
const STORE_KEY = 'asos';
const CURRENCY = 'USD'; // ASOS uses USD for Canadian customers

// ASOS sale search URLs (category URLs no longer work, using search instead)
const SALE_PAGES = [
  { url: 'https://www.asos.com/us/search/?q=sale&gender=Men', label: "men's sale", gender: 'Men' },
  { url: 'https://www.asos.com/us/search/?q=sale&gender=Women', label: "women's sale", gender: 'Women' },
];

/**
 * ASOS — global fashion retailer, ships to Canada (USD prices, converted to CAD).
 * Uses Playwright browser XHR interception to capture ASOS internal API calls.
 *
 * NOTE: ASOS has strong anti-bot protection. The old REST API endpoint
 * (api.asos.com/product/search/v2/categories/{id}/products) returns 404.
 * Browser XHR interception works in non-headless mode but headless mode only
 * intercepts initial API call (limit=1) and products don't load fully.
 * May need non-headless browser or more sophisticated bot detection bypass.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('ASOS: loading sale pages…');

  const rate = await getUSDtoCAD();
  const allDeals = [];
  const seen = new Set();

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept API responses containing product data
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';

    // Look for ASOS product search API responses
    if (!ct.includes('application/json') && !ct.includes('json')) return;
    if (!url.includes('/api/product/search/v2/')) return;

    try {
      const json = await response.json();
      const products = json?.products || [];

      if (Array.isArray(products) && products.length > 0) {
        for (const p of products) {
          const id = p.id;
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            rawProducts.push(p);
          }
        }
      }
    } catch (_) {
      // Ignore parsing errors
    }
  });

  const page = await context.newPage();

  try {
    for (const { url, label, gender } of SALE_PAGES) {
      onProgress(`ASOS: loading ${label}…`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Accept cookies if prompt appears
        try {
          await page.click('#onetrust-accept-btn-handler', { timeout: 4000 });
        } catch (_) {
          // Cookie banner not present
        }

        // Wait for initial API calls
        await page.waitForTimeout(5000);

        // Scroll to trigger lazy loading of more products
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2500);
        }

        // Wait for final API calls to complete
        await page.waitForTimeout(3000);

        onProgress(`ASOS: intercepted ${rawProducts.length} products from ${label}…`);
      } catch (err) {
        onProgress(`ASOS: error loading ${label} — ${err.message}`);
      }
    }

    // Process all intercepted products
    for (const p of rawProducts) {
      const genderGuess = p.gender || '';
      const d = mapProduct(p, genderGuess, rate, seen);
      if (d) allDeals.push(d);
    }
  } catch (err) {
    onProgress(`ASOS: browser error — ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }

  onProgress(`ASOS: found ${allDeals.length} deals`);
  return allDeals;
}

function mapProduct(p, gender, rate, seen) {
  try {
    const name = p.name || '';
    if (!name) return null;

    const productId = p.id || '';
    const url = `https://www.asos.com/us/prd/${productId}`;
    if (seen.has(url) || !productId) return null;
    seen.add(url);

    // ASOS price structure: price.current.value (sale), price.previous.value (was)
    const priceUSD = p.price?.current?.value ?? p.price?.current?.text?.replace(/[^0-9.]/g, '');
    const origUSD  = p.price?.previous?.value ?? p.price?.previous?.text?.replace(/[^0-9.]/g, '');

    const price = parseFloat(priceUSD || 0);
    const originalPrice = parseFloat(origUSD || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const priceCAD = Math.round(price * rate * 100) / 100;
    const originalPriceCAD = Math.round(originalPrice * rate * 100) / 100;

    const image = p.imageUrl
      ? `https://images.asos-media.com/products/${p.imageUrl}`
      : '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${productId}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: priceCAD,
      originalPrice: originalPriceCAD,
      discount,
      currency: CURRENCY,
      priceCAD,
      originalPriceCAD,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
