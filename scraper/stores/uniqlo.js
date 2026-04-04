'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Uniqlo';
const STORE_KEY = 'uniqlo';

// Uniqlo Canada uses Fast Retailing's custom platform.
// They expose a public JSON API that is much faster than DOM scraping.
// API endpoint pattern (confirmed across Fast Retailing properties):
//   GET /api/getOutfits?store=ca&lang=en&...
// Fallback: Playwright DOM scrape of the sale page.

const API_URL = 'https://www.uniqlo.com/ca/api/commerce/v5/en/products?path=%2Fsale&limit=100&offset=0&httpFailure=true';
const SALE_URL = 'https://www.uniqlo.com/ca/en/sale/';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Uniqlo: trying JSON API…');

  // Try the JSON API first — no browser needed, much faster
  try {
    const apiDeals = await scrapeViaApi();
    if (apiDeals.length > 0) {
      onProgress(`Uniqlo: found ${apiDeals.length} deals via API`);
      return apiDeals;
    }
  } catch (err) {
    onProgress(`Uniqlo: API failed (${err.message}), falling back to browser…`);
  }

  // Fallback: Playwright DOM scrape
  return scrapViaBrowser(browser, onProgress);
}

async function scrapeViaApi() {
  const fetch = (await import('node-fetch')).default;

  // Paginate through all results
  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://www.uniqlo.com/ca/api/commerce/v5/en/products?path=%2Fsale&limit=${limit}&offset=${offset}&httpFailure=true`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = data?.result?.items || data?.items || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }

  return allItems.map(item => {
    const prices = item.prices || {};
    const price = prices.promoPrice?.value ?? prices.base?.value ?? null;
    const originalPrice = prices.base?.value ?? null;

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const name = item.name || item.displayCode || '';
    const slug = item.productId || item.code || '';
    const url = `https://www.uniqlo.com/ca/en/products/${slug}/`;

    // Pick best image
    const image = item.images?.main?.url
      || item.images?.sub?.[0]?.url
      || '';

    const gender = item.gender || item.genderCategory || '';
    const category = item.subCategory?.displayName || item.category?.displayName || '';

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
      tags: tag({ name, category, gender }),
      scrapedAt: new Date().toISOString(),
    };
  }).filter(Boolean);
}

async function scrapViaBrowser(browser, onProgress) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
  });
  const page = await context.newPage();

  // Intercept API calls — Uniqlo's SPA fires XHR requests we can capture
  const intercepted = [];
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/commerce') && url.includes('products')) {
      try {
        const json = await response.json();
        const items = json?.result?.items || json?.items || [];
        if (items.length > 0) intercepted.push(...items);
      } catch (_) {}
    }
  });

  try {
    onProgress('Uniqlo: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try { await page.click('[class*="CookieBanner"] button, #onetrust-accept-btn-handler', { timeout: 3000 }); } catch (_) {}

    await page.waitForTimeout(3000); // Allow XHR to fire

    if (intercepted.length > 0) {
      onProgress(`Uniqlo: captured ${intercepted.length} products from network`);
      const deals = intercepted.map(item => {
        const prices = item.prices || {};
        const price = prices.promoPrice?.value ?? prices.base?.value ?? null;
        const originalPrice = prices.base?.value ?? null;
        if (!price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        const name = item.name || '';
        const slug = item.productId || item.code || '';
        return {
          id: slugify(`${STORE_KEY}-${name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name,
          url: `https://www.uniqlo.com/ca/en/products/${slug}/`,
          image: item.images?.main?.url || '',
          price, originalPrice, discount,
          tags: tag({ name, category: item.subCategory?.displayName || '', gender: item.gender || '' }),
          scrapedAt: new Date().toISOString(),
        };
      }).filter(Boolean);
      return deals;
    }

    // Last resort: DOM scrape
    onProgress('Uniqlo: falling back to DOM scrape…');
    await autoScroll(page);

    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = document.querySelectorAll('[class*="ProductTile"], [class*="product-tile"], [class*="fr-product"]');
      return [...cards].map(card => {
        const link = card.querySelector('a[href]');
        const nameEl = card.querySelector('[class*="ProductName"], [class*="product-name"]');
        const salePriceEl = card.querySelector('[class*="sale"], [class*="promo"], [class*="discount"]');
        const origPriceEl = card.querySelector('s, del, [class*="original"], [class*="was"]');
        const imgEl = card.querySelector('img');
        const name = nameEl?.textContent?.trim() || '';
        const url = link?.href || '';
        const image = imgEl?.src || '';
        const parsePrice = el => el ? parseFloat(el.textContent.replace(/[^0-9.]/g, '')) : null;
        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    return deals.map(d => ({
      ...d,
      id: slugify(`${d.storeKey}-${d.name}`),
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

  } finally {
    await context.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 500);
        total += 500;
        if (total >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
      }, 200);
    });
  });
  await page.waitForTimeout(800);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
