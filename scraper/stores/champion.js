'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Champion';
const STORE_KEY = 'champion';
const CURRENCY = 'CAD';
const BASE_URL = 'https://www.champion.com';
const SALE_COLLECTIONS = ['sale'];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  onProgress('Champion: fetching sale products from Shopify API…');

  const allDeals = [];
  const seen = new Set();

  for (const collection of SALE_COLLECTIONS) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${BASE_URL}/collections/${collection}/products.json?limit=250&page=${page}`;

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });

        if (!res.ok) {
          onProgress(`Champion: HTTP ${res.status} on ${collection} page ${page}`);
          break;
        }

        const data = await res.json();
        const products = data.products || [];

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        for (const product of products) {
          const deal = mapShopifyProduct(product, seen);
          if (deal) allDeals.push(deal);
        }

        onProgress(`Champion: ${allDeals.length} deals (page ${page})`);

        if (products.length < 250) hasMore = false;
        page++;
      } catch (err) {
        onProgress(`Champion: Error on ${collection} page ${page}: ${err.message}`);
        break;
      }
    }
  }

  onProgress(`Champion: total ${allDeals.length} deals found`);
  return allDeals;
}

function mapShopifyProduct(p, seen) {
  try {
    const name = p.title || '';
    if (!name) return null;

    const handle = p.handle || slugify(name);
    const url = `${BASE_URL}/products/${handle}`;
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

    // Auto-detect gender from product name/tags
    const productTags = p.tags || [];
    const allText = [name, ...productTags].join(' ').toLowerCase();
    let gender = '';

    if (allText.includes('women') || allText.includes('ladies')) {
      gender = 'Women';
    } else if (allText.includes('men') && !allText.includes('women')) {
      gender = 'Men';
    } else if (allText.includes('kids') || allText.includes('youth')) {
      gender = 'Kids';
    }

    return {
      id: slugify(`champion-${name}-${handle}`),
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
