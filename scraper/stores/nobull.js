'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Nobull';
const STORE_KEY = 'nobull';
const CURRENCY = 'USD';
const SALE_COLLECTIONS = [
  'mens-sale',
  'womens-sale'
];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  onProgress('Nobull: fetching USD→CAD rate…');
  const rate = await getUSDtoCAD();
  onProgress(`Nobull: 1 USD = ${rate.toFixed(4)} CAD`);

  const allDeals = [];
  const seen = new Set();

  for (const collection of SALE_COLLECTIONS) {
    const gender = collection.includes('mens-') ? 'Men' : 'Women';
    onProgress(`Nobull: fetching ${gender} sale products from Shopify API…`);

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `https://nobullproject.com/collections/${collection}/products.json?limit=250&page=${page}`;

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });

        if (!res.ok) {
          onProgress(`Nobull: HTTP ${res.status} on ${collection} page ${page}`);
          break;
        }

        const data = await res.json();
        const products = data.products || [];

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        for (const product of products) {
          const deal = mapShopifyProduct(product, rate, gender, seen);
          if (deal) allDeals.push(deal);
        }

        onProgress(`Nobull: ${gender} - ${allDeals.filter(d => d.gender === gender).length} deals (page ${page})`);

        if (products.length < 250) hasMore = false;
        page++;
      } catch (err) {
        onProgress(`Nobull: Error on ${collection} page ${page}: ${err.message}`);
        break;
      }
    }
  }

  onProgress(`Nobull: total ${allDeals.length} deals found`);
  return allDeals;
}

function mapShopifyProduct(p, rate, gender, seen) {
  try {
    const name = p.title || '';
    if (!name) return null;

    const handle = p.handle || slugify(name);
    const url = `https://nobullproject.com/products/${handle}`;
    if (seen.has(url)) return null;

    // Find cheapest variant with a discount
    const variants = p.variants || [];
    let price = null, originalPrice = null;

    for (const v of variants) {
      const sp = parseFloat(v.price || 0);
      const cp = parseFloat(v.compare_at_price || 0);

      if (sp > 0 && cp > sp) {
        if (price === null || sp < price) {
          price = sp;
          originalPrice = cp;
        }
      }
    }

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    seen.add(url);

    // Get image
    const images = p.images || [];
    const image = images[0]?.src || '';

    return {
      id: slugify(`nobull-${name}-${handle}`),
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
      gender,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) {
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
