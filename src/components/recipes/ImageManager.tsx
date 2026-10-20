import type { ImageRow } from '@/lib/data/recipes';
import { ImageManagerClient } from './RecipeIslands';

export function ImageManager(props: { recipeId: string; title: string; images: ImageRow[] }) {
  return <ImageManagerClient {...props} />;
}
