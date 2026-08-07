// CMS helpers: defaults + fetchers. Frontend reads from Supabase and falls back
// to these defaults when nothing is loaded. Managed from /admin → "Contenido web".
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------- Types ----------
export type HomeContent = {
  hero_title: string;
  hero_subtitle: string;
  hero_cta_primary: string;
  hero_cta_secondary: string;
  hero_image_url: string;
  benefits: { icon?: string; title: string; desc: string }[];
  sections: {
    hero: boolean;
    how_it_works: boolean;
    featured_packs: boolean;
    why_us: boolean;
    cta: boolean;
  };
};

export type ContactContent = {
  whatsapp: string;
  instagram: string;
  facebook: string;
  email: string;
  address: string;
  hours: string;
};

export type VisualContent = {
  logo_url: string;
  favicon_url: string;
  color_primary: string;
  color_button: string;
  legal_text: string;
};

export type PackType = "carcasa" | "carcasa+polera" | "carcasa+poleron" | "carcasa+polera+poleron";

export type PromoPack = {
  id: string;
  name: string;
  description: string;
  price: number;
  sale_price: number | null;
  image_url: string | null;
  gradient: string;
  tag: string;
  pack_type: PackType;
  includes: string[];
  features: string[];
  button_label: string;
  button_url: string;
  is_active: boolean;
  sort_order: number;
};


export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  image_url: string | null;
  price: number | null;
  commercial_text: string;
  is_active: boolean;
  sort_order: number;
};

export type Faq = {
  id: string;
  question: string;
  answer: string;
  is_active: boolean;
  sort_order: number;
};

export type Banner = {
  id: string;
  text: string;
  image_url: string | null;
  link_url: string | null;
  is_active: boolean;
  sort_order: number;
};

// ---------- Defaults ----------
export const DEFAULT_HOME: HomeContent = {
  hero_title: "Diseña tu pack.\nViste la calle.",
  hero_subtitle:
    "Carcasa de celular + polera o polerón, 100% personalizados. Sube tu diseño, elige tu modelo y listo.",
  hero_cta_primary: "Crear mi pack",
  hero_cta_secondary: "Ver catálogo",
  hero_image_url: "",
  benefits: [
    { title: "Impresión premium", desc: "Sublimación de alta resolución que no se despinta." },
    { title: "Compra segura", desc: "Checkout seguro + seguimiento en tiempo real." },
    { title: "+2.500 packs enviados", desc: "Comunidad urbana que confía en nosotros." },
  ],
  sections: { hero: true, how_it_works: true, featured_packs: true, why_us: true, cta: true },
};

export const DEFAULT_CONTACT: ContactContent = {
  whatsapp: "",
  instagram: "",
  facebook: "",
  email: "",
  address: "",
  hours: "",
};

// ---------- Contact validation & normalization ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw?: string | null): { value: string | null; error: string | null } {
  const v = (raw ?? "").trim();
  if (!v) return { value: null, error: null };
  if (v.length > 254 || !EMAIL_RE.test(v)) return { value: null, error: "Correo inválido" };
  return { value: v, error: null };
}

export function normalizeWhatsapp(raw?: string | null): { value: string | null; error: string | null } {
  const v = (raw ?? "").trim();
  if (!v) return { value: null, error: null };
  const digits = v.replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return { value: null, error: "Ingresa el número completo con código de país (solo dígitos, 8 a 15)" };
  }
  return { value: digits, error: null };
}

export function whatsappUrl(raw?: string | null): string | null {
  const { value } = normalizeWhatsapp(raw);
  return value ? `https://wa.me/${value}` : null;
}

function safeUserSlug(input: string): string | null {
  const slug = input.replace(/^@+/, "").replace(/\/+$/, "").trim();
  if (!slug) return null;
  if (!/^[a-zA-Z0-9._\-]+$/.test(slug)) return null;
  return slug;
}

