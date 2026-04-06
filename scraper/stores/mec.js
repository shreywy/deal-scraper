'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'MEC';
const STORE_KEY = 'mec';
const CURRENCY = 'CAD';

// MEC (Mountain Equipment Co-op) - Canadian outdoor retailer
// Next.js site with product data embedded in page
const SALE_URL = 'https://www.mec.ca/en/products/sale';

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

  const interceptedProducts = [];
  const seenIds = new Set();

  // Intercept API responses that might contain product data
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;

    try {
      const json = await response.json();
      extractMecProducts(json, interceptedProducts, seenIds);
    } catch (_) {}
  });

  try {
    onProgress('MEC: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Accept cookies if present
    try {
      await page.click('button[id*="accept"], button[class*="accept"]', { timeout: 3000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    await loadAllProductsScroll(page, interceptedProducts, onProgress);

    if (interceptedProducts.length > 0) {
      const deals = interceptedProducts.map(p => mapMecProduct(p)).filter(Boolean);
      onProgress(`MEC: found ${deals.length} deals (API)`);
      return deals;
    }

    // DOM fallback
    onProgress('MEC: trying DOM scrape…');
    const rawDeals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = document.querySelectorAll('[class*="product"], [class*="Product"], [data-testid*="product"], article, [class*="card"]');

      const parsePrice = el => {
        if (!el) return null;
        const text = el.textContent || '';
        const n = parseFloat(text.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      const seen = new Set();
      return [...cards].map(card => {
        // Find link
        const link = card.querySelector('a[href*="/product"], a[href*="/products"]');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        // Find name
        const name = (
          card.querySelector('[class*="name"], [class*="Name"], [class*="title"], [class*="Title"], h2, h3, h4')?.textContent ||
          link?.getAttribute('aria-label') ||
          link?.textContent ||
          ''
        ).trim();

        if (!name) return null;

        // Find image
        const imgEl = card.querySelector('img');
        const image = imgEl?.src || imgEl?.dataset?.src || '';

        // Find prices - look for sale/current and original/compare prices
        const priceEls = card.querySelectorAll('[class*="price"], [class*="Price"]');
        let price = null;
        let originalPrice = null;

        for (const el of priceEls) {
          const cls = el.className || '';
          const text = el.textContent || '';
          const p = parsePrice(el);
          if (!p) continue;

          // Sale/current price indicators
          if (cls.includes('sale') || cls.includes('Sale') || cls.includes('current') || cls.includes('Current')) {
            if (!price || p < price) price = p;
          }
          // Original/compare price indicators
          else if (cls.includes('compare') || cls.includes('Compare') || cls.includes('original') || cls.includes('Original') ||
                   cls.includes('was') || cls.includes('Was') || cls.includes('standard') || cls.includes('Standard') ||
                   el.style?.textDecoration === 'line-through' || cls.includes('strike') || cls.includes('Strike')) {
            if (!originalPrice || p > originalPrice) originalPrice = p;
          }
          // If no specific class, take first as price, second as original
          else if (!price) {
            price = p;
          } else if (!originalPrice && p !== price) {
            originalPrice = p;
          }
        }

        if (!price || !originalPrice || price >= originalPrice) return null;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;

        return {
          store: storeName,
          storeKey,
          name,
          url,
          image,
          price,
          originalPrice,
          discount,
          currency: 'CAD',
          tags: []
        };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = rawDeals.map(d => ({
      ...d,
      id: slugify(`mec-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`MEC: found ${tagged.length} deals (DOM)`);
    return tagged;

  } catch (error) {
    onProgress(`MEC: error - ${error.message}`);
    return [];
  } finally {
    await context.close();
  }
}

function extractMecProducts(json, out, seenIds) {
  // Try common product data structures
  const products = json?.products || json?.items || json?.data?.products || json?.data?.items || [];

  const arr = Array.isArray(products) ? products : Object.values(products);
  for (const p of arr) {
    const id = p?.id || p?.productId || p?.sku || p?.handle;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(p);
  }
}

function mapMecProduct(p) {
  try {
    const name = p.name || p.title || p.productName || '';
    if (!name) return null;

    // Try various price field structures
    const price = parseFloat(
      p.price?.current || p.price?.sale || p.salePrice || p.currentPrice ||
      p.price || p.prices?.sale || 0
    );
    const originalPrice = parseFloat(
      p.price?.original || p.price?.list || p.comparePrice || p.originalPrice ||
      p.compareAtPrice || p.prices?.list || 0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || p.slug || slugify(name);
    const url = p.url || (handle ? `https://www.mec.ca/en/product/${handle}` : SALE_URL);
    const image = p.image?.url || p.imageUrl || p.images?.[0]?.url || p.featuredImage?.url || '';

    return {
      id: slugify(`mec-${name}-${p.id || ''}`),
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

async function loadAllProductsScroll(page, interceptedProducts, onProgress) {
  let lastHeight = 0;
  let lastCount = 0;
  let stable = 0;

  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    if (h === lastHeight && interceptedProducts.length === lastCount) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
      lastHeight = h;
      lastCount = interceptedProducts.length;
      if (interceptedProducts.length) {
        onProgress(`MEC: loading… (${interceptedProducts.length} products)`);
      }
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
