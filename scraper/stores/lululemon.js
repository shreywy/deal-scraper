'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Lululemon';
const STORE_KEY = 'lululemon';
const CURRENCY = 'CAD';

// Lululemon CA sale pages
const SALE_URLS = [
  'https://shop.lululemon.com/c/sale',
  'https://shop.lululemon.com/c/mens-sale',
];

/**
 * Lululemon Canada — intercepts XHR product search responses.
 *
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

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept product API responses
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('lululemon.com') && !url.includes('coveo')) return;

    try {
      const json = await response.json();
      extractProducts(json, rawProducts, seenIds);
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const saleUrl of SALE_URLS) {
    onProgress(`Lululemon: loading ${saleUrl.includes('mens') ? "men's" : "women's"} sale…`);
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      try { await page.click('[data-testid="accept-cookies"], #onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(5000);

      // Wait for product grid to load
      try {
        await page.waitForSelector('[data-testid="product-card"], [class*="ProductCard"]', { timeout: 10000 });
      } catch (_) {
        onProgress(`Lululemon: no product cards found on ${saleUrl}`);
      }

      // Scroll to trigger lazy loading
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        // Click "Show more" if present
        try {
          const btn = await page.$('button[data-testid*="more"], button[class*="show-more"], button[class*="load-more"]');
          if (btn && await btn.isVisible()) {
            await btn.click();
            await page.waitForTimeout(2000);
          }
        } catch (_) {}
      }

      // DOM fallback
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = txt => {
          const n = parseFloat((txt || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll(
          '[data-testid="product-card"], [class*="ProductCard"], [class*="product-card"]'
        );
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const nameEl = card.querySelector('[data-testid="product-tile-title"], h3, h2, [class*="name"]');
          const name = nameEl?.textContent?.trim() || '';
          // Lululemon shows prices like "$62" and crossed-out "$89"
          const priceEls = card.querySelectorAll('[data-testid*="price"], [class*="price"]');
          let price = null, originalPrice = null;
          for (const el of priceEls) {
            const txt = el.textContent || '';
            const n = parsePrice(txt);
            if (!n) continue;
            if (el.tagName === 'DEL' || el.tagName === 'S' || el.className?.includes?.('was') || el.className?.includes?.('original')) {
              originalPrice = n;
            } else if (price === null) {
              price = n;
            }
          }
          if (!price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          const imgEl = card.querySelector('img');
          const image = imgEl?.src || imgEl?.dataset?.src || '';
          return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }
    } catch (err) {
      onProgress(`Lululemon: error — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  // Also process any XHR-intercepted products
  const xhrDeals = rawProducts.map(p => mapProduct(p)).filter(Boolean);
  for (const d of xhrDeals) {
    if (!seenUrls.has(d.url)) {
      seenUrls.add(d.url);
      allDeals.push(d);
    }
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

  await context.close();
  onProgress(`Lululemon: found ${tagged.length} deals`);
  return tagged;
}

function extractProducts(json, out, seenIds) {
  // Lululemon may return products in various API response shapes
  const candidates = [
    json?.products,
    json?.results,
    json?.items,
    json?.data?.products,
    json?.searchResults?.products,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const id = p?.id || p?.productId || p?.sku;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      out.push(p);
    }
  }
}

function mapProduct(p) {
  try {
    const name = p.displayName || p.name || p.title || '';
    if (!name) return null;
    const price = parseFloat(p.salePrice || p.price?.sale || p.prices?.sale || 0);
    const originalPrice = parseFloat(p.regularPrice || p.price?.list || p.prices?.list || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;
    const slug = p.slug || p.handle || p.productId || '';
    const url = slug ? `https://www.lululemon.com/en-ca/p/${slug}` : '';
    if (!url) return null;
    const image = p.images?.[0]?.url || p.image || p.imageUrl || '';
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
