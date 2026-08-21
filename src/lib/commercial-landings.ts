import type { PackType, PromoPack } from "@/lib/cms";

export type CommercialLandingSlug =
  | "carcasas-personalizadas"
  | "poleras-personalizadas"
  | "polerones-personalizados"
  | "packs-personalizados";

export type CommercialFaq = { question: string; answer: string };

export type CommercialLandingConfig = {
  slug: CommercialLandingSlug;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  introduction: string;
  productsHeading: string;
  productsIntroduction: string;
  ctaLabel: string;
  ctaPack?: PackType;
  faqs: CommercialFaq[];
};

export const COMMERCIAL_LANDINGS: Record<CommercialLandingSlug, CommercialLandingConfig> = {
  "carcasas-personalizadas": {
    slug: "carcasas-personalizadas",
    title: "Carcasas personalizadas en Chile | VISUALSKIN",
    description: "Crea una carcasa personalizada para tu celular con tu foto o diseño. Elige tu modelo y comienza a personalizar en VISUALSKIN Chile.",
    eyebrow: "Diseña en línea",
    heading: "Carcasas personalizadas",
    introduction: "Convierte una foto, ilustración o diseño propio en una carcasa personalizada. En VISUALSKIN eliges la marca y el modelo de tu celular, subes tu imagen y la ajustas directamente en el personalizador.",
    productsHeading: "Carcasas y packs que puedes personalizar",
    productsIntroduction: "La carcasa forma parte de las opciones activas que ves a continuación. Los nombres, imágenes y precios se cargan directamente desde el catálogo vigente.",
    ctaLabel: "Personalizar mi carcasa",
    ctaPack: "carcasa",
    faqs: [
      { question: "¿Cómo puedo personalizar mi carcasa?", answer: "Comienza en el personalizador, elige la marca y el modelo de tu celular, sube tu imagen y ajústala dentro del área de diseño." },
      { question: "¿Puedo usar una foto o un diseño propio?", answer: "Sí. El personalizador permite subir una imagen propia y ajustar su posición, escala y rotación antes de agregar el producto al carrito." },
      { question: "¿Cómo elijo el modelo de celular?", answer: "Dentro del personalizador primero seleccionas la marca y luego uno de los modelos disponibles en el catálogo activo." },
    ],
  },
  "poleras-personalizadas": {
    slug: "poleras-personalizadas",
    title: "Poleras personalizadas en Chile | VISUALSKIN",
    description: "Diseña una polera personalizada dentro de los packs disponibles de VISUALSKIN. Elige un pack real y personaliza sus productos en línea.",
    eyebrow: "Polera incluida en packs",
    heading: "Poleras personalizadas",
    introduction: "En VISUALSKIN la polera personalizada se ofrece dentro de packs que también incluyen una carcasa. Elige un pack activo y crea el diseño de cada producto desde el flujo real de personalización.",
    productsHeading: "Packs que incluyen polera",
    productsIntroduction: "Aquí aparecen únicamente packs activos del catálogo que contienen polera; no mostramos una polera individual que la tienda no comercialice.",
    ctaLabel: "Personalizar mi pack",
    ctaPack: "carcasa+polera",
    faqs: [
      { question: "¿Puedo comprar una polera personalizada por separado?", answer: "Actualmente la polera personalizada se presenta dentro de los packs activos que incluyen carcasa y polera." },
      { question: "¿Puedo usar diseños distintos en la carcasa y la polera?", answer: "Sí. El flujo permite cargar y ajustar el diseño de la carcasa y el diseño de la prenda por separado." },
      { question: "¿Cómo comienzo a diseñar mi polera?", answer: "Selecciona uno de los packs con polera y entra al personalizador. Allí podrás elegir las opciones disponibles y cargar el diseño de la prenda." },
    ],
  },
  "polerones-personalizados": {
    slug: "polerones-personalizados",
    title: "Polerones personalizados en Chile | VISUALSKIN",
    description: "Personaliza un polerón dentro de los packs disponibles de VISUALSKIN Chile. Elige un pack activo y crea tus diseños en línea.",
    eyebrow: "Polerón incluido en packs",
    heading: "Polerones personalizados",
    introduction: "Los polerones personalizados de VISUALSKIN forman parte de packs reales junto a una carcasa. Puedes elegir una alternativa activa y preparar los diseños de sus productos en el personalizador.",
    productsHeading: "Packs que incluyen polerón",
    productsIntroduction: "La selección se obtiene del catálogo activo y muestra solo packs que contienen polerón, sin presentar un producto individual inexistente.",
    ctaLabel: "Personalizar mi pack",
    ctaPack: "carcasa+poleron",
    faqs: [
      { question: "¿El polerón personalizado se vende individualmente?", answer: "Actualmente el polerón personalizado se muestra dentro de los packs activos que incluyen carcasa y polerón." },
      { question: "¿La carcasa y el polerón pueden llevar diseños diferentes?", answer: "Sí. En el personalizador cada diseño se carga y ajusta en su producto correspondiente." },
      { question: "¿Dónde elijo mi pack con polerón?", answer: "Puedes elegirlo en esta página, revisar todas las alternativas en el catálogo o comenzar desde Crear mi pack." },
    ],
  },
  "packs-personalizados": {
    slug: "packs-personalizados",
    title: "Packs personalizados en Chile | VISUALSKIN",
    description: "Explora los packs personalizados activos de VISUALSKIN y elige una combinación para diseñar sus productos en línea.",
    eyebrow: "Elige tu combinación",
    heading: "Packs personalizados",
    introduction: "Elige entre las combinaciones activas de VISUALSKIN y después personaliza los productos incluidos. El catálogo define en tiempo real qué packs están disponibles, sus nombres, imágenes y precios.",
    productsHeading: "Packs disponibles",
    productsIntroduction: "Cada opción corresponde a un pack activo del catálogo. Al seleccionarlo continuarás en el personalizador con esa configuración.",
    ctaLabel: "Crear mi pack",
    faqs: [
      { question: "¿Cómo elijo un pack personalizado?", answer: "Revisa los packs activos y elige la combinación de productos que quieres diseñar. También puedes compararlos desde Crear mi pack o el catálogo." },
      { question: "¿Qué puedo personalizar dentro de un pack?", answer: "El contenido depende del pack elegido. El personalizador muestra la carcasa y las prendas incluidas para que cargues los diseños correspondientes." },
      { question: "¿El precio mostrado es el precio actual?", answer: "Los precios de esta página se obtienen del mismo catálogo activo que utiliza la tienda. Si existe un precio vigente distinto del precio base, ambos se muestran." },
    ],
  },
};

export function packsForLanding(slug: CommercialLandingSlug, packs: readonly PromoPack[]): PromoPack[] {
  return packs.filter((pack) => {
    if (!pack.is_active) return false;
    if (slug === "poleras-personalizadas") {
      return pack.pack_type === "carcasa+polera" || pack.pack_type === "carcasa+polera+poleron";
    }
    if (slug === "polerones-personalizados") {
      return pack.pack_type === "carcasa+poleron" || pack.pack_type === "carcasa+polera+poleron";
    }
    return true;
  });
}
