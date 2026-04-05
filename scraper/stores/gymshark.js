'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Gymshark';
const STORE_KEY = 'gymshark';
const CURRENCY = 'CAD';
const SALE_URL = 'https://ca.gymshark.com/collections/sale';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Gymshark: navigating to sale page…');

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });
  const page = await context.newPage();
  const intercepted = [];

  // Gymshark fires API calls to their backend — capture any JSON product data
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('gymshark.com')) return;
    try {
      const json = await response.json();
      extractGymsharkProducts(json, intercepted);
    } catch (_) {}
  });

  try {
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Accept cookies
    try {
      await page.click('[id*="onetrust-accept"], [class*="cookie"] button, button[id*="accept"]', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(2000);
    await loadAllScroll(page, intercepted, onProgress, 'Gymshark');

    // If XHR gave us data, use it
    if (intercepted.length > 0) {
      const deals = intercepted.map(p => mapGymsharkProduct(p)).filter(Boolean);
      onProgress(`Gymshark: found ${deals.length} deals`);
      return deals;
    }

    // Try __NEXT_DATA__ extraction
    const nextData = await page.evaluate(() => {
      try { return window.__NEXT_DATA__; } catch (_) { return null; }
    });
    if (nextData) {
      const products = extractFromNextData(nextData);
      if (products.length > 0) {
        const deals = products.map(p => mapGymsharkProduct(p)).filter(Boolean);
        onProgress(`Gymshark: found ${deals.length} deals (Next.js data)`);
        return deals;
      }
    }

    // DOM fallback
    onProgress('Gymshark: using DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const CARD_SELS = [
        '[data-testid="product-card"]',
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        'li[class*="product"]',
        'article',
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
        const salePriceEl = card.querySelector('[class*="sale"], [class*="Sale"], [aria-label*="sale"]');
        const origPriceEl = card.querySelector('s, del, [class*="original"], [class*="was"], [class*="compare"]');
        const imgEl = card.querySelector('img[src]');
        const name = nameEl?.textContent?.trim() || '';
        const image = imgEl?.src || imgEl?.dataset?.src || '';
        const price = parsePrice(salePriceEl || card.querySelector('[class*="price"]'));
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'CAD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`${STORE_KEY}-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`Gymshark: found ${tagged.length} deals (DOM)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function extractGymsharkProducts(json, out) {
  // Various shapes Gymshark might return
  const candidates = [
    json?.products,
    json?.collection?.products,
    json?.data?.collection?.products?.nodes,
    json?.data?.products?.nodes,
    json?.items,
  ].filter(Array.isArray);

  for (const arr of candidates) {
    for (const p of arr) {
      if (p?.id && p?.title) out.push(p);
    }
  }
}

function extractFromNextData(data) {
  const out = [];
  try {
    const pageProps = data?.props?.pageProps;
    const prods =
      pageProps?.collection?.products?.nodes ||
      pageProps?.products?.nodes ||
      pageProps?.initialData?.collection?.products?.nodes || [];
    out.push(...prods);
  } catch (_) {}
  return out;
}

function mapGymsharkProduct(p) {
  try {
    const name = p.title || p.name || '';
    if (!name) return null;

    // Handle variants (pick cheapest on-sale variant)
    const variants = p.variants?.nodes || p.variants || [];
    let price = null, originalPrice = null;

    for (const v of variants) {
      const sp = parseFloat(v.price?.amount || v.price || 0);
      const cp = parseFloat(v.compareAtPrice?.amount || v.compareAtPrice || v.compare_at_price || 0);
      if (sp > 0 && cp > sp) {
        if (price === null || sp < price) { price = sp; originalPrice = cp; }
      }
    }

    // If no variants with sale, check product-level prices
    if (!price) {
      price = parseFloat(p.priceRange?.minVariantPrice?.amount || p.price || 0);
      originalPrice = parseFloat(p.compareAtPriceRange?.minVariantPrice?.amount || p.compare_at_price || 0);
    }

    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || slugify(name);
    const url = `https://ca.gymshark.com/products/${handle}`;
    const image = p.featuredImage?.url || p.images?.nodes?.[0]?.url || p.images?.[0]?.src || '';

    return {
      id: slugify(`gymshark-${name}-${p.id || ''}`),
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

async function loadAllScroll(page, intercepted, onProgress, storeName) {
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
      if (intercepted.length) onProgress(`${storeName}: loading… (${intercepted.length})`);
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
