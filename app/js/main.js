import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { parseIngredient, normalizeIngredient, scaleIngredient, shoppingList, guessCategory, CATEGORIES, UNITS } from './ingredients.js';
import { computeFactor, formatFactor, describeMold, servingsForMold, AREA_PER_SERVING } from './scale.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

// ---------------------------------------------------------------- utilitaires
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
const artFor = (cat) => `img/${CATEGORIES[cat]?.icon || 'cupcake'}.svg`;
function thumb(r, cls = '') {
  const img = safeUrl(r.image);
  return img
    ? `<img class="photo ${cls}" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.className='art ${cls}';this.src='${artFor(r.category)}'">`
    : `<img class="art ${cls}" src="${artFor(r.category)}" alt="">`;
}

// ---------------------------------------------------------------- état
const state = {
  user: null,
  recipes: [],
  bakes: [],
  filter: { cat: 'all', q: '' },
  bake: null,
  editing: null,
};
const emptyBake = () => ({ id: null, name: '', recipe_ids: [], target: { mode: 'servings', servings: 8, mold: { shape: 'round', diameter: 20 }, overrides: {} } });
const bakeKey = () => `ca.bake.${state.user?.id}`;
const saveDraft = () => store.set(bakeKey(), state.bake);

// ---------------------------------------------------------------- éditeur de moule
const SHAPES = {
  round: { label: 'Rond', icon: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>' },
  square: { label: 'Carré', icon: '<svg viewBox="0 0 20 20"><rect x="2.5" y="2.5" width="15" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>' },
  rect: { label: 'Rectangle', icon: '<svg viewBox="0 0 20 20"><rect x="1.5" y="5" width="17" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>' },
};

function moldEditor(container, initial, onChange, { allowNone = false } = {}) {
  let mold = initial ? { ...initial } : (allowNone ? { shape: 'none' } : { shape: 'round' });
  const field = (name, label, ph) => `<label>${label}<input type="number" step="0.5" min="1" inputmode="decimal" data-k="${name}" value="${esc(mold[name] ?? '')}" placeholder="${ph}"></label>`;
  const render = () => {
    const shapes = Object.entries(SHAPES).map(([k, s]) => `<button type="button" data-shape="${k}" class="${mold.shape === k ? 'active' : ''}">${s.icon}${s.label}</button>`).join('');
    let dims = '';
    if (mold.shape === 'round') dims = field('diameter', 'Diamètre (cm)', 'ex. 20');
    if (mold.shape === 'square') dims = field('side', 'Côté (cm)', 'ex. 18');
    if (mold.shape === 'rect') dims = field('length', 'Longueur (cm)', 'ex. 30') + field('width', 'Largeur (cm)', 'ex. 20');
    if (mold.shape !== 'none') dims += field('height', 'Hauteur (cm, facultatif)', 'ex. 5');
    container.innerHTML = `<div class="shape-pick">${allowNone ? `<button type="button" data-shape="none" class="${mold.shape === 'none' ? 'active' : ''}">Inconnu</button>` : ''}${shapes}</div><div class="mold-fields">${dims}</div>`;
  };
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shape]');
    if (!b) return;
    mold = { ...mold, shape: b.dataset.shape };
    render();
    onChange?.(get());
  });
  container.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    mold[k] = e.target.value === '' ? null : Number(e.target.value.replace(',', '.'));
    onChange?.(get());
  });
  const get = () => {
    if (mold.shape === 'none') return null;
    const m = { shape: mold.shape };
    for (const k of ['diameter', 'side', 'length', 'width', 'height']) if (num(mold[k])) m[k] = num(mold[k]);
    return describeMold(m) ? m : null;
  };
  render();
  return { get };
}

