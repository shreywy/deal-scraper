'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Urban Outfitters';
const STORE_KEY = 'urbanoutfitters';
const CURRENCY = 'CAD';

// Urban Outfitters CA sale pages (en-ca site with CAD pricing)
const SALE_PAGES = [
  { url: 'https://www.urbanoutfitters.com/en-ca/mens-sale', gender: 'Men', label: "men's" },
  { url: 'https://www.urbanoutfitters.com/en-ca/womens-sale', gender: 'Women', label: "women's" },
];

/**
 * Urban Outfitters CA — XHR intercept approach
 * UO uses internal API calls for product search
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
    },
  });

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept API responses
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('urbanoutfitters.com')) return;

    try {
      const json = await response.json();
      // Urban Outfitters API patterns
      const products =
        json?.products ||
        json?.data?.products ||
        json?.response?.products ||
        json?.results?.products ||
        json?.productResults ||
        json?.items ||
        [];

      for (const p of products) {
        const id = p.productId || p.id || p.sku || p.code || '';
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        rawProducts.push(p);
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: pageUrl, gender, label } of SALE_PAGES) {
    onProgress(`Urban Outfitters: loading ${label} sale…`);
    const page = await context.newPage();

    try {
      const response = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Check for blocking
      if (response && (response.status() === 403 || response.status() === 503)) {
        onProgress(`Urban Outfitters: access denied (${response.status()}) - likely bot-blocked`);
        await page.close();
        continue;
      }

      // Cookie consent
      try { await page.click('[data-testid="cookie-accept"], #onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}

      await page.waitForTimeout(3000);

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

      // Process XHR products first
      for (const p of rawProducts) {
        const d = mapProduct(p, gender, seenUrls);
        if (d) allDeals.push(d);
      }

      // DOM fallback if no XHR products found
      if (allDeals.length === 0) {
        const domDeals = await page.evaluate(({ storeName, storeKey, gender }) => {
          const parsePrice = el => {
            if (!el) return null;
            const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          const cardSels = [
            '[class*="product-card"]',
            '[class*="productCard"]',
            '[class*="product-tile"]',
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
            const link = card.querySelector('a[href]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);

            const name = card.querySelector('[class*="product-name"], [class*="productName"], h3, h2, [class*="title"]')?.textContent?.trim() || '';

            // Price selectors
            const salePriceEl = card.querySelector('[class*="sale-price"], [class*="salePrice"], [class*="current-price"], [class*="markdown"]');
            const origPriceEl = card.querySelector('del, s, [class*="original-price"], [class*="was-price"], [class*="compare"]');

            const price = parsePrice(salePriceEl);
            const originalPrice = parsePrice(origPriceEl);

            const imgEl = card.querySelector('img[src]');
            const image = imgEl?.src || '';

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
      }
    } catch (err) {
      onProgress(`Urban Outfitters: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();

  onProgress(`Urban Outfitters: found ${allDeals.length} deals`);
  return allDeals;
}

function mapProduct(p, gender, seen) {
  try {
    const name = p.name || p.productName || p.title || '';
    if (!name) return null;

    // Price patterns from UO API
    const price = parseFloat(
      p.price?.sale ||
      p.salePrice ||
      p.price?.current ||
      p.currentPrice ||
      p.price ||
      0
    );
    const originalPrice = parseFloat(
      p.price?.original ||
      p.originalPrice ||
      p.price?.regular ||
      p.regularPrice ||
      p.compareAtPrice ||
      0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.productId || p.id || p.sku || p.code || '';
    const slug = p.slug || p.handle || slugify(name);
    const url = p.url || p.link || `https://www.urbanoutfitters.com/en-ca/shop/${slug}`;

    if (seen.has(url)) return null;
    seen.add(url);

    // Image extraction
    const image =
      p.image?.url ||
      p.imageUrl ||
      p.image ||
      p.images?.[0]?.url ||
      p.images?.[0] ||
      '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${id || slug}`),
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
