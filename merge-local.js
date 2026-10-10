// node merge-local.js <local.json> <out.json> [--replace]
// The desktop updater (run from a Canadian home connection) uploads its deals.json as a release asset.
//   --replace  publish that file as-is
//   default    backfill: stores that came back empty on GitHub's US runner (Sport Chek, Visions…)
//              keep their deals from the local run, if it's recent
const fs = require('fs');

const [localPath, outPath, mode] = process.argv.slice(2);
const MAX_AGE_HOURS = 72;

let local;
try { local = JSON.parse(fs.readFileSync(localPath, 'utf8')); } catch (_) {
  console.log('No local data to merge');
  process.exit(mode === '--replace' ? 1 : 0);
}

if (mode === '--replace') {
  fs.writeFileSync(outPath, JSON.stringify(local));
  console.log(`Published local data: ${local.deals.length} deals from ${local.scrapedAt}`);
  process.exit(0);
}

if ((Date.now() - new Date(local.scrapedAt)) / 36e5 > MAX_AGE_HOURS) {
  console.log(`Local data from ${local.scrapedAt} is too old to backfill`);
  process.exit(0);
}

const fresh = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const filled = [];
for (const [key, result] of Object.entries(local.storeResults || {})) {
  const now = fresh.storeResults?.[key];
  if (!result.count || !now || now.count) continue; // only enabled stores that got nothing here
  const deals = local.deals.filter(d => d.storeKey === key);
  fresh.deals.push(...deals);
  fresh.storeResults[key] = { ...result, backfilledFrom: local.scrapedAt };
  filled.push(`${key} (${deals.length})`);
}
fresh.deals.sort((a, b) => b.discount - a.discount);
fs.writeFileSync(outPath, JSON.stringify(fresh));
console.log(filled.length ? `Backfilled from local run: ${filled.join(', ')}` : 'Nothing to backfill');
