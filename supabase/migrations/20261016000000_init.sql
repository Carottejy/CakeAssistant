-- Schéma Cake Assistant (déjà appliqué sur le projet Supabase « CakeAssistant »).

-- Recettes enregistrées (une fiche par préparation ; une page peut en contenir plusieurs)
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  title text not null default 'Recette sans titre',
  site text,
  image text,
  category text,
  ingredients jsonb not null default '[]'::jsonb,   -- [{raw, qty, unit, name}]
  steps jsonb not null default '[]'::jsonb,         -- ["étape 1", …]
  base_servings numeric,
  base_mold jsonb,                                   -- {shape:'round'|'square'|'rect', diameter, side, length, width, height}
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_user_idx on public.recipes(user_id, created_at desc);
create index recipes_user_url_idx on public.recipes(user_id, url);

-- Projets de gâteaux (assemblage de plusieurs préparations)
create table public.bakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Mon gâteau',
  recipe_ids uuid[] not null default '{}',
  target jsonb not null default '{}'::jsonb,          -- {mode, servings, mold, overrides}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bakes_user_idx on public.bakes(user_id, created_at desc);

alter table public.recipes enable row level security;
alter table public.bakes enable row level security;

create policy "recipes_select_own" on public.recipes for select to authenticated using ((select auth.uid()) = user_id);
create policy "recipes_insert_own" on public.recipes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "recipes_update_own" on public.recipes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "recipes_delete_own" on public.recipes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "bakes_select_own" on public.bakes for select to authenticated using ((select auth.uid()) = user_id);
create policy "bakes_insert_own" on public.bakes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bakes_update_own" on public.bakes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "bakes_delete_own" on public.bakes for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger recipes_touch before update on public.recipes for each row execute function public.touch_updated_at();
create trigger bakes_touch before update on public.bakes for each row execute function public.touch_updated_at();
