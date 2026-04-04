'use strict';

// Keyword maps for auto-tagging product names → normalized category tags
const CATEGORY_MAP = [
  { tag: 'T-Shirts',    keywords: ['t-shirt', 'tshirt', 'tee', ' tee ', 'graphic tee', 'crew neck', 'crewneck'] },
  { tag: 'Shorts',      keywords: ['short', 'shorts'] },
  { tag: 'Jackets',     keywords: ['jacket', 'parka', 'anorak', 'windbreaker', 'wind breaker', 'vest', 'gilet'] },
  { tag: 'Hoodies',     keywords: ['hoodie', 'hoody', 'sweatshirt', 'fleece', 'pullover'] },
  { tag: 'Outerwear',   keywords: ['coat', 'overcoat', 'trench', 'puffer', 'down jacket', 'rain jacket'] },
  { tag: 'Dresses',     keywords: ['dress', 'gown', 'midi', 'maxi dress', 'mini dress'] },
  { tag: 'Skirts',      keywords: ['skirt'] },
  { tag: 'Pants',       keywords: ['pant', 'pants', 'jean', 'jeans', 'trouser', 'trousers', 'chino', 'legging', 'jogger', 'sweatpant'] },
  { tag: 'Tops',        keywords: ['blouse', 'top ', 'tops', 'tunic', 'tank', 'cami', 'crop', 'polo', 'henley', 'shirt'] },
  { tag: 'Footwear',    keywords: ['shoe', 'shoes', 'sneaker', 'runner', 'trainer', 'boot', 'sandal', 'slide', 'loafer', 'oxford', 'mule', 'clog'] },
  { tag: 'Activewear',  keywords: ['sport', 'active', 'athletic', 'performance', 'training', 'running', 'gym', 'yoga', 'cycling', 'compression', 'hovr', 'rush', 'tech'] },
  { tag: 'Swimwear',    keywords: ['swim', 'bikini', 'board short', 'swimsuit', 'bathing'] },
  { tag: 'Underwear',   keywords: ['underwear', 'brief', 'briefs', 'boxer', 'bra', 'bralette', 'lingerie', 'thong', 'panty', 'sock', 'socks'] },
  { tag: 'Accessories', keywords: ['bag', 'tote', 'backpack', 'wallet', 'belt', 'hat', 'cap', 'beanie', 'glove', 'scarf', 'sunglasses', 'watch', 'jewelry', 'jewellery', 'necklace', 'bracelet', 'earring'] },
];

const GENDER_MAP = [
  { tag: 'Men',   keywords: ['men\'s', 'mens', ' men ', 'male', 'boy', 'boys'] },
  { tag: 'Women', keywords: ['women\'s', 'womens', ' women ', 'female', 'girl', 'girls', 'ladies'] },
  { tag: 'Kids',  keywords: ['kids', 'children', 'toddler', 'infant', 'baby', 'youth'] },
];

/**
 * Given a product name, description, and optional store-provided category string,
 * returns an array of normalized string tags.
 *
 * @param {object} opts
 * @param {string} opts.name          Product name
 * @param {string} [opts.description] Product description (optional)
 * @param {string} [opts.category]    Store-provided category string (optional)
 * @param {string} [opts.gender]      Store-provided gender hint (optional)
 * @returns {string[]}
 */
function tag({ name = '', description = '', category = '', gender = '' } = {}) {
  const haystack = [name, description, category].join(' ').toLowerCase();
  const tags = new Set();

  // Gender
  if (gender) {
    const g = gender.toLowerCase();
    if (g.includes('men') && !g.includes('women')) tags.add('Men');
    else if (g.includes('women') || g.includes('woman')) tags.add('Women');
    else if (g.includes('unisex')) tags.add('Unisex');
    else if (g.includes('kid') || g.includes('child') || g.includes('boy') || g.includes('girl')) tags.add('Kids');
  }

  if (tags.size === 0) {
    for (const { tag: t, keywords } of GENDER_MAP) {
      if (keywords.some(k => haystack.includes(k))) {
        tags.add(t);
        break;
      }
    }
  }

  if (tags.size === 0) tags.add('Unisex');

  // Category — can match multiple
  const catHaystack = [name, category].join(' ').toLowerCase();
  for (const { tag: t, keywords } of CATEGORY_MAP) {
    if (keywords.some(k => catHaystack.includes(k))) {
      tags.add(t);
    }
  }

  return [...tags];
}

module.exports = { tag };
