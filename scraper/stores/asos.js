'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'ASOS';
const STORE_KEY = 'asos';
const CURRENCY = 'USD'; // ASOS uses USD for Canadian customers

// ASOS product search API — public, no auth required.
// Store: 10&Country=CA to get Canadian prices
const ASOS_API = 'https://api.asos.com/product/search/v2/categories';
const STORE_ID = '10'; // US/International store

// ASOS sale category IDs
const SALE_CATEGORIES = [
  { id: '8799', label: "men's sale", gender: 'Men' },
  { id: '8801', label: "women's sale", gender: 'Women' },
];

/**
 * ASOS — global fashion retailer, ships to Canada (USD prices, converted to CAD).
 * Uses ASOS product search API.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('ASOS: fetching sale products…');

  const fetch = require('node-fetch');
  const rate = await getUSDtoCAD();
  const allDeals = [];
  const seen = new Set();

  for (const { id: catId, label, gender } of SALE_CATEGORIES) {
    let offset = 0;
    const limit = 72;

    while (true) {
      // ASOS product search API (reverse-engineered from their site)
      const params = new URLSearchParams({
        store:       STORE_ID,
        lang:        'en-US',
        currency:    'USD',
        sizeSchema:  'US',
        keyStoreDataversion: 'ornjx70-36',
        offset:      String(offset),
        limit:       String(limit),
        attribute_1047: '7',  // sale filter
      });

      const url = `${ASOS_API}/${catId}/products?${params}`;
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.asos.com/',
            'Origin': 'https://www.asos.com',
          },
        });
        if (!res.ok) break;
        const data = await res.json();
        const products = data?.products || [];
        if (products.length === 0) break;

        for (const p of products) {
          const d = mapProduct(p, gender, rate, seen);
          if (d) allDeals.push(d);
        }
        onProgress(`ASOS: fetched ${allDeals.length} ${label} products…`);

        const itemCount = data?.itemCount || 0;
        offset += limit;
        if (products.length < limit || offset >= itemCount || offset > 500) break;
      } catch (_) { break; }
    }
  }

  if (allDeals.length === 0) {
    onProgress('ASOS: API unavailable, trying browser…');
    return await browserScrape(browser, rate, onProgress);
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

async function browserScrape(browser, rate, onProgress) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });

  const rawProducts = [];
  const seenIds = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('asos.com') && !url.includes('asos-media')) return;
    try {
      const json = await response.json();
      const products = json?.products || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.productId;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push({ p, gender: '' }); }
      }
    } catch (_) {}
  });

  const page = await context.newPage();
  const seen = new Set();
  const allDeals = [];

  try {
    await page.goto('https://www.asos.com/men/sale/cat/?cid=8799', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
    await page.waitForTimeout(3000);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }
    for (const { p, gender } of rawProducts) {
      const d = mapProduct(p, gender, rate, seen);
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

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