// ---------------------------------------------------------------- authentification
let authMode = 'login';
function setAuthTab(mode) {
  authMode = mode;
  $$('[data-auth-tab]').forEach((t) => { const on = t.dataset.authTab === mode; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $('#auth-submit').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  $('#auth-form [name=password]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  setMsg('#auth-msg', '');
}
function setMsg(sel, text, kind = '') { const el = $(sel); el.textContent = text; el.className = `form-msg ${kind}`; }
const appUrl = () => location.origin + location.pathname;

function frenchAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return 'Confirme ton adresse e-mail (regarde ta boîte de réception).';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Un compte existe déjà avec cet e-mail.';
  if (m.includes('rate limit')) return 'Trop de tentatives, réessaie dans quelques minutes.';
  if (m.includes('password')) return 'Mot de passe trop faible (6 caractères minimum).';
  return err?.message || 'Une erreur est survenue.';
}

$$('[data-auth-tab]').forEach((t) => t.addEventListener('click', () => setAuthTab(t.dataset.authTab)));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get('email').trim();
  const password = fd.get('password');
  const btn = $('#auth-submit');
  btn.disabled = true;
  setMsg('#auth-msg', authMode === 'login' ? 'Connexion…' : 'Création du compte…');
  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
      if (error) throw error;
      if (!data.session) setMsg('#auth-msg', 'Compte créé ! Clique sur le lien reçu par e-mail pour l\'activer.', 'ok');
    }
  } catch (err) {
    setMsg('#auth-msg', frenchAuthError(err), 'error');
  } finally {
    btn.disabled = false;
  }
});
$('#forgot-btn').addEventListener('click', async () => {
  const email = $('#auth-form [name=email]').value.trim();
  if (!email) { setMsg('#auth-msg', 'Saisis d\'abord ton e-mail ci-dessus.', 'error'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  setMsg('#auth-msg', error ? frenchAuthError(error) : 'Un e-mail de réinitialisation t\'a été envoyé.', error ? 'error' : 'ok');
});
$('#reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = new FormData(e.target).get('password');
  const { error } = await sb.auth.updateUser({ password });
  if (error) { setMsg('#reset-msg', frenchAuthError(error), 'error'); return; }
  $('#reset-form').hidden = true;
  $('#auth-form').hidden = false;
  toast('Mot de passe mis à jour 🍰');
  const { data } = await sb.auth.getSession();
  onSession(data.session);
});
$('#logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); });

let recovering = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recovering = true;
    showAuth();
    $('#auth-form').hidden = true;
    $('#reset-form').hidden = false;
    return;
  }
  if (recovering) return;
  // Laisse le temps au client de terminer avant d'appeler la base.
  setTimeout(() => onSession(session), 0);
});

function showAuth() {
  $('#boot').hidden = true;
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
}

async function onSession(session) {
  const user = session?.user ?? null;
  if (user?.id === state.user?.id && user) return;
  state.user = user;
  if (!user) { state.recipes = []; state.bakes = []; showAuth(); return; }
  $('#boot').hidden = true;
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-email').textContent = user.email;
  state.bake = store.get(bakeKey(), null) || emptyBake();
  state.recipes = store.get(`ca.recipes.${user.id}`, []);
  route();
  renderRecipes();
  await Promise.all([loadRecipes(), loadBakes()]);
  handleShared();
}

// ---------------------------------------------------------------- données
async function loadRecipes() {
  const { data, error } = await sb.from('recipes').select('*').order('created_at', { ascending: false });
  if (error) { if (!navigator.onLine) toast('Hors ligne : recettes en cache'); else toast('Impossible de charger les recettes'); return; }
  state.recipes = data;
  store.set(`ca.recipes.${state.user.id}`, data);
  renderRecipes();
  renderBake();
}
async function loadBakes() {
  const { data, error } = await sb.from('bakes').select('*').order('updated_at', { ascending: false });
  if (!error) { state.bakes = data; renderBakes(); }
}
const recipeById = (id) => state.recipes.find((r) => r.id === id);

