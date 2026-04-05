'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Gymshark';
const STORE_KEY = 'gymshark';
const CURRENCY = 'CAD';

// Gymshark uses Algolia for product search. The CA index has CAD pricing.
const ALGOLIA_APP_ID = '2DEAES0CUO';
const ALGOLIA_API_KEY = '932fd4562e8443c09e3d14fd4ab94295';
const ALGOLIA_INDEX = 'production_ca_products_v2';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;

const HITS_PER_PAGE = 100;

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  onProgress('Gymshark: querying Algolia CA index for sale items…');

  const allHits = [];
  let page = 0;

  while (true) {
    const res = await fetch(ALGOLIA_URL, {
      method: 'POST',
      headers: {
        'x-algolia-application-id': ALGOLIA_APP_ID,
        'x-algolia-api-key': ALGOLIA_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '',
        filters: 'compareAtPrice > 0',
        hitsPerPage: HITS_PER_PAGE,
        page,
        attributesToRetrieve: [
          'title', 'price', 'compareAtPrice', 'handle',
          'featuredImage', 'division', 'category', 'productCategory',
        ],
      }),
    });

    if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`);
    const data = await res.json();
    const hits = data.hits || [];
    allHits.push(...hits);

    onProgress(`Gymshark: fetched ${allHits.length} / ${data.nbHits} sale items…`);

    if (hits.length < HITS_PER_PAGE || allHits.length >= data.nbHits) break;
    page++;
  }

  const seen = new Set();
  const deals = allHits.map(h => mapAlgoliaHit(h, seen)).filter(Boolean);
  onProgress(`Gymshark: found ${deals.length} deals`);
  return deals;
}

function mapAlgoliaHit(h, seen) {
  try {
    const name = h.title || '';
    if (!name) return null;

    const price = parseFloat(h.price || 0);
    const originalPrice = parseFloat(h.compareAtPrice || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = h.handle || slugify(name);
    const url = `https://www.gymshark.com/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    const image = h.featuredImage?.url || h.image?.url || '';

    // Gender from division
    const div = (h.division || '').toLowerCase();
    const gender = div.includes('female') || div.includes('women') ? 'Women'
      : div.includes('male') || div.includes('men') ? 'Men' : '';

    return {
      id: slugify(`gymshark-${name}-${handle}`),
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
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
