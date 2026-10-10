// node scraper/tagger.test.js — exits non-zero on any mismatch
const assert = require('assert');
const { tag, genderOf } = require('./tagger');
const cases = [
  ["UA Tech™Women's V-Neck Short Sleeve", ['Women', 'Tops', 'Activewear']],
  ["Armour Fleece® Girls' Relaxed Joggers", ['Kids', 'Hoodies', 'Pants']],
  ["UA Brawler 3.0 Tapered Boys' Pants", ['Kids', 'Pants']],
  ["Men's Running Shoe", ['Men', 'Footwear', 'Activewear']],
  ['W’s Down Sweater', ['Women', 'Hoodies']],
  ["Men's Ski Jacket", ['Men', 'Jackets']],
  ['Hockey Stick', ['Non-Clothing']],
  ['Womens Shorts', ['Women', 'Shorts']],
  ['Steel Water Bottle', ['Non-Clothing']],
  ['Classic Dresses', ['Dresses']],
];
for (const [name, want] of cases) assert.deepStrictEqual(tag({ name }), want, name);
assert.deepStrictEqual(tag({ name: 'Crest Joggers', gender: 'Mens' }), ['Men', 'Pants']);
assert.deepStrictEqual(tag({ name: 'Crest Joggers', gender: 'Unisex' }), ['Unisex', 'Pants']);
assert.deepStrictEqual(tag({ name: 'Logo Hoodie', description: 'mens womens fleece' }), ['Unisex', 'Hoodies']);
assert.deepStrictEqual(tag({ name: "Women's Logo Tee", gender: 'Men' }), ['Women', 'T-Shirts']);
assert.deepStrictEqual(tag({ name: 'Logo Tee', description: 'kids boys' }), ['Kids', 'T-Shirts']);
assert.strictEqual(genderOf('ca t zenvy womens tank top cy1'), 'Women');
assert.strictEqual(genderOf('en sale mens sale'), 'Men');
assert.strictEqual(genderOf('products classic hoodie'), undefined);
assert.strictEqual(genderOf('Bluey Unisex Graphic Pajama Set for Toddler & Baby'), 'Kids');
console.log('tagger ok');