async function importUrl(url) {
  const clean = safeUrl(url);
  if (!clean) { toast('Lien invalide'); return; }
  const existing = state.recipes.find((r) => r.url === clean);
  if (existing) { toast('Cette recette est déjà enregistrée'); openRecipe(existing); return; }
  toast('Lecture de la recette… 🧁');
  let info = null;
  try {
    const { data, error } = await sb.functions.invoke('import-recipe', { body: { url: clean } });
    if (error) throw error;
    info = data;
  } catch (err) {
    console.warn('import', err);
  }
  const title = info?.title || hostOf(clean) || 'Recette';
  const row = {
    user_id: state.user.id,
    url: clean,
    title,
    site: info?.site || hostOf(clean),
    image: info?.image || null,
    category: guessCategory(title),
    ingredients: (info?.ingredients || []).map((raw) => parseIngredient(raw)),
    steps: info?.steps || [],
    base_servings: info?.servings || null,
    base_mold: info?.mold || null,
  };
  const { data, error } = await sb.from('recipes').upsert(row, { onConflict: 'user_id,url' }).select().single();
  if (error) { toast('Enregistrement impossible : ' + error.message); return; }
  state.recipes.unshift(data);
  renderRecipes();
  if (!row.ingredients.length) toast('Ingrédients non détectés : colle-les dans la fiche');
  else toast('Recette ajoutée !');
  openRecipe(data);
}

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#add-url');
  const url = input.value.trim();
  input.value = '';
  await importUrl(url);
});

// Partage depuis une autre application (Android : « Partager → Cake Assistant »)
function handleShared() {
  const params = new URLSearchParams(location.search);
  let shared = params.get('url') || '';
  if (!shared) { const m = (params.get('text') || '').match(/https?:\/\/\S+/); if (m) shared = m[0]; }
  if (!shared) return;
  history.replaceState(null, '', location.pathname + location.hash);
  importUrl(shared);
}

// ---------------------------------------------------------------- liste des recettes
function renderChips() {
  const counts = {};
  for (const r of state.recipes) counts[r.category || 'autre'] = (counts[r.category || 'autre'] || 0) + 1;
  const chips = [`<button class="chip ${state.filter.cat === 'all' ? 'active' : ''}" data-cat="all"><img src="img/cupcake.svg" alt="">Tout (${state.recipes.length})</button>`];
  for (const [k, c] of Object.entries(CATEGORIES)) {
    if (!counts[k]) continue;
    chips.push(`<button class="chip ${state.filter.cat === k ? 'active' : ''}" data-cat="${k}"><img src="img/${c.icon}.svg" alt="">${c.label} (${counts[k]})</button>`);
  }
  $('#category-chips').innerHTML = chips.join('');
}
$('#category-chips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-cat]');
  if (!c) return;
  state.filter.cat = c.dataset.cat;
  renderRecipes();
});
$('#search').addEventListener('input', (e) => { state.filter.q = e.target.value; renderRecipes(); });

function baseLine(r) {
  const parts = [];
  if (r.base_servings) parts.push(`${r.base_servings} pers.`);
  if (r.base_mold) parts.push(describeMold(r.base_mold));
  return parts.join(' · ');
}

function renderRecipes() {
  renderChips();
  const q = state.filter.q.trim().toLowerCase();
  const list = state.recipes.filter((r) =>
    (state.filter.cat === 'all' || (r.category || 'autre') === state.filter.cat) &&
    (!q || `${r.title} ${r.site}`.toLowerCase().includes(q)));
  const inBake = new Set(state.bake?.recipe_ids || []);
  $('#recipe-grid').innerHTML = list.map((r) => {
    const base = baseLine(r);
    const nIng = (r.ingredients || []).length;
    return `<article class="rcard ${inBake.has(r.id) ? 'in-bake' : ''}" data-id="${r.id}" tabindex="0">
      <div class="rcard-img c-${esc(r.category || 'autre')}">${thumb(r)}</div>
      <span class="cat">${esc(CATEGORIES[r.category]?.label || 'Autre')}</span>
      <button class="btn btn-round ${inBake.has(r.id) ? 'btn-primary' : ''} add-bake" data-toggle="${r.id}" title="${inBake.has(r.id) ? 'Retirer du gâteau' : 'Ajouter au gâteau'}" aria-label="${inBake.has(r.id) ? 'Retirer du gâteau' : 'Ajouter au gâteau'}">${inBake.has(r.id) ? '✓' : '+'}</button>
      <div class="rcard-body">
        <h3>${esc(r.title)}</h3>
        <span class="muted small">${esc(r.site || hostOf(r.url))} · ${nIng} ingrédient${nIng > 1 ? 's' : ''}</span>
        ${base ? `<span class="small">${esc(base)}</span>` : '<span class="warn">Base à renseigner</span>'}
      </div>
    </article>`;
  }).join('');
  $('#recipes-empty').hidden = state.recipes.length > 0;
  const n = state.recipes.length;
  $('#welcome-title').textContent = n ? `Coucou ! ${n} recette${n > 1 ? 's' : ''} dans ton carnet` : 'Coucou, bienvenue !';
}