function parseSocial(raw: string | null | undefined, host: RegExp): { value: string | null; error: string | null } {
  const v = (raw ?? "").trim();
  if (!v) return { value: null, error: null };
  if (/^javascript:/i.test(v)) return { value: null, error: "Enlace no permitido" };
  if (/^https?:\/\//i.test(v)) {
    let url: URL;
    try { url = new URL(v); } catch { return { value: null, error: "URL inválida" }; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { value: null, error: "URL inválida" };
    if (!host.test(url.hostname)) return { value: null, error: "El dominio no coincide con la red seleccionada" };
    const user = safeUserSlug(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
    if (!user) return { value: null, error: "Usuario no reconocido en la URL" };
    return { value: user, error: null };
  }
  const user = safeUserSlug(v);
  if (!user) return { value: null, error: "Usuario inválido" };
  return { value: user, error: null };
}

// ---------- Category slug normalization ----------
export function normalizeCategorySlug(raw?: string | null): string {
  const v = (raw ?? "").toString().trim().toLowerCase();
  if (!v) return "";
  const noAccents = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return noAccents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function validateCategorySlug(raw?: string | null): { value: string; error: string | null } {
  const v = normalizeCategorySlug(raw);
  if (!v) return { value: "", error: "El slug es obligatorio" };
  if (v.length < 2) return { value: v, error: "El slug es demasiado corto" };
  if (/^(javascript|data|vbscript)/i.test(v)) return { value: v, error: "Slug no permitido" };
  return { value: v, error: null };
}

export function normalizeInstagram(raw?: string | null): { value: string | null; error: string | null } {
  return parseSocial(raw, /(^|\.)instagram\.com$/i);
}
export function instagramUrl(raw?: string | null): string | null {
  const { value } = normalizeInstagram(raw);
  return value ? `https://instagram.com/${value}` : null;
}

export function normalizeFacebook(raw?: string | null): { value: string | null; error: string | null } {
  return parseSocial(raw, /(^|\.)facebook\.com$/i);
}
export function facebookUrl(raw?: string | null): string | null {
  const { value } = normalizeFacebook(raw);
  return value ? `https://facebook.com/${value}` : null;
}

export const DEFAULT_VISUAL: VisualContent = {
  logo_url: "",
  favicon_url: "",
  color_primary: "#00e0ff",
  color_button: "#22ff88",
  legal_text: "© VISUALSKIN. Todos los derechos reservados.",
};

export const DEFAULT_FAQS: Faq[] = [
  { id: "d1", question: "¿Cuánto tarda mi pack en llegar?", answer: "Entre 3 y 5 días hábiles a todo Chile una vez confirmado el diseño y el pago.", is_active: true, sort_order: 0 },
  { id: "d2", question: "¿Qué calidad tiene la impresión?", answer: "Usamos sublimación de alta resolución que no se despinta ni se agrieta con el uso.", is_active: true, sort_order: 1 },
  { id: "d3", question: "¿Puedo cambiar el diseño después de pagar?", answer: "Puedes solicitar cambios dentro de las primeras 2 horas escribiéndonos por nuestros canales de contacto.", is_active: true, sort_order: 2 },
  { id: "d4", question: "¿Qué pasa si mi carcasa no calza en mi celular?", answer: "Cambio gratis. El mockup se genera automáticamente según el modelo que elijas.", is_active: true, sort_order: 3 },
  { id: "d5", question: "¿Tienen tallas grandes?", answer: "Sí, desde S hasta XL en polera y polerón. Consulta talla XXL por WhatsApp.", is_active: true, sort_order: 4 },
];

// ---------- Legal documents ----------
export type LegalStatus = "draft" | "published";

export type LegalIdentity = {
  status: LegalStatus;
  updated_at: string | null;
  trade_name: string;
  legal_name: string;
  rut: string;
  address: string;
  comuna: string;
  region: string;
  representative: string;
  official_channel: string;
  legal_email: string;
  phone: string;
};

export type LegalDoc = {
  status: LegalStatus;
  updated_at: string | null;
  sections: Record<string, string>;
};

export type LegalSectionSpec = { key: string; title: string; required?: boolean; hint?: string; example?: string };

export type LegalIdentityFieldSpec = {
  key: keyof LegalIdentity;
  label: string;
  hint: string;
  example: string;
  required: boolean;
  type?: "text" | "email";
};

export const LEGAL_IDENTITY_FIELDS: LegalIdentityFieldSpec[] = [
  { key: "trade_name", label: "Nombre de fantasía", required: false,
    hint: "Nombre comercial con el que la marca se muestra al público.",
    example: "Ejemplo: VisualSkin" },
  { key: "legal_name", label: "Razón social", required: true,
    hint: "Nombre legal completo con el que opera la empresa o persona natural.",
    example: "Ejemplo: EMPRESA EJEMPLO SpA" },
  { key: "rut", label: "RUT", required: true,
    hint: "RUT de la empresa o persona con formato chileno (con guion y dígito verificador).",
    example: "Ejemplo: 76.123.456-7" },
  { key: "address", label: "Domicilio legal", required: true,
    hint: "Dirección completa registrada legalmente (calle, número, oficina si aplica).",
    example: "Ejemplo: Av. Ejemplo 1234, oficina 501" },
  { key: "comuna", label: "Comuna", required: false,
    hint: "Comuna del domicilio legal. Opcional si el domicilio ya la incluye.",
    example: "Ejemplo: Providencia" },
  { key: "region", label: "Región", required: false,
    hint: "Región del domicilio legal. Opcional si el domicilio ya la incluye.",
    example: "Ejemplo: Región Metropolitana" },
  // Representante legal: dato interno, no requerido y no expuesto públicamente.
  // Se mantiene fuera del formulario de identidad y de las vistas públicas.
  { key: "official_channel", label: "Medio oficial de contacto", required: true,
    hint: "Canal principal por el cual el cliente puede comunicarse (correo, WhatsApp u otro).",
    example: "Ejemplo: contacto@empresa-ejemplo.cl" },
  { key: "legal_email", label: "Correo legal / atención", required: false, type: "email",
    hint: "Correo específico para notificaciones legales o de atención al consumidor.",
    example: "Ejemplo: legal@empresa-ejemplo.cl" },
  { key: "phone", label: "Teléfono o WhatsApp", required: false,
    hint: "Teléfono opcional publicado como contacto adicional.",
    example: "Ejemplo: +56 9 1234 5678" },
];

export const LEGAL_IDENTITY_REQUIRED: (keyof LegalIdentity)[] =
  LEGAL_IDENTITY_FIELDS.filter((f) => f.required).map((f) => f.key);

// Formato chileno de RUT: 7-8 dígitos + guion + dígito verificador (0-9 o K).
const RUT_RE = /^\d{1,2}(?:\.?\d{3}){2}-[\dkK]$/;

export function isValidRutChileno(raw?: string | null): boolean {
  const v = String(raw ?? "").trim();
  if (!v) return false;
  if (!RUT_RE.test(v)) return false;
  const clean = v.replace(/\./g, "").replace(/-/g, "").toUpperCase();
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0, mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
  return expected === dv;
}


export const TERMS_SECTIONS: LegalSectionSpec[] = [
  { key: "identificacion_vendedor", title: "Identificación del vendedor",
    hint: "Indica qué persona natural o empresa vende los productos y cómo el cliente puede identificarla oficialmente. Puedes remitir a la identidad ya cargada en Admin." },
  { key: "objeto", title: "Objeto y alcance del sitio",
    hint: "Explica para qué sirve este sitio y qué relación comercial se genera cuando el cliente compra o encarga un producto." },
  { key: "productos_personalizados", title: "Productos personalizados", required: true,
    hint: "Explica qué productos se fabrican o intervienen según las elecciones, medidas, imágenes o instrucciones del comprador." },
  { key: "proceso_personalizacion", title: "Proceso de personalización",
    hint: "Describe los pasos que sigue el cliente al personalizar (elección de modelo, subida de imágenes, ajustes) y qué archivos o datos entrega." },
  { key: "responsabilidad_archivos", title: "Responsabilidad del cliente por sus archivos",
    hint: "Aclara que el cliente responde por los derechos, contenido y calidad de las imágenes o textos que sube." },
  { key: "revision_diseno", title: "Revisión y aprobación del diseño",
    hint: "Explica en qué momento el cliente aprueba el diseño y desde cuándo ya no puede solicitar cambios." },
  { key: "precios", title: "Precios y costo total", required: true,
    hint: "Explica que el precio total mostrado antes de pagar incluye los conceptos informados en el resumen del pedido." },
  { key: "medios_pago", title: "Medios y condiciones de pago",
    hint: "Enumera los medios de pago disponibles y aclara que el procesamiento lo realiza el proveedor de pagos contratado." },
  { key: "produccion", title: "Producción", required: true,
    hint: "Indica cuándo comienza la producción y el plazo estimado. No inventes el plazo: ingresa el plazo real del negocio." },
  { key: "entrega", title: "Entrega, despacho o retiro", required: true,
    hint: "Indica las modalidades, zonas de cobertura, costos y plazos reales." },
  { key: "plazos", title: "Plazos estimados",
    hint: "Resume los plazos totales estimados entre pago aprobado y entrega, considerando producción y despacho." },
  { key: "disponibilidad", title: "Disponibilidad",
    hint: "Aclara que la disponibilidad de modelos o packs puede variar y que se confirma al momento de aprobar el pedido." },
  { key: "cambios_devoluciones", title: "Cambios y devoluciones", required: true,
    hint: "Resume las condiciones de cambio o devolución y remite al documento específico de cambios y devoluciones." },
  { key: "retracto", title: "Derecho a retracto", required: true,
    hint: "Define qué productos permiten retracto y cómo se informa la situación de los productos confeccionados según instrucciones del cliente. No elimines la garantía legal." },
  { key: "garantia", title: "Garantía legal", required: true,
    hint: "Explica cómo se aplica la garantía cuando el producto tiene fallas, no corresponde a lo contratado o presenta errores atribuibles al vendedor." },
  { key: "propiedad_intelectual", title: "Propiedad intelectual",
    hint: "Aclara los derechos sobre las marcas y contenidos del sitio, y el uso limitado a la personalización solicitada por el cliente." },
  { key: "uso_sitio", title: "Uso permitido del sitio",
    hint: "Prohibiciones básicas: usos automatizados, subida de contenidos ilícitos, intentos de manipulación del sistema." },
  { key: "errores_precios", title: "Errores en precios o información",
    hint: "Explica cómo se corrigen errores evidentes de precio o descripción antes de confirmar el pedido." },
  { key: "comunicaciones", title: "Comunicaciones con el cliente",
    hint: "Indica los canales por los que se envían notificaciones (correo, WhatsApp) y su carácter informativo." },
  { key: "legislacion", title: "Legislación aplicable",
    hint: "Indica que aplica la legislación chilena y en particular la Ley 19.496 de protección al consumidor." },
  { key: "canales_atencion", title: "Canales de atención", required: true,
    hint: "Indica los canales oficiales de atención al cliente y sus horarios de respuesta reales." },
  { key: "vigencia", title: "Fecha de vigencia",
    hint: "Fecha desde la cual rige esta versión del documento." },
];

export const PRIVACY_SECTIONS: LegalSectionSpec[] = [
  { key: "responsable", title: "Responsable del tratamiento", required: true,
    hint: "Identifica quién es responsable de los datos personales recopilados en el sitio (normalmente la empresa vendedora)." },
  { key: "datos_recopilados", title: "Datos recopilados", required: true,
    hint: "Enumera qué categorías de datos se recopilan realmente: identificación, contacto, pedido, imágenes, datos técnicos." },
  { key: "datos_pedidos", title: "Datos de pedidos",
    hint: "Describe los datos asociados al pedido: productos, opciones personalizadas, dirección de despacho, monto." },
  { key: "datos_contacto", title: "Datos de contacto",
    hint: "Correo, teléfono y otros medios que el cliente entrega para el envío y seguimiento del pedido." },
  { key: "archivos_disenos", title: "Archivos y diseños subidos",
    hint: "Explica cómo se tratan las imágenes o archivos que el cliente sube y para qué se usan." },
  { key: "datos_tecnicos", title: "Datos técnicos y de sesión",
    hint: "Datos técnicos mínimos (por ejemplo, cookies de sesión de autenticación). No mencionar tecnologías no implementadas realmente." },
  { key: "finalidades", title: "Finalidades del tratamiento", required: true,
    hint: "Producción del producto, gestión del pedido, comunicaciones operativas, cumplimiento legal." },
  { key: "base_tratamiento", title: "Base o justificación del tratamiento",
    hint: "Ejecución del contrato de compraventa, cumplimiento de obligaciones legales y consentimiento cuando aplique." },
  { key: "proveedores", title: "Proveedores tecnológicos",
    hint: "Menciona los proveedores tecnológicos usados realmente (hosting/base de datos y pagos). No incluir servicios que no estén implementados." },
  { key: "plataforma_pagos", title: "Plataforma de pagos",
    hint: "Aclara que los datos de pago los procesa el proveedor de pagos y que el sitio no almacena datos de tarjetas." },
  { key: "almacenamiento", title: "Almacenamiento y seguridad",
    hint: "Describe dónde se almacenan los datos y las medidas de seguridad aplicadas (control de acceso, cifrado del proveedor, etc.)." },
  { key: "conservacion", title: "Conservación", required: true,
    hint: "Indica cuánto tiempo se conservan los datos y los archivos de diseño según finalidad y obligaciones legales." },
  { key: "terceros", title: "Comunicación a terceros",
    hint: "Solo los estrictamente necesarios para producción, despacho, pagos y cumplimiento legal." },
  { key: "derechos", title: "Derechos de acceso, rectificación, eliminación y bloqueo", required: true,
    hint: "Explica cómo el cliente puede ejercer sus derechos sobre sus datos personales." },
  { key: "eliminacion", title: "Solicitud de eliminación",
    hint: "Explica el canal y los pasos para pedir eliminación, respetando lo que la ley obligue a conservar." },
  { key: "menores", title: "Datos de menores",
    hint: "Aclara la política respecto a menores de edad y la autorización requerida cuando aplique." },
  { key: "transferencias", title: "Transferencias o almacenamiento fuera de Chile",
    hint: "Si los proveedores usan infraestructura fuera de Chile, indícalo de forma clara." },
  { key: "cambios_politica", title: "Cambios a la política",
    hint: "Explica cómo se comunican los cambios a esta política y desde cuándo rigen." },
  { key: "canal_privacidad", title: "Canal de privacidad", required: true,
    hint: "Canal oficial (correo u otro) al que el cliente puede escribir por temas de privacidad." },
  { key: "vigencia", title: "Fecha de vigencia",
    hint: "Fecha desde la cual rige esta versión de la política." },
];

export const RETURNS_SECTIONS: LegalSectionSpec[] = [
  { key: "cambios_voluntarios", title: "Cambios voluntarios",
    hint: "Condiciones para cambios solicitados por preferencia del cliente, distintos de fallas o errores." },
  { key: "devoluciones", title: "Devoluciones",
    hint: "Condiciones generales de devolución de productos no personalizados o cuando corresponda por ley." },
  { key: "errores_fabricacion", title: "Errores de fabricación", required: true,
    hint: "Explica cómo se maneja un producto con defectos atribuibles al proceso de fabricación." },
  { key: "producto_distinto", title: "Producto distinto al aprobado",
    hint: "Qué ocurre si el producto entregado no coincide con el diseño o pack aprobado por el cliente." },
  { key: "dano_transporte", title: "Daño durante transporte",
    hint: "Procedimiento cuando el producto llega dañado y cómo el cliente debe reportarlo y evidenciarlo." },
  { key: "garantia", title: "Garantía legal", required: true,
    hint: "Explica la garantía legal aplicable a productos con fallas, incluso cuando son personalizados." },
  { key: "procedimiento", title: "Procedimiento de solicitud", required: true,
    hint: "Pasos concretos que debe seguir el cliente para solicitar cambio, devolución o hacer efectiva la garantía." },
  { key: "evidencia", title: "Evidencia solicitada",
    hint: "Qué evidencia se pide (fotos, número de pedido, descripción de la falla) para evaluar la solicitud." },
  { key: "contacto", title: "Canales de contacto", required: true,
    hint: "Canales oficiales por los que se reciben solicitudes de cambio, devolución o garantía." },
  { key: "plazos_respuesta", title: "Plazos internos de respuesta",
    hint: "Plazo que se compromete internamente para responder al cliente sobre su solicitud." },
  { key: "condiciones_devuelto", title: "Condiciones del producto devuelto",
    hint: "Estado en que debe entregarse el producto para su devolución o cambio (empaque, uso, etc.)." },
  { key: "gastos_envio", title: "Gastos de envío",
    hint: "Explica quién asume los gastos de envío según el motivo (error del vendedor, cambio voluntario, garantía)." },
  { key: "casos_excluidos", title: "Casos excluidos",
    hint: "Situaciones que quedan fuera de cambio o devolución, respetando siempre la garantía legal." },
  { key: "retracto", title: "Derecho a retracto", required: true,
    hint: "Explica cómo aplica el retracto legal y qué ocurre con los productos confeccionados según instrucciones del cliente." },
];


export const DEFAULT_LEGAL_IDENTITY: LegalIdentity = {
  status: "draft", updated_at: null,
  trade_name: "", legal_name: "", rut: "", address: "", comuna: "", region: "",
  representative: "", official_channel: "", legal_email: "", phone: "",
};

const emptySections = (spec: LegalSectionSpec[]): Record<string, string> =>
  Object.fromEntries(spec.map((s) => [s.key, ""]));

export const DEFAULT_LEGAL_TERMS: LegalDoc = { status: "draft", updated_at: null, sections: emptySections(TERMS_SECTIONS) };
export const DEFAULT_LEGAL_PRIVACY: LegalDoc = { status: "draft", updated_at: null, sections: emptySections(PRIVACY_SECTIONS) };
export const DEFAULT_LEGAL_RETURNS: LegalDoc = { status: "draft", updated_at: null, sections: emptySections(RETURNS_SECTIONS) };

export function legalIdentityMissing(id: LegalIdentity): string[] {
  return LEGAL_IDENTITY_REQUIRED.filter((k) => !String(id[k] ?? "").trim());
}
export function legalDocMissing(doc: LegalDoc, spec: LegalSectionSpec[]): string[] {
  return spec.filter((s) => s.required && !String(doc.sections?.[s.key] ?? "").trim()).map((s) => s.title);
}

// Extra publication check for the identity document (RUT format).
export function legalIdentityInvalid(id: LegalIdentity): string[] {
  const errs: string[] = [];
  if (String(id.rut ?? "").trim() && !isValidRutChileno(id.rut)) {
    errs.push("RUT con formato inválido");
  }
  if (String(id.legal_email ?? "").trim()) {
    const { error } = normalizeEmail(id.legal_email);
    if (error) errs.push("Correo legal inválido");
  }
  return errs;
}

// Plain-text export for offline review. Never rendered publicly.
export function formatLegalDocForReview(
  title: string,
  identity: LegalIdentity,
  doc: LegalDoc,
  spec: LegalSectionSpec[],
): string {
  const lines: string[] = [];
  lines.push(title.toUpperCase());
  lines.push("=".repeat(title.length));
  lines.push("");
  lines.push(`Estado: ${doc.status === "published" ? "Publicado" : "Borrador"}`);
  lines.push(`Última actualización: ${doc.updated_at ? new Date(doc.updated_at).toLocaleString("es-CL") : "—"}`);
  lines.push("");
  lines.push("Identidad del vendedor");
  lines.push("----------------------");
  const idLines: Array<[string, string]> = [
    ["Nombre de fantasía", identity.trade_name],
    ["Razón social", identity.legal_name],
    ["RUT", identity.rut],
    ["Domicilio", identity.address],
    ["Comuna", identity.comuna],
    ["Región", identity.region],
    // representante legal omitido intencionalmente (dato interno, no público)
    ["Medio oficial de contacto", identity.official_channel],
    ["Correo legal", identity.legal_email],
    ["Teléfono / WhatsApp", identity.phone],
  ];
  for (const [k, v] of idLines) {
    if (String(v ?? "").trim()) lines.push(`${k}: ${v}`);
  }
  lines.push("");
  for (const s of spec) {
    const body = String(doc.sections?.[s.key] ?? "").trim();
    lines.push(s.title.toUpperCase());
    lines.push("-".repeat(s.title.length));
    lines.push(body ? body : "(pendiente)");
    lines.push("");
  }
  return lines.join("\n");
}

// Reject unsafe schemes/HTML/JS in stored legal text. Plain text only.
export function sanitizeLegalText(v: string): string {
  const s = String(v ?? "");
  // Strip control chars except newline/tab, remove HTML tags.
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/data:/gi, "")
    .replace(/vbscript:/gi, "");
}



// ---------- Fetch helpers ----------
async function getKey<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.from("site_content").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return { ...fallback, ...(data.value as any) } as T;
}

export const cmsKeys = {
  home: ["cms", "home"] as const,
  contact: ["cms", "contact"] as const,
  visual: ["cms", "visual"] as const,
  packs: ["cms", "promo_packs"] as const,
  categories: ["cms", "catalog_categories"] as const,
  faqs: ["cms", "faqs"] as const,
  banners: ["cms", "banners"] as const,
  legalIdentity: ["cms", "legal_identity"] as const,
  legalTerms: ["cms", "legal_terms"] as const,
  legalPrivacy: ["cms", "legal_privacy"] as const,
  legalReturns: ["cms", "legal_returns"] as const,
};

export function useLegalIdentity() {
  return useQuery({
    queryKey: cmsKeys.legalIdentity,
    queryFn: () => getKey<LegalIdentity>("legal_identity", DEFAULT_LEGAL_IDENTITY),
    staleTime: 60_000,
  });
}
export function useLegalTerms() {
  return useQuery({
    queryKey: cmsKeys.legalTerms,
    queryFn: () => getKey<LegalDoc>("legal_terms", DEFAULT_LEGAL_TERMS),
    staleTime: 60_000,
  });
}
export function useLegalPrivacy() {
  return useQuery({
    queryKey: cmsKeys.legalPrivacy,
    queryFn: () => getKey<LegalDoc>("legal_privacy", DEFAULT_LEGAL_PRIVACY),
    staleTime: 60_000,
  });
}
export function useLegalReturns() {
  return useQuery({
    queryKey: cmsKeys.legalReturns,
    queryFn: () => getKey<LegalDoc>("legal_returns", DEFAULT_LEGAL_RETURNS),
    staleTime: 60_000,
  });
}

export function useHomeContent() {
  return useQuery({
    queryKey: cmsKeys.home,
    queryFn: () => getKey<HomeContent>("home", DEFAULT_HOME),
    staleTime: 60_000,
  });
}
export function useContactContent() {
  return useQuery({
    queryKey: cmsKeys.contact,
    queryFn: () => getKey<ContactContent>("contact", DEFAULT_CONTACT),
    staleTime: 60_000,
  });
}
export function useVisualContent() {
  return useQuery({
    queryKey: cmsKeys.visual,
    queryFn: () => getKey<VisualContent>("visual", DEFAULT_VISUAL),
    staleTime: 60_000,
  });
}

export function usePromoPacks(onlyActive = true) {
  return useQuery({
    queryKey: [...cmsKeys.packs, onlyActive],
    queryFn: async () => {
      let q = supabase.from("promo_packs").select("*").order("sort_order");
      if (onlyActive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PromoPack[];
    },
    staleTime: 60_000,
  });
}

export function usePromoPack(id: string | undefined) {
  return useQuery({
    queryKey: ["cms", "promo_pack", id ?? ""],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("promo_packs").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as PromoPack | null;
    },
    staleTime: 60_000,
  });
}

export function useCatalogCategories(onlyActive = true) {
  return useQuery({
    queryKey: [...cmsKeys.categories, onlyActive],
    queryFn: async () => {
      let q = supabase.from("catalog_categories").select("*").order("sort_order");
      if (onlyActive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CatalogCategory[];
    },
    staleTime: 60_000,
  });
}

export function useFaqs(onlyActive = true) {
  return useQuery({
    queryKey: [...cmsKeys.faqs, onlyActive],
    queryFn: async () => {
      let q = supabase.from("faqs").select("*").order("sort_order");
      if (onlyActive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Faq[];
      return rows.length ? rows : DEFAULT_FAQS;
    },
    staleTime: 60_000,
  });
}

export function useBanners(onlyActive = true) {
  return useQuery({
    queryKey: [...cmsKeys.banners, onlyActive],
    queryFn: async () => {
      let q = supabase.from("banners").select("*").order("sort_order");
      if (onlyActive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Banner[];
    },
    staleTime: 60_000,
  });
}

// ---------- Upload helper ----------
export async function uploadCmsMedia(file: File, folder = "misc"): Promise<string> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("cms-media").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  // Bucket is private; create long-lived signed URL (~10 years).
  const { data, error: e2 } = await supabase.storage
    .from("cms-media")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (e2 || !data) throw e2 ?? new Error("signed url failed");
  return data.signedUrl;
}

// ---------- Save helpers (admin) ----------
export async function saveSiteContent(key: string, value: unknown) {
  const { error } = await supabase
    .from("site_content")
    .upsert({ key, value: value as any }, { onConflict: "key" });
  if (error) throw error;
}
