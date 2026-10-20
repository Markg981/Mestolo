# Formati di esportazione

## 1. `mestolo.recipe/v1` (JSON, senza perdita di informazioni)

Endpoint: `GET /api/recipes/{id}/export` (richiede login e permesso di vedere la ricetta).

```json
{
  "format": "mestolo.recipe/v1",
  "exported_at": "2026-10-20T10:00:00.000Z",
  "recipe": {
    "id": "uuid",
    "title": "Parmigiana di melanzane",
    "description": "…",
    "original_language": "it",
    "servings": 6,
    "prep_minutes": 40,
    "cook_minutes": 45,
    "total_minutes": null,
    "ingredients": [
      { "name": "melanzane", "quantity": 1.5, "quantityMax": null, "unit": "kg", "note": null, "section": null },
      { "name": "sale", "quantity": null, "unit": null, "toTaste": true },
      { "name": "fiordilatte", "quantity": null, "unit": "g", "flags": ["missing"] }
    ],
    "steps": [{ "text": "Taglia le melanzane…", "section": null }],
    "category": { "slug": "main-courses", "name": null },
    "tags": ["estate"],
    "visibility": "private",
    "verification_status": "needs_review",
    "field_flags": { "total_minutes": ["missing"] },
    "diet_hints_unverified": [],
    "source": { "type": "url", "url": "https://…", "name": "Sito", "attribution": "Autore", "original_author_name": null },
    "version": 3,
    "created_at": "…",
    "updated_at": "…",
    "images": [{ "kind": "upload", "alt_text": "…", "attribution": null, "source_url": null }],
    "personal_note": "solo se è la tua nota"
  }
}
```

Regole:
- `quantity: null` significa **non indicato** (mai inventato). `toTaste: true` = "q.b.".
- `unit` è una chiave canonica (`g`, `kg`, `mg`, `ml`, `cl`, `dl`, `l`, `tsp`, `tbsp`, `cup`, `fl_oz`, `oz`, `lb`, `pinch`, `clove`, `slice`, `can`, `pack`, `bunch`, `sprig`, `leaf`, `drop`, `glass`, `handful`, `piece`) oppure il testo originale se non riconosciuta. Le unità non vengono mai convertite.
- `flags` / `field_flags`: `missing`, `low_confidence`, `ambiguous`, `ai_estimate`.
- `category.slug` delle categorie di sistema: `starters`, `first-courses`, `main-courses`, `sides`, `desserts`, `bread-baking`, `drinks`, `breakfast`, `snacks`, `sauces`, `uncategorized`.
- I file immagine non sono inclusi (solo i metadati).

## 2. Schema.org `Recipe` (JSON-LD)

Endpoint: `GET /api/recipes/{id}/export?format=schema`. Formato standard leggibile da molte app di ricette e motori di ricerca: `recipeIngredient` come testo, `recipeInstructions` come `HowToStep`, durate ISO 8601 (`PT1H30M`), `isBasedOn` = URL della fonte.

## 3. Esportazione dell'account

Endpoint: `GET /api/account/export` (*Impostazioni → Account e dati*). File `mestolo.account-export/v1` con profilo, ricette, versioni, metadati immagini, note, preferiti, categorie personali, raccolte, lista della spesa, piano pasti, amicizie, blocchi, segnalazioni, provider configurati (**mai i valori delle chiavi**) e uso AI.

## 4. Stampa / PDF

`/print/recipes/{id}` e `/print/shopping` sono pagine ottimizzate per la stampa: usa "Stampa" del browser e scegli "Salva come PDF".
