'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Lululemon';
const STORE_KEY = 'lululemon';
const CURRENCY = 'CAD';

// Lululemon CA sale pages
const SALE_URLS = [
  'https://www.lululemon.com/en-ca/c/womens-sale/',
  'https://www.lululemon.com/en-ca/c/mens-sale/',
];

/**
 * Lululemon Canada — extracts sale products from __NEXT_DATA__ embedded in sale pages.
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

  const seenUrls = new Set();
  const allDeals = [];

  for (const saleUrl of SALE_URLS) {
    onProgress(`Lululemon: loading ${saleUrl.includes('mens') ? "men's" : "women's"} sale…`);
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      try { await page.click('[data-testid="accept-cookies"], #onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(8000);

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

      // Extract products from __NEXT_DATA__
      const nextDataDeals = await page.evaluate(({ storeName, storeKey, baseUrl }) => {
        try {
          const nd = window.__NEXT_DATA__;
          const queries = nd?.props?.pageProps?.dehydratedState?.queries || [];
          const ptq = queries.find(q => q.queryKey?.[0] === 'productTileData');
          const data = ptq?.state?.data || {};
          const entries = Object.values(data);

          return entries.map(product => {
            try {
              const sku = product?.defaultSku;
              const price = parseFloat(sku?.price?.salePrice || 0);
              const originalPrice = parseFloat(sku?.price?.listPrice || 0);
              const onSale = sku?.price?.onSale;

              if (!onSale || !price || !originalPrice || price >= originalPrice) return null;

              const name = product?.productName || product?.productSummary?.displayName || '';
              if (!name) return null;

              const discount = Math.round((1 - price / originalPrice) * 100);
              if (discount <= 0) return null;

              const productId = product?.productId || product?.id || '';
              const href = product?.href || '';
              const url = href ? `${baseUrl}${href}` : '';
              if (!url) return null;

              const image = product?.imageUrl || product?.colors?.[0]?.imageUrl || '';

              // Determine gender from URL
              const gender = baseUrl.includes('mens') ? 'Men' : (baseUrl.includes('womens') ? 'Women' : '');

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
                tags: []
              };
            } catch (_) { return null; }
          }).filter(Boolean);
        } catch (_) {
          return [];
        }
      }, {
        storeName: STORE_NAME,
        storeKey: STORE_KEY,
        baseUrl: saleUrl.includes('mens') ? 'https://www.lululemon.com' : 'https://www.lululemon.com'
      });

      for (const d of nextDataDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }

      onProgress(`Lululemon: extracted ${nextDataDeals.length} from __NEXT_DATA__`);
    } catch (err) {
      onProgress(`Lululemon: error — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: d.tags?.length ? d.tags : tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: d.scrapedAt || new Date().toISOString(),
  }));

  await context.close();
  onProgress(`Lululemon: found ${tagged.length} deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
