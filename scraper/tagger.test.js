// node scraper/tagger.test.js — exits non-zero on any mismatch
const assert = require('assert');
const { tag, genderOf, ncTag } = require('./tagger');
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
  ["Men's Slim Dress Shirt", ['Men', 'Tops']],
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
for (const [args, want] of [
  [['MacBook Air 13-inch M3'], 'Computers'],
  [['ThinkPad X1 Carbon Gen 12'], 'Computers'],
  [['Galaxy S25 Ultra 256GB'], 'Phones & Tablets'],
  [['RTX 4070 Super', 'Graphics Cards'], 'Gaming'],
  [['HEMNES TV unit'], 'Furniture'],
  [['10" Table Saw'], 'Tools & Home Improvement'],
  [['Portable Air Conditioner'], 'Appliances'],
  [['Beautyrest Firm Queen Mattress'], 'Furniture'],
  [['Gloria End Table - Espresso'], 'Furniture'],
  [['GE Profile All-in-One Washer/Dryer'], 'Appliances'],
  [['Smartwatch Band'], 'Electronics'],
  [['Ceramic Vase', '', 'Furniture'], 'Furniture'],
]) assert.strictEqual(ncTag(...args), want, args[0]);
console.log('tagger ok');
