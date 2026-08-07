// Convierte los píxeles cercanos al blanco puro en transparentes.
// Útil cuando el overlay del molde se subió como JPG/PNG opaco con fondo blanco.
export async function removeWhiteBackground(
  url: string,
  { threshold = 240, feather = 12 }: { threshold?: number; feather?: number } = {},
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar imagen (${res.status})`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const minC = Math.min(r, g, b);
    if (minC >= threshold) {
      // píxel blanco → transparente completo
      d[i + 3] = 0;
    } else if (minC >= threshold - feather) {
      // borde: alpha proporcional para evitar halo duro
      const t = (minC - (threshold - feather)) / feather; // 0..1
      d[i + 3] = Math.round(d[i + 3] * (1 - t));
    }
  }
  ctx.putImageData(img, 0, 0);
  return await new Promise<Blob>((res2, rej) =>
    canvas.toBlob((b) => (b ? res2(b) : rej(new Error("toBlob null"))), "image/png"),
  );
}
