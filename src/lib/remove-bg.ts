// Borrador mágico "no invasivo": elimina SOLO los píxeles de fondo conectados
// a los bordes de la imagen mediante flood-fill. Los píxeles del sujeto (aunque
// tengan un color similar al fondo) no se tocan porque no están conectados
// al borde a través de una zona del color de fondo.
export async function removeImageBackground(
  url: string,
  {
    tolerance = 32,
    feather = 6,
  }: { tolerance?: number; feather?: number } = {},
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar la imagen (${res.status})`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const W = bmp.width;
  const H = bmp.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Estima color de fondo desde los píxeles del borde (mediana por canal).
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const pushEdge = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 8) return;
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.min(W, H) / 80));
  for (let x = 0; x < W; x += step) { pushEdge(x, 0); pushEdge(x, H - 1); }
  for (let y = 0; y < H; y += step) { pushEdge(0, y); pushEdge(W - 1, y); }
  if (rs.length === 0) {
    return url; // sin muestra suficiente
  }
  const median = (a: number[]) => {
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const bgR = median(rs), bgG = median(gs), bgB = median(bs);

  const t2 = tolerance * tolerance;
  const outer = tolerance + feather;
  const outer2 = outer * outer;

  const distSq = (i: number) => {
    const dr = d[i] - bgR, dg = d[i + 1] - bgG, db = d[i + 2] - bgB;
    return dr * dr + dg * dg + db * db;
  };

  // Flood-fill BFS desde todos los píxeles del borde que coincidan con el fondo.
  // Marcamos con alpha=0 (fondo) o dejamos intacto (sujeto).
  const visited = new Uint8Array(W * H);
  const queue: number[] = [];

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (visited[p]) return;
    const i = p * 4;
    const ds = distSq(i);
    if (ds <= outer2) {
      visited[p] = 1;
      queue.push(p);
      if (ds <= t2) {
        d[i + 3] = 0;
      } else {
        const dist = Math.sqrt(ds);
        const t = (dist - tolerance) / feather; // 0..1
        d[i + 3] = Math.round(d[i + 3] * t);
      }
    } else {
      visited[p] = 2; // sujeto: no propagar
    }
  };

  for (let x = 0; x < W; x++) { tryPush(x, 0); tryPush(x, H - 1); }
  for (let y = 0; y < H; y++) { tryPush(0, y); tryPush(W - 1, y); }

  while (queue.length) {
    const p = queue.pop()!;
    const x = p % W;
    const y = (p - x) / W;
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  ctx.putImageData(img, 0, 0);
  const outBlob: Blob = await new Promise((res2, rej) =>
    canvas.toBlob((b) => (b ? res2(b) : rej(new Error("toBlob null"))), "image/png"),
  );
  return URL.createObjectURL(outBlob);
}
