'use strict';

const STORE_NAME = 'Staples CA';
const STORE_KEY = 'staples';
const CURRENCY = 'CAD';

function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|ultrabook|chromebook|macbook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled/.test(t)) return 'TVs & Displays';
  if (/iphone|smartphone|cell phone|\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/\bgaming\b|console|\bxbox\b|playstation|\bps5\b|nintendo|controller|gpu/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|dishwasher|microwave|vacuum|air purifier|coffee maker/.test(t)) return 'Appliances';
  if (/\bsofa\b|\bdesk\b|\btable\b|\bchair\b|mattress|bookcase/.test(t)) return 'Furniture';
  if (/\bprinter\b|\bkeyboard\b|\bmouse\b|\brouter\b|hard drive|\bssd\b|\bram\b|\bcpu\b/.test(t)) return 'Computer Parts';
  return 'Electronics';
}

/**
 * Staples Canada — tries Shopify products API, falls back to XHR intercept.
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

  const interceptedProducts = [];
  const seenIds = new Set();

  context.on('response', async resp => {
    const url = resp.url();
    if (!url.includes('staples.ca')) return;
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return;

    try {
      const data = await resp.json();

      // Try various API response shapes
      const products =
        data?.products ||
        data?.items ||
        data?.data?.products ||
        [];

      for (const p of products) {
        const id = p.id || p.productId || p.sku;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        interceptedProducts.push(p);
      }
    } catch (_) {}
  });

  const allDeals = [];
  const seenUrls = new Set();

  const SALE_PAGES = [
    'https://www.staples.ca/collections/deals',
    'https://www.staples.ca/collections/technology-deals',
  ];

  for (const pageUrl of SALE_PAGES) {
    const label = pageUrl.includes('technology') ? 'technology deals' : 'all deals';
    onProgress(`Staples CA: loading ${label}…`);

    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Accept cookies if present
      try {
        await page.click('button:has-text("Accept"), button[id*="accept"]', { timeout: 3000 });
      } catch (_) {}

      await page.waitForTimeout(3000);

      // Try Shopify products.json API first
      const shopifyProducts = await page.evaluate(async () => {
        try {
          const resp = await fetch('/collections/deals/products.json?limit=250');
          if (!resp.ok) return null;
          const data = await resp.json();
          return data.products || [];
        } catch (_) {
          return null;
        }
      });

      if (shopifyProducts && shopifyProducts.length > 0) {
        onProgress(`Staples CA: found ${shopifyProducts.length} products via Shopify API`);

        for (const p of shopifyProducts) {
          const deal = mapShopifyProduct(p, seenUrls);
          if (deal) allDeals.push(deal);
        }
      } else {
        // Fallback: scroll and load more
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);

          try {
            const btn = await page.$('button:has-text("Load more"), [class*="load-more"]');
            if (btn && await btn.isVisible()) {
              await btn.click();
              await page.waitForTimeout(2000);
            }
          } catch (_) {}
        }

        // Process intercepted products
        for (const p of interceptedProducts) {
          const deal = mapProduct(p, seenUrls);
          if (deal) allDeals.push(deal);
        }

        // DOM fallback if still nothing
        if (allDeals.length === 0) {
          const domDeals = await page.evaluate(({ storeName, storeKey }) => {
            const parsePrice = text => {
              const n = parseFloat((text || '').replace(/[^0-9.]/g, ''));
              return isNaN(n) ? null : n;
            };

            const cards = document.querySelectorAll(
              '[class*="product-card"], [class*="productCard"], article[class*="product"]'
            );

            const seen = new Set();
            return [...cards].map(card => {
              const link = card.querySelector('a[href*="/products/"]');
              const url = link?.href || '';
              if (!url || seen.has(url)) return null;
              seen.add(url);

              const name = (
                card.querySelector('[class*="product-title"], [class*="product-name"], h3, h2')?.textContent?.trim() || ''
              );

              const priceEl = card.querySelector('[class*="sale-price"], [class*="current-price"]');
              const wasEl = card.querySelector('[class*="compare-price"], [class*="original-price"], del, s');

              const price = parsePrice(priceEl?.textContent);
              const originalPrice = parsePrice(wasEl?.textContent);

              if (!name || !price || !originalPrice || price >= originalPrice) return null;

              const discount = Math.round((1 - price / originalPrice) * 100);
              if (discount <= 0) return null;

              const imgEl = card.querySelector('img[src]');
              const image = imgEl?.src || '';

              return {
                store: storeName,
                storeKey,
                name,
                url,
                image,
                price,
                originalPrice,
                discount
              };
            }).filter(Boolean);
          }, { storeName: STORE_NAME, storeKey: STORE_KEY });

          for (const d of domDeals) {
            if (!seenUrls.has(d.url)) {
              seenUrls.add(d.url);
              allDeals.push(d);
            }
          }
        }
      }
    } catch (err) {
      onProgress(`Staples CA: error on ${label} — ${err.message}`);
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
    tags: ['Non-Clothing', ncTag(d.name, d.category || '')],
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Staples CA: found ${tagged.length} deals`);
  return tagged;
}

function mapShopifyProduct(p, seen) {
  try {
    const name = p.title || '';
    if (!name) return null;

    // Find variant with compare_at_price > price
    const variants = p.variants || [];
    let bestDeal = null;
    let maxDiscount = 0;

    for (const v of variants) {
      const price = parseFloat(v.price || 0);
      const comparePrice = parseFloat(v.compare_at_price || 0);

      if (!price || !comparePrice || price >= comparePrice) continue;

      const discount = Math.round((1 - price / comparePrice) * 100);
      if (discount > maxDiscount) {
        maxDiscount = discount;
        bestDeal = { price, originalPrice: comparePrice, discount };
      }
    }

    if (!bestDeal) return null;

    const handle = p.handle || '';
    const url = `https://www.staples.ca/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    const image = p.images?.[0]?.src || p.featured_image || '';
    const productType = p.product_type || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${p.id || ''}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: bestDeal.price,
      originalPrice: bestDeal.originalPrice,
      discount: bestDeal.discount,
      currency: CURRENCY,
      priceCAD: bestDeal.price,
      originalPriceCAD: bestDeal.originalPrice,
      category: productType,
      tags: ['Non-Clothing', ncTag(name, productType)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function mapProduct(p, seen) {
  try {
    const name = p.title || p.name || p.product_name || '';
    if (!name) return null;

    const price = parseFloat(p.price || p.sale_price || 0);
    const originalPrice = parseFloat(p.compare_at_price || p.original_price || p.list_price || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || p.url || '';
    const productId = p.id || p.product_id || '';

    let url = '';
    if (handle.startsWith('http')) {
      url = handle;
    } else if (handle) {
      url = `https://www.staples.ca/products/${handle}`;
    } else if (productId) {
      url = `https://www.staples.ca/products/${slugify(name)}-${productId}`;
    }

    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image = p.image || p.featured_image || p.thumbnail || '';
    const category = p.product_type || p.category || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${productId}`),
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
      category,
      tags: ['Non-Clothing', ncTag(name, category)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
