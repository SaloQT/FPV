import type { AppSettings } from '../../ui/settingsSchema';
import { sanitizeParkRecipe } from './recipe';
import type { ParkRecipe } from './types';
export type ParkSettings = Partial<Pick<AppSettings, 'worldKind' | 'parkSize' | 'parkTheme' | 'parkLayout' | 'parkGuests' | 'parkRoute' | 'parkCoaster'>>;
export function parkRecipeFromSettings(s: ParkSettings & { seed: number }, seed = s.seed): ParkRecipe {
  return sanitizeParkRecipe({ version: 1, seed, size: s.parkSize, theme: s.parkTheme, layout: s.parkLayout, guests: s.parkGuests, route: s.parkRoute, coaster: s.parkCoaster });
}
export function parkSettings(recipe: ParkRecipe): Partial<AppSettings> {
  return { worldKind: 'theme-park', seed: recipe.seed, parkSize: recipe.size, parkTheme: recipe.theme, parkLayout: recipe.layout, parkGuests: recipe.guests, parkRoute: recipe.route, parkCoaster: recipe.coaster };
}
