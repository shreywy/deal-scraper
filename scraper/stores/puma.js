'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Puma';
const STORE_KEY = 'puma';
const CURRENCY = 'USD';

// Try multiple URLs in order
const SALE_URLS = [
  'https://us.puma.com/us/en/sale',
  'https://ca.puma.com/ca/en/sale',
];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Puma: fetching USD→CAD rate…');
  const rate = await getUSDtoCAD();
  onProgress(`Puma: 1 USD = ${rate.toFixed(4)} CAD`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  let workingUrl = null;
  let page = null;

  // Find working URL
  for (const url of SALE_URLS) {
    onProgress(`Puma: trying ${url}…`);
    page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const status = response?.status() || 0;
      const finalUrl = page.url();

      // Check if we got redirected to error page or homepage
      // Allow redirects to /all-sale or /sale/* paths
      if (status === 200 && (finalUrl.includes('/sale') || finalUrl.includes('/all-sale')) && !finalUrl.includes('/error')) {
        workingUrl = url;
        onProgress(`Puma: ${url} → ${finalUrl}`);
        break;
      }
      await page.close();
    } catch (err) {
      onProgress(`Puma: ${url} failed — ${err.message}`);
      await page.close();
    }
  }

  if (!workingUrl) {
    await context.close();
    throw new Error('Puma: all sale URLs failed');
  }

  // Track XHR intercepted products
  const intercepted = [];
  const interceptedIds = new Set();

  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';

    // Puma likely uses a product API
    if (ct.includes('application/json') && (url.includes('/api/') || url.includes('/search') || url.includes('/products'))) {
      try {
        const json = await response.json();
        // Check various response structures
        const products =
          json?.products ||
          json?.data?.products ||
          json?.hits ||
          json?.results ||
          [];

        for (const p of products) {
          const id = p.id || p.productId || p.sku || p.code;
          if (id && !interceptedIds.has(id)) {
            interceptedIds.add(id);
            intercepted.push(p);
          }
        }
      } catch (_) {}
    }
  });

  try {
    // Dismiss overlays
    try {
      await page.click('#onetrust-accept-btn-handler, [class*="accept"], button[class*="cookie"]', { timeout: 3000 });
    } catch (_) {}

    // Wait for products
    try {
      await page.waitForSelector('.product, [class*="Product"], [class*="product-tile"], [data-test*="product"]', { timeout: 15000 });
    } catch (_) {
      onProgress('Puma: no product grid visible, proceeding anyway…');
    }

    // Scroll to load more products
    await scrollAndLoad(page, onProgress);

    // Try XHR intercepted data first
    if (intercepted.length > 0) {
      const deals = intercepted.map(p => mapAPIProduct(p, rate)).filter(Boolean);
      if (deals.length > 0) {
        onProgress(`Puma: found ${deals.length} deals (XHR)`);
        await context.close();
        return deals;
      }
    }

    // DOM scraping fallback
    onProgress('Puma: DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      // Puma uses Tailwind classes, find product containers via product links
      const productLinks = document.querySelectorAll('a[href*="/pd/"]');

      const seen = new Set();
      const results = [];

      for (const link of productLinks) {
        const url = link.href;
        if (!url || seen.has(url)) continue;
        seen.add(url);

        // Get container (parent div)
        const container = link.closest('div[data-primary-product="true"]') || link.parentElement;
        if (!container) continue;

        // Extract from aria-label: "2 Colors, Carter 2.0 Men's Sneakers, Discounted Price, $57.99, Regular price, $68"
        const ariaLabel = link.getAttribute('aria-label') || '';
        const priceMatch = ariaLabel.match(/Discounted Price[,\s]+\$?([\d.]+).*?Regular price[,\s]+\$?([\d.]+)/i);

        let price = null, originalPrice = null;
        if (priceMatch) {
          price = parseFloat(priceMatch[1]);
          originalPrice = parseFloat(priceMatch[2]);
        } else {
          // Fallback: parse from container text
          const text = container.innerText || '';
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

          // Find price lines (lines starting with $ or containing numbers)
          const priceLike = lines.filter(l => /^\$?[\d.]+$/.test(l.replace(/,/g, '')));
          if (priceLike.length >= 2) {
            const nums = priceLike.map(p => parseFloat(p.replace(/[^0-9.]/g, '')));
            price = Math.min(...nums);
            originalPrice = Math.max(...nums);
          }
        }

        if (!price || !originalPrice || price >= originalPrice) continue;

        // Extract name from aria-label or container text
        let name = '';
        if (ariaLabel) {
          const parts = ariaLabel.split(',');
          // Find the part that's likely the product name (not "X Colors", not price info)
          for (const part of parts) {
            const clean = part.trim();
            if (!clean.includes('Color') && !clean.includes('Price') && !clean.startsWith('$') && clean.length > 5) {
              name = clean;
              break;
            }
          }
        }
        if (!name) {
          const text = container.innerText || '';
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          // Product name is usually one of the first non-color, non-price lines
          for (const line of lines) {
            if (!/^\$/.test(line) && !/^\d+\s*COLOR/i.test(line) && line.length > 3 && !/^[\d.]+$/.test(line)) {
              name = line;
              break;
            }
          }
        }

        const imgEl = container.querySelector('img[src]');
        const image = imgEl?.src || '';

        if (!name || !url) continue;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) continue;

        results.push({ store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'USD', tags: [] });
      }

      return results;
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`puma-${d.name}`),
      priceCAD: Math.round(d.price * rate * 100) / 100,
      originalPriceCAD: Math.round(d.originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`Puma: found ${tagged.length} deals (DOM)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function mapAPIProduct(p, rate) {
  try {
    const name = p.name || p.title || p.productName || '';
    if (!name) return null;

    // Try various price field patterns
    let price = parseFloat(p.price?.sale || p.salePrice || p.price?.current || p.price || 0);
    let originalPrice = parseFloat(p.price?.original || p.originalPrice || p.price?.standard || p.listPrice || 0);

    // Some APIs return price as object with formatted string
    if (typeof p.price === 'object') {
      if (p.price.sales) price = parseFloat(String(p.price.sales).replace(/[^0-9.]/g, ''));
      if (p.price.list) originalPrice = parseFloat(String(p.price.list).replace(/[^0-9.]/g, ''));
    }

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.id || p.productId || p.sku || p.code || slugify(name);
    const url = p.url || p.link || `https://us.puma.com/us/en/pd/${id}`;
    const image = p.image?.url || p.imageUrl || p.images?.[0]?.url || '';

    return {
      id: slugify(`puma-${name}-${id}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: Math.round(price * rate * 100) / 100,
      originalPriceCAD: Math.round(originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function scrollAndLoad(page, onProgress) {
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);

    // Try clicking load more
    try {
      const loadMore = await page.$('button[class*="load-more"], button[class*="show-more"], [class*="LoadMore"]');
      if (loadMore) {
        const visible = await loadMore.isVisible();
        if (visible) {
          await loadMore.click();
          onProgress(`Puma: loading more products (${i + 1})…`);
          await page.waitForTimeout(2000);
        }
      }
    } catch (_) {}
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
