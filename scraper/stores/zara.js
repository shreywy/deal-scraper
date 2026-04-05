'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Zara';
const STORE_KEY = 'zara';

// Zara (Inditex) is a React SPA. Their internal catalog API serves JSON but
// requires session cookies embedded via the page load. Best approach: Playwright
// + response interception. Works for other Inditex brands too (just change BASE_URL).

// Try multiple sale entry points — Zara periodically restructures these URLs
const SALE_URLS = [
  'https://www.zara.com/ca/en/sale-l1333.html',
  'https://www.zara.com/ca/en/woman-sale-l1001.html',
  'https://www.zara.com/ca/en/man-sale-l1002.html',
];

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

  // Capture ALL JSON responses from Zara's domain — their internal API paths
  // change frequently, but the response structures are consistent
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('zara.com') && !url.includes('inditex.com')) return;

    try {
      const json = await response.json();
      const before = rawProducts.length;
      extractZaraProducts(json, rawProducts, seenIds);
      // Debug: log when we find products
      if (rawProducts.length > before) {
        // products found from this response — captured silently
      }
    } catch (_) {}
  });

  try {
    let foundProducts = false;

    for (const saleUrl of SALE_URLS) {
      onProgress(`Zara: loading ${saleUrl.split('/').pop()}…`);
      try {
        await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (_) {
        // Redirect / 404 — try next URL
        continue;
      }

      // Accept cookies once
      try {
        await page.click(
          '#onetrust-accept-btn-handler, [class*="onetrust-accept"], button[id*="accept"]',
          { timeout: 3000 }
        );
      } catch (_) {}

      await page.waitForTimeout(2000);
      await loadAllProductsScroll(page, rawProducts, onProgress);
      await page.waitForTimeout(1000);

      if (rawProducts.length > 0) { foundProducts = true; break; }
    }

    if (rawProducts.length > 0) {
      const deals = mapZaraProducts(rawProducts);
      onProgress(`Zara: found ${deals.length} sale items`);
      return deals;
    }

    if (!foundProducts) {
      onProgress('Zara: no network data captured, trying DOM scrape…');
    }

    // DOM fallback — Zara renders product cards even if we miss the API
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const CARD_SELS = [
        'article[class*="product"]',
        '[class*="product-grid-product"]',
        '[data-testid*="product"]',
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

        const nameEl = card.querySelector([
          '[class*="product-grid-product-info__name"]',
          '[class*="product-info__name"]',
          'h2', 'h3',
          '[class*="name"]',
        ].join(', '));
        const salePriceEl = card.querySelector('[class*="price__sale"], [class*="sale"], [aria-label*="sale"], [class*="current"]');
        const origPriceEl = card.querySelector('[class*="price__old"], [class*="old"], s, del, [class*="original"]');
        const imgEl = card.querySelector('img[src]');

        const name = nameEl?.textContent?.trim() || '';
        const image = imgEl?.currentSrc || imgEl?.src || '';

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;

        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`${d.storeKey}-${d.name}`),
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`Zara: found ${tagged.length} deals (DOM fallback)`);
    return tagged;

  } finally {
    await context.close();
  }
}

/**
 * Walk a Zara API response JSON tree and pull out product objects.
 * Handles multiple known response structures from different API versions.
 */