$('#recipe-grid').addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) { e.stopPropagation(); toggleInBake(t.dataset.toggle); return; }
  const card = e.target.closest('.rcard');
  if (card) openRecipe(recipeById(card.dataset.id));
});
$('#recipe-grid').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('rcard')) openRecipe(recipeById(e.target.dataset.id));
});

function toggleInBake(id) {
  const ids = state.bake.recipe_ids;
  const i = ids.indexOf(id);
  if (i >= 0) ids.splice(i, 1); else ids.push(id);
  saveDraft();
  renderRecipes();
  renderBake();
  toast(i >= 0 ? 'Retirée du gâteau' : 'Ajoutée au gâteau 🎂');
}

// ---------------------------------------------------------------- fiche recette
const dlg = $('#recipe-dialog');
const rform = $('#recipe-form');
let moldEd = null;
$('#rd-category').innerHTML = Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');

function ingLine(i) {
  if (typeof i === 'string') return i;
  return i.raw || [i.qty, i.unit ? UNITS[i.unit]?.label[0] : '', i.name].filter(Boolean).join(' ');
}

function renderParsed() {
  const lines = rform.ingredients.value.split('\n').map((l) => l.trim()).filter(Boolean);
  $('#rd-parsed').innerHTML = lines.map((l) => {
    const p = parseIngredient(l);
    const q = p.qty == null ? 'selon besoin' : scaleIngredient(p, 1).display;
    return `<span class="pchip ${p.qty == null ? 'noqty' : ''}" title="${esc(l)}"><b>${esc(q)}</b> · ${esc(p.name)}</span>`;
  }).join('');
}
rform.ingredients.addEventListener('input', renderParsed);

function openRecipe(r) {
  if (!r) return;
  state.editing = r;
  $('#rd-heading').textContent = r.title;
  rform.title.value = r.title;
  rform.category.value = r.category || guessCategory(r.title);
  rform.base_servings.value = r.base_servings ?? '';
  rform.ingredients.value = (r.ingredients || []).map(ingLine).join('\n');
  rform.steps.value = (r.steps || []).join('\n');
  rform.notes.value = r.notes || '';
  const link = $('#rd-link');
  link.href = safeUrl(r.url) || '#';
  link.textContent = `Voir la page d'origine (${hostOf(r.url)}) ↗`;
  moldEd = moldEditor($('#rd-mold'), r.base_mold, null, { allowNone: true });
  $('#rd-addbake').textContent = state.bake.recipe_ids.includes(r.id) ? 'Retirer du gâteau' : 'Ajouter au gâteau';
  renderParsed();
  dlg.showModal();
}

