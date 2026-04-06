'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Joe Fresh';
const STORE_KEY = 'joefresh';
const CURRENCY = 'CAD';
const SALE_COLLECTIONS = [
  { slug: 'mens-sale', gender: 'Men' },
  { slug: 'womens-sale', gender: 'Women' },
];

/**
 * Joe Fresh - Large Canadian brand (Shopify)
 * NOTE: As of April 2026, joefresh.com redirects to Canadian Tire/Hudson's Bay.
 * This scraper is disabled until the site structure stabilizes.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  const allDeals = [];
  const seen = new Set();

  for (const { slug, gender } of SALE_COLLECTIONS) {
    onProgress(`Joe Fresh: fetching ${gender} sale products from Shopify API…`);

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `https://www.joefresh.com/ca/collections/${slug}/products.json?limit=250&page=${page}`;

      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
        });

        if (!res.ok) {
          onProgress(`Joe Fresh: HTTP ${res.status} on ${slug} page ${page}`);
          break;
        }

        const data = await res.json();
        const products = data.products || [];

        if (products.length === 0) {
          hasMore = false;
          break;
        }

        for (const product of products) {
          const deal = mapShopifyProduct(product, gender, seen);
          if (deal) allDeals.push(deal);
        }

        onProgress(`Joe Fresh: ${gender} - ${allDeals.filter(d => d.gender === gender).length} deals (page ${page})`);

        if (products.length < 250) hasMore = false;
        page++;
      } catch (err) {
        onProgress(`Joe Fresh: Error on ${slug} page ${page}: ${err.message}`);
        break;
      }
    }
  }

  onProgress(`Joe Fresh: total ${allDeals.length} deals found`);
  return allDeals;
}

function mapShopifyProduct(p, gender, seen) {
  try {
    const name = p.title || '';
    if (!name) return null;

    const handle = p.handle || slugify(name);
    const url = `https://www.joefresh.com/ca/products/${handle}`;
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
      id: slugify(`joefresh-${name}-${handle}`),
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
