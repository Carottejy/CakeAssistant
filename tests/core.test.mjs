import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../shared/recipe-core.js';

const C = globalThis.CakeCore;

test('extension & server copies are in sync', () => {
  const src = readFileSync(new URL('../shared/recipe-core.js', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../extension/recipe-core.js', import.meta.url), 'utf8'), src);
  assert.equal(readFileSync(new URL('../supabase/functions/import-recipe/recipe-core.js', import.meta.url), 'utf8'), src);
});

test('JSON-LD in @graph', () => {
  const html = `<html><head><title>Génoise | Blog</title>
  <meta property="og:site_name" content="Le Blog Sucr&eacute;">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"G&eacute;noise inratable","image":[{"url":"/img/g.jpg"}],"recipeYield":["8","8 parts"],"recipeIngredient":["4 œufs","120 g de sucre","120 g de farine"],"recipeInstructions":[{"@type":"HowToStep","text":"Battre les œufs."},{"@type":"HowToStep","text":"Ajouter la farine."}]}]}</script>
  </head><body><p>Versez dans un moule de 22 cm beurré.</p></body></html>`;
  const r = C.fromHtml(html, 'https://www.exemple.fr/genoise');
  assert.equal(r.title, 'Génoise inratable');
  assert.equal(r.site, 'Le Blog Sucré');
  assert.equal(r.image, 'https://www.exemple.fr/img/g.jpg');
  assert.equal(r.servings, 8);
  assert.deepEqual(r.ingredients, ['4 œufs', '120 g de sucre', '120 g de farine']);
  assert.deepEqual(r.mold, { shape: 'round', diameter: 22 });
  assert.equal(r.steps.length, 2);
});

test('microdata fallback and rect mold', () => {
  const html = `<title>Brownie</title><ul><li itemprop="recipeIngredient">200 g de chocolat</li><li itemprop="recipeIngredient">3 œufs</li></ul><p>Cuire dans un cadre de 30 x 20 cm pour 12 personnes.</p>`;
  const r = C.fromHtml(html, 'https://ex.com/b');
  assert.deepEqual(r.ingredients, ['200 g de chocolat', '3 œufs']);
  assert.deepEqual(r.mold, { shape: 'rect', length: 30, width: 20 });
  assert.equal(r.servings, 12);
});

test('mold detection variants', () => {
  assert.deepEqual(C.moldFrom('un cercle à entremets Ø 18 cm'), { shape: 'round', diameter: 18 });
  assert.deepEqual(C.moldFrom('Moule carré de 20 cm'), { shape: 'square', side: 20 });
  assert.equal(C.moldFrom('ce matin 2 cm de crème'), null);
  assert.equal(C.servingsFrom('Recette pour 6 personnes'), 6);
});
