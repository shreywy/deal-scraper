'use strict';

const fetch = require('node-fetch');

let cachedRate = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch current USD→CAD exchange rate.
 * Returns the cached value if fresh, or falls back to 1.38 if all APIs fail.
 */
async function getUSDtoCAD() {
  const now = Date.now();
  if (cachedRate && now - cacheTime < CACHE_TTL) return cachedRate;

  const APIS = [
    { url: 'https://open.er-api.com/v6/latest/USD', pick: d => d?.rates?.CAD },
    { url: 'https://api.exchangerate.host/latest?base=USD&symbols=CAD', pick: d => d?.rates?.CAD },
  ];

  for (const { url, pick } of APIS) {
    try {
      const res = await fetch(url, { timeout: 8000 });
      if (!res.ok) continue;
      const data = await res.json();
      const rate = pick(data);
      if (rate && rate > 0) {
        cachedRate = rate;
        cacheTime = now;
        return rate;
      }
    } catch (_) {}
  }

  return cachedRate || 1.38; // fallback if all APIs fail
}

module.exports = { getUSDtoCAD };
