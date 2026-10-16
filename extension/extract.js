// Injecté dans la page de recette (après recipe-core.js). La dernière expression est renvoyée au popup.
(() => {
  const C = globalThis.CakeCore;
  const txt = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const meta = (p) => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.content?.trim() || '';

  // 1. Données structurées JSON-LD (la plupart des sites de recettes)
  const blocks = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { blocks.push(JSON.parse(s.textContent)); } catch (_) { /* ignore */ }
  }
  const recipes = C.findRecipes(blocks).map(C.fromJsonLd).filter((r) => r.ingredients.length || r.title);
  recipes.sort((a, b) => b.ingredients.length - a.ingredients.length);
  const data = recipes[0] || { title: '', image: null, ingredients: [], servings: null, steps: [] };
  let source = recipes.length ? 'jsonld' : '';

  // 2. Microdonnées
  if (!data.ingredients.length) {
    const items = [...document.querySelectorAll('[itemprop="recipeIngredient"],[itemprop="ingredients"]')].map(txt).filter(Boolean);
    if (items.length) { data.ingredients = items; source = 'microdata'; }
  }

  // 3. Liste placée sous un titre « Ingrédients »
  let ingredientZone = null;
  if (!data.ingredients.length) {
    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,strong,b,p')].filter((h) => /^\s*ingr[ée]dients?\b/i.test(txt(h)) && txt(h).length < 80);
    for (const h of heads) {
      let el = h.closest('h1,h2,h3,h4,h5,p') || h;
      for (let i = 0; i < 6 && el; i++) {
        el = el.nextElementSibling;
        const list = el && (el.matches('ul,ol') ? el : el.querySelector('ul,ol'));
        if (list) {
          const items = [...list.querySelectorAll('li')].map(txt).filter((s) => s && s.length < 200);
          if (items.length) { data.ingredients = items; ingredientZone = list; source = 'heading'; break; }
        }
      }
      if (data.ingredients.length) break;
    }
  }

  // Texte sélectionné par l'utilisateur : utile quand une page contient plusieurs préparations.
  const selection = String(window.getSelection?.() || '')
    .split(/\n+/).map((s) => s.replace(/^[\s•\-*–·▪]+/, '').trim()).filter((s) => s && s.length < 200);

  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  let url = location.href.split('#')[0];
  try { if (canonical && new URL(canonical).hostname === location.hostname) url = canonical; } catch (_) { /* ignore */ }

  const bodyText = (document.body?.innerText || '').slice(0, 60000);
  const title = data.title || meta('og:title') || document.title;
  let image = data.image || meta('og:image') || null;
  try { if (image) image = new URL(image, location.href).href; } catch (_) { image = null; }

  return {
    url,
    title: title.trim(),
    site: meta('og:site_name') || location.hostname.replace(/^www\./, ''),
    image,
    ingredients: data.ingredients,
    steps: data.steps || [],
    servings: data.servings || C.servingsFrom(`${title} ${bodyText}`),
    mold: C.moldFrom(`${data.description || ''} ${title} ${txt(ingredientZone)} ${bodyText}`),
    selection,
    otherRecipes: recipes.slice(1).map((r) => ({ title: r.title, ingredients: r.ingredients, servings: r.servings, steps: r.steps })),
    source,
  };
})();
