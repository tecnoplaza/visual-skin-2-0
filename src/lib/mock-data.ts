export type PhoneBrand = { id: string; name: string; models: PhoneModel[] };
export type PhoneModel = { id: string; name: string };

export const brands: PhoneBrand[] = [
  {
    id: "apple",
    name: "Apple",
    models: [
      { id: "iphone-15-pro-max", name: "iPhone 15 Pro Max" },
      { id: "iphone-15-pro", name: "iPhone 15 Pro" },
      { id: "iphone-15", name: "iPhone 15" },
      { id: "iphone-14-pro", name: "iPhone 14 Pro" },
      { id: "iphone-14", name: "iPhone 14" },
      { id: "iphone-13", name: "iPhone 13" },
      { id: "iphone-12", name: "iPhone 12" },
      { id: "iphone-11", name: "iPhone 11" },
    ],
  },
  {
    id: "samsung",
    name: "Samsung",
    models: [
      { id: "s24-ultra", name: "Galaxy S24 Ultra" },
      { id: "s24", name: "Galaxy S24" },
      { id: "s23-ultra", name: "Galaxy S23 Ultra" },
      { id: "s23", name: "Galaxy S23" },
      { id: "a54", name: "Galaxy A54" },
      { id: "a34", name: "Galaxy A34" },
    ],
  },
  {
    id: "xiaomi",
    name: "Xiaomi",
    models: [
      { id: "14-pro", name: "Xiaomi 14 Pro" },
      { id: "13t", name: "Xiaomi 13T" },
      { id: "redmi-note-13", name: "Redmi Note 13" },
      { id: "redmi-note-12", name: "Redmi Note 12" },
    ],
  },
  {
    id: "motorola",
    name: "Motorola",
    models: [
      { id: "edge-40", name: "Edge 40" },
      { id: "g84", name: "Moto G84" },
    ],
  },
];

export type Pack = {
  id: string;
  name: string;
  type: "carcasa+polera" | "carcasa+poleron" | "carcasa+polera+poleron";
  price: number;
  tag: string;
  gradient: string;
  description: string;
};

export const packs: Pack[] = [
  { id: "urban-blue", name: "Urban Blue", type: "carcasa+polera", price: 29990, tag: "Bestseller", gradient: "from-blue-500 to-cyan-400", description: "Pack juvenil de calle con carcasa premium + polera oversize." },
  { id: "neon-drop", name: "Neon Drop", type: "carcasa+poleron", price: 39990, tag: "Nuevo", gradient: "from-green-400 to-emerald-500", description: "Polerón con capucha y carcasa neón, para los que destacan." },
  { id: "midnight", name: "Midnight", type: "carcasa+polera", price: 27990, tag: "", gradient: "from-slate-700 to-slate-900", description: "Estética minimalista total black para el día a día." },
  { id: "street-fade", name: "Street Fade", type: "carcasa+poleron", price: 42990, tag: "Limited", gradient: "from-fuchsia-500 to-indigo-600", description: "Degradado urbano exclusivo en edición limitada." },
  { id: "chrome", name: "Chrome", type: "carcasa+polera", price: 31990, tag: "", gradient: "from-zinc-400 to-zinc-700", description: "Acabado cromado premium con polera de algodón peinado." },
  { id: "acid", name: "Acid", type: "carcasa+poleron", price: 40990, tag: "Hot", gradient: "from-lime-400 to-green-600", description: "Verde neón que grita ciudad. Polerón polar interior." },
];

export const PACK_PRICES = {
  "carcasa": 8990,
  "carcasa+polera": 21990,
  "carcasa+poleron": 29990,
  "carcasa+polera+poleron": 44990,

} as const;