rform.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const r = state.editing;
  const patch = {
    title: rform.title.value.trim() || r.title,
    category: rform.category.value,
    base_servings: num(rform.base_servings.value),
    base_mold: moldEd.get(),
    ingredients: rform.ingredients.value.split('\n').map((l) => l.trim()).filter(Boolean).map(parseIngredient),
    steps: rform.steps.value.split('\n').map((l) => l.trim()).filter(Boolean),
    notes: rform.notes.value.trim() || null,
  };
  const { data, error } = await sb.from('recipes').update(patch).eq('id', r.id).select().single();
  if (error) { toast('Erreur : ' + error.message); return; }
  Object.assign(r, data);
  store.set(`ca.recipes.${state.user.id}`, state.recipes);
  dlg.close();
  renderRecipes();
  renderBake();
  toast('Recette enregistrée ✨');
});
$('#rd-delete').addEventListener('click', async () => {
  const r = state.editing;
  if (!confirm(`Supprimer « ${r.title} » ?`)) return;
  const { error } = await sb.from('recipes').delete().eq('id', r.id);
  if (error) { toast('Erreur : ' + error.message); return; }
  state.recipes = state.recipes.filter((x) => x.id !== r.id);
  state.bake.recipe_ids = state.bake.recipe_ids.filter((id) => id !== r.id);
  saveDraft();
  dlg.close();
  renderRecipes();
  renderBake();
  toast('Recette supprimée');
});
$('#rd-addbake').addEventListener('click', () => { toggleInBake(state.editing.id); dlg.close(); });

// ---------------------------------------------------------------- mon gâteau
let targetMoldEd = null;
function setMode(mode) {
  state.bake.target.mode = mode;
  $$('.seg').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  $('#target-servings').hidden = mode !== 'servings';
  $('#target-mold').hidden = mode !== 'mold';
  saveDraft();
  renderBake();
}
$$('.seg').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#target-servings-input').addEventListener('input', (e) => { state.bake.target.servings = num(e.target.value); saveDraft(); renderBake(); });
$$('[data-step]').forEach((b) => b.addEventListener('click', () => {
  const input = $('#target-servings-input');
  const v = Math.max(1, (num(input.value) || 0) + Number(b.dataset.step));
  input.value = v;
  state.bake.target.servings = v;
  saveDraft();
  renderBake();
}));
$('#bake-name').addEventListener('input', (e) => { state.bake.name = e.target.value; saveDraft(); });

