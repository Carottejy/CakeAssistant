// Calcul du coefficient multiplicateur entre la recette d'origine et le gâteau visé.
//
// Principe : on ramène tout à une « surface équivalente » (cm²).
//  - Moule rond : π × r² ; carré : c² ; rectangle : L × l.
//  - Nombre de personnes : on utilise la référence pâtissière courante
//    « cercle de 20 cm ≈ 8 parts », soit ≈ 39,3 cm² par part.
// Si la hauteur est connue des deux côtés, on passe en volume.

export const AREA_PER_SERVING = (Math.PI * 10 * 10) / 8; // ≈ 39,27 cm²

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function moldArea(mold) {
  if (!mold) return null;
  const { shape } = mold;
  if (shape === 'round') {
    const d = num(mold.diameter);
    return d ? Math.PI * (d / 2) ** 2 : null;
  }
  if (shape === 'square') {
    const c = num(mold.side);
    return c ? c * c : null;
  }
  if (shape === 'rect') {
    const L = num(mold.length);
    const W = num(mold.width);
    return L && W ? L * W : null;
  }
  return null;
}

export function servingsForMold(mold) {
  const a = moldArea(mold);
  return a ? Math.max(1, Math.round(a / AREA_PER_SERVING)) : null;
}

export function describeMold(mold) {
  if (!mold) return '';
  const h = num(mold.height) ? `, h ${String(mold.height).replace('.', ',')} cm` : '';
  if (mold.shape === 'round' && num(mold.diameter)) return `rond Ø ${String(mold.diameter).replace('.', ',')} cm${h}`;
  if (mold.shape === 'square' && num(mold.side)) return `carré ${mold.side} × ${mold.side} cm${h}`;
  if (mold.shape === 'rect' && num(mold.length) && num(mold.width)) return `rectangle ${mold.length} × ${mold.width} cm${h}`;
  return '';
}

/**
 * base   : { base_servings, base_mold }  (la recette telle qu'écrite sur le site)
 * target : { mode: 'servings' | 'mold', servings, mold }
 * Renvoie { factor, approx, why } ou { factor: null, why } si on ne peut pas calculer.
 */
export function computeFactor(base, target) {
  const bs = num(base?.base_servings);
  const bArea = moldArea(base?.base_mold);
  const bH = num(base?.base_mold?.height);

  if (target?.mode === 'servings') {
    const ts = num(target.servings);
    if (!ts) return { factor: null, why: 'Indique le nombre de personnes.' };
    if (bs) return { factor: ts / bs, approx: false, why: `${fmt(ts)} pers. ÷ ${fmt(bs)} pers.` };
    if (bArea) return { factor: (ts * AREA_PER_SERVING) / bArea, approx: true, why: `estimé : moule d'origine ${describeMold(base.base_mold)} ≈ ${servingsForMold(base.base_mold)} parts` };
    return { factor: null, why: 'Base inconnue : renseigne le nombre de personnes ou le moule de la recette.' };
  }

  if (target?.mode === 'mold') {
    const tArea = moldArea(target.mold);
    const tH = num(target.mold?.height);
    if (!tArea) return { factor: null, why: 'Indique les dimensions du moule.' };
    if (bArea) {
      let f = tArea / bArea;
      let why = `surface ${fmt(Math.round(tArea))} cm² ÷ ${fmt(Math.round(bArea))} cm²`;
      if (bH && tH) { f *= tH / bH; why += ` × hauteur ${fmt(tH)} ÷ ${fmt(bH)}`; }
      return { factor: f, approx: false, why };
    }
    if (bs) return { factor: tArea / (bs * AREA_PER_SERVING), approx: true, why: `estimé : ${fmt(bs)} pers. ≈ ${fmt(Math.round(bs * AREA_PER_SERVING))} cm²` };
    return { factor: null, why: 'Base inconnue : renseigne le nombre de personnes ou le moule de la recette.' };
  }
  return { factor: null, why: 'Choisis une cible.' };
}

function fmt(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

export function formatFactor(f) {
  return f == null ? '—' : `×${f.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
}
