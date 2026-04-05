'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'H&M Canada';
const STORE_KEY = 'hm';
const CURRENCY = 'CAD';

// H&M Canada product listing API (paginated JSON)
// Intercept: https://www2.hm.com/en_ca/sale/... returns product lists
const BASE_API = 'https://www2.hm.com/en_ca_content/products/list';
const CATEGORIES = [
  { id: 'ladies_sale', label: "women's" },
  { id: 'men_sale',    label: "men's" },
];

/**
 * H&M Canada — fetches from the H&M product listing API (CAD prices).
 * Falls back to Playwright DOM if API is blocked.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('H&M Canada: fetching sale products…');

  // Try fetch-based approach first
  try {
    const deals = await fetchDeals(onProgress);
    if (deals.length > 0) {
      onProgress(`H&M Canada: found ${deals.length} deals`);
      return deals;
    }
  } catch (err) {
    onProgress(`H&M Canada: API blocked (${err.message}), trying browser…`);
  }

  // Browser fallback
  return await browserScrape(browser, onProgress);
}

async function fetchDeals(onProgress) {
  const allDeals = [];
  const seen = new Set();

  for (const cat of CATEGORIES) {
    let offset = 0;
    const pageSize = 36;

    while (true) {
      const url = `${BASE_API}?category=${cat.id}&offset=${offset}&page-size=${pageSize}&sort=SELL_OUT&country=CA&lang=en_US&editorial-exp=A`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www2.hm.com/en_ca/sale.html',
        },
      });
      if (!res.ok) break;
      const data = await res.json();
      const products = data.products || data.results || [];
      if (products.length === 0) break;

      for (const p of products) {
        const d = mapHMProduct(p, cat.label.includes('men') && !cat.label.includes('women') ? 'Men' : 'Women', seen);
        if (d) allDeals.push(d);
      }
      onProgress(`H&M Canada: fetched ${allDeals.length} ${cat.label} deals…`);

      const total = data.total || data.pagination?.total || 0;
      offset += pageSize;
      if (offset >= total || products.length < pageSize) break;
    }
  }
  return allDeals;
}

function mapHMProduct(p, gender, seen) {
  try {
    const name = p.name || p.title || '';
    if (!name) return null;

    const articleCode = p.articleCode || p.code || p.id || '';
    const url = articleCode
      ? `https://www2.hm.com/en_ca/productpage.${articleCode}.html`
      : '';
    if (!url || seen.has(url)) return null;
    seen.add(url);

    const price = parseFloat((p.price?.value || p.salePrice || p.prices?.sale || '0').toString().replace(/[^0-9.]/g, ''));
    const originalPrice = parseFloat((p.price?.regularPrice || p.regularPrice || p.prices?.regular || '0').toString().replace(/[^0-9.]/g, ''));

    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const image = p.images?.[0]?.url
      ? `https://lp2.hm.com/hmgoepprod?set=source[/${p.images[0].url}]`
      : p.imageUrl || p.mainImage || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${articleCode}`),
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
    if (!url.includes('hm.com') && !url.includes('apiforcontent')) return;
    try {
      const json = await response.json();
      const products = json?.products || json?.results || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.articleCode || p.code || p.id;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const page = await context.newPage();
  const seen = new Set();
  const allDeals = [];

  try {
    await page.goto('https://www2.hm.com/en_ca/sale.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.click('#onetrust-accept-btn-handler, .cookie-notice-accept', { timeout: 4000 }); } catch (_) {}
    await page.waitForTimeout(3000);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Process XHR-intercepted products
    for (const p of rawProducts) {
      const gStr = p.name?.toLowerCase() || '';
      const gender = /women|ladies|girl/.test(gStr) ? 'Women' : /\bmen\b|guys|boy/.test(gStr) ? 'Men' : '';
      const d = mapHMProduct(p, gender, seen);
      if (d) allDeals.push(d);
    }

    // DOM fallback
    if (allDeals.length === 0) {
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll('[class*="product-item"], [class*="ProductItem"], article[class*="product"]');
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const name = card.querySelector('[class*="name"], h3, h2')?.textContent?.trim() || '';
          const priceEl = card.querySelector('[class*="sale-price"], [class*="reduced"]');
          const origPriceEl = card.querySelector('[class*="original-price"], del, s');
          const imgEl = card.querySelector('img');
          const price = parsePrice(priceEl);
          const originalPrice = parsePrice(origPriceEl);
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });
      allDeals.push(...domDeals);
    }
  } catch (err) {
    onProgress(`H&M Canada: browser error — ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: d.tags?.length ? d.tags : tag({ name: d.name }),
    scrapedAt: d.scrapedAt || new Date().toISOString(),
  }));

  onProgress(`H&M Canada: found ${tagged.length} deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
