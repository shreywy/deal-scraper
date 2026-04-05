'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'YoungLA';
const STORE_KEY = 'youngla';
const CURRENCY = 'USD';
const SALE_URL = 'https://youngla.com/collections/sale';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('YoungLA: fetching USD→CAD rate…');
  const rate = await getUSDtoCAD();
  onProgress(`YoungLA: 1 USD = ${rate.toFixed(4)} CAD`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  const intercepted = [];
  const interceptedIds = new Set();

  // Capture Shopify Storefront API or any JSON product data
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    try {
      const json = await response.json();
      // Shopify products.json format
      const products = json?.products || json?.data?.collection?.products?.edges?.map(e => e.node) || [];
      for (const p of products) {
        const key = p.id || p.handle;
        if (key && !interceptedIds.has(key)) {
          interceptedIds.add(key);
          intercepted.push(p);
        }
      }
    } catch (_) {}
  });

  try {
    onProgress('YoungLA: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);
    await loadAllScroll(page, intercepted, onProgress);

    if (intercepted.length > 0) {
      const deals = intercepted.map(p => mapShopifyProduct(p, rate)).filter(Boolean);
      onProgress(`YoungLA: found ${deals.length} deals (XHR)`);
      return deals;
    }

    // __NEXT_DATA__ / window data
    const products = await page.evaluate(() => {
      // Try multiple Shopify data injection points
      if (window.__NEXT_DATA__) {
        const pp = window.__NEXT_DATA__?.props?.pageProps;
        return pp?.collection?.products?.nodes || pp?.products || [];
      }
      // Shopify theme globals
      if (window.ShopifyAnalytics?.meta?.page?.collections) return [];
      return [];
    });
    if (products.length > 0) {
      const deals = products.map(p => mapShopifyProduct(p, rate)).filter(Boolean);
      if (deals.length > 0) {
        onProgress(`YoungLA: found ${deals.length} deals (page data)`);
        return deals;
      }
    }

    // DOM fallback
    onProgress('YoungLA: DOM scrape…');
    const rawDeals = await page.evaluate(({ storeName, storeKey }) => {
      const CARD_SELS = [
        '[data-product-id]',
        '[class*="product-card"]',
        '[class*="ProductCard"]',
        '.grid-item',
        'li[class*="product"]',
      ];
      let cards = [];
      for (const sel of CARD_SELS) {
        cards = [...document.querySelectorAll(sel)];
        if (cards.length > 0) break;
      }
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
        const nameEl = card.querySelector('[class*="title"], [class*="name"], h2, h3');
        const salePriceEl = card.querySelector('[class*="sale"], [class*="Sale"]');
        const origPriceEl = card.querySelector('s, del, [class*="compare"], [class*="original"]');
        const imgEl = card.querySelector('img[src]');
        const name = nameEl?.textContent?.trim() || '';
        const image = imgEl?.src || imgEl?.dataset?.src || '';
        const price = parsePrice(salePriceEl || card.querySelector('[class*="price"]'));
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'USD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = rawDeals.map(d => ({
      ...d,
      id: slugify(`youngla-${d.name}`),
      priceCAD: Math.round(d.price * rate * 100) / 100,
      originalPriceCAD: Math.round(d.originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`YoungLA: found ${tagged.length} deals (DOM)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function mapShopifyProduct(p, rate) {
  try {
    const name = p.title || p.name || '';
    if (!name) return null;

    // Variants: find the cheapest on-sale one
    const variants = p.variants?.nodes || p.variants || [];
    let price = null, originalPrice = null;
    for (const v of variants) {
      const sp = parseFloat(v.price?.amount || v.price || 0);
      const cp = parseFloat(v.compareAtPrice?.amount || v.compareAtPrice || v.compare_at_price || 0);
      if (sp > 0 && cp > sp && (price === null || sp < price)) {
        price = sp; originalPrice = cp;
      }
    }
    if (!price) {
      price = parseFloat(p.priceRange?.minVariantPrice?.amount || p.price || 0);
      originalPrice = parseFloat(p.compareAtPriceRange?.minVariantPrice?.amount || p.compare_at_price || 0);
    }
    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || slugify(name);
    const url = `https://youngla.com/products/${handle}`;
    const image = p.featuredImage?.url || p.images?.nodes?.[0]?.url || p.images?.[0]?.src || '';

    return {
      id: slugify(`youngla-${name}-${p.id || ''}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: Math.round(price * rate * 100) / 100,
      originalPriceCAD: Math.round(originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function loadAllScroll(page, intercepted, onProgress) {
  let lastHeight = 0;
  let lastCount = 0;
  let stable = 0;
  for (let i = 0; i < 30; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    if (h === lastHeight && intercepted.length === lastCount) {
      if (++stable >= 3) break;
    } else {
      stable = 0; lastHeight = h; lastCount = intercepted.length;
      if (intercepted.length) onProgress(`YoungLA: loading… (${intercepted.length})`);
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
