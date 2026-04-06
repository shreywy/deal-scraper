'use strict';

// HP Canada deals scraper
// Uses XHR intercept to capture product API responses + DOM fallback

const URLS = [
  'https://www.hp.com/ca-en/shop/slp/deals-and-offers/deals',
  'https://www.hp.com/ca-en/shop/pdp/promotions',
];
const STORE_NAME = 'HP CA';
const STORE_KEY = 'hp';

function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|ultrabook|thinkpad|ideapad|yoga|legion|chromebook|macbook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one|tower/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|display/.test(t)) return 'TVs & Displays';
  if (/\btablet\b|\bipad\b|smartphone/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b/.test(t)) return 'Audio';
  if (/\bkeyboard\b|\bmouse\b|\bssd\b|\bram\b|hard drive|\bdock\b|docking|adapter|charger|cable/.test(t)) return 'Computer Parts';
  if (/printer|scanner/.test(t)) return 'Computer Parts';
  if (/gaming|geforce|radeon|gpu|graphics/.test(t)) return 'Gaming';
  return 'Electronics';
}

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
    onProgress(`HP: loading ${url.includes('promotions') ? 'promotions' : 'deals'} page…`);
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
      onProgress(`HP: error on ${url} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  onProgress(`HP: found ${allDeals.length} deals total`);
  return allDeals;
}

async function scrapePage(page, url, onProgress) {
  const intercepted = [];

  // XHR intercept strategy
  page.on('response', async resp => {
    const respUrl = resp.url();
    if ((respUrl.includes('hp.com') || respUrl.includes('hpapi')) &&
        resp.headers()['content-type']?.includes('json')) {
      try {
        const data = await resp.json();
        const prods = data?.products || data?.data?.products || data?.items || data?.results || [];
        if (Array.isArray(prods) && prods.length) {
          intercepted.push(...prods);
        }
      } catch (_) {}
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Dismiss cookie banner
  try {
    await page.click('#onetrust-accept-btn-handler, [class*="cookie-accept"]', { timeout: 4000 });
  } catch (_) {}

  // Wait for products to appear
  const PRODUCT_SEL = [
    '[data-testid="product-card"]',
    '.product-card',
    '.ProductTitle',
    '[class*="productCard"]',
    '.product-item',
  ].join(', ');

  try {
    await page.waitForSelector(PRODUCT_SEL, { timeout: 20000 });
  } catch (_) {
    onProgress('HP: no product grid found, trying scroll anyway…');
  }

  // Scroll to trigger lazy-load
  await loadProducts(page, onProgress);

  // Try XHR-intercepted data first
  if (intercepted.length > 0) {
    onProgress(`HP: processing ${intercepted.length} intercepted products`);
    const deals = intercepted.map(p => {
      const price = parseFloat(p.price?.current || p.salePrice || p.currentPrice || p.price || 0);
      const originalPrice = parseFloat(p.price?.original || p.listPrice || p.originalPrice || p.wasPrice || 0);

      if (!price || !originalPrice || price >= originalPrice) return null;

      const discount = Math.round((1 - price / originalPrice) * 100);
      if (discount <= 0) return null;

      const name = p.productName || p.name || p.title || '';
      const productUrl = p.url || p.productUrl || p.link || '';
      const image = p.image || p.imageUrl || p.thumbnail || p.images?.[0] || '';
      const category = p.category || p.productCategory || '';

      return {
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name,
        url: productUrl.startsWith('http') ? productUrl : `https://www.hp.com${productUrl}`,
        image: image.startsWith('http') ? image : `https://www.hp.com${image}`,
        price,
        originalPrice,
        discount,
        category,
        tags: [],
      };
    }).filter(Boolean);

    if (deals.length > 0) {
      return deals.map(d => ({
        ...d,
        id: slugify(`${d.storeKey}-${d.name}`),
        tags: ['Non-Clothing', ncTag(d.name, d.category)],
        currency: 'CAD',
        priceCAD: d.price,
        originalPriceCAD: d.originalPrice,
        scrapedAt: new Date().toISOString(),
      }));
    }
  }

  // Fallback to DOM scraping
  onProgress('HP: using DOM fallback');
  const deals = await page.evaluate(({ storeName, storeKey }) => {
    const cardSelectors = [
      '[data-testid="product-card"]',
      '.product-card',
      '.ProductTitle',
      '[class*="productCard"]',
      '.product-item',
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > 0) { cards = found; break; }
    }

    const parsePrice = el => {
      if (!el) return null;
      const text = (el.textContent || '').replace(/[^0-9.]/g, '');
      const n = parseFloat(text);
      return isNaN(n) ? null : n;
    };

    const seen = new Set();
    return cards.map(card => {
      const link = card.querySelector('a[href]');
      const nameEl = card.querySelector('.ProductTitle, [class*="productName"], [class*="product-name"], h2, h3, h4');
      const salePriceEl = card.querySelector('.price-current, [class*="salePrice"], [class*="sale-price"], [class*="currentPrice"], [class*="promo"]');
      const origPriceEl = card.querySelector('.price-original, [class*="listPrice"], [class*="originalPrice"], [class*="was-price"], s, del, strike');
      const imgEl = card.querySelector('img[src]:not([src=""]), .product-thumbnail img');

      const name = nameEl?.textContent?.trim() || '';
      const cardUrl = link?.href || '';
      const image = imgEl?.src || imgEl?.dataset?.src || '';

      const price = parsePrice(salePriceEl);
      const originalPrice = parsePrice(origPriceEl);

      if (!name || !cardUrl || price === null || seen.has(cardUrl)) return null;
      seen.add(cardUrl);

      const discount = originalPrice && originalPrice > price
        ? Math.round((1 - price / originalPrice) * 100)
        : 0;

      if (discount <= 0) return null;

      return { store: storeName, storeKey, name, url: cardUrl, image, price, originalPrice, discount, tags: [] };
    }).filter(Boolean);
  }, { storeName: STORE_NAME, storeKey: STORE_KEY });

  return deals.map(d => ({
    ...d,
    id: slugify(`${d.storeKey}-${d.name}`),
    tags: ['Non-Clothing', ncTag(d.name, '')],
    currency: 'CAD',
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    scrapedAt: new Date().toISOString(),
  }));
}

async function loadProducts(page, onProgress) {
  let round = 0;
  const MAX_ROUNDS = 10;

  while (round < MAX_ROUNDS) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    const LOAD_MORE_SEL = [
      'button[class*="load-more"]',
      'button[class*="LoadMore"]',
      'button[class*="show-more"]',
      '[class*="pagination"] button:not([disabled])',
    ].join(', ');

    try {
      const btn = await page.$(LOAD_MORE_SEL);
      if (!btn) break;
      const visible = await btn.isVisible();
      if (!visible) break;

      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      round++;
      onProgress(`HP: loading more products (page ${round + 1})…`);
      await page.waitForTimeout(2000);
    } catch (_) {
      break;
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
