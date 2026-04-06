'use strict';

/**
 * Non-clothing category helper
 */
function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|chromebook/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled|frame tv/.test(t)) return 'TVs & Displays';
  if (/smartphone|galaxy s|galaxy a|\btablet\b|galaxy tab/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar|galaxy buds/.test(t)) return 'Audio';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|vacuum|air purifier/.test(t)) return 'Appliances';
  if (/\bcamera\b|mirrorless/.test(t)) return 'Cameras';
  if (/gaming|console|controller/.test(t)) return 'Gaming';
  if (/book|novel|toy|\bgame\b|\bpuzzle\b|lego|craft|stationery/.test(t)) return 'Books & Toys';
  if (/\bwatch\b|smartwatch|galaxy watch/.test(t)) return 'Electronics';
  return 'Electronics';
}

const STORE_NAME = 'Samsung CA';
const STORE_KEY = 'samsung';
const CURRENCY = 'CAD';

const SALE_URLS = [
  'https://www.samsung.com/ca/offer/',
  'https://www.samsung.com/ca/smartphones/all-smartphones/',
  'https://www.samsung.com/ca/certified-re-newed/all-products/',
];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const allDeals = [];
  const seenUrls = new Set();
  const intercepted = [];

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
  });

  const page = await context.newPage();

  // Intercept API responses
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('samsung.com') && resp.headers()['content-type']?.includes('json')) {
      try {
        const data = await resp.json();
        const prods = data?.response?.docs ||
                      data?.results?.productList ||
                      data?.productsOnSale ||
                      data?.products ||
                      [];
        if (Array.isArray(prods) && prods.length > 0) {
          intercepted.push(...prods);
        }
      } catch (_) {}
    }
  });

  try {
    for (const url of SALE_URLS) {
      onProgress(`Samsung: loading ${url}…`);
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(3000);

        // Scroll to load more products
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1000);
        }
      } catch (err) {
        onProgress(`Samsung: error loading ${url} — ${err.message}`);
      }
    }

    onProgress(`Samsung: intercepted ${intercepted.length} products from API`);

    // Map intercepted products to deals
    for (const prod of intercepted) {
      const deal = mapSamsungProduct(prod, seenUrls);
      if (deal) allDeals.push(deal);
    }

  } finally {
    await context.close();
  }

  onProgress(`Samsung: found ${allDeals.length} deals`);
  return allDeals;
}

function mapSamsungProduct(p, seen) {
  try {
    const name = p.name || p.displayName || p.modelName || p.title || '';
    if (!name) return null;

    // Samsung API can have various price field patterns
    const salePrice = parseFloat(
      p.price?.salePrice?.replace(/[^0-9.]/g, '') ||
      p.salePrice?.replace(/[^0-9.]/g, '') ||
      p.discountedPrice?.replace(/[^0-9.]/g, '') ||
      p.priceValue ||
      0
    );

    const regularPrice = parseFloat(
      p.price?.regularPrice?.replace(/[^0-9.]/g, '') ||
      p.regularPrice?.replace(/[^0-9.]/g, '') ||
      p.originalPrice?.replace(/[^0-9.]/g, '') ||
      p.listPrice?.replace(/[^0-9.]/g, '') ||
      0
    );

    if (!salePrice || !regularPrice || salePrice >= regularPrice) return null;

    const discount = Math.round((1 - salePrice / regularPrice) * 100);
    if (discount <= 0) return null;

    const productUrl = p.url || p.productUrl || p.link || '';
    const url = productUrl.startsWith('http')
      ? productUrl
      : `https://www.samsung.com${productUrl}`;

    if (seen.has(url)) return null;
    seen.add(url);

    const image = p.image || p.imageUrl || p.thumbnail || p.galleryImage?.[0] || '';
    const category = p.category || p.categoryName || '';

    return {
      id: slugify(`${STORE_KEY}-${name}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: salePrice,
      originalPrice: regularPrice,
      discount,
      currency: CURRENCY,
      priceCAD: salePrice,
      originalPriceCAD: regularPrice,
      tags: ['Non-Clothing', ncTag(name, category)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
