export const PRESETS = [
  {
    name: "Mountains",
    url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
  },
  {
    name: "Ocean",
    url: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800&q=80",
  },
  {
    name: "Forest",
    url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80",
  },
  {
    name: "Sunset",
    url: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=800&q=80",
  },
  {
    name: "Aurora",
    url: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800&q=80",
  },
  {
    name: "Desert",
    url: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80",
  },
] as const;

export const PACKAGE_MANAGERS = [
  { id: "npm", label: "npm", cmd: "npm install" },
  { id: "yarn", label: "yarn", cmd: "yarn add" },
  { id: "pnpm", label: "pnpm", cmd: "pnpm add" },
  { id: "bun", label: "bun", cmd: "bun add" },
] as const;

export type Preset = (typeof PRESETS)[number];
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
