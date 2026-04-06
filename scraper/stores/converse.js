'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Converse';
const STORE_KEY = 'converse';
const CURRENCY = 'CAD';

// Converse Canada is on Shopify (converse.ca)
const SALE_COLLECTIONS = [
  { collection: 'sale', gender: '', label: 'all sale items' },
];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const allDeals = [];
  const seenUrls = new Set();

  for (const { collection, gender, label } of SALE_COLLECTIONS) {
    onProgress(`Converse: loading ${label}…`);

    let page = 1;
    const MAX_PAGES = 10;

    while (page <= MAX_PAGES) {
      const url = `https://converse.ca/collections/${collection}/products.json?limit=250&page=${page}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          if (page === 1) onProgress(`Converse: ${collection} returned ${response.status}`);
          break;
        }

        const json = await response.json();
        const products = json?.products || [];

        if (products.length === 0) break;

        for (const p of products) {
          const deal = mapShopifyProduct(p, gender, seenUrls);
          if (deal) allDeals.push(deal);
        }

        onProgress(`Converse: loaded page ${page} (${products.length} products)`);
        page++;
      } catch (err) {
        onProgress(`Converse: error on page ${page} — ${err.message}`);
        break;
      }
    }
  }

  const tagged = allDeals.map(d => ({
    ...d,
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Converse: found ${tagged.length} deals`);
  return tagged;
}

function mapShopifyProduct(p, gender, seen) {
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
    const url = `https://converse.ca/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    const image = p.images?.[0]?.src || '';

    // Infer gender from title
    const nameLower = name.toLowerCase();
    const inferredGender = nameLower.includes("women") ? 'Women' :
                          nameLower.includes("men") && !nameLower.includes("women") ? 'Men' :
                          gender;

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
      gender: inferredGender,
      tags: tag({ name, gender: inferredGender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
