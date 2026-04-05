'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Nike';
const STORE_KEY = 'nike';
const CURRENCY = 'CAD';

// Nike CA sale page — Nike uses a complex SPA with server-rendered data
// Their search/filter API fires to api.nike.com which we can intercept
const SALE_URL = 'https://www.nike.com/ca/w/sale-3yaep';

/**
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
  const page = await context.newPage();

  const rawProducts = [];
  const seenIds = new Set();

  // Nike fires calls to api.nike.com which return product arrays
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('api.nike.com') && !url.includes('nike.com')) return;

    try {
      const json = await response.json();
      extractNikeProducts(json, rawProducts, seenIds);
    } catch (_) {}
  });

  try {
    onProgress('Nike: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    try {
      await page.click('#onetrust-accept-btn-handler, [class*="accept-btn"], button[id*="accept"]', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Nike uses "Load More" and/or infinite scroll — do both
    await loadAllProductsNike(page, rawProducts, onProgress);

    if (rawProducts.length > 0) {
      const deals = rawProducts.map(p => mapNikeProduct(p)).filter(Boolean);
      onProgress(`Nike: found ${deals.length} deals`);
      return deals;
    }

    // DOM fallback
    onProgress('Nike: trying DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = [
        ...document.querySelectorAll('[data-testid="product-card"]'),
        ...document.querySelectorAll('[class*="product-card"]'),
        ...document.querySelectorAll('[class*="ProductCard"]'),
      ];
      const parsePrice = el => {
        if (!el) return null;
        const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };
      const seen = new Set();
      return cards.map(card => {
        const link = card.querySelector('a[href]');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);
        const nameEl = card.querySelector('[data-testid="product-card-title"], [class*="title"], [class*="name"]');
        const salePriceEl = card.querySelector('[data-testid="product-card-sale-price"], [class*="sale"]');
        const origPriceEl = card.querySelector('[data-testid="product-card-price"], s, del');
        const imgEl = card.querySelector('img[src]');
        const name = nameEl?.textContent?.trim() || '';
        const image = imgEl?.src || '';
        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'CAD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`nike-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`Nike: found ${tagged.length} deals (DOM)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function extractNikeProducts(json, out, seenIds) {
  // Nike's productsSearch API structure
  const nodes = json?.data?.products?.nodes ||
    json?.productInfo ||
    json?.products ||
    [];

  const arr = Array.isArray(nodes) ? nodes : Object.values(nodes);
  for (const p of arr) {
    const id = p?.id || p?.styleCode;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(p);
  }
}

function mapNikeProduct(p) {
  try {
    const name = p.productInfo?.colorDescription || p.displayName || p.title || p.fullTitle || '';
    if (!name) return null;

    const priceInfo = p.productInfo?.prices || p.prices || {};
    const price = priceInfo.currentPrice ?? priceInfo.sale ?? null;
    const originalPrice = priceInfo.fullPrice ?? priceInfo.was ?? null;

    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const slug = p.slug || p.id || '';
    const url = slug ? `https://www.nike.com/ca/t/${slug}` : 'https://www.nike.com/ca/w/sale-3yaep';
    const image = p.productInfo?.images?.portraitURL || p.images?.[0]?.url || '';

    return {
      id: slugify(`nike-${name}-${p.id || ''}`),
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

async function loadAllProductsNike(page, rawProducts, onProgress) {
  const LOAD_MORE = '[data-testid="load-more-btn"], button[aria-label*="more"], [class*="load-more"]';
  let round = 0;
  const MAX = 20;

  while (round < MAX) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    try {
      const btn = await page.$(LOAD_MORE);
      if (!btn || !(await btn.isVisible())) break;
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      round++;
      onProgress(`Nike: loading more products (batch ${round + 1})…`);
      await page.waitForTimeout(2000);
    } catch (_) { break; }
  }
  await page.waitForTimeout(1000);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
