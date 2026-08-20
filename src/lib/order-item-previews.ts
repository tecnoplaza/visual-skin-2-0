export type OrderItemPreview = { slot: string; url: string };

export type PersistedPreviewRow = {
  order_id: string;
  order_item_id: string;
  slot: string;
  storage_path: string;
};

export function previewSlotLabel(slot: string): string {
  const known: Record<string, string> = {
    case: "Carcasa",
    garment: "Prenda",
    secondary_garment: "Prenda secundaria",
  };
  return known[slot] ?? slot.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function groupSignedOrderItemPreviews(
  rows: Array<{ order_item_id: string; slot: string; url: string }>,
): Map<string, OrderItemPreview[]> {
  const grouped = new Map<string, OrderItemPreview[]>();
  for (const row of rows) {
    if (!row.order_item_id || !row.slot || !row.url) continue;
    const previews = grouped.get(row.order_item_id) ?? [];
    previews.push({ slot: row.slot, url: row.url });
    grouped.set(row.order_item_id, previews);
  }
  return grouped;
}
