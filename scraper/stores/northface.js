'use strict';

const { tag } = require('../tagger');

// The North Face CA uses Salesforce Commerce Cloud (SFCC) — same platform as Under Armour.
const URLS = [
  'https://www.thenorthface.com/en-ca/sale?sz=120',
  'https://www.thenorthface.com/en-ca/outlet?sz=120',
];
const STORE_NAME = 'The North Face';
const STORE_KEY = 'northface';

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
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });

  const allDeals = [];
  const seenUrls = new Set();
  const rawProducts = [];
  const seenProductIds = new Set();

  for (const url of URLS) {
    const label = url.includes('outlet') ? 'outlet' : 'sale';
    onProgress(`The North Face: loading ${label} page…`);
    const page = await context.newPage();

    // Intercept XHR responses for SFCC API data
    page.on('response', async response => {
      const resUrl = response.url();
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('application/json')) return;
      if (!resUrl.includes('thenorthface.com')) return;

      try {
        const json = await response.json();
        // SFCC product search responses
        const products =
          json?.productSearchResult?.products ||
          json?.products ||
          json?.hits ||
          json?.data?.products ||
          [];
        for (const p of products) {
          const pid = p.id || p.productId || p.sku || Math.random();
          if (!seenProductIds.has(pid)) {
            seenProductIds.add(pid);
            rawProducts.push(p);
          }
        }
      } catch (_) {}
    });

    try {
      let response;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        if (err.message.includes('Timeout') || err.message.includes('ERR_')) {
          onProgress(`The North Face: failed to load ${label} page - likely bot-blocked or network error`);
          await page.close();
          continue;
        }
        throw err;
      }

      // Check for bot blocking
      if (response && (response.status() === 403 || response.status() === 503)) {
        onProgress(`The North Face: access denied (${response.status()}) - likely bot-blocked`);
        await page.close();
        continue;
      }

      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}

      await page.waitForTimeout(3000);

      // Check if page has products
      const hasProducts = await page.evaluate(() => {
        const cards = document.querySelectorAll('.product, .product-tile, .grid-tile, [class*="product"]');
        return cards.length > 0;
      });

      if (!hasProducts) {
        onProgress(`The North Face: ${label} page loaded but no products found - possible bot detection or site structure change`);
        await page.close();
        continue;
      }

      await loadAll(page, onProgress);

      // First, try to map XHR-intercepted products
      let deals = [];
      if (rawProducts.length > 0) {
        deals = rawProducts.map(p => mapNorthFaceProduct(p)).filter(Boolean);
      }

      // If no XHR products, try DOM
      if (deals.length === 0) {
        deals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = el => {
            if (!el) return null;
            const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          // Try SFCC window state first
          try {
            const sfcc = window.__STORE_STATE__ || window.__NEXT_DATA__?.props?.pageProps;
            if (sfcc) {
              const products =
                sfcc?.products?.productList ||
                sfcc?.searchResult?.products ||
                sfcc?.category?.products || [];
              if (products.length > 0) {
                return products.map(p => {
                  const price = p.price?.salePriceValue || p.price?.salePrice || p.salePrice;
                  const originalPrice = p.price?.listPriceValue || p.price?.listPrice || p.listPrice;
                  if (!price || !originalPrice || price >= originalPrice) return null;
                  const discount = Math.round((1 - price / originalPrice) * 100);
                  if (discount <= 0) return null;
                  const name = p.productName || p.name || '';
                  const prodUrl = p.url || p.pdpUrl || '';
                  const image = p.images?.[0]?.url || p.imageUrl || '';
                  return { store: storeName, storeKey, name, url: prodUrl, image, price, originalPrice, discount, tags: [] };
                }).filter(Boolean);
              }
            }
          } catch (_) {}

          // DOM fallback - The North Face uses SFCC
          const cardSels = [
            '.product',
            '.product-tile',
            'div[class*="product"]',
            '[data-testid="product-card"]',
            '[class*="ProductCard"]',
            'li[class*="product"]',
          ];
          let cards = [];
          for (const sel of cardSels) {
            const found = [...document.querySelectorAll(sel)];
            if (found.length > 0) { cards = found; break; }
          }

          const seen = new Set();
          return cards.map(card => {
            // SFCC-specific selectors
            const link = card.querySelector('a.thumb-link, a[href*="/p/"]');
            const cardUrl = link?.href || '';
            if (!cardUrl || seen.has(cardUrl)) return null;
            seen.add(cardUrl);

            // SFCC product name and prices
            const nameEl = card.querySelector('.tile-body .product-name, .product-name, h2, h3, [class*="name"]');
            const salePriceEl = card.querySelector('.price .sales .value, .price-sales, [class*="sale"]');
            const origPriceEl = card.querySelector('.price .strike-through .value, .price-standard, del, s');
            const imgEl = card.querySelector('img');

            const name = nameEl?.textContent?.trim() || '';
            const price = parsePrice(salePriceEl);
            const originalPrice = parsePrice(origPriceEl);
            const image = imgEl?.src || '';

            if (!name || !price || !originalPrice || price >= originalPrice) return null;
            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) return null;
            return { store: storeName, storeKey, name, url: cardUrl, image, price, originalPrice, discount, tags: [] };
          }).filter(Boolean);
        }, { storeName: STORE_NAME, storeKey: STORE_KEY });
      }

      for (const d of deals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          // Extract product ID from URL
          const productId = d.url.match(/\/([^\/]+)\.html$/)?.[1] || d.url.split('/').pop() || '';
          allDeals.push({
            ...d,
            id: slugify(`${d.storeKey}-${d.name}-${productId}`),
            currency: 'CAD',
            priceCAD: d.price,
            originalPriceCAD: d.originalPrice,
            tags: tag({ name: d.name }),
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      onProgress(`The North Face: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  onProgress(`The North Face: found ${allDeals.length} deals total`);
  return allDeals;
}

function mapNorthFaceProduct(p) {
  try {
    // SFCC product object mapping
    const price = parseFloat(
      p.price?.sales?.value ||
      p.price?.sales ||
      p.salePrice ||
      p.price?.min?.sales?.value ||
      0
    );
    const originalPrice = parseFloat(
      p.price?.list?.value ||
      p.price?.list ||
      p.listPrice ||
      p.price?.min?.list?.value ||
      0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const name = p.productName || p.name || p.title || '';
    if (!name) return null;

    const id = p.productId || p.id || '';
    const url = p.pdpUrl || p.url || (id ? `https://www.thenorthface.com/en-ca/p/${id}` : '');
    const image = p.images?.[0]?.url || p.images?.[0]?.link || p.image?.url || '';

    return {
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      tags: [],
    };
  } catch (_) {
    return null;
  }
}

async function loadAll(page, onProgress) {
  const LOAD_MORE = [
    'button[data-testid*="load-more"]',
    'button[class*="load-more"]',
    'button[class*="LoadMore"]',
    'button[class*="show-more"]',
    '[class*="pagination"] button',
  ].join(', ');

  let round = 0;
  while (round < 20) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    try {
      const btn = await page.$(LOAD_MORE);
      if (!btn || !(await btn.isVisible())) break;
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      round++;
      onProgress(`The North Face: loading more (page ${round + 1})…`);
      await page.waitForTimeout(2000);
    } catch (_) { break; }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
