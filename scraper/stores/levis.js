'use strict';

const { tag } = require('../tagger');

// Levi's CA uses Salesforce Commerce Cloud (SFCC) platform.
// Strategy: scroll + Load More + extract from product cards with DOM scraping.
// Try window.__NEXT_DATA__ or SFCC window state first, then DOM fallback.

const URLS = ['https://www.levi.com/CA/en_CA/sale/c/levi_clothing_sale'];
const STORE_NAME = "Levi's CA";
const STORE_KEY = 'levis';
const CURRENCY = 'CAD';

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

  const allDeals = [];
  const seenUrls = new Set();

  for (const url of URLS) {
    onProgress(`Levi's CA: loading sale page…`);
    const page = await context.newPage();
    try {
      const pageDeals = await scrapePage(page, url, onProgress);
      for (const d of pageDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }
    } catch (err) {
      onProgress(`Levi's CA: error on ${url} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  onProgress(`Levi's CA: found ${allDeals.length} deals total`);
  return allDeals;
}

async function scrapePage(page, url, onProgress) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Dismiss cookie banner
  try {
    await page.click('#onetrust-accept-btn-handler, [class*="onetrust-accept"], button[class*="cookie-accept"]', { timeout: 4000 });
  } catch (_) {}

  // Wait for any product to appear
  const PRODUCT_SEL = [
    '[class*="product-tile"]',
    '[class*="ProductCard"]',
    'article[class*="product"]',
    '[class*="product-card"]',
    'li[class*="product"]',
  ].join(', ');

  try {
    await page.waitForSelector(PRODUCT_SEL, { timeout: 20000 });
  } catch (_) {
    onProgress("Levi's CA: no product grid found, trying scroll anyway…");
  }

  // Scroll + click "Load More" until all products are visible
  await loadAllProducts(page, onProgress);

  const deals = await page.evaluate(({ storeName, storeKey }) => {
    // --- Strategy 1: Try window.__NEXT_DATA__ or SFCC window state ---
    try {
      const nextData = window.__NEXT_DATA__?.props?.pageProps;
      const sfcc = window.__STORE_STATE__ || nextData;

      if (sfcc) {
        const products =
          sfcc?.products?.productList ||
          sfcc?.searchResult?.products ||
          sfcc?.category?.products ||
          nextData?.products || [];

        if (products.length > 0) {
          return products.map(p => {
            const price = p.price?.salePriceValue || p.price?.salePrice || p.salePrice;
            const originalPrice = p.price?.listPriceValue || p.price?.listPrice || p.listPrice;
            if (!price || !originalPrice || price >= originalPrice) return null;
            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) return null;
            const name = p.productName || p.name || '';
            const slug = p.productId || p.masterId || p.id || '';
            const prodUrl = p.url || `https://www.levi.com/en-CA/p/${slug}`;
            const image = p.images?.[0]?.url || p.imageUrl || '';
            return { store: storeName, storeKey, name, url: prodUrl, image, price, originalPrice, discount, tags: [] };
          }).filter(Boolean);
        }
      }
    } catch (_) {}

    // --- Strategy 2: DOM scraping with Levi's-specific selectors ---
    const cardSelectors = [
      '[class*="product-tile"]',
      '[class*="ProductCard"]',
      'article[class*="product"]',
      '[class*="product-card"]',
      'li[class*="product"]',
      'div[class*="ProductTile"]',
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > 0) { cards = found; break; }
    }

    // Deduplicate by href
    const seen = new Set();
    const unique = cards.filter(card => {
      const href = card.querySelector('a[href]')?.href || '';
      if (!href || seen.has(href)) return false;
      seen.add(href);
      return true;
    });

    const parsePrice = el => {
      if (!el) return null;
      const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/[^0-9.]/g, '');
      const n = parseFloat(text);
      return isNaN(n) ? null : n;
    };

    return unique.map(card => {
      const link = card.querySelector('a[href]');
      const nameEl = card.querySelector([
        '[class*="product-name"]',
        '[class*="productName"]',
        '[class*="ProductName"]',
        '[class*="title"]',
        'h2', 'h3', 'h4',
      ].join(', '));

      // Levi's-specific price selectors
      const salePriceEl = card.querySelector([
        '.levi-price-sale',
        '[class*="price-sale"]',
        '[class*="sale-price"]',
        '[class*="salePrice"]',
        '[class*="promo-price"]',
        '[class*="reduced"]',
        '[aria-label*="Sale"]',
      ].join(', '));

      const origPriceEl = card.querySelector([
        '[class*="was-price"]',
        '[class*="wasPrice"]',
        '[class*="original-price"]',
        '[class*="originalPrice"]',
        '[class*="list-price"]',
        's', 'del', 'strike',
      ].join(', '));

      const imgEl = card.querySelector('img[src]:not([src=""]), img[data-src]');

      const name = nameEl?.textContent?.trim() || '';
      const cardUrl = link?.href || '';
      const image = imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || '';

      const price = parsePrice(salePriceEl);
      const originalPrice = parsePrice(origPriceEl);

      if (!name || !cardUrl || price === null) return null;

      const discount = originalPrice && originalPrice > price
        ? Math.round((1 - price / originalPrice) * 100)
        : 0;

      if (discount <= 0) return null;

      return { store: storeName, storeKey, name, url: cardUrl, image, price, originalPrice, discount, tags: [] };
    }).filter(Boolean);
  }, { storeName: STORE_NAME, storeKey: STORE_KEY });

  // Add tags, IDs, and currency fields
  return deals.map(d => ({
    ...d,
    id: slugify(`${d.storeKey}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name }),
    scrapedAt: new Date().toISOString(),
  }));
}

// Click "Load More" / "Show More" buttons until they disappear, scrolling between each click.
async function loadAllProducts(page, onProgress) {
  const LOAD_MORE_SEL = [
    'button[data-testid*="load-more"]',
    'button[class*="load-more"]',
    'button[class*="LoadMore"]',
    'button[class*="show-more"]',
    'button[class*="ShowMore"]',
    '[class*="pagination"] button',
    'button[aria-label*="more"]',
  ].join(', ');

  let round = 0;
  const MAX_ROUNDS = 20; // safety cap

  while (round < MAX_ROUNDS) {
    // Scroll to bottom to trigger any lazy-load triggers
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Try clicking a "Load More" button
    try {
      const btn = await page.$(LOAD_MORE_SEL);
      if (!btn) break; // No more button — all loaded
      const visible = await btn.isVisible();
      if (!visible) break;

      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      round++;
      onProgress(`Levi's CA: loading more products (page ${round + 1})…`);
      await page.waitForTimeout(2000);
    } catch (_) {
      break;
    }
  }

  // Final scroll to capture any remaining lazy-loaded images
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
