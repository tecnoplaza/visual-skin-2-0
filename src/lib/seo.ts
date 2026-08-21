export const CANONICAL_ORIGIN = "https://www.visualskin.cl";
export const PRIVATE_ROBOTS_DIRECTIVE = "noindex, nofollow, noarchive";

const DEFAULT_SITE_NAME = "VISUALSKIN";

export function normalizeSeoPathname(input: string): string {
  let pathname = input.trim();
  try {
    pathname = /^[a-z][a-z\d+.-]*:\/\//i.test(pathname)
      ? new URL(pathname).pathname
      : pathname.split(/[?#]/, 1)[0];
  } catch {
    pathname = "/";
  }
  pathname = `/${pathname}`.replace(/\/{2,}/g, "/");
  if (pathname !== "/") pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

export function canonicalUrl(pathname: string): string {
  return new URL(normalizeSeoPathname(pathname), `${CANONICAL_ORIGIN}/`).toString();
}

export type SeoMetadataInput = {
  pathname: string;
  title: string;
  description: string;
  type?: "website" | "article";
  image?: string;
};

export function buildSeoHead({
  pathname,
  title,
  description,
  type = "website",
  image,
}: SeoMetadataInput) {
  const url = canonicalUrl(pathname);
  const meta = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:type", content: type },
    { property: "og:locale", content: "es_CL" },
    { property: "og:site_name", content: DEFAULT_SITE_NAME },
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (image) {
    const safeImage = new URL(image, `${CANONICAL_ORIGIN}/`).toString();
    meta.push({ property: "og:image", content: safeImage });
    meta.push({ name: "twitter:image", content: safeImage });
  }
  return {
    meta,
    links: [{ rel: "canonical", href: url }],
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: DEFAULT_SITE_NAME,
    url: `${CANONICAL_ORIGIN}/`,
  } as const;
}

export function organizationJsonLd(sameAs: readonly string[] = []) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: DEFAULT_SITE_NAME,
    legalName: "TECNOPLAZA SpA",
    url: `${CANONICAL_ORIGIN}/`,
    ...(sameAs.length > 0 ? { sameAs: [...sameAs] } : {}),
  } as const;
}

export type BreadcrumbEntry = { name: string; pathname: string };

export function breadcrumbJsonLd(entries: readonly BreadcrumbEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: canonicalUrl(entry.pathname),
    })),
  } as const;
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type SitemapEntry = { path: string; changefreq: string; priority: string };

export function renderSitemap(paths: ReadonlyArray<SitemapEntry>): string {
  const urls = paths.map(
    (entry) =>
      `  <url>\n    <loc>${escapeXml(canonicalUrl(entry.path))}</loc>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`,
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}
