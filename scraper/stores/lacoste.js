'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Tommy Hilfiger Canada';
const STORE_KEY = 'lacoste';
const CURRENCY = 'CAD';

// Lacoste Canada redirects to Tommy Hilfiger Canada
// Using multiple sale URLs to capture men's and women's items
const SALE_URLS = [
  'https://ca.tommy.com/en/men/sale',
  'https://ca.tommy.com/en/women/sale'
];

/**
 * Lacoste Canada now redirects to Tommy Hilfiger Canada.
 * Uses API interception to capture product data from XHR calls.
 *
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

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept API responses
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('tommy')) return;
    try {
      const json = await response.json();
      // Look for product arrays in various API response structures
      const products = json?.products || json?.data?.products || json?.results || json?.items || json?.hits || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.productId || p.code || p.ID;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const saleUrl of SALE_URLS) {
    onProgress(`Tommy Hilfiger (Lacoste): loading ${saleUrl.includes('men') ? "men's" : "women's"} sale page…`);
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Cookie consent
      try {
        await page.click('#onetrust-accept-btn-handler, [class*="accept"], button[id*="accept"]', { timeout: 4000 });
      } catch (_) {}

      await page.waitForTimeout(3000);

      // Scroll to load more products
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
      }

      // Map XHR products
      for (const p of rawProducts) {
        const d = mapXHRProduct(p, seenUrls);
        if (d) allDeals.push(d);
      }

      // Fallback to DOM scraping if no API data
      if (allDeals.length === 0) {
        const domDeals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = el => {
            if (!el) return null;
            const text = (el.textContent || '').replace(/[^0-9.]/g, '');
            const n = parseFloat(text);
            return isNaN(n) ? null : n;
          };

          const cards = document.querySelectorAll('[class*="product-tile"], [class*="product-card"], [class*="product-item"], .product');
          const seen = new Set();

          return [...cards].map(card => {
            const linkEl = card.querySelector('a[href*="/men/"], a[href*="/women/"], a[href*="/product/"]');
            const url = linkEl?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);

            const nameEl = card.querySelector('[class*="product-name"], [class*="product-title"], h3, h2, .name');
            const name = (nameEl?.textContent || linkEl?.textContent || '').trim();
            if (!name) return null;

            const imgEl = card.querySelector('img');
            const image = imgEl?.src || '';

            // Tommy Hilfiger uses specific price classes
            const salePriceEl = card.querySelector('[class*="sale"], [class*="promo"], .price-sales, [class*="markdown"]');
            const origPriceEl = card.querySelector('del, s, [class*="original"], [class*="standard"], [class*="list-price"]');

            const price = parsePrice(salePriceEl);
            const originalPrice = parsePrice(origPriceEl);

            if (!price || !originalPrice || price >= originalPrice) return null;

            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) return null;

            return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
          }).filter(Boolean);
        }, { storeName: STORE_NAME, storeKey: STORE_KEY });

        for (const d of domDeals) {
          if (!seenUrls.has(d.url)) { seenUrls.add(d.url); allDeals.push(d); }
        }
      }
    } catch (err) {
      onProgress(`Tommy Hilfiger (Lacoste): error — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Tommy Hilfiger (Lacoste): found ${tagged.length} deals`);
  return tagged;
}

function mapXHRProduct(p, seen) {
  try {
    const name = p.name || p.displayName || p.title || p.productName || '';
    if (!name) return null;

    const price = parseFloat(p.price || p.salePrice || p.price?.sale || p.price_current || 0);
    const originalPrice = parseFloat(p.originalPrice || p.regularPrice || p.price?.list || p.price?.standard || p.price_original || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const url = p.url || p.link || (p.slug ? `https://ca.tommy.com/en/${p.slug}` : '');
    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image = p.image || p.imageUrl || p.images?.[0]?.url || p.thumbnail || '';

    return {
      id: slugify(`${STORE_KEY}-${name}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: price,
      originalPriceCAD: originalPrice,
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
