// Cake Assistant — extraction des recettes (commun à l'extension et à la fonction serveur).
// Script « classique » volontairement sans import/export : il fonctionne injecté dans une page
// (extension) comme importé dans Deno (fonction Supabase). Il expose globalThis.CakeCore.
// ⚠️ Fichier source : shared/recipe-core.js — lance `npm run sync` après modification.
(function () {
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', iuml: 'ï', euml: 'ë', oelig: 'œ', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—' };

  function decode(s) {
    return String(s ?? '')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
  }

  function clean(s) {
    return decode(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function hasType(o, t) {
    const ty = o && o['@type'];
    return Array.isArray(ty) ? ty.some((x) => String(x).toLowerCase() === t) : String(ty || '').toLowerCase() === t;
  }

  // Parcourt les blocs JSON-LD à la recherche d'un objet schema.org/Recipe
  function findRecipes(nodes, out = [], depth = 0) {
    if (!nodes || depth > 8) return out;
    if (Array.isArray(nodes)) { nodes.forEach((n) => findRecipes(n, out, depth + 1)); return out; }
    if (typeof nodes !== 'object') return out;
    if (hasType(nodes, 'recipe')) out.push(nodes);
    for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'hasPart']) {
      if (nodes[k] && typeof nodes[k] === 'object') findRecipes(nodes[k], out, depth + 1);
    }
    return out;
  }

  function imageOf(img) {
    if (!img) return null;
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) return imageOf(img[0]);
    return img.url || img.contentUrl || null;
  }

  function yieldOf(y) {
    const list = Array.isArray(y) ? y : [y];
    for (const v of list) {
      const m = String(v ?? '').match(/(\d+(?:[.,]\d+)?)/);
      if (m) {
        const n = Number(m[1].replace(',', '.'));
        if (n > 0 && n <= 100) return n;
      }
    }
    return null;
  }

  function stepsOf(instr) {
    const out = [];
    const walk = (x) => {
      if (!x) return;
      if (typeof x === 'string') {
        clean(x).split(/\s*(?:\n|\r|(?<=\.)\s+(?=\d+[.)]\s))\s*/).forEach((s) => s && out.push(s));
        return;
      }
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (hasType(x, 'howtosection')) { if (x.name) out.push(`— ${clean(x.name)} —`); walk(x.itemListElement); return; }
      if (x.text) out.push(clean(x.text));
      else if (x.name) out.push(clean(x.name));
      else if (x.itemListElement) walk(x.itemListElement);
    };
    walk(instr);
    return out.filter(Boolean).slice(0, 80);
  }

  function num(s) { return Number(String(s).replace(',', '.')); }

  // Cherche une mention de moule dans le texte : « moule de 22 cm », « cercle Ø 20 », « cadre 30 x 20 cm »…
  function moldFrom(text) {
    const t = String(text || '').replace(/\u00a0/g, ' ');
    const KW = '(?<![\\p{L}])(?:moule|cercle|anneau|cadre|plaque|plat|tourti[eè]re|mold|pan|tin|ring)s?(?![\\p{L}])';
    const D = '(\\d{1,2}(?:[.,]\\d)?)';
    let m = t.match(new RegExp(`${KW}[^.\\n]{0,40}?${D}\\s*(?:cm)?\\s*[x×*]\\s*${D}\\s*cm`, 'iu'));
    if (m) {
      const a = num(m[1]); const b = num(m[2]);
      if (a >= 8 && b >= 8) return a === b ? { shape: 'square', side: a } : { shape: 'rect', length: Math.max(a, b), width: Math.min(a, b) };
    }
    m = t.match(new RegExp(`${KW}[^.\\n]{0,30}?(?:carr[ée]|square)[^.\\n]{0,15}?${D}\\s*cm`, 'iu'));
    if (m && num(m[1]) >= 8) return { shape: 'square', side: num(m[1]) };
    m = t.match(new RegExp(`${KW}[^.\\n]{0,40}?(?:Ø|ø|diam[eè]tre\\s*(?:de\\s*)?|de\\s*)?${D}\\s*cm`, 'iu')) || t.match(new RegExp(`(?:Ø|ø)\\s*${D}\\s*cm`, 'i'));
    if (m) {
      const d = num(m[1]);
      if (d >= 8 && d <= 40) return /cadre/i.test(m[0]) ? { shape: 'square', side: d } : { shape: 'round', diameter: d };
    }
    return null;
  }

  function servingsFrom(text) {
    const m = String(text || '').match(/pour\s+(\d{1,2})\s*(?:à\s*\d{1,2}\s*)?(?:personnes?|pers\.?|parts?|gourmands?|convives?)/i)
      || String(text || '').match(/(\d{1,2})\s*(?:personnes|parts|servings|portions)\b/i);
    const n = m ? Number(m[1]) : null;
    return n && n <= 60 ? n : null;
  }

  function fromJsonLd(r) {
    return {
      title: clean(r.name || r.headline || ''),
      image: imageOf(r.image),
      ingredients: (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : [])
        .map(clean).filter(Boolean),
      servings: yieldOf(r.recipeYield),
      steps: stepsOf(r.recipeInstructions),
      description: clean(r.description || ''),
    };
  }

  /** Analyse un document HTML sous forme de texte (côté serveur). */
  function fromHtml(html, pageUrl) {
    const blocks = [];
    const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      try { blocks.push(JSON.parse(m[1].trim())); } catch (_) { /* JSON invalide */ }
    }
    const meta = (prop) => {
      const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
      const r2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
      const x = html.match(r1) || html.match(r2);
      return x ? decode(x[1]).trim() : '';
    };
    const recipes = findRecipes(blocks);
    const best = recipes.sort((a, b) => (b.recipeIngredient?.length || 0) - (a.recipeIngredient?.length || 0))[0];
    const data = best ? fromJsonLd(best) : { title: '', image: null, ingredients: [], servings: null, steps: [] };

    if (!data.ingredients.length) {
      const items = [];
      const ri = /itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/(?:li|span|p|div)>/gi;
      while ((m = ri.exec(html))) { const s = clean(m[1]); if (s) items.push(s); }
      data.ingredients = items;
    }
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    data.title = data.title || meta('og:title') || (titleTag ? clean(titleTag[1]) : '');
    data.image = data.image || meta('og:image') || null;
    let host = '';
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (_) { /* ignore */ }
    data.site = meta('og:site_name') || host;
    const text = clean(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 60000);
    data.mold = moldFrom(`${data.description || ''} ${data.title} ${text}`);
    data.servings = data.servings || servingsFrom(`${data.title} ${text}`);
    data.recipeCount = recipes.length;
    if (data.image) { try { data.image = new URL(data.image, pageUrl).href; } catch (_) { data.image = null; } }
    return data;
  }

  globalThis.CakeCore = { decode, clean, findRecipes, fromJsonLd, fromHtml, imageOf, yieldOf, stepsOf, moldFrom, servingsFrom };
})();
