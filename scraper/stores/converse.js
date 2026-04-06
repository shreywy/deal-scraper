'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Converse';
const STORE_KEY = 'converse';
const CURRENCY = 'CAD';

// Converse Canada sale page
const SALE_URL = 'https://www.converse.com/en-ca/c/sale';

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

  // Converse may use API calls like Nike (both Nike-owned)
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('converse.com') && !url.includes('api')) return;

    try {
      const json = await response.json();
      extractConverseProducts(json, rawProducts, seenIds);
    } catch (_) {}
  });

  try {
    onProgress('Converse: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Cookie consent
    try {
      await page.click('#onetrust-accept-btn-handler, [class*="accept"], button[id*="accept"]', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    onProgress('Converse: loading products…');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Try API-captured products first
    if (rawProducts.length > 0) {
      const deals = rawProducts.map(p => mapConverseProduct(p)).filter(Boolean);
      onProgress(`Converse: found ${deals.length} deals (API)`);
      return deals;
    }

    // DOM fallback
    onProgress('Converse: trying DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const parsePrice = el => {
        if (!el) return null;
        const text = (el.textContent || '').replace(/[^0-9.]/g, '');
        const n = parseFloat(text);
        return isNaN(n) ? null : n;
      };

      const cards = document.querySelectorAll('[class*="product-card"], [data-testid*="product"], .product-tile, .product-item, .grid-item');
      const seen = new Set();

      return [...cards].map(card => {
        const linkEl = card.querySelector('a[href*="/product/"], a[href*="/t/"], a[class*="product"]');
        const url = linkEl?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        const nameEl = card.querySelector('[class*="product-name"], [class*="title"], h3, h2');
        const name = (nameEl?.textContent || linkEl?.textContent || '').trim();
        if (!name) return null;

        const imgEl = card.querySelector('img');
        const image = imgEl?.src || '';

        const salePriceEl = card.querySelector('[class*="sale-price"], [class*="current-price"], .price-sales');
        const origPriceEl = card.querySelector('[class*="original-price"], [class*="was-price"], [class*="strike"]');

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);

        if (!price || !originalPrice || price >= originalPrice) return null;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;

        const gender = name.toLowerCase().includes('women') ? 'Women' :
                      name.toLowerCase().includes('men') ? 'Men' : '';

        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'CAD', gender, tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`converse-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name, gender: d.gender || '' }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`Converse: found ${tagged.length} deals`);
    return tagged;

  } finally {
    await context.close();
  }
}

function extractConverseProducts(json, out, seenIds) {
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

function mapConverseProduct(p) {
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
    const url = slug ? `https://www.converse.com/en-ca/t/${slug}` : 'https://www.converse.com/en-ca/c/sale';
    const image = p.productInfo?.images?.portraitURL || p.images?.[0]?.url || '';

    return {
      id: slugify(`converse-${name}-${p.id || ''}`),
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
