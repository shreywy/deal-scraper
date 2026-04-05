'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Uniqlo';
const STORE_KEY = 'uniqlo';

// Uniqlo Canada — Fast Retailing platform.
// Try the JSON API first (multiple URL patterns), then XHR intercept, then DOM.

const SALE_PAGE = 'https://www.uniqlo.com/ca/en/sale/';

// Multiple API patterns — FR changes paths between regions/versions
const API_CANDIDATES = [
  'https://www.uniqlo.com/ca/api/commerce/v5/en/products?path=%2Fsale&limit=100&offset=0&httpFailure=true',
  'https://www.uniqlo.com/ca/api/commerce/v5/en/products?path=/sale&limit=100&offset=0',
  'https://www.uniqlo.com/ca/api/commerce/v5/en/products?path=%2Fsale-and-special-offers&limit=100&offset=0&httpFailure=true',
  'https://www.uniqlo.com/ca/api/commerce/v3/en/products?path=%2Fsale&limit=100&offset=0',
  'https://www.uniqlo.com/ca/api/commerce/v5/en/products?path=/sale&limit=100',
];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Uniqlo: trying JSON API…');

  for (const apiUrl of API_CANDIDATES) {
    try {
      const apiDeals = await scrapeViaApi(apiUrl, onProgress);
      if (apiDeals.length > 0) {
        onProgress(`Uniqlo: found ${apiDeals.length} deals via API`);
        return apiDeals;
      }
    } catch (err) {
      onProgress(`Uniqlo: API attempt failed (${err.message})`);
    }
  }

  onProgress('Uniqlo: all API attempts failed — using browser…');
  return scrapeViaBrowser(browser, onProgress);
}

async function scrapeViaApi(baseUrl, onProgress) {
  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = baseUrl.replace(/offset=\d+/, `offset=${offset}`);
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-CA,en;q=0.9',
      },
      timeout: 15000,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = data?.result?.items || data?.items || data?.products || [];
    if (items.length === 0) break;

    allItems.push(...items);
    if (items.length < limit) break;
    offset += limit;

    onProgress(`Uniqlo: fetched ${allItems.length} products from API…`);
  }

  return allItems.map(item => mapUniqloItem(item)).filter(Boolean);
}

