'use strict';

// Dell Canada deals scraper
// Dell embeds product data as HTML-entity-encoded JSON in data-product-detail attributes.
// No Playwright needed — pure fetch.

const fetch = require('node-fetch');

const STORE_NAME = 'Dell CA';
const STORE_KEY = 'dell';
const CURRENCY = 'CAD';

// Dell's deals pages all include a global deals widget with the same 36 products;
// a single page fetch is enough. Use the top-level deals page.
const DEALS_URL = 'https://www.dell.com/en-ca/shop/deals/laptops';

function ncTag(name) {
  const t = name.toLowerCase();
  if (/laptop|notebook|ultrabook|xps|inspiron|vostro|latitude|precision|chromebook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini|tower|optiplex|optiplex/.test(t)) return 'Computers';
  if (/\bmonitor\b|display|screen/.test(t)) return 'TVs & Displays';
  if (/\btablet\b/.test(t)) return 'Phones & Tablets';
  if (/\bkeyboard\b|\bmouse\b|\bssd\b|hard drive|\bdock\b|docking|adapter|charger/.test(t)) return 'Computer Parts';
  if (/printer|scanner/.test(t)) return 'Computer Parts';
  if (/gaming|alienware|geforce|gpu/.test(t)) return 'Gaming';
  return 'Electronics';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function decodeHtml(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * @param {import('playwright').Browser} _browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  onProgress('Dell CA: fetching deals page…');

  let text;
  try {
    const res = await fetch(DEALS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-CA,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    onProgress(`Dell CA: fetch failed — ${err.message}`);
    return [];
  }

  const allDeals = [];
  const seen = new Set();

  // Parse all data-product-detail='{"productId": {...}}' attributes
  for (const [, encoded] of text.matchAll(/data-product-detail='(\{[^']+\})'/g)) {
    let container;
    try {
      container = JSON.parse(decodeHtml(encoded));
    } catch (_) {
      continue;
    }

    for (const [productId, p] of Object.entries(container)) {
      if (seen.has(productId)) continue;
      seen.add(productId);

      if (!p.showMarketPrice || !p.title || !p.pdUrl) continue;

      const price = parseFloat((p.dellPrice || '').replace(/[^0-9.]/g, ''));
      const originalPrice = parseFloat((p.marketPrice || '').replace(/[^0-9.]/g, ''));

      if (!price || !originalPrice || price >= originalPrice) continue;

      const discount = Math.round((1 - price / originalPrice) * 100);
      if (discount <= 0) continue;

      const productUrl = p.pdUrl.startsWith('//')
        ? 'https:' + p.pdUrl
        : p.pdUrl.startsWith('/')
        ? 'https://www.dell.com' + p.pdUrl
        : p.pdUrl;

      const image = p.image
        ? (p.image.startsWith('//') ? 'https:' + p.image : p.image)
        : '';

      allDeals.push({
        id: slugify(`dell-${productId}`),
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name: p.title,
        url: productUrl,
        image,
        price: Math.round(price * 100) / 100,
        originalPrice: Math.round(originalPrice * 100) / 100,
        discount,
        currency: CURRENCY,
        priceCAD: Math.round(price * 100) / 100,
        originalPriceCAD: Math.round(originalPrice * 100) / 100,
        tags: ['Non-Clothing', ncTag(p.title)],
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  onProgress(`Dell CA: ${allDeals.length} deals found`);
  return allDeals;
}

module.exports = { scrape, STORE_KEY };
