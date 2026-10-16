<p align="center"><img src="app/img/logo.svg" width="120" alt=""></p>

# Cake Assistant 🧁

Assistant de pâtisserie : enregistre des recettes depuis n'importe quel site, assemble-les en un gâteau
(génoise + crème + curd…) et obtiens les quantités de chaque ingrédient pour **ton nombre de personnes**
ou **ta taille de moule**.

- **Application (PWA)** : `app/` — https://carottejy.github.io/CakeAssistant/
- **Extension Chrome / Firefox** : `extension/`
- **Base de données & connexion** : Supabase (projet « CakeAssistant »)

## Fonctionnement

1. **Enregistrer** une recette
   - avec l'extension : sur la page d'une recette, clique sur l'icône Cake Assistant (ou `Alt+Maj+K`) ;
   - dans l'application : colle le lien dans « Mes recettes » ;
   - sur Android, une fois l'app installée : *Partager → Cake Assistant* depuis le navigateur.

   Les ingrédients, le nombre de personnes et le moule sont détectés automatiquement (données
   schema.org, microdonnées, ou liste sous un titre « Ingrédients »). Si une page contient plusieurs
   préparations, l'extension permet de choisir laquelle, ou de **sélectionner** à la souris la liste voulue.

2. **Vérifier la fiche** : dans l'app, chaque recette peut être corrigée (une ligne par ingrédient,
   nombre de personnes et moule de la recette d'origine).

3. **Composer un gâteau** (« Mon gâteau ») : ajoute les préparations, choisis *Nombre de personnes*
   ou *Taille du moule* (rond, carré, rectangle, hauteur facultative). Chaque préparation reçoit son
   coefficient ; une liste totale des ingrédients est calculée (copiable, imprimable).

### Calcul des quantités

| Recette d'origine | Cible | Coefficient |
|---|---|---|
| moule | moule | surface cible ÷ surface d'origine (× rapport des hauteurs si connues) |
| personnes | personnes | personnes cible ÷ personnes d'origine |
| personnes ↔ moule | | estimé avec la règle « cercle de 20 cm ≈ 8 parts » (≈ 39 cm² par part) |

Les œufs non entiers sont indiqués en grammes (≈ 50 g l'œuf, 18 g le jaune, 30 g le blanc),
la gélatine en grammes (≈ 2 g la feuille). Un coefficient manuel peut remplacer le calcul.

## Installer l'extension

**Chrome / Edge / Brave** : `chrome://extensions` → activer le *Mode développeur* →
*Charger l'extension non empaquetée* → choisir le dossier `extension/`.

**Firefox** : `about:debugging#/runtime/this-firefox` → *Charger un module complémentaire temporaire* →
choisir `extension/manifest.json` (temporaire jusqu'au redémarrage). Pour une installation permanente,
il faut faire signer l'extension (gratuitement) sur https://addons.mozilla.org/developers/ en
distribution « non listée », puis installer le fichier `.xpi` obtenu.

## Mise en ligne (GitHub Pages)

Le workflow `.github/workflows/pages.yml` teste puis publie le dossier `app/` à chaque push sur `main`.
Une seule fois : *Settings → Pages → Source : GitHub Actions* (le dépôt doit être public sur un compte gratuit).

### Réglage Supabase à faire une fois

Dans le tableau de bord Supabase du projet : *Authentication → URL Configuration*
- **Site URL** : `https://carottejy.github.io/CakeAssistant/`
- **Redirect URLs** : ajouter `https://carottejy.github.io/CakeAssistant/**`

(sans cela, les liens de confirmation d'e-mail et de mot de passe oublié pointent vers `localhost`).

## Développement

```bash
npm test                     # tests de l'analyse des ingrédients, du calcul et de l'extraction
npm run sync                 # recopie shared/recipe-core.js vers l'extension et la fonction serveur
python3 -m http.server -d app 8080   # app servie sur http://localhost:8080
```

Structure :

```
app/                  PWA (HTML/CSS/JS sans build)
  js/ingredients.js   analyse « 250 g de farine », conversions, liste de courses
  js/scale.js         coefficients moule / personnes
extension/            extension Manifest V3 (Chrome + Firefox)
shared/recipe-core.js extraction des recettes (source commune)
supabase/             schéma SQL + fonction « import-recipe »
tests/                tests node
```

La clé Supabase présente dans `config.js` est la clé publique (« publishable ») : les données de chaque
utilisateur sont protégées par les règles RLS de la base.
