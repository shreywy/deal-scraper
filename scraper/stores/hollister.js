'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Hollister';
const STORE_KEY = 'hollister';
const CURRENCY = 'CAD';

// HCo platform API — same backend as Abercrombie & Fitch
// Store number: 10200 (Hollister), country: CA
const HCO_API = 'https://www.hollisterco.com/api/ecomm/10200/products/search';

const CATEGORY_IDS = [
  { id: '10001',  label: 'Guys' },
  { id: '10002',  label: 'Girls' },
];

/**
 * Hollister CA — HCo platform product search API (CAD prices).
 * Falls back to Playwright DOM scrape if API is blocked.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Hollister: fetching sale products…');

  // Try API first
  try {
    const deals = await fetchViaAPI(onProgress);
    if (deals.length > 0) {
      onProgress(`Hollister: found ${deals.length} deals via API`);
      return deals;
    }
  } catch (err) {
    onProgress(`Hollister: API failed (${err.message}), using browser…`);
  }

  return await browserScrape(browser, onProgress);
}

async function fetchViaAPI(onProgress) {
  const allDeals = [];
  const seen = new Set();

  // Hollister sale category IDs (these may need updating)
  const SALE_PARAMS = [
    { gender: 'Men',   url: 'https://www.hollisterco.com/shop/ca/guys-sale' },
    { gender: 'Women', url: 'https://www.hollisterco.com/shop/ca/girls-sale' },
  ];

  // Try the HCo search API with sale filter
  for (const { gender } of SALE_PARAMS) {
    let offset = 0;
    const limit = 48;
    while (true) {
      const params = new URLSearchParams({
        country: 'CA',
        lang: 'en-CA',
        store: 'HCO',
        offset: String(offset),
        limit: String(limit),
        sort: 'BestSeller',
        onSale: 'true',
        gender: gender === 'Men' ? 'Male' : 'Female',
      });
      const res = await fetch(`${HCO_API}?${params}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.hollisterco.com/',
        },
      });
      if (!res.ok) break;
      const data = await res.json();
      const products = data.products || data.results || [];
      if (products.length === 0) break;
      for (const p of products) {
        const d = mapHCoProduct(p, STORE_NAME, STORE_KEY, gender, seen);
        if (d) allDeals.push(d);
      }
      onProgress(`Hollister: fetched ${allDeals.length} ${gender} deals…`);
      offset += limit;
      if (products.length < limit) break;
    }
  }
  return allDeals;
}

function mapHCoProduct(p, storeName, storeKey, gender, seen) {
  try {
    const name = p.name || p.productName || p.title || '';
    if (!name) return null;

    const price = parseFloat(p.price?.sale || p.salePrice || p.offerPrice || 0);
    const originalPrice = parseFloat(p.price?.list || p.regularPrice || p.listPrice || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const productId = p.productId || p.id || p.catalogRefId || '';
    const url = p.url
      ? `https://www.hollisterco.com${p.url}`
      : `https://www.hollisterco.com/shop/ca/p/${productId}`;
    if (seen.has(url)) return null;
    seen.add(url);

    const image = p.imageUrl || p.images?.[0]?.url || p.media?.[0]?.url || '';

    return {
      id: slugify(`${storeKey}-${name}-${productId}`),
      store: storeName,
      storeKey,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: price,
      originalPriceCAD: originalPrice,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function browserScrape(browser, onProgress) {
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
    if (!url.includes('hollisterco.com')) return;
    try {
      const json = await response.json();
      const products = json?.products || json?.results || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.productId || p.id;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const SALE_PAGES = [
    { url: 'https://www.hollisterco.com/shop/ca/guys-sale', gender: 'Men' },
    { url: 'https://www.hollisterco.com/shop/ca/girls-sale', gender: 'Women' },
  ];
  const seen = new Set();
  const allDeals = [];

  for (const { url: pageUrl, gender } of SALE_PAGES) {
    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
      }

      const domDeals = await page.evaluate(({ storeName, storeKey, gender }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll('[class*="product-grid"] [class*="product-item"], [class*="ProductGrid"] [class*="Product"]');
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const name = card.querySelector('[class*="name"], [class*="title"]')?.textContent?.trim() || '';
          const priceEl = card.querySelector('[class*="sale-price"], [class*="salePrice"]');
          const origEl = card.querySelector('[class*="original-price"], [class*="was-price"], del, s');
          const imgEl = card.querySelector('img');
          const price = parsePrice(priceEl);
          const originalPrice = parsePrice(origEl);
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, gender, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY, gender });

      for (const d of domDeals) {
        if (!seen.has(d.url)) { seen.add(d.url); allDeals.push(d); }
      }
      // XHR products
      for (const p of rawProducts) {
        const d = mapHCoProduct(p, STORE_NAME, STORE_KEY, gender, seen);
        if (d) allDeals.push(d);
      }
    } catch (err) {
      onProgress(`Hollister: browser error — ${err.message}`);
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
    tags: d.tags?.length ? d.tags : tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: d.scrapedAt || new Date().toISOString(),
  }));

  onProgress(`Hollister: found ${tagged.length} deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
