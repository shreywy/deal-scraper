'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Gap CA';
const STORE_KEY = 'gap';
const CURRENCY = 'CAD';

const SALE_PAGES = [
  { url: 'https://gap.com/browse/category.do?cid=11900&department=75&style=1132935', gender: 'Men', label: "men's" },
  { url: 'https://gap.com/browse/category.do?cid=8792&department=136', gender: 'Women', label: "women's" },
];

/**
 * Gap CA — GAP Inc platform (same as Banana Republic CA).
 * Uses XHR intercept + DOM fallback.
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

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('api.gap.com/commerce/search')) return;
    try {
      const json = await response.json();
      // GAP API returns products array with full details
      const products = json?.products || [];
      for (const p of products) {
        const styleId = p.styleId;
        if (!styleId || seenIds.has(styleId)) continue;
        seenIds.add(styleId);
        // Each product has multiple colors in styleColors array
        for (const color of (p.styleColors || [])) {
          const colorId = color.ccId;
          if (colorId && !seenIds.has(colorId)) {
            seenIds.add(colorId);
            rawProducts.push({ ...p, color });
          }
        }
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: pageUrl, gender, label } of SALE_PAGES) {
    onProgress(`Gap CA: loading ${label} sale…`);
    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);

      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        try {
          const btn = await page.$('[data-testid="load-more-btn"], button[class*="load-more"], [class*="seeMore"]');
          if (btn && await btn.isVisible()) { await btn.click(); await page.waitForTimeout(2000); }
        } catch (_) {}
      }

      // XHR products
      for (const p of rawProducts) {
        const d = mapProduct(p, gender, seenUrls);
        if (d) allDeals.push(d);
      }

      if (allDeals.length === 0) {
        const domDeals = await page.evaluate(({ storeName, storeKey, gender }) => {
          const parsePrice = el => {
            const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };
          const cards = document.querySelectorAll(
            '[class*="product-card"], [class*="productCard"], [class*="product-item"], li[class*="product"]'
          );
          const seen = new Set();
          return [...cards].map(card => {
            const link = card.querySelector('a[href]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);
            const name = card.querySelector('[class*="productName"], [class*="product-name"], h3, h2')?.textContent?.trim() || '';
            const origEl = card.querySelector('del, s, [class*="original-price"], [class*="was-price"]');
            const saleEl = card.querySelector('[class*="sale-price"], [class*="markdown-price"], [class*="priceMarkdown"]');
            const imgEl = card.querySelector('img[src]');
            const price = parsePrice(saleEl);
            const originalPrice = parsePrice(origEl);
            if (!name || !price || !originalPrice || price >= originalPrice) return null;
            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) return null;
            return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, gender, tags: [] };
          }).filter(Boolean);
        }, { storeName: STORE_NAME, storeKey: STORE_KEY, gender });

        for (const d of domDeals) {
          if (!seenUrls.has(d.url)) { seenUrls.add(d.url); allDeals.push(d); }
        }
      }
    } catch (err) {
      onProgress(`Gap CA: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Gap CA: found ${tagged.length} deals`);
  return tagged;
}

function mapProduct(p, gender, seen) {
  try {
    // GAP API structure: product has styleName and color object
    const name = p.styleName || p.name || '';
    if (!name) return null;
    const color = p.color || {};
    const price = parseFloat(color.effectivePrice || 0);
    const originalPrice = parseFloat(color.regularPrice || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = parseInt(color.percentageOff || 0, 10);
    if (discount <= 0) return null;

    const styleId = p.styleId || '';
    const ccId = color.ccId || '';
    const url = `https://gap.com/browse/product.do?pid=${styleId}-${ccId}`;
    if (seen.has(url)) return null;
    seen.add(url);

    // Get image from color images array (use P01 or first available)
    const images = color.images || [];
    const p01 = images.find(img => img.type === 'P01');
    const imagePath = p01?.path || images[0]?.path || '';
    const image = imagePath ? `https://gap.com${imagePath}` : '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${ccId}`),
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
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
