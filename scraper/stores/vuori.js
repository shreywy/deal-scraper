'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Vuori';
const STORE_KEY = 'vuori';
const CURRENCY = 'USD';

// Algolia credentials (from browser network inspection)
const ALGOLIA_APP_ID = 'P2MLBKGFDS';
const ALGOLIA_API_KEY = '7825c979763a41aae103633f760004f1';
const ALGOLIA_INDEX = 'us_products';

/**
 * Vuori — men's + women's activewear, ships to Canada.
 * USD prices converted to CAD. Uses Algolia API.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const rate = await getUSDtoCAD();

  onProgress('Vuori: querying Algolia for sale products…');

  const allDeals = [];
  const seenUrls = new Set();

  // Query Algolia for sale products (men's and women's)
  const collections = [
    { handle: 'sale', gender: 'Men', label: "men's" },
    { handle: 'womens-sale', gender: 'Women', label: "women's" },
  ];

  for (const { handle, gender, label } of collections) {
    onProgress(`Vuori: fetching ${label} sale from Algolia…`);

    try {
      // Algolia search query (mimicking the browser request)
      const algoliaUrl = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`;
      const body = {
        requests: [
          {
            indexName: ALGOLIA_INDEX,
            query: '',
            hitsPerPage: 250,
            filters: `collections:${handle}`,
            attributesToRetrieve: [
              'title',
              'handle',
              'image',
              'variants',
              'variants_min_price',
              'variants_max_price',
            ],
          },
        ],
      };

      const response = await fetch(algoliaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Algolia-Application-Id': ALGOLIA_APP_ID,
          'X-Algolia-API-Key': ALGOLIA_API_KEY,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        onProgress(`Vuori: Algolia error ${response.status} for ${label}`);
        continue;
      }

      const data = await response.json();
      const hits = data.results?.[0]?.hits || [];

      for (const product of hits) {
        const name = product.title || product.name || '';
        if (!name) continue;

        const productHandle = product.handle || '';
        const url = `https://vuoriclothing.com/products/${productHandle}`;
        if (seenUrls.has(url)) continue;

        // Algolia response has variants with price info
        const variants = product.variants || [];
        let priceUSD = null;
        let origUSD = null;

        // Try to find a variant with both price and compare_at_price
        for (const v of variants) {
          let vPrice = parseFloat(v.price || v.variant_price || 0);
          let vCompare = parseFloat(v.compare_at_price || v.compareAtPrice || v.compare_price || 0);

          if (vCompare > vPrice && vPrice > 0 && (priceUSD === null || vPrice < priceUSD)) {
            priceUSD = vPrice;
            origUSD = vCompare;
          }
        }

        // If no variant-level compare_at_price, check if there's a product-level discount
        if (!priceUSD || !origUSD) {
          // Check if variants_min_price exists (this is often the sale price)
          const minPrice = parseFloat(product.variants_min_price || 0);
          const maxPrice = parseFloat(product.variants_max_price || 0);

          // If min < max, assume there's a sale (min is sale price, max is original)
          if (minPrice > 0 && maxPrice > minPrice) {
            priceUSD = minPrice;
            origUSD = maxPrice;
          }
        }

        if (!priceUSD || !origUSD || priceUSD >= origUSD) continue;

        const discount = Math.round((1 - priceUSD / origUSD) * 100);
        if (discount <= 0) continue;

        seenUrls.add(url);

        const image = product.image || product.images?.[0] || '';

        allDeals.push({
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name,
          url,
          image,
          price: priceUSD,
          originalPrice: origUSD,
          discount,
          gender,
          tags: [],
        });
      }

      onProgress(`Vuori: ${allDeals.filter(d => d.gender === gender).length} ${label} deals found`);
    } catch (err) {
      onProgress(`Vuori: error fetching ${label} — ${err.message}`);
    }
  }

  const tagged = allDeals.map(d => ({
    ...d,
    id: slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: Math.round(d.price * rate * 100) / 100,
    originalPriceCAD: Math.round(d.originalPrice * rate * 100) / 100,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Vuori: found ${tagged.length} total deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