function mapUniqloItem(item) {
  const prices = item.prices || item.price || {};

  // Try multiple price structure patterns
  // Pattern 1: prices.priceGroup[0].basePrice / salePrice
  const priceGroup = prices.priceGroup?.[0];
  let price = priceGroup?.salePrice?.value ?? priceGroup?.currentPrice?.value;
  let originalPrice = priceGroup?.basePrice?.value ?? priceGroup?.originalPrice?.value;

  // Pattern 2: prices.promoPrice / base
  if (!price) {
    price = prices.promoPrice?.value ?? prices.salePrice?.value ?? prices.current?.value;
  }
  if (!originalPrice) {
    originalPrice = prices.base?.value ?? prices.originalPrice?.value ?? prices.was?.value;
  }

  // Pattern 3: Direct price fields
  if (!price) {
    price = item.salePrice ?? item.currentPrice ?? item.price;
  }
  if (!originalPrice) {
    originalPrice = item.originalPrice ?? item.basePrice ?? item.wasPrice;
  }

  if (!price || !originalPrice || price >= originalPrice) return null;

  const discount = Math.round((1 - price / originalPrice) * 100);
  if (discount <= 0) return null;

  const name = item.name || item.displayCode || item.title || '';
  if (!name) return null;

  const slug = item.productId || item.code || item.id || '';
  const url = slug
    ? `https://www.uniqlo.com/ca/en/products/${slug}/`
    : item.url || item.productUrl || '';

  // Best available image
  const image =
    item.images?.main?.url ||
    item.images?.sub?.[0]?.url ||
    (Array.isArray(item.images) ? item.images[0]?.url : '') ||
    item.imageUrl ||
    item.image ||
    '';

  const gender = item.gender || item.genderCategory || '';
  const category = item.subCategory?.displayName || item.category?.displayName || '';

  return {
    id: slugify(`${STORE_KEY}-${name}-${slug}`),
    store: STORE_NAME,
    storeKey: STORE_KEY,
    name,
    url,
    image,
    price,
    originalPrice,
    discount,
    currency: 'CAD',
    priceCAD: price,
    originalPriceCAD: originalPrice,
    tags: tag({ name, category, gender }),
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeViaBrowser(browser, onProgress) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });
  const page = await context.newPage();

  const intercepted = [];
  const interceptedIds = new Set();

  // Intercept ALL JSON from Uniqlo — FR fires several API calls on page load
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('uniqlo.com')) return;

    // Log intercepted API calls for debugging
    if (url.includes('/api/') || url.includes('commerce')) {
      onProgress(`Uniqlo: intercepted API: ${url.substring(0, 100)}…`);
    }

    try {
      const json = await response.json();
      // Enhanced XHR interception - try multiple item container keys and patterns
      // Uniqlo Canada sometimes uses /api/commerce/ endpoints
      const items = json?.result?.items || json?.items || json?.products || json?.payload?.items || [];

      if (Array.isArray(items) && items.length > 0) {
        onProgress(`Uniqlo: found ${items.length} items in API response`);
      }

      for (const item of items) {
        const itemId = item?.productId || item?.code || item?.id;
        if (itemId && !interceptedIds.has(itemId)) {
          interceptedIds.add(itemId);
          intercepted.push(item);
        }
      }
    } catch (_) {}
  });

  try {
    onProgress('Uniqlo: navigating to sale page…');
    await page.goto(SALE_PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await page.click('[class*="CookieBanner"] button, #onetrust-accept-btn-handler', { timeout: 3000 });
    } catch (_) {}

    await page.waitForTimeout(3000);
    await loadAllProductsScroll(page, intercepted, onProgress);

    if (intercepted.length > 0) {
      onProgress(`Uniqlo: captured ${intercepted.length} products from XHR`);
      const deals = intercepted.map(item => mapUniqloItem(item)).filter(Boolean);
      return deals;
    }

    // Last resort DOM scrape
    onProgress('Uniqlo: falling back to DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const selectors = [
        '[class*="ProductTile"]',
        '[class*="product-tile"]',
        '[class*="fr-product"]',
        'li[class*="product"]',
        'article[class*="product"]',
      ];
      let cards = [];
      for (const sel of selectors) {
        cards = [...document.querySelectorAll(sel)];
        if (cards.length) break;
      }
      const parsePrice = el => el ? parseFloat(el.textContent.replace(/[^0-9.]/g, '')) : null;
      const seen = new Set();
      return cards.map(card => {
        const link = card.querySelector('a[href]');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);
        const nameEl = card.querySelector('[class*="ProductName"], [class*="product-name"], h2, h3');
        const salePriceEl = card.querySelector('[class*="sale"], [class*="promo"], [class*="discount"]');
        const origPriceEl = card.querySelector('s, del, [class*="original"], [class*="was"]');
        const imgEl = card.querySelector('img');
        const name = nameEl?.textContent?.trim() || '';
        const image = imgEl?.src || imgEl?.dataset?.src || '';
        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !price || !originalPrice || price >= originalPrice) return null;
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

// Scroll until page height stabilizes (handles lazy-load + infinite scroll)
async function loadAllProductsScroll(page, intercepted, onProgress) {
  let lastHeight = 0;
  let lastCount = 0;
  let stableRounds = 0;
  const MAX_ROUNDS = 30;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);

    const stable = (currentHeight === lastHeight) && (intercepted.length === lastCount);
    if (stable) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
      lastHeight = currentHeight;
      lastCount = intercepted.length;
      if (intercepted.length > 0) onProgress(`Uniqlo: loading more… (${intercepted.length} so far)`);
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
