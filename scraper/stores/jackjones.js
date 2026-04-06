'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Foot Locker Canada';
const STORE_KEY = 'jackjones';
const CURRENCY = 'CAD';

// Jack & Jones Canada now redirects to Foot Locker Canada
const SALE_URL = 'https://www.footlocker.ca/en/category/sale.html';

/**
 * Jack & Jones Canada redirects to Foot Locker Canada.
 * Uses API interception + DOM fallback for Foot Locker sale products.
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
    if (!url.includes('footlocker') && !url.includes('flx')) return;
    try {
      const json = await response.json();
      // Foot Locker API response structure
      const products = json?.products || json?.data?.products || json?.results || json?.items || json?.productListItems || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.productId || p.code || p.sku;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const page = await context.newPage();

  try {
    onProgress('Foot Locker (Jack & Jones): navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Cookie consent
    try {
      await page.click('#onetrust-accept-btn-handler, [class*="accept"], button[id*="accept"]', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    onProgress('Foot Locker (Jack & Jones): loading products…');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const seenUrls = new Set();
    const allDeals = [];

    // Map XHR products
    for (const p of rawProducts) {
      const d = mapXHRProduct(p, seenUrls);
      if (d) allDeals.push(d);
    }

    // Fallback to DOM scraping
    if (allDeals.length === 0) {
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = text => {
          if (!text) return null;
          const cleaned = text.replace(/[^0-9.]/g, '');
          const n = parseFloat(cleaned);
          return isNaN(n) ? null : n;
        };

        const parsePriceText = text => {
          // Foot Locker format: "$168.75$225.00" or "Price dropped from $225.00 to $168.75"
          const matches = text.match(/\$([0-9.]+)/g);
          if (!matches || matches.length < 2) return null;
          const prices = matches.map(m => parsePrice(m));
          // Find sale price (lowest) and original price (highest)
          const sorted = prices.filter(Boolean).sort((a, b) => a - b);
          if (sorted.length < 2) return null;
          return { price: sorted[0], originalPrice: sorted[sorted.length - 1] };
        };

        const links = document.querySelectorAll('a[href*="/product/"]');
        const seen = new Set();

        return [...links].map(link => {
          const url = link.href;
          if (!url || seen.has(url)) return null;
          seen.add(url);

          // Find parent container
          let container = link.closest('[class*="product"], article, li');
          if (!container) container = link.parentElement;

          const priceEl = container?.querySelector('.ProductPrice');
          if (!priceEl) return null;

          const priceText = priceEl.textContent || '';
          const prices = parsePriceText(priceText);
          if (!prices) return null;

          const { price, originalPrice } = prices;
          if (price >= originalPrice) return null;

          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;

          // Extract name - remove "Save $XX" prefix/suffix, ratings, price text
          let name = (link.textContent || link.getAttribute('aria-label') || '').trim();
          name = name.replace(/Save\s+\$\d+/gi, '').replace(/Average customer rating.*$/i, '').replace(/This item is on sale.*$/i, '').trim();
          // Remove trailing Men's/Women's/Kids and color info
          name = name.split(/\n/)[0].trim();
          if (!name || name === 'Gift Cards' || name.length < 3) return null;

          const imgEl = container?.querySelector('img');
          const image = imgEl?.src || '';

          return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) { seenUrls.add(d.url); allDeals.push(d); }
      }
    }

    const tagged = allDeals.map(d => ({
      ...d,
      id: d.id || slugify(`${STORE_KEY}-${d.name}`),
      currency: CURRENCY,
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`Foot Locker (Jack & Jones): found ${tagged.length} deals`);
    return tagged;

  } finally {
    await context.close();
  }
}

function mapXHRProduct(p, seen) {
  try {
    const name = p.name || p.displayName || p.title || p.productName || '';
    if (!name) return null;

    const price = parseFloat(p.price || p.salePrice || p.price?.sale || p.currentPrice || 0);
    const originalPrice = parseFloat(p.originalPrice || p.regularPrice || p.price?.original || p.price?.list || p.listPrice || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const url = p.url || p.link || p.pdpUrl || (p.slug ? `https://www.footlocker.ca/en/product/${p.slug}` : '');
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
