import { describe, expect, it } from 'vitest';
import { emptyNutrition, nutritionJsonLd, parseAiNutrition, parseSchemaOrgNutrition, scaleNutrition, validateNutrition } from '@/lib/nutrition';

describe('parseSchemaOrgNutrition', () => {
  it('reads typical values with units', () => {
    const v = parseSchemaOrgNutrition({
      '@type': 'NutritionInformation',
      calories: '320 kcal',
      proteinContent: '12,5 g',
      carbohydrateContent: '40 g',
      sugarContent: '8 g',
      fatContent: '10 g',
      saturatedFatContent: '3 g',
      fiberContent: '4 g',
      sodiumContent: '400 mg',
    });
    expect(v).toEqual({ energy_kcal: 320, protein_g: 12.5, carbs_g: 40, sugars_g: 8, fat_g: 10, saturated_fat_g: 3, fiber_g: 4, salt_g: 1 });
  });
  it('converts kJ and drops inconsistent or invalid parts', () => {
    const v = parseSchemaOrgNutrition({ calories: '1000 kJ', carbohydrateContent: '5 g', sugarContent: '9 g', proteinContent: 'n/d', fatContent: '-3 g' });
    expect(v?.energy_kcal).toBe(239);
    expect(v?.sugars_g).toBeNull();
    expect(v?.protein_g).toBeNull();
    expect(v?.fat_g).toBeNull();
  });
  it('returns null when nothing is usable', () => {
    expect(parseSchemaOrgNutrition(undefined)).toBeNull();
    expect(parseSchemaOrgNutrition('x')).toBeNull();
    expect(parseSchemaOrgNutrition({ servingSize: '1 piece' })).toBeNull();
  });
});

describe('validate and scale', () => {
  it('accepts partial values and rounds', () => {
    const r = validateNutrition({ ...emptyNutrition(), energy_kcal: 250.26, protein_g: '' });
    expect(r.ok && r.values.energy_kcal).toBe(250.3);
  });
  it('rejects empty, negative, huge and inconsistent sets', () => {
    expect(validateNutrition(emptyNutrition()).ok).toBe(false);
    expect(validateNutrition({ ...emptyNutrition(), fat_g: -1 }).ok).toBe(false);
    expect(validateNutrition({ ...emptyNutrition(), energy_kcal: 99999 }).ok).toBe(false);
    expect(validateNutrition({ ...emptyNutrition(), carbs_g: 5, sugars_g: 6 })).toEqual({ ok: false, field: 'sugars_g' });
  });
  it('scales per portions and keeps nulls', () => {
    const s = scaleNutrition({ ...emptyNutrition(), energy_kcal: 200, salt_g: 0.55 }, 3);
    expect(s.energy_kcal).toBe(600);
    expect(s.salt_g).toBe(1.65);
    expect(s.protein_g).toBeNull();
    expect(scaleNutrition({ ...emptyNutrition(), energy_kcal: 200 }, 0).energy_kcal).toBe(200);
  });
});

describe('json-ld and AI output', () => {
  it('omits JSON-LD when empty and builds NutritionInformation otherwise', () => {
    expect(nutritionJsonLd(null)).toBeUndefined();
    expect(nutritionJsonLd(emptyNutrition())).toBeUndefined();
    expect(nutritionJsonLd({ energy_kcal: 300, salt_g: 1 })).toMatchObject({ '@type': 'NutritionInformation', calories: '300 kcal', sodiumContent: '400 mg' });
  });
  it('sanitizes AI output', () => {
    expect(parseAiNutrition('x')).toBeNull();
    const v = parseAiNutrition({ energy_kcal: 410.44, protein_g: '5', fat_g: 10, saturated_fat_g: 12, carbs_g: 1e6 });
    expect(v?.energy_kcal).toBe(410.4);
    expect(v?.protein_g).toBeNull();
    expect(v?.saturated_fat_g).toBeNull();
    expect(v?.carbs_g).toBeNull();
  });
});
