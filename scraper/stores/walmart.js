'use strict';

const STORE_NAME = 'Walmart CA';
const STORE_KEY = 'walmart';
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
 * Walmart Canada — XHR API intercept for clearance and sale items.
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
    if (!url.includes('walmart.ca')) return;
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return;

    try {
      const data = await resp.json();

      // Walmart returns products in various API shapes
      const products =
        data?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items ||
        data?.data?.search?.searchResult?.itemStacks?.[0]?.items ||
        data?.itemStacks?.[0]?.items ||
        data?.items ||
        [];

      for (const p of products) {
        const id = p.usItemId || p.productId || p.id;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        interceptedProducts.push(p);
      }
    } catch (_) {}
  });

  const allDeals = [];
  const seenUrls = new Set();

  const SALE_PAGES = [
    'https://www.walmart.ca/en/cp/clearance/6000177830',
    'https://www.walmart.ca/en/cp/electronics/electronics-on-sale/N-4143',
  ];

  for (const pageUrl of SALE_PAGES) {
    const label = pageUrl.includes('clearance') ? 'clearance' : 'electronics sale';
    onProgress(`Walmart CA: loading ${label}…`);

    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Accept cookies if present
      try {
        await page.click('button[aria-label*="Accept"], button:has-text("Accept")', { timeout: 3000 });
      } catch (_) {}

      await page.waitForTimeout(3000);

      // Scroll to trigger lazy loading and "Load More" if exists
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

      // DOM fallback if no intercepted products
      if (allDeals.length === 0) {
        const domDeals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = text => {
            const n = parseFloat((text || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          const cards = document.querySelectorAll(
            '[class*="product-card"], [class*="productCard"], [data-automation*="product"]'
          );

          const seen = new Set();
          return [...cards].map(card => {
            const link = card.querySelector('a[href*="/ip/"]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);

            const name = (
              card.querySelector('[class*="prod-ProductTitle"], [class*="product-name"]')?.textContent?.trim() || ''
            );

            const priceEl = card.querySelector('[class*="price-current"], [class*="price-now"]');
            const wasEl = card.querySelector('[class*="price-was"], [class*="price-old"], del, s');

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
    } catch (err) {
      onProgress(`Walmart CA: error on ${label} — ${err.message}`);
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

  onProgress(`Walmart CA: found ${tagged.length} deals`);
  return tagged;
}

function mapProduct(p, seen) {
  try {
    const name = p.name || p.item?.name || p.title || '';
    if (!name) return null;

    // Walmart price structures vary
    const priceObj = p.price || p.priceInfo || p.item?.price || {};
    const currentPrice = parseFloat(
      priceObj.currentPrice?.price ||
      priceObj.current?.price ||
      priceObj.price ||
      0
    );

    const wasPrice = parseFloat(
      priceObj.wasPrice?.price ||
      priceObj.was?.price ||
      priceObj.comparisonPrice?.price ||
      0
    );

    if (!currentPrice || !wasPrice || currentPrice >= wasPrice) return null;

    const discount = Math.round((1 - currentPrice / wasPrice) * 100);
    if (discount <= 0) return null;

    // Build product URL
    const canonicalUrl = p.canonicalUrl || p.productPageUrl || p.seeDetails || '';
    const productId = p.usItemId || p.productId || p.id || '';
    let url = '';

    if (canonicalUrl) {
      url = canonicalUrl.startsWith('http')
        ? canonicalUrl
        : `https://www.walmart.ca${canonicalUrl}`;
    } else if (productId) {
      url = `https://www.walmart.ca/en/ip/${slugify(name)}/${productId}`;
    }

    if (!url || seen.has(url)) return null;
    seen.add(url);

    // Image
    const imageObj = p.imageInfo || p.image || {};
    const imagePath =
      imageObj.thumbnailUrl ||
      imageObj.allImages?.[0]?.url ||
      imageObj.url ||
      '';
    const image = imagePath.startsWith('http') ? imagePath : (imagePath ? `https://i5.walmartimages.ca${imagePath}` : '');

    const category = p.category?.path || p.primaryCategory || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${productId}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: currentPrice,
      originalPrice: wasPrice,
      discount,
      currency: CURRENCY,
      priceCAD: currentPrice,
      originalPriceCAD: wasPrice,
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
