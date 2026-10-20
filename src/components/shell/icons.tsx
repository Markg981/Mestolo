import { BookOpen, CalendarDays, Camera, Compass, FolderHeart, Home, Link2, Menu, Plus, Settings, ShieldCheck, ShoppingBasket, Users, Type } from 'lucide-react';

const MAP = {
  home: Home,
  book: BookOpen,
  compass: Compass,
  folder: FolderHeart,
  cart: ShoppingBasket,
  calendar: CalendarDays,
  users: Users,
  settings: Settings,
  plus: Plus,
  camera: Camera,
  link: Link2,
  menu: Menu,
  text: Type,
  shield: ShieldCheck,
} as const;

export type IconName = keyof typeof MAP;

export function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const I = MAP[name];
  return <I aria-hidden className={className ?? 'size-5'} />;
}
