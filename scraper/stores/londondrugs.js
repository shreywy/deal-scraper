'use strict';

const STORE_NAME = 'London Drugs';
const STORE_KEY = 'londondrugs';
const CURRENCY = 'CAD';

// Non-clothing category helper
function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|chromebook|surface pro|surface laptop/.test(t)) return 'Computers';
  if (/desktop|workstation|all.in.one|mini pc/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled/.test(t)) return 'TVs & Displays';
  if (/\btablet\b|smartphone|iphone|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/gaming|xbox|playstation|nintendo|controller|gpu|graphics/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|vacuum|air purifier|blender|coffee|kettle/.test(t)) return 'Appliances';
  if (/\bsofa\b|\bcouch\b|\bchair\b|\bdesk\b|\btable\b|\bbed\b|mattress|shelf|bookcase|lamp|rug|curtain|pillow|duvet/.test(t)) return 'Furniture';
  if (/\bprinter\b|\bkeyboard\b|\bmouse\b|\brouter\b|hard drive|\bssd\b|\bram\b/.test(t)) return 'Computer Parts';
  if (/book|novel|toy|\bpuzzle\b|game board|lego/.test(t)) return 'Books & Toys';
  if (/beauty|skincare|makeup|shampoo|vitamin|supplement|health/.test(t)) return 'Health & Beauty';
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
  const page = await context.newPage();

  const intercepted = [];
  const seenIds = new Set();

  // Intercept XHR/API responses
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;

    try {
      const data = await response.json();
      const prods = data?.products || data?.items || data?.data?.products || data?.data?.items || [];

      const arr = Array.isArray(prods) ? prods : (prods ? Object.values(prods) : []);
      for (const p of arr) {
        const id = p?.id || p?.productId || p?.sku || p?.handle;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        intercepted.push(p);
      }
    } catch (_) {}
  });

  try {
    onProgress('London Drugs: navigating to sale page...');
    await page.goto('https://www.londondrugs.com/on-sale/', {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    // Accept cookies if present
    try {
      await page.click('button[id*="accept"], button[class*="accept"]', { timeout: 3000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    await loadAllProductsScroll(page, intercepted, onProgress);

    if (intercepted.length > 0) {
      const deals = intercepted.map(p => mapProduct(p)).filter(Boolean);
      onProgress(`London Drugs: found ${deals.length} deals (API)`);
      return deals;
    }

    // DOM fallback
    onProgress('London Drugs: trying DOM scrape...');
    const rawDeals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = document.querySelectorAll('.ProductItem, .product, [class*="product"], [class*="Product"]');

      const parsePrice = el => {
        if (!el) return null;
        const text = el.textContent || '';
        const n = parseFloat(text.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      const seen = new Set();
      return [...cards].map(card => {
        const link = card.querySelector('a[href*="/product"], a');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        const name = (
          card.querySelector('.ProductTitle, [class*="ProductTitle"], [class*="name"], [class*="Name"], h2, h3, h4')?.textContent ||
          link?.getAttribute('aria-label') ||
          link?.textContent ||
          ''
        ).trim();

        if (!name) return null;

        const imgEl = card.querySelector('img');
        const image = imgEl?.src || imgEl?.dataset?.src || '';

        const priceEls = card.querySelectorAll('.Price--sale, .Price--compareAt, [class*="price"], [class*="Price"]');
        let price = null;
        let originalPrice = null;

        for (const el of priceEls) {
          const cls = el.className || '';
          const p = parsePrice(el);
          if (!p) continue;

          if (cls.includes('sale') || cls.includes('Sale') || cls.includes('current') || cls.includes('Current')) {
            if (!price || p < price) price = p;
          } else if (cls.includes('compare') || cls.includes('Compare') || cls.includes('original') || cls.includes('Original') ||
                     cls.includes('was') || cls.includes('Was') || cls.includes('standard') || cls.includes('Standard') ||
                     el.style?.textDecoration === 'line-through' || cls.includes('strike') || cls.includes('Strike')) {
            if (!originalPrice || p > originalPrice) originalPrice = p;
          } else if (!price) {
            price = p;
          } else if (!originalPrice && p !== price) {
            originalPrice = p;
          }
        }

        if (!price || !originalPrice || price >= originalPrice) return null;

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
          currency: 'CAD',
          tags: []
        };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = rawDeals.map(d => ({
      ...d,
      id: slugify(`${STORE_KEY}-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: ['Non-Clothing', ncTag(d.name)],
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`London Drugs: found ${tagged.length} deals (DOM)`);
    return tagged;

  } catch (error) {
    onProgress(`London Drugs: error - ${error.message}`);
    return [];
  } finally {
    await context.close();
  }
}

function mapProduct(p) {
  try {
    const name = p.name || p.title || p.productName || '';
    if (!name) return null;

    const price = parseFloat(
      p.price?.current || p.price?.sale || p.salePrice || p.currentPrice ||
      p.price || p.prices?.sale || 0
    );
    const originalPrice = parseFloat(
      p.price?.original || p.price?.list || p.comparePrice || p.originalPrice ||
      p.compareAtPrice || p.prices?.list || 0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || p.slug || slugify(name);
    const url = p.url || (handle ? `https://www.londondrugs.com/product/${handle}` : 'https://www.londondrugs.com/on-sale/');
    const image = p.image?.url || p.imageUrl || p.images?.[0]?.url || p.featuredImage?.url || '';
    const category = p.category || p.productType || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${p.id || ''}`),
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
      tags: ['Non-Clothing', ncTag(name, category)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function loadAllProductsScroll(page, interceptedProducts, onProgress) {
  let lastHeight = 0;
  let lastCount = 0;
  let stable = 0;

  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    if (h === lastHeight && interceptedProducts.length === lastCount) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
      lastHeight = h;
      lastCount = interceptedProducts.length;
      if (interceptedProducts.length) {
        onProgress(`London Drugs: loading... (${interceptedProducts.length} products)`);
      }
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
