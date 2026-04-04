'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Zara';
const STORE_KEY = 'zara';

// Zara (Inditex) is a heavy React SPA. They have an internal API but it
// requires session cookies + specific headers. We use Playwright and intercept
// network responses to capture the JSON product data as the page loads.
// This approach also works for other Inditex brands (Pull&Bear, Bershka, etc.)
// by changing the BASE_URL.

const SALE_URLS = [
  'https://www.zara.com/ca/en/sale-l1333.html',   // All sale
  // Men/Women specific pages are loaded via filters on the same URL
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
    extraHTTPHeaders: {
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  });
  const page = await context.newPage();

  const interceptedProducts = [];

  // Zara's internal API returns product arrays in responses to paths like
  // /api/catalog/store/... — capture all of them
  page.on('response', async response => {
    const url = response.url();
    if (
      (url.includes('/api/catalog') || url.includes('/api/product')) &&
      response.headers()['content-type']?.includes('application/json')
    ) {
      try {
        const json = await response.json();
        extractZaraProducts(json, interceptedProducts);
      } catch (_) {}
    }
  });

  try {
    onProgress('Zara: navigating to sale page…');
    await page.goto(SALE_URLS[0], { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Handle cookie consent
    try {
      await page.click('[id*="onetrust-accept"], button[class*="accept"], [data-testid="accept-all-cookies"]', { timeout: 4000 });
    } catch (_) {}

    onProgress('Zara: waiting for products to load…');
    await page.waitForTimeout(3000);

    // Scroll to trigger lazy loading + additional API calls
    await autoScroll(page);
    await page.waitForTimeout(1500);

    if (interceptedProducts.length > 0) {
      onProgress(`Zara: captured ${interceptedProducts.length} products from network`);
      const deals = mapZaraProducts(interceptedProducts);
      onProgress(`Zara: found ${deals.length} sale items`);
      return deals;
    }

    // Fallback: DOM scrape
    onProgress('Zara: falling back to DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = document.querySelectorAll(
        '[class*="product-grid-product"], article[class*="product"], [data-testid="product"]'
      );
      return [...cards].map(card => {
        const link = card.querySelector('a[href]');
        const nameEl = card.querySelector('[class*="product-grid-product-info__name"], h2, [class*="name"]');
        const salePriceEl = card.querySelector('[class*="price__sale"], [class*="sale-price"], [aria-label*="sale"]');
        const origPriceEl = card.querySelector('[class*="price__old"], s, del, [class*="original-price"]');
        const imgEl = card.querySelector('img[src*="zara"], img[src*="static"]');

        const name = nameEl?.textContent?.trim() || '';
        const url = link?.href || '';
        const image = imgEl?.src || '';
        const parsePrice = el => {
          if (!el) return null;
          const n = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    return deals.map(d => ({
      ...d,
      id: slugify(`${d.storeKey}-${d.name}`),
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

  } finally {
    await context.close();
  }
}

function extractZaraProducts(json, out) {
  // Zara API nests products under various keys depending on endpoint
  const candidates = [
    json?.productGroups,
    json?.products,
    json?.elements,
    json?.catalog,
  ].flat().filter(Boolean);

  for (const item of candidates) {
    if (Array.isArray(item)) {
      for (const p of item) {
        if (p?.name && p?.detail?.colors) out.push(p);
        else if (Array.isArray(p?.products)) out.push(...p.products);
      }
    } else if (item?.name && item?.detail?.colors) {
      out.push(item);
    }
  }
}

function mapZaraProducts(raw) {
  const seen = new Set();
  const deals = [];

  for (const item of raw) {
    try {
      const name = item.name || '';
      const colors = item.detail?.colors || [{}];
      const firstColor = colors[0] || {};

      // Prices
      const priceObj = firstColor.price || item.price || {};
      const price = priceObj.value ?? null;
      const originalPrice = priceObj.originalValue ?? priceObj.value ?? null;

      if (!price || !originalPrice || price >= originalPrice) continue;
      const discount = Math.round((1 - price / originalPrice) * 100);
      if (discount <= 0) continue;

      // URL
      const seo = item.seo || {};
      const slug = seo.keyword || item.id;
      const url = `https://www.zara.com/ca/en/${slug}-p${item.id}.html`;

      if (seen.has(url)) continue;
      seen.add(url);

      // Image
      const media = firstColor.xmedia?.[0] || firstColor.media?.[0] || {};
      const image = media.url
        ? `https://static.zara.net/assets${media.url}/w/750`
        : '';

      // Gender from URL/section
      const genderHint = (item.sectionName || item.section || '').toLowerCase();
      const gender = genderHint.includes('woman') || genderHint.includes('women') ? 'Women'
        : genderHint.includes('man') || genderHint.includes('men') ? 'Men'
        : '';

      deals.push({
        id: slugify(`${STORE_KEY}-${name}`),
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

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        total += 600;
        if (total >= document.body.scrollHeight * 1.5) { clearInterval(timer); resolve(); }
      }, 250);
    });
  });
  await page.waitForTimeout(1000);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
