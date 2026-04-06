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
  // H&M blocks all direct fetch requests with Akamai 403
  // Skip this approach entirely and go straight to browser
  throw new Error('Direct fetch blocked by Akamai');
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
    viewport: { width: 1920, height: 1080 },
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

  // Try multiple H&M sale URLs - some might bypass Akamai
  const saleURLs = [
    { url: 'https://www2.hm.com/en_ca/men/sale.html', gender: 'Men' },
    { url: 'https://www2.hm.com/en_ca/ladies/sale.html', gender: 'Women' },
  ];

  try {
    for (const { url, gender } of saleURLs) {
      try {
        onProgress(`H&M Canada: trying ${gender} sale page...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Check if blocked by Akamai
        const content = await page.content();
        if (content.includes('Access Denied') || content.includes('Akamai') || content.includes('403')) {
          onProgress(`H&M Canada: ${gender} - Akamai blocked`);
          continue;
        }

        try {
          await page.click('#onetrust-accept-btn-handler, button:has-text("Accept"), button:has-text("OK")', { timeout: 3000 });
        } catch (_) {}

        await page.waitForTimeout(3000);

        // Aggressive scrolling to load lazy products
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
        }

        // Process XHR-intercepted products
        for (const p of rawProducts) {
          const d = mapHMProduct(p, gender, seen);
          if (d) allDeals.push(d);
        }

        // Enhanced DOM scraping with more selectors
        const domDeals = await page.evaluate(({ storeName, storeKey, expectedGender }) => {
          const parsePrice = el => {
            if (!el) return null;
            const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          // Try multiple selector patterns
          const cards = document.querySelectorAll([
            'article.product-item',
            'li.product-item',
            '.item-link',
            '[data-product]',
            '[class*="product-tile"]',
            'article',
          ].join(', '));

          const seen = new Set();
          const results = [];

          for (const card of cards) {
            try {
              const link = card.querySelector('a[href*="/productpage"], a[href*=".html"]');
              if (!link) continue;

              const url = link.href;
              if (!url || seen.has(url)) continue;
              seen.add(url);

              // Multiple name selector patterns
              const nameEl = card.querySelector([
                '[class*="product-item-link"]',
                '[class*="item-heading"]',
                '[class*="name"]',
                'h3', 'h2',
              ].join(', '));

              const name = nameEl?.textContent?.trim() || '';
              if (!name) continue;

              // Multiple price selector patterns
              const salePriceEl = card.querySelector([
                '[class*="sale-price"]',
                '[class*="price-value"]',
                '.price span:not([class*="original"])',
                '.price .current',
              ].join(', '));

              const regularPriceEl = card.querySelector([
                '[class*="original-price"]',
                '[class*="compare-price"]',
                'del',
                's',
                '.price .old',
              ].join(', '));

              const price = parsePrice(salePriceEl);
              const originalPrice = parsePrice(regularPriceEl);

              if (!price || !originalPrice || price >= originalPrice) continue;

              const imgEl = card.querySelector('img');
              const image = imgEl?.src || imgEl?.dataset?.src || '';

              const discount = Math.round((1 - price / originalPrice) * 100);
              if (discount <= 0) continue;

              results.push({
                store: storeName,
                storeKey,
                name,
                url,
                image,
                price,
                originalPrice,
                discount,
                tags: [],
                gender: expectedGender,
              });
            } catch (e) {}
          }

          return results;
        }, { storeName: STORE_NAME, storeKey: STORE_KEY, expectedGender: gender });

        allDeals.push(...domDeals);
        onProgress(`H&M Canada: ${gender} - found ${domDeals.length} products`);

      } catch (err) {
        onProgress(`H&M Canada: ${gender} error — ${err.message}`);
      }
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
    tags: d.tags?.length ? d.tags : tag({ name: d.name, gender: d.gender }),
    scrapedAt: d.scrapedAt || new Date().toISOString(),
  }));

  onProgress(`H&M Canada: found ${tagged.length} deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