function extractZaraProducts(json, out, seenIds) {
  if (!json || typeof json !== 'object') return;

  // Structure 1: { sections: [{ elements: [{ type, commercialComponents: [...] }] }] }
  // Most common in current Zara SPA
  if (Array.isArray(json.sections)) {
    for (const section of json.sections) {
      for (const el of (section.elements || [])) {
        for (const p of (el.commercialComponents || [])) pushProduct(p, out, seenIds);
        // Some sections nest deeper
        for (const group of (el.productGroups || [])) {
          for (const p of (group.elements || [])) pushProduct(p, out, seenIds);
        }
      }
    }
  }

  // Structure 2: { productGroups: [{ type, elements: [...] }] }
  if (Array.isArray(json.productGroups)) {
    for (const group of json.productGroups) {
      for (const el of (group.elements || [])) {
        for (const p of (el.commercialComponents || [])) pushProduct(p, out, seenIds);
        pushProduct(el, out, seenIds);
      }
    }
  }

  // Structure 3: { products: [...] } or { elements: [...] }
  for (const key of ['products', 'elements', 'items', 'catalog']) {
    if (Array.isArray(json[key])) {
      for (const item of json[key]) {
        if (Array.isArray(item.commercialComponents)) {
          for (const p of item.commercialComponents) pushProduct(p, out, seenIds);
        } else {
          pushProduct(item, out, seenIds);
        }
      }
    }
  }
}

function pushProduct(p, out, seenIds) {
  if (!p || !p.id || seenIds.has(p.id)) return;
  // Must have name and color/price data to be useful
  if (!p.name) return;
  seenIds.add(p.id);
  out.push(p);
}

function mapZaraProducts(raw) {
  const deals = [];

  for (const item of raw) {
    try {
      const name = item.name || '';
      if (!name) continue;

      const colors = item.detail?.colors || item.colors || [{}];
      const firstColor = Array.isArray(colors) ? (colors[0] || {}) : {};

      // Price can be in firstColor.price, item.price, or item.detail.price
      const priceObj = firstColor.price || item.price || item.detail?.price || {};
      // Zara prices are in cents in some API versions (value > 1000), whole numbers in others
      const rawPrice = priceObj.value ?? priceObj.current?.value ?? null;
      const rawOrig = priceObj.originalValue ?? priceObj.old?.value ?? priceObj.oldValue ?? null;

      if (rawPrice === null) continue;
      // If no original price, this item isn't on sale
      if (rawOrig === null || rawPrice >= rawOrig) continue;

      const factor = rawPrice > 1000 ? 0.01 : 1;
      const price = Math.round(rawPrice * factor * 100) / 100;
      const originalPrice = Math.round(rawOrig * factor * 100) / 100;

      const discount = Math.round((1 - price / originalPrice) * 100);
      if (discount <= 0) continue;

      // Build URL
      const keyword = item.seo?.keyword || item.seoKeyword || slugify(name);
      const url = `https://www.zara.com/ca/en/${keyword}-p${item.id}.html`;

      // Image — Zara CDN
      const media = firstColor.xmedia?.[0] || firstColor.media?.[0] || {};
      let image = '';
      if (media.url) {
        // media.url is like /assets/public/.../image.jpg
        image = media.url.startsWith('http') ? media.url : `https://static.zara.net${media.url}?w=750`;
      }

      // Gender from section data
      const section = (item.sectionName || item.section || item.familyName || '').toLowerCase();
      const gender = section.includes('woman') || section.includes('women') ? 'Women'
        : section.includes('man') || section.includes('men') ? 'Men'
        : '';

      deals.push({
        id: slugify(`${STORE_KEY}-${name}-${item.id}`),
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name,
        url,
        image,
        price,
        originalPrice,
        discount,
        tags: tag({ name, gender }),
        scrapedAt: new Date().toISOString(),
      });
    } catch (_) {}
  }

  return deals;
}

// Zara uses infinite scroll — keep scrolling until product count stabilizes
async function loadAllProductsScroll(page, rawProducts, onProgress) {
  let prevCount = 0;
  let stableRounds = 0;
  const MAX_STABLE = 3; // stop after 3 scrolls with no new products
  const MAX_ROUNDS = 30;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    const currentCount = rawProducts.length;
    if (currentCount > prevCount) {
      onProgress(`Zara: loading products… (${currentCount} so far)`);
      stableRounds = 0;
      prevCount = currentCount;
    } else {
      stableRounds++;
      if (stableRounds >= MAX_STABLE) break;
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
