import type { PackType, PromoPack } from "./cms.ts";
import { canonicalUrl } from "./seo.ts";

export const PRODUCT_SLUGS = {
  carcasa: "carcasa-personalizada",
  "carcasa+polera": "pack-carcasa-polera-personalizada",
  "carcasa+poleron": "pack-carcasa-poleron-personalizado",
  "carcasa+polera+poleron": "pack-completo-personalizado",
} as const satisfies Record<PackType, string>;

export type ProductSlug = (typeof PRODUCT_SLUGS)[PackType];

const PACK_TYPES_BY_SLUG = Object.fromEntries(
  Object.entries(PRODUCT_SLUGS).map(([packType, slug]) => [slug, packType]),
) as Record<ProductSlug, PackType>;

export function productSlugForPackType(packType: string): ProductSlug | null {
  return Object.prototype.hasOwnProperty.call(PRODUCT_SLUGS, packType)
    ? PRODUCT_SLUGS[packType as PackType]
    : null;
}

export function packTypeForProductSlug(slug: string): PackType | null {
  return Object.prototype.hasOwnProperty.call(PACK_TYPES_BY_SLUG, slug)
    ? PACK_TYPES_BY_SLUG[slug as ProductSlug]
    : null;
}

export function productPathForPack(pack: Pick<PromoPack, "pack_type">): string | null {
  const slug = productSlugForPackType(pack.pack_type);
  return slug ? `/productos/${slug}` : null;
}

export type CanonicalPromoPackPricing = {
  basePrice: number;
  effectivePrice: number;
  hasSale: boolean;
};

// Mirrors resolveCanonicalOrderItem(): CLP is charged as rounded, positive safe
// integers and a sale price may never exceed the base price.
export function canonicalPromoPackPricing(
  pack: Pick<PromoPack, "price" | "sale_price">,
): CanonicalPromoPackPricing | null {
  const basePrice = Math.round(Number(pack.price));
  const effectivePrice = Math.round(Number(pack.sale_price ?? pack.price));
  if (
    !Number.isSafeInteger(basePrice) ||
    !Number.isSafeInteger(effectivePrice) ||
    basePrice <= 0 ||
    effectivePrice <= 0 ||
    effectivePrice > basePrice
  ) return null;
  return { basePrice, effectivePrice, hasSale: effectivePrice < basePrice };
}

export function effectivePromoPackPrice(pack: Pick<PromoPack, "price" | "sale_price">): number | null {
  return canonicalPromoPackPricing(pack)?.effectivePrice ?? null;
}

export function resolveActiveProduct(slug: string, packs: readonly PromoPack[]): PromoPack | null {
  const packType = packTypeForProductSlug(slug);
  if (!packType) return null;
  const matches = packs.filter((pack) => pack.is_active && pack.pack_type === packType);
  return matches.length === 1 ? matches[0] : null;
}

export function publicProductImage(imageUrl: string | null | undefined): string | undefined {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl.trim())) return undefined;
  try {
    const parsed = new URL(imageUrl.trim());
    if (parsed.username || parsed.password) return undefined;
    if (/\/storage\/v1\/object\/sign\//i.test(parsed.pathname)) return undefined;
    const privateParams = ["token", "signature", "x-amz-signature"];
    if (privateParams.some((key) => parsed.searchParams.has(key))) return undefined;
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function productJsonLd(pack: PromoPack, pathname: string) {
  const price = effectivePromoPackPrice(pack);
  const image = publicProductImage(pack.image_url);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: pack.name,
    ...(pack.description?.trim() ? { description: pack.description.trim() } : {}),
    ...(image ? { image } : {}),
    url: canonicalUrl(pathname),
    ...(price != null
      ? {
          offers: {
            "@type": "Offer",
            url: canonicalUrl(pathname),
            priceCurrency: "CLP",
            price,
          },
        }
      : {}),
  } as const;
}

export function productSitemapPaths(packs: readonly PromoPack[]) {
  const counts = new Map<string, number>();
  for (const pack of packs) {
    if (!pack.is_active || !productSlugForPackType(pack.pack_type)) continue;
    counts.set(pack.pack_type, (counts.get(pack.pack_type) ?? 0) + 1);
  }
  return packs.flatMap((pack) => {
    const path = productPathForPack(pack);
    return pack.is_active && path && counts.get(pack.pack_type) === 1
      ? [{ path, changefreq: "weekly", priority: "0.8" }]
      : [];
  });
}

export function sitemapPathsWithProducts<T>(basePaths: readonly T[], packs?: readonly PromoPack[]): Array<T | ReturnType<typeof productSitemapPaths>[number]> {
  return packs ? [...basePaths, ...productSitemapPaths(packs)] : [...basePaths];
}
