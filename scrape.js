// CLI scrape (used by the GitHub Actions deploy): writes data/deals.json.
// Exits non-zero on a suspiciously small result so a bad run never replaces the live site.
const { runAll } = require('./scraper/index');
const MIN_DEALS = 500;
runAll(require('./config.json'), m => console.log(m)).then(deals => {
  console.log(deals.length, 'deals');
  process.exit(deals.length < MIN_DEALS ? 1 : 0);
}).catch(err => { console.error(err); process.exit(1); });
