export const PRIMARY_NAV = [
  { href: '/', key: 'home', icon: 'home' },
  { href: '/recipes', key: 'recipes', icon: 'book' },
  { href: '/discover', key: 'discover', icon: 'compass' },
] as const;

export const SECONDARY_NAV = [
  { href: '/collections', key: 'collections', icon: 'folder' },
  { href: '/shopping', key: 'shopping', icon: 'cart' },
  { href: '/pantry', key: 'pantry', icon: 'pantry' },
  { href: '/plan', key: 'plan', icon: 'calendar' },
  { href: '/friends', key: 'friends', icon: 'users' },
  { href: '/settings', key: 'settings', icon: 'settings' },
] as const;

export const QUICK_ACTIONS = [
  { href: '/recipes/new', key: 'addRecipe', icon: 'plus' },
  { href: '/import/photo', key: 'importPhoto', icon: 'camera' },
  { href: '/import/link', key: 'importLink', icon: 'link' },
] as const;
