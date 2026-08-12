function parseNum(v) {
  if (v === "" || v == null) return null;
  const n = Number(
    String(v)
      .replace(/,/g, "")
      .replace(/[０-９．]/g, (ch) => {
        const map = "０１２３４５６７８９．";
        const idx = map.indexOf(ch);
        return idx >= 0 ? "0123456789."[idx] : ch;
      })
  );
  return Number.isFinite(n) ? n : NaN;
}

export function numOk(v) {
  const n = parseNum(v);
  return n != null && Number.isFinite(n) && n > 0 && n < 1000;
}

export function numError(v) {
  if (v === "" || v == null) return "";
  const n = parseNum(v);
  if (!Number.isFinite(n)) return "数字で入力してください";
  if (n <= 0 || n >= 1000) return "1〜999cmで入力";
  return "";
}

export function missingFields(o, photoCount) {
  const miss = [];
  if ((photoCount || 0) < 1) miss.push("写真");
  if (!numOk(o.height)) miss.push("縦");
  if (!numOk(o.width)) miss.push("横");
  if (o.kind === "window" && !numOk(o.sill)) miss.push("床からの高さ");
  if (!o.material) miss.push("素材");
  else if (o.material === "その他" && !o.materialOther) miss.push("素材の具体名");
  return miss;
}

export function isOpeningDone(o, photoCount) {
  return missingFields(o, photoCount).length === 0;
}

export function openingProgress(openings, counts) {
  const total = openings.length;
  let done = 0;
  for (const o of openings) {
    const n = counts[`opening:${o.id}`] || 0;
    if (isOpeningDone(o, n)) done += 1;
  }
  return { done, total };
}
