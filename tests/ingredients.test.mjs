import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient, scaleIngredient, shoppingList, guessCategory } from '../app/js/ingredients.js';
import { computeFactor, servingsForMold } from '../app/js/scale.js';

const cases = [
  ['250 g de farine', 250, 'g', 'farine'],
  ['250g farine T55', 250, 'g', 'farine T55'],
  ['4 œufs', 4, null, 'œufs'],
  ['3 jaunes d\'œufs', 3, null, 'jaunes d\'œufs'],
  ['1/2 litre de lait entier', 0.5, 'l', 'lait entier'],
  ['½ citron', 0.5, null, 'citron'],
  ['1 ½ c. à soupe de miel', 1.5, 'cs', 'miel'],
  ['2 cuillères à café de vanille liquide', 2, 'cc', 'vanille liquide'],
  ['20 cl de crème liquide 35 %', 20, 'cl', 'crème liquide 35 %'],
  ['1 sachet de levure chimique', 1, 'sachet', 'levure chimique'],
  ['Une pincée de sel', 1, 'pincee', 'sel'],
  ['3 feuilles de gélatine', 3, 'feuille', 'gélatine'],
  ['1,5 kg de pommes', 1.5, 'kg', 'pommes'],
  ['Farine : 120 g', 120, 'g', 'Farine'],
  ['Sucre glace (40 g)', 40, 'g', 'Sucre glace'],
  ['2 à 3 cs de rhum', 2.5, 'cs', 'rhum'],
  ['2 gousses de vanille', 2, 'gousse', 'vanille'],
  ['100 ml d\'eau', 100, 'ml', 'eau'],
  ['1 cup sugar', 1, 'cup', 'sugar'],
  ['Le zeste d\'un citron', null, null, 'Le zeste d\'un citron'],
  ['beurre pour le moule', null, null, 'beurre pour le moule'],
  ['80 gr de sucre', 80, 'g', 'sucre'],
  ['1 l de lait', 1, 'l', 'lait'],
  ['10 g de gingembre', 10, 'g', 'gingembre'],
];

for (const [raw, qty, unit, name] of cases) {
  test(`parse « ${raw} »`, () => {
    const r = parseIngredient(raw);
    assert.equal(r.qty == null ? null : Math.round(r.qty * 1000) / 1000, qty, `qty for ${raw}`);
    assert.equal(r.unit, unit, `unit for ${raw}`);
    assert.equal(r.name, name, `name for ${raw}`);
  });
}

test('scale eggs adds a gram hint', () => {
  const s = scaleIngredient('4 œufs', 1.25);
  assert.equal(s.display, '5');
  const t = scaleIngredient('3 œufs', 1.5);
  assert.equal(t.display, '4,5');
  assert.match(t.hint, /225 g/);
});

test('shopping list merges units', () => {
  const list = shoppingList([
    { ingredients: ['100 g de sucre', '2 œufs', '20 cl de crème liquide'], factor: 2, label: 'A' },
    { ingredients: ['0,05 kg de sucres', '1 oeuf', '100 ml de crème liquide'], factor: 1, label: 'B' },
  ]);
  const sugar = list.find((i) => i.name.startsWith('sucre'));
  assert.equal(sugar.qty, 250);
  const eggs = list.find((i) => /œuf|oeuf/.test(i.name));
  assert.equal(eggs.qty, 5);
  const cream = list.find((i) => i.name.startsWith('crème'));
  assert.equal(cream.qty, 500);
});

test('factor by mold and servings', () => {
  const f = computeFactor({ base_mold: { shape: 'round', diameter: 20 } }, { mode: 'mold', mold: { shape: 'round', diameter: 24 } });
  assert.equal(Math.round(f.factor * 100) / 100, 1.44);
  const g = computeFactor({ base_servings: 6 }, { mode: 'servings', servings: 9 });
  assert.equal(g.factor, 1.5);
  const h = computeFactor({ base_mold: { shape: 'round', diameter: 20 } }, { mode: 'servings', servings: 8 });
  assert.equal(Math.round(h.factor * 100) / 100, 1);
  assert.equal(h.approx, true);
  assert.equal(servingsForMold({ shape: 'round', diameter: 24 }), 12);
  const r = computeFactor({ base_mold: { shape: 'rect', length: 30, width: 20 } }, { mode: 'mold', mold: { shape: 'square', side: 20 } });
  assert.equal(Math.round(r.factor * 100) / 100, 0.67);
});

test('category guess', () => {
  assert.equal(guessCategory('Génoise nature inratable'), 'biscuit');
  assert.equal(guessCategory('Lemon curd maison'), 'insert');
  assert.equal(guessCategory('Glaçage miroir chocolat'), 'glacage');
  assert.equal(guessCategory('Crème pâtissière vanille'), 'creme');
});

test('lemons are not egg yolks; butter descriptors merge', () => {
  assert.equal(scaleIngredient('3 citrons jaunes', 2).hint, '');
  assert.match(scaleIngredient('3 jaunes d\'œufs', 1).hint, /54 g de jaunes/);
  const list = shoppingList([{ ingredients: ['100 g de beurre mou', '50 g de beurre'], factor: 1 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 150);
});
