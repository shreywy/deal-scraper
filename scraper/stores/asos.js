'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'ASOS';
const STORE_KEY = 'asos';
const CURRENCY = 'USD'; // ASOS uses USD for Canadian customers

// ASOS sale category IDs
// attribute_1049=7261,8843 filters to sale items only
const SALE_PAGES = [
  { catId: 27110, url: 'https://www.asos.com/us/men/sale/cat/?cid=27110', label: "men's sale", gender: 'Men' },
  { catId: 8799, url: 'https://www.asos.com/us/women/sale/cat/?cid=8799', label: "women's sale", gender: 'Women' },
];

/**
 * ASOS — global fashion retailer, ships to Canada (USD prices, converted to CAD).
 * Uses Playwright with stealth mode to access the product API directly.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('ASOS: fetching sale products…');

  const rate = await getUSDtoCAD();
  const allDeals = [];
  const seen = new Set();

  // Use browser-based API fetching (bypasses bot detection)
  return scrapeViaApiWithBrowser(browser, rate, onProgress, seen);
}

async function scrapeViaApiWithBrowser(browser, rate, onProgress, seen) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const page = await context.newPage();
  const allProducts = [];

  try {
    for (const { catId, url: pageUrl, label, gender } of SALE_PAGES) {
      onProgress(`ASOS: loading ${label}…`);

      // First, visit the page to get cookies and proper session
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Accept cookies
      try {
        await page.click('#onetrust-accept-btn-handler', { timeout: 3000 });
      } catch (_) {}

      await page.waitForTimeout(2000);

      // Now use page.evaluate to fetch the API with the established session
      let offset = 0;
      const limit = 72;
      const maxProducts = 500;

      while (offset < maxProducts) {
        const apiUrl = `https://www.asos.com/api/product/search/v2/categories/${catId}?store=US&lang=en-US&currency=USD&country=US&sizeSchema=US&offset=${offset}&limit=${limit}&attribute_1049=7261,8843`;

        onProgress(`ASOS: fetching ${label} at offset ${offset}…`);

        const result = await page.evaluate(async (url) => {
          try {
            const res = await fetch(url, {
              headers: {
                'Accept': 'application/json',
              },
            });
            if (!res.ok) return { error: `HTTP ${res.status}` };
            const json = await res.json();
            return { data: json };
          } catch (err) {
            return { error: err.message };
          }
        }, apiUrl);

        if (result.error) {
          onProgress(`ASOS: API error at offset ${offset}: ${result.error}`);
          break;
        }

        const products = result.data?.products || [];
        if (!products.length) break;

        for (const p of products) {
          const d = mapProduct(p, gender, rate, seen);
          if (d) allProducts.push(d);
        }

        onProgress(`ASOS: fetched ${allProducts.length} deals from ${label}…`);

        if (products.length < limit) break;
        offset += limit;
        await page.waitForTimeout(500); // Small delay between requests
      }
    }
  } catch (err) {
    onProgress(`ASOS: browser error — ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }

  onProgress(`ASOS: found ${allProducts.length} deals`);
  return allProducts;
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
