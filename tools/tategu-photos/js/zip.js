function csvEscape(v) {
  const s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function pad(n) {
  return String(n).padStart(3, "0");
}

export async function buildZip({ openings, photos, meta }) {
  const zip = new window.JSZip();
  const byOwner = {};
  for (const p of photos) {
    const key = `${p.ownerType}:${p.ownerId}`;
    (byOwner[key] ||= []).push(p);
  }

  const openingRows = [
    ["番号", "種類", "幅cm", "高さcm", "窓台高さcm", "材質", "材質その他", "写真枚数", "メモ"]
  ];
  for (const o of openings) {
    const list = (byOwner[`opening:${o.id}`] || []).sort((a, b) => a.id - b.id);
    let i = 1;
    for (const p of list) {
      const ext = (p.mime || "").includes("png") ? "png" : "jpg";
      zip.file(`${o.id}/${o.id}_${pad(i)}.${ext}`, p.blob);
      i += 1;
    }
    const mat = o.material === "その他" ? o.materialOther : o.material;
    openingRows.push([
      o.id,
      o.kind === "door" ? "ドア" : "窓",
      o.width,
      o.height,
      o.kind === "window" ? o.sill : "",
      mat,
      o.materialOther,
      list.length,
      o.note || ""
    ]);
  }

  zip.file(
    "建具.csv",
    "\uFEFF" + openingRows.map((r) => r.map(csvEscape).join(",")).join("\n")
  );
  zip.file(
    "data.json",
    JSON.stringify(
      {
        openings,
        exportedAt: new Date().toISOString(),
        appVersion: meta?.appVersion || "1",
        schemaVersion: meta?.schemaVersion || ""
      },
      null,
      2
    )
  );

  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
