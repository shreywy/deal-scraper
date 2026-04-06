'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Quiksilver';
const STORE_KEY = 'quiksilver';
const CURRENCY = 'CAD'; // Quiksilver.com shows CAD prices for Canada

// Quiksilver sale page (redirects to /collections/sale)
const SALE_URL = 'https://www.quiksilver.com/collections/sale';

/**
 * Quiksilver Canada - en-CA subdirectory returns 404.
 * Using main .com site which has CAD currency option.
 * Shopify-based, uses API interception + DOM fallback.
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

  // Intercept Shopify API responses
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('quiksilver')) return;
    try {
      const json = await response.json();
      // Shopify product API
      const products = json?.products || json?.items || json?.collection?.products || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.product_id || p.handle;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  const page = await context.newPage();
  try {
    onProgress('Quiksilver: loading sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Close privacy/cookie banners
    try {
      await page.click('button[class*="close"], [class*="accept"], .close, [aria-label*="close" i]', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    onProgress('Quiksilver: scrolling to load products…');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Map XHR products
    for (const p of rawProducts) {
      const d = await mapXHRProduct(p, seenUrls);
      if (d) allDeals.push(d);
    }

    // Fallback to DOM scraping
    if (allDeals.length === 0) {
      onProgress('Quiksilver: extracting deals from DOM…');
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          if (!el) return null;
          const text = (el.textContent || '').replace(/[^0-9.]/g, '');
          const n = parseFloat(text);
          return isNaN(n) ? null : n;
        };

        const cards = document.querySelectorAll('[class*="product-card"], [data-product]');
        const seen = new Set();

        return [...cards].map(card => {
          const linkEl = card.querySelector('a[href*="/products/"]');
          const url = linkEl?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);

          const nameEl = card.querySelector('[class*="product-card__title"], [class*="product__title"]');
          const name = (nameEl?.textContent || linkEl?.textContent || '').trim();
          if (!name) return null;

          const imgEl = card.querySelector('img');
          const image = imgEl?.src || '';

          // Quiksilver price selectors
          const salePriceEl = card.querySelector('.product-card__meta-price--sale, [class*="meta-price"][class*="sale"]');
          const origPriceEl = card.querySelector('.product-card__meta-compare-price, [class*="compare-price"]');

          const price = parsePrice(salePriceEl);
          const originalPrice = parsePrice(origPriceEl);

          if (!price || !originalPrice || price >= originalPrice) return null;

          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;

          return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push({
            ...d,
            priceCAD: d.price,
            originalPriceCAD: d.originalPrice,
            currency: CURRENCY
          });
        }
      }
    }
  } catch (err) {
    onProgress(`Quiksilver: error — ${err.message}`);
  } finally {
    await page.close();
  }

  await context.close();

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    tags: tag({ name: d.name }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Quiksilver: found ${tagged.length} deals`);
  return tagged;
}

async function mapXHRProduct(p, seen) {
  try {
    const name = p.title || p.name || p.displayName || '';
    if (!name) return null;

    // Shopify product structure - prices are already in CAD
    const price = parseFloat(p.price || p.variants?.[0]?.price || 0);
    const originalPrice = parseFloat(p.compare_at_price || p.variants?.[0]?.compare_at_price || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const url = p.url || (p.handle ? `https://www.quiksilver.com/products/${p.handle}` : '');
    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image = p.featured_image || p.image || p.images?.[0] || '';

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