function syncBakeHead() {
  const t = state.bake.target;
  $('#bake-name').value = state.bake.name || '';
  $('#target-servings-input').value = t.servings ?? '';
  targetMoldEd = moldEditor($('#target-mold'), t.mold, (m) => { state.bake.target.mold = m; saveDraft(); renderBake(); });
  $$('.seg').forEach((b) => { const on = b.dataset.mode === t.mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  $('#target-servings').hidden = t.mode !== 'servings';
  $('#target-mold').hidden = t.mode !== 'mold';
}

function targetHint() {
  const t = state.bake.target;
  if (t.mode === 'servings' && num(t.servings)) {
    const d = Math.sqrt((num(t.servings) * AREA_PER_SERVING) / Math.PI) * 2;
    return `Pour ${t.servings} personnes, compte environ un cercle de ${Math.round(d)} cm de diamètre.`;
  }
  if (t.mode === 'mold' && t.mold) {
    const s = servingsForMold(t.mold);
    return s ? `Ce moule (${describeMold(t.mold)}) donne environ ${s} parts.` : '';
  }
  return '';
}

function componentFactor(r) {
  const override = num(state.bake.target.overrides?.[r.id]);
  if (override) return { factor: override, approx: false, why: 'coefficient choisi à la main', manual: true };
  return computeFactor(r, state.bake.target);
}

function renderBake() {
  if (!state.bake) return;
  const ids = state.bake.recipe_ids.filter((id) => recipeById(id));
  const count = $('#bake-count');
  count.textContent = ids.length;
  count.hidden = !ids.length;
  $('#target-hint').textContent = targetHint();
  $('#bake-empty').hidden = ids.length > 0;
  $('#shopping').hidden = ids.length === 0;

  const items = [];
  $('#bake-components').innerHTML = ids.map((id) => {
    const r = recipeById(id);
    const f = componentFactor(r);
    const factor = f.factor ?? 1;
    items.push({ ingredients: r.ingredients, factor, label: r.title });
    const rows = (r.ingredients || []).map((ing) => {
      const n = normalizeIngredient(ing);
      const s = scaleIngredient(n, factor);
      return `<tr><td class="q">${esc(s.display)}${s.hint ? `<span class="h">${esc(s.hint)}</span>` : ''}</td><td>${esc(n.name)}</td><td class="orig">${n.qty != null ? esc(scaleIngredient(n, 1).display) : ''}</td></tr>`;
    }).join('');
    const base = baseLine(r);
    return `<article class="card comp" data-id="${r.id}">
      <div class="comp-head">
        ${thumb(r)}
        <div class="comp-title">
          <h3>${esc(r.title)}</h3>
          <span class="muted small">${esc(r.site || hostOf(r.url))}${base ? ' · recette pour ' + esc(base) : ''}</span>
        </div>
        <span class="factor ${f.factor == null ? 'unknown' : ''}" title="Coefficient appliqué">${f.factor == null ? '×1 ?' : formatFactor(f.factor)}</span>
      </div>
      <p class="comp-note ${f.factor == null ? 'alert' : ''}">${f.factor == null ? esc(f.why) + ' Quantités d\'origine affichées.' : (f.approx ? '≈ ' : '') + esc(f.why)}</p>
      ${rows ? `<table class="ing-table"><tbody>${rows}</tbody></table>` : '<p class="comp-note alert">Aucun ingrédient : ouvre la fiche pour les ajouter.</p>'}
      <div class="comp-tools">
        <label>Coefficient manuel <input type="number" step="0.05" min="0.05" inputmode="decimal" data-override="${r.id}" value="${esc(state.bake.target.overrides?.[r.id] ?? '')}" placeholder="auto"></label>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Modifier la fiche</button>
        <a class="btn btn-ghost btn-sm" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">Recette ↗</a>
        <button class="btn btn-danger btn-sm" data-remove="${r.id}">Retirer</button>
      </div>
    </article>`;
  }).join('');

  const list = shoppingList(items);
  $('#shop-list').innerHTML = list.map((i) => `<li><input type="checkbox" aria-label="Acheté"><span class="q">${esc(i.display)}</span><span>${esc(i.name)}${i.hint ? ` <span class="muted small">(${esc(i.hint)})</span>` : ''}${i.from.length > 1 ? `<span class="from">${esc(i.from.join(' + '))}</span>` : ''}</span></li>`).join('');
  state.lastList = list;
}

$('#bake-components').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { toggleInBake(rm.dataset.remove); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) openRecipe(recipeById(ed.dataset.edit));
});
$('#bake-components').addEventListener('change', (e) => {
  const id = e.target.dataset.override;
  if (!id) return;
  const v = num(e.target.value);
  state.bake.target.overrides ||= {};
  if (v) state.bake.target.overrides[id] = v; else delete state.bake.target.overrides[id];
  saveDraft();
  renderBake();
});

// Sélecteur
const picker = $('#picker-dialog');
function renderPicker() {
  const q = $('#picker-search').value.trim().toLowerCase();
  const sel = new Set(state.bake.recipe_ids);
  $('#picker-list').innerHTML = state.recipes.filter((r) => !q || r.title.toLowerCase().includes(q)).map((r) => `
    <li><label><input type="checkbox" value="${r.id}" ${sel.has(r.id) ? 'checked' : ''}>${thumb(r)}<span>${esc(r.title)}<span class="sub">${esc(CATEGORIES[r.category]?.label || 'Autre')} · ${esc(r.site || hostOf(r.url))}</span></span></label></li>`).join('')
    || '<li class="muted">Aucune recette. Ajoute-en depuis « Mes recettes ».</li>';
}
$('#pick-btn').addEventListener('click', () => { $('#picker-search').value = ''; renderPicker(); picker.showModal(); });
$('#picker-search').addEventListener('input', renderPicker);
$('#picker-list').addEventListener('change', (e) => {
  const id = e.target.value;
  const ids = state.bake.recipe_ids;
  if (e.target.checked && !ids.includes(id)) ids.push(id);
  if (!e.target.checked) state.bake.recipe_ids = ids.filter((x) => x !== id);
  saveDraft();
});
picker.addEventListener('close', () => { renderBake(); renderRecipes(); });

