'use strict';

const fetch = require('node-fetch');

const STORE_NAME = 'Indigo';
const STORE_KEY = 'indigo';
const CURRENCY = 'CAD';

// Indigo/Chapters is on Shopify
const SALE_COLLECTIONS = [
  'sale',
  'clearance',
  'books-on-sale',
];

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

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  const allDeals = [];
  const seenUrls = new Set();

  for (const collection of SALE_COLLECTIONS) {
    onProgress(`Indigo: loading ${collection} collection…`);

    let page = 1;
    const MAX_PAGES = 10;

    while (page <= MAX_PAGES) {
      const url = `https://www.chapters.indigo.ca/collections/${collection}/products.json?limit=250&page=${page}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          if (page === 1) onProgress(`Indigo: ${collection} returned ${response.status}`);
          break;
        }

        const json = await response.json();
        const products = json?.products || [];

        if (products.length === 0) break;

        for (const p of products) {
          const deal = mapShopifyProduct(p, seenUrls);
          if (deal) allDeals.push(deal);
        }

        onProgress(`Indigo: ${collection} page ${page} (${products.length} products)`);
        page++;
      } catch (err) {
        onProgress(`Indigo: error on ${collection} page ${page} — ${err.message}`);
        break;
      }
    }
  }

  onProgress(`Indigo: found ${allDeals.length} deals`);
  return allDeals;
}

function mapShopifyProduct(p, seen) {
  try {
    const name = p.title || '';
    if (!name) return null;

    // Get first variant with both price and compare_at_price
    let selectedVariant = null;
    for (const v of (p.variants || [])) {
      const price = parseFloat(v.price);
      const compareAt = parseFloat(v.compare_at_price);
      if (price && compareAt && compareAt > price) {
        selectedVariant = v;
        break;
      }
    }

    if (!selectedVariant) return null;

    const price = parseFloat(selectedVariant.price);
    const originalPrice = parseFloat(selectedVariant.compare_at_price);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || '';
    const url = `https://www.chapters.indigo.ca/en-ca/home/${handle}/`;
    if (seen.has(url)) return null;
    seen.add(url);

    const image = p.images?.[0]?.src || '';
    const category = p.product_type || '';

    return {
      id: slugify(`${STORE_KEY}-${handle}`),
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

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
