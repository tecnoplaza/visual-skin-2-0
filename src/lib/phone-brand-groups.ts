export type PhoneBrandIdentity = {
  id: string;
  name: string;
};

export type PhoneBrandGroup = {
  key: string;
  name: string;
  brandIds: string[];
};

export function normalizePhoneBrandName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-CL");
}

export function groupPhoneBrands(brands: readonly PhoneBrandIdentity[]): PhoneBrandGroup[] {
  const groups = new Map<string, PhoneBrandGroup>();

  for (const brand of brands) {
    const name = brand.name.trim().replace(/\s+/g, " ");
    const key = normalizePhoneBrandName(name);
    if (!key) continue;

    const existing = groups.get(key);
    if (existing) {
      if (!existing.brandIds.includes(brand.id)) existing.brandIds.push(brand.id);
    } else {
      groups.set(key, { key, name, brandIds: [brand.id] });
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es-CL", { sensitivity: "base" }));
}

export function phoneBrandGroupForId(groups: readonly PhoneBrandGroup[], brandId: string): PhoneBrandGroup | undefined {
  return groups.find((group) => group.brandIds.includes(brandId));
}
