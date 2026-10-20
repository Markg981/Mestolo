import { describe, expect, it } from 'vitest';
import { detectRecipeLanguage } from '@/lib/recipes/detect-language';
import { parseRecipeText } from '@/lib/recipes/text-parser';

const EN = `Pancakes
Ingredients
2 cups flour
2 eggs
1 tbsp butter
a pinch of salt
Directions
Stir the eggs with the flour and add the butter. Bake 10 minutes.`;
const FR = `Crêpes
Ingrédients
250 g de farine
3 œufs
1 pincée de sel
Préparation
Mélanger la farine avec les œufs et ajouter le beurre. Cuisson 10 minutes.`;
const DE = `Pfannkuchen
Zutaten
250 g Mehl
3 Eier
1 Prise Salz
Zubereitung
Das Mehl mit den Eiern und der Butter rühren. 10 Minuten backen.`;
const IT = `Crespelle
Ingredienti
250 g di farina
3 uova
Sale q.b.
Preparazione
Mescolare la farina con le uova e aggiungere il burro. 10 minuti.`;

describe('detectRecipeLanguage', () => {
  it('riconosce inglese, francese e tedesco', () => {
    expect(detectRecipeLanguage(EN, 'it')).toBe('en');
    expect(detectRecipeLanguage(FR, 'it')).toBe('fr');
    expect(detectRecipeLanguage(DE, 'it')).toBe('de');
  });
  it("riconosce l'italiano anche con default diverso", () => {
    expect(detectRecipeLanguage(IT, 'en')).toBe('it');
  });
  it("usa il default se non c'è evidenza", () => {
    expect(detectRecipeLanguage('12345 xyz qwerty', 'es')).toBe('es');
  });
  it('il parser estrae comunque gli ingredienti dei testi non italiani', () => {
    expect(parseRecipeText(EN).ingredients.length).toBeGreaterThan(0);
    expect(parseRecipeText(DE).ingredients.length).toBeGreaterThan(0);
  });
});
