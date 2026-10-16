/* global CAKE_CONFIG, CakeCore */
// Popup de l'extension : connexion, lecture de la page courante, enregistrement dans Supabase.
const api = globalThis.browser ?? globalThis.chrome;
const { SUPABASE_URL, SUPABASE_KEY, APP_URL } = CAKE_CONFIG;
const $ = (s) => document.querySelector(s);
const views = ['login', 'loading', 'recipe', 'done'];
const show = (v) => views.forEach((x) => { $(`#v-${x}`).hidden = x !== v; });

let session = null;
let page = null;
let tab = null;

// ------------------------------------------------------------ session
async function getStored() {
  const r = await api.storage.local.get('session');
  return r.session || null;
}
async function setStored(s) {
  session = s;
  if (s) await api.storage.local.set({ session: s }); else await api.storage.local.remove('session');
  $('#logout').hidden = !s;
}
function packSession(d) {
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, user: { id: d.user.id, email: d.user.email } };
}
async function authFetch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Erreur de connexion');
  return data;
}
async function validSession() {
  if (!session) return null;
  if (Date.now() < session.expires_at - 60_000) return session;
  try {
    const d = await authFetch('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    await setStored(packSession(d));
    return session;
  } catch {
    await setStored(null);
    return null;
  }
}
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const s = await validSession();
  if (!s) { show('login'); throw new Error('Session expirée, reconnecte-toi.'); }
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Erreur ${res.status}`);
  return data;
}

// ------------------------------------------------------------ utilitaires
function guessCategory(title = '') {
  const t = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/curd|confit|coulis|compot|insert|gelee|marmelade|caramel/.test(t)) return 'insert';
  if (/glacage|nappage|miroir|icing|frosting|fondant/.test(t)) return 'glacage';
  if (/genoise|biscuit|joconde|dacquoise|sponge|financier|cake|brownie|madeleine|savoie|gateau/.test(t)) return 'biscuit';
  if (/creme|chantilly|ganache|mousse|mousseline|patissiere|diplomate|bavarois|cremeux|namelaka|mascarpone/.test(t)) return 'creme';
  if (/pate|tarte|brisee|sablee|sucree|feuillet|choux|croquant|crumble|streusel|sable/.test(t)) return 'pate';
  if (/macaron|meringue|praline|decor|tuile/.test(t)) return 'decor';
  return 'autre';
}
function describeMold(m) {
  if (!m) return '';
  if (m.shape === 'round') return `moule rond Ø ${m.diameter} cm`;
  if (m.shape === 'square') return `moule carré ${m.side} × ${m.side} cm`;
  if (m.shape === 'rect') return `moule ${m.length} × ${m.width} cm`;
  return '';
}

// ------------------------------------------------------------ lecture de la page
async function readPage() {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const fallback = { url: tab?.url || '', title: tab?.title || '', site: '', image: null, ingredients: [], steps: [], servings: null, mold: null, selection: [], otherRecipes: [], source: '' };
  try { fallback.site = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  if (!/^https?:/.test(tab?.url || '')) return { ...fallback, unreadable: true };
  try {
    const results = await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['recipe-core.js', 'extract.js'] });
    return results?.[results.length - 1]?.result || { ...fallback, unreadable: true };
  } catch (e) {
    console.warn(e);
    return { ...fallback, unreadable: true };
  }
}

function sources() {
  const list = [];
  if (page.ingredients.length) list.push({ id: 'main', label: `${page.title || 'Recette principale'} (${page.ingredients.length} ingr.)`, ingredients: page.ingredients, title: page.title, servings: page.servings, steps: page.steps });
  (page.otherRecipes || []).forEach((r, i) => list.push({ id: `o${i}`, label: `${r.title || 'Autre préparation'} (${r.ingredients.length} ingr.)`, ingredients: r.ingredients, title: r.title, servings: r.servings, steps: r.steps }));
  if (page.selection.length >= 2) list.unshift({ id: 'sel', label: `Mon texte sélectionné (${page.selection.length} lignes)`, ingredients: page.selection, title: page.title, servings: page.servings, steps: [] });
  return list;
}

function applySource(src) {
  const f = $('#save-form');
  const ings = src?.ingredients || [];
  if (src && src.id !== 'sel' && src.title) { f.title.value = src.title; f.category.value = guessCategory(src.title); }
  if (src?.servings) f.servings.value = src.servings;
  $('#ing-summary').textContent = ings.length ? `${ings.length} ingrédient${ings.length > 1 ? 's' : ''} détecté${ings.length > 1 ? 's' : ''}` : 'Aucun ingrédient détecté';
  $('#ing-list').replaceChildren(...ings.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  $('#status').textContent = ings.length ? 'Recette reconnue ✓' : 'Ingrédients à compléter dans l\'app';
  $('#status').className = `status ${ings.length ? 'ok' : ''}`;
}

async function showRecipe() {
  show('loading');
  page = await readPage();
  show('recipe');
  const f = $('#save-form');
  f.title.value = page.title || '';
  f.category.value = guessCategory(page.title);
  f.servings.value = page.servings || '';
  $('#site').textContent = page.site || 'Page';
  const img = $('#thumb img');
  if (page.image) { img.src = page.image; img.referrerPolicy = 'no-referrer'; img.onerror = () => { img.src = 'img/strawberry.svg'; }; }
  $('#mold-info').textContent = page.mold ? `Moule détecté : ${describeMold(page.mold)}` : 'Moule non détecté (tu pourras le préciser dans l\'app).';

  const list = sources();
  const sel = $('#source');
  sel.replaceChildren(...list.map((s) => new Option(s.label, s.id)));
  $('#source-wrap').hidden = list.length < 2;
  applySource(list[0]);

  if (page.unreadable) $('#tip').textContent = 'Cette page ne peut pas être lue : seul le lien sera enregistré.';
  else if (!list.length) $('#tip').textContent = 'Astuce : sélectionne la liste des ingrédients sur la page avant de cliquer sur l\'extension.';
  else if (page.selection.length < 2) $('#tip').textContent = 'Astuce : plusieurs préparations sur la page ? Sélectionne les ingrédients de celle qui t\'intéresse puis rouvre l\'extension.';
  else $('#tip').textContent = '';

  // Doublon ?
  try {
    const dup = await rest(`recipes?select=id,title&url=eq.${encodeURIComponent(page.url)}`);
    if (dup?.length) {
      $('#dup').hidden = false;
      $('#dup').textContent = `Déjà dans ton carnet : « ${dup.map((d) => d.title).join(' », « ')} ». Tu peux enregistrer une autre préparation de cette page.`;
    }
  } catch { /* ignore */ }
}

$('#source').addEventListener('change', (e) => applySource(sources().find((s) => s.id === e.target.value)));

$('#save-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const src = sources().find((s) => s.id === f.source.value) || sources()[0];
  const btn = $('#save-btn');
  btn.disabled = true;
  $('#save-msg').textContent = 'Enregistrement…';
  $('#save-msg').className = 'msg';
  try {
    const servings = Number(f.servings.value) || null;
    const row = {
      user_id: session.user.id,
      url: page.url,
      title: f.title.value.trim() || page.title || 'Recette',
      site: page.site,
      image: page.image,
      category: f.category.value,
      ingredients: (src?.ingredients || []).map((raw) => ({ raw })),
      steps: src?.steps || [],
      base_servings: servings,
      base_mold: page.mold,
    };
    await rest('recipes', { method: 'POST', body: row, prefer: 'return=representation' });
    $('#done-text').textContent = row.title;
    show('done');
  } catch (err) {
    $('#save-msg').textContent = err.message;
    $('#save-msg').className = 'msg error';
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------ connexion
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#login-msg').textContent = 'Connexion…';
  $('#login-msg').className = 'msg';
  try {
    const d = await authFetch('token?grant_type=password', { email: fd.get('email').trim(), password: fd.get('password') });
    await setStored(packSession(d));
    showRecipe();
  } catch (err) {
    const m = /invalid login/i.test(err.message) ? 'E-mail ou mot de passe incorrect.' : /not confirmed/i.test(err.message) ? 'Confirme d\'abord ton e-mail.' : err.message;
    $('#login-msg').textContent = m;
    $('#login-msg').className = 'msg error';
  }
});
$('#logout').addEventListener('click', async () => { await setStored(null); show('login'); });
const openApp = () => { api.tabs.create({ url: APP_URL }); window.close(); };
$('#open-app').addEventListener('click', openApp);
$('#open-app-signup').addEventListener('click', (e) => { e.preventDefault(); openApp(); });
$('#again').addEventListener('click', showRecipe);

// ------------------------------------------------------------ démarrage
(async () => {
  session = await getStored();
  $('#logout').hidden = !session;
  if (await validSession()) showRecipe(); else show('login');
})();
