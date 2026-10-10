'use strict';

// Shared scraper for Gap Inc. Canada brands (Gap, Banana Republic, Old Navy).
// Their sale pages load from a public product-search API, which we call directly.

const { tag } = require('./tagger');

const API = 'https://api.gapcanada.ca/v2/product_search_cc_aggregations/v2';

async function scrapeGapInc(browser, onProgress, { storeKey, storeName, host, brand, cids }) {
  const deals = [];
  const seen = new Set();
  for (const c of cids) {
    const { cid, gender = '' } = typeof c === 'string' ? { cid: c } : c;
    for (let pageNumber = 0, total = 1; pageNumber < total && pageNumber < 10; pageNumber++) {
      const qs = new URLSearchParams({
        pageSize: 200, pageNumber, ignoreInventory: false, cid, vendor: 'constructorio',
        client_id: 0, session_id: 0, brand, locale: 'en_CA', market: 'ca',
      });
      const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0 Safari/537.36' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for cid ${cid}`);
      const json = await res.json();
      total = Number(json.pagination?.pageNumberTotal) || 1;
      for (const p of json.products || []) {
        for (const color of p.styleColors || []) {
          const d = mapColor(p, color, { storeKey, storeName, host, gender });
          if (d && !seen.has(d.id)) { seen.add(d.id); deals.push(d); }
        }
      }
    }
    onProgress(`${storeName}: ${deals.length} deals after cid ${cid}`);
  }
  return deals;
}

function mapColor(p, c, { storeKey, storeName, host, gender }) {
  const price = parseFloat(c.effectivePrice);
  const originalPrice = parseFloat(c.regularPrice);
  if (!(price > 0) || !(originalPrice > price) || c.inventoryStatus === 'Out of Stock') return null;
  const img = (c.images || []).find(i => i.type === 'P01') || c.images?.[0];
  return {
    id: `${storeKey}-${c.ccId}`,
    store: storeName,
    storeKey,
    name: p.styleName,
    url: `https://${host}/browse/product.do?pid=${c.ccId}`,
    image: img ? `https://${host}/${img.path.replace(/^\//, '')}` : '',
    price,
    originalPrice,
    discount: Math.round((1 - price / originalPrice) * 100),
    currency: 'CAD',
    priceCAD: price,
    originalPriceCAD: originalPrice,
    tags: tag({ name: p.styleName, category: p.webProductType || '', gender }),
    scrapedAt: new Date().toISOString(),
  };
}

module.exports = { scrapeGapInc };