$('#copy-list').addEventListener('click', async () => {
  const title = state.bake.name || 'Mon gâteau';
  const text = `${title}\n` + (state.lastList || []).map((i) => `- ${i.display} ${i.name}`).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Liste copiée 📋'); } catch { toast('Copie impossible'); }
});
$('#print-btn').addEventListener('click', () => window.print());
$('#new-bake').addEventListener('click', () => {
  if (state.bake.recipe_ids.length && !confirm('Commencer un nouveau gâteau ? Le gâteau en cours non enregistré sera vidé.')) return;
  state.bake = emptyBake();
  saveDraft();
  syncBakeHead();
  renderBake();
  renderRecipes();
});
$('#save-bake').addEventListener('click', async () => {
  const b = state.bake;
  if (!b.recipe_ids.length) { toast('Ajoute au moins une préparation'); return; }
  const row = { name: b.name?.trim() || 'Mon gâteau', recipe_ids: b.recipe_ids, target: b.target };
  const q = b.id ? sb.from('bakes').update(row).eq('id', b.id) : sb.from('bakes').insert({ ...row, user_id: state.user.id });
  const { data, error } = await q.select().single();
  if (error) { toast('Erreur : ' + error.message); return; }
  b.id = data.id;
  b.name = data.name;
  saveDraft();
  $('#bake-name').value = data.name;
  await loadBakes();
  toast('Projet enregistré 🎂');
});

// ---------------------------------------------------------------- projets
function renderBakes() {
  $('#bakes-empty').hidden = state.bakes.length > 0;
  $('#bake-list').innerHTML = state.bakes.map((b) => {
    const recs = (b.recipe_ids || []).map(recipeById).filter(Boolean);
    const t = b.target || {};
    const tgt = t.mode === 'mold' ? describeMold(t.mold) : t.servings ? `${t.servings} personnes` : '';
    return `<article class="card bcard">
      <h3>${esc(b.name)}</h3>
      <div class="thumbs">${recs.map((r) => thumb(r)).join('')}</div>
      <p class="muted small">${recs.map((r) => esc(r.title)).join(' · ') || 'Préparations supprimées'}${tgt ? `<br>Pour : ${esc(tgt)}` : ''}</p>
      <div class="row-btns">
        <button class="btn btn-danger btn-sm" data-del-bake="${b.id}">Supprimer</button>
        <button class="btn btn-primary btn-sm" data-open-bake="${b.id}">Ouvrir</button>
      </div>
    </article>`;
  }).join('');
}
$('#bake-list').addEventListener('click', async (e) => {
  const o = e.target.closest('[data-open-bake]');
  if (o) {
    const b = state.bakes.find((x) => x.id === o.dataset.openBake);
    state.bake = { id: b.id, name: b.name, recipe_ids: [...(b.recipe_ids || [])], target: { ...emptyBake().target, ...(b.target || {}) } };
    saveDraft();
    location.hash = '#gateau';
    return;
  }
  const d = e.target.closest('[data-del-bake]');
  if (d && confirm('Supprimer ce projet ?')) {
    const { error } = await sb.from('bakes').delete().eq('id', d.dataset.delBake);
    if (error) { toast('Erreur : ' + error.message); return; }
    if (state.bake.id === d.dataset.delBake) state.bake.id = null;
    await loadBakes();
  }
});

// ---------------------------------------------------------------- navigation
function route() {
  if (!state.user) return;
  const page = (location.hash.replace('#', '') || 'recettes');
  const valid = ['recettes', 'gateau', 'projets'].includes(page) ? page : 'recettes';
  $$('.page').forEach((p) => { p.hidden = p.id !== `page-${valid}`; });
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === valid));
  if (valid === 'gateau') { syncBakeHead(); renderBake(); }
  if (valid === 'projets') renderBakes();
  if (valid === 'recettes') renderRecipes();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

// Recharge quand on revient sur l'app (ex. après avoir utilisé l'extension)
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) loadRecipes(); });

// ---------------------------------------------------------------- démarrage
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
const { data: { session } } = await sb.auth.getSession();
if (!recovering) await onSession(session);
