// Fonction Supabase « import-recipe » : récupère une page de recette et en extrait
// le titre, l'image, les ingrédients, le nombre de personnes et le moule.
// Utilisée par la PWA quand on colle un lien ou qu'on partage une page depuis le téléphone.
import './recipe-core.js';

// deno-lint-ignore no-explicit-any
const Core = (globalThis as any).CakeCore;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

const MAX_BYTES = 3_000_000;

function isForbiddenHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return true; // adresses IPv6 littérales refusées
  return false;
}

function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Seuls les liens http(s) sont acceptés');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('Port non autorisé');
  if (isForbiddenHost(u.hostname)) throw new Error('Adresse non autorisée');
  return u;
}

async function fetchPage(start: URL): Promise<{ html: string; url: string }> {
  let url = start;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CakeAssistant/1.0; +https://github.com/Carottejy/CakeAssistant)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = checkUrl(new URL(res.headers.get('location')!, url).href);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) throw new Error(`Le site a répondu ${res.status}`);
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size > MAX_BYTES ? MAX_BYTES : size);
    let off = 0;
    for (const c of chunks) { if (off + c.length > buf.length) break; buf.set(c, off); off += c.length; }
    const ctype = res.headers.get('content-type') || '';
    const charset = /charset=([\w-]+)/i.exec(ctype)?.[1] || 'utf-8';
    let html: string;
    try { html = new TextDecoder(charset).decode(buf.subarray(0, off)); } catch { html = new TextDecoder().decode(buf.subarray(0, off)); }
    return { html, url: url.href };
  }
  throw new Error('Trop de redirections');
}

async function userFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL');
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const res = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey } });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const userId = await userFromRequest(req);
    if (!userId) return json({ error: 'Connexion requise' }, 401);
    const { url } = await req.json();
    const target = checkUrl(String(url || ''));
    const page = await fetchPage(target);
    const data = Core.fromHtml(page.html, page.url);
    return json({ ...data, url: page.url });
  } catch (err) {
    return json({ error: (err as Error).message || 'Erreur' }, 400);
  }
});
