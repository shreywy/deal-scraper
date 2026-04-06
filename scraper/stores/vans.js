'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Vans';
const STORE_KEY = 'vans';
const CURRENCY = 'CAD';

// Vans CA doesn't have a sale tab — shop all products and filter for items with sale prices
const CATEGORY_PAGES = [
  { url: 'https://www.vans.com/en-ca/men/footwear.html', gender: 'Men', label: "men's footwear" },
  { url: 'https://www.vans.com/en-ca/men/clothing.html', gender: 'Men', label: "men's clothing" },
  { url: 'https://www.vans.com/en-ca/women/footwear.html', gender: 'Women', label: "women's footwear" },
  { url: 'https://www.vans.com/en-ca/women/clothing.html', gender: 'Women', label: "women's clothing" },
];

/**
 * Vans CA — VF Corporation platform
 * Navigates to all-products pages and filters for items with sale prices
 * Uses XHR intercept + DOM fallback
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: {
      'Accept-Language': 'en-CA,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept API responses (VF platform often uses JSON responses)
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('vans.')) return;

    try {
      const json = await response.json();
      // VF platform patterns
      const products =
        json?.productSearchResult?.products ||
        json?.products ||
        json?.hits ||
        json?.data?.products ||
        json?.results ||
        json?.items ||
        [];

      for (const p of products) {
        const id = p.id || p.productId || p.sku || p.code || '';
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        rawProducts.push(p);
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: pageUrl, gender, label } of CATEGORY_PAGES) {
    onProgress(`Vans: loading ${label}…`);
    const page = await context.newPage();

    try {
      const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Check for blocking
      if (response && (response.status() === 403 || response.status() === 503 || response.status() === 404)) {
        onProgress(`Vans: ${label} page returned ${response.status()} - possible bot block or URL changed`);
        await page.close();
        continue;
      }

      // Cookie consent
      try { await page.click('#onetrust-accept-btn-handler, [data-testid="cookie-accept"]', { timeout: 4000 }); } catch (_) {}

      await page.waitForTimeout(3000);

      // Check if page loaded successfully
      const hasProducts = await page.evaluate(() => {
        const cards = document.querySelectorAll('.product, .product-tile, [class*="product"]');
        return cards.length > 0;
      });

      if (!hasProducts) {
        onProgress(`Vans: ${label} page loaded but no products found`);
        await page.close();
        continue;
      }

      // Scroll and load more
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        try {
          const btn = await page.$('button[class*="load-more"], button[class*="LoadMore"], [data-testid*="load-more"]');
          if (btn && await btn.isVisible()) {
            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            await page.waitForTimeout(2000);
          }
        } catch (_) {}
      }

      // Process XHR products first (filter for items on sale)
      const currentPageDeals = [];
      for (const p of rawProducts) {
        const d = mapProduct(p, gender, seenUrls);
        if (d) currentPageDeals.push(d);
      }

      // DOM scrape for sale items (always run to catch items XHR might miss)
      const domDeals = await page.evaluate(({ storeName, storeKey, gender }) => {
        const parsePrice = el => {
          if (!el) return null;
          const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };

        // VF platform selectors (similar to North Face)
        const cardSels = [
          '.product',
          '.product-tile',
          'div[class*="product"]',
          '[data-testid*="product"]',
          'li[class*="product"]',
          'article[class*="product"]',
        ];

        let cards = [];
        for (const sel of cardSels) {
          const found = [...document.querySelectorAll(sel)];
          if (found.length > 0) { cards = found; break; }
        }

        const seen = new Set();
        return cards.map(card => {
          const link = card.querySelector('a[href*="/p/"], a.thumb-link, a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);

          // VF platform name and price selectors
          const name =
            card.querySelector('.tile-body .product-name, .product-name, h2, h3, [class*="name"]')?.textContent?.trim() || '';

          // Look for BOTH sale price AND original price (strikethrough)
          const salePriceEl = card.querySelector('.price .sales .value, .price-sales, [class*="sale-price"], [class*="salePrice"], [class*="current"]');
          const origPriceEl = card.querySelector('.price .strike-through .value, .price-standard, del, s, [class*="original-price"], [class*="was"]');

          const price = parsePrice(salePriceEl);
          const originalPrice = parsePrice(origPriceEl);

          const imgEl = card.querySelector('img[src]');
          const image = imgEl?.src || '';

          // Only include items that have BOTH prices (indicating a sale)
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
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
            gender,
            tags: [],
          };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY, gender });

      // Merge DOM deals
      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push({
            ...d,
            id: slugify(`${STORE_KEY}-${d.name}`),
            currency: CURRENCY,
            priceCAD: d.price,
            originalPriceCAD: d.originalPrice,
            tags: tag({ name: d.name, gender: d.gender || '' }),
            scrapedAt: new Date().toISOString(),
          });
        }
      }

      // Add XHR deals
      for (const d of currentPageDeals) {
        allDeals.push(d);
      }

      onProgress(`Vans: ${label} — found ${domDeals.length} deals`);
    } catch (err) {
      onProgress(`Vans: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();

  onProgress(`Vans: found ${allDeals.length} total deals`);
  return allDeals;
}

function mapProduct(p, gender, seen) {
  try {
    // VF platform product mapping
    const name = p.productName || p.name || p.title || '';
    if (!name) return null;

    const price = parseFloat(
      p.price?.sales?.value ||
      p.price?.sales ||
      p.salePrice ||
      p.price?.min?.sales?.value ||
      p.price?.current ||
      0
    );
    const originalPrice = parseFloat(
      p.price?.list?.value ||
      p.price?.list ||
      p.listPrice ||
      p.price?.min?.list?.value ||
      p.price?.original ||
      0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.productId || p.id || '';
    const url = p.pdpUrl || p.url || (id ? `https://www.vans.ca/en-ca/p/${id}` : '');

    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image =
      p.images?.[0]?.url ||
      p.images?.[0]?.link ||
      p.image?.url ||
      p.imageUrl ||
      '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${id}`),
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
      gender,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) {
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
