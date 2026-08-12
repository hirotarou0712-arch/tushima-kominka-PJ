import {
  SCHEMA_VERSION,
  addPhoto,
  allPhotos,
  clearAll,
  dbGetAll,
  dbPut,
  deleteOpening,
  deletePhoto,
  ensureSchema,
  nextId,
  photoCounts,
  photosFor
} from "./db.js";
import { isOpeningDone, missingFields, numError, numOk, openingProgress } from "./progress.js";
import { buildZip, downloadBlob } from "./zip.js";
import { checkPhrase, isUnlocked, lock, unlock } from "./gate.js";

const MATERIALS = ["ガラス", "障子", "襖", "木製扉", "アルミサッシ", "不明", "その他"];
const APP_VERSION = "3.1.0";

const state = {
  view: "home",
  openings: [],
  counts: {},
  openingId: null,
  thumbs: [],
  toast: "",
  toastAction: null,
  gateError: "",
  saveStatus: "保存済み",
  saveFailed: false,
  offlineReady: false,
  appear: false,
  exportHint: "",
  lastExportAt: ""
};

let saveTimer = null;
let toastTimer = null;
let undoTimer = null;
let historySyncing = false;

function $(sel, root = document) {
  return root.querySelector(sel);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function refresh() {
  state.openings = sortOpenings(await dbGetAll("openings"));
  state.counts = await photoCounts();
}

function sortOpenings(list) {
  return [...list].sort((a, b) => {
    const ao = a.order ?? 999;
    const bo = b.order ?? 999;
    if (ao !== bo) return ao - bo;
    return String(a.id).localeCompare(String(b.id), "ja", { numeric: true });
  });
}

function toast(msg, action = null, ms = 2800) {
  state.toast = msg;
  state.toastAction = action;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast === msg) {
      state.toast = "";
      state.toastAction = null;
      $(".toast")?.remove();
    }
  }, ms);
}

function syncHistory(view) {
  if (historySyncing) return;
  const path = view === "home" || view === "gate" ? "#/" : view === "export" ? "#/export" : `#/o/${state.openingId}`;
  const cur = location.hash || "#/";
  if (cur === path) return;
  history.pushState({ view, openingId: state.openingId }, "", path);
}

async function goHome({ fromPop = false } = {}) {
  if (state.saveFailed) {
    if (!confirm("保存できていません。一覧に戻りますか？（未保存の入力が失われる可能性があります）")) {
      return;
    }
  }
  await flushSave();
  await refresh();
  revokeThumbs();
  state.view = "home";
  state.openingId = null;
  render();
  if (!fromPop) syncHistory("home");
}

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const max = 1920;
  let w = bmp.width;
  let h = bmp.height;
  if (Math.max(w, h) > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return (
    (await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
    )) || file
  );
}

function progressLine() {
  const o = openingProgress(state.openings, state.counts);
  const pct = o.total ? Math.round((o.done / o.total) * 100) : 0;
  return `<div class="progress-block">
    <div class="progress-meta">
      <span>建具 ${o.done}/${o.total}</span>
      <span class="save-pill ${state.saveFailed ? "fail" : ""}" data-save>${esc(state.saveStatus)}</span>
      <span class="offline-pill ${state.offlineReady ? "ok" : ""}">${
        state.offlineReady ? "オフライン準備完了" : "オフライン準備中…"
      }</span>
    </div>
    <div class="progress-bar"><i style="width:${pct}%"></i></div>
    ${state.lastExportAt ? `<p class="muted tiny export-stamp">最終ZIP: ${esc(state.lastExportAt)}</p>` : ""}
  </div>`;
}

function statusOfOpening(o) {
  const n = state.counts[`opening:${o.id}`] || 0;
  if (isOpeningDone(o, n)) return "完了";
  if (n || o.width || o.height || o.material || o.sill || o.note) return "途中";
  return "未着手";
}

function backBtn(label = "‹ 戻る") {
  return `<button type="button" class="back" data-act="home" aria-label="一覧へ戻る">${label}</button>`;
}

function stickyBackBar(primaryLabel, primaryAct = "done-home") {
  return `<div class="sticky-bar">
    <button type="button" class="btn secondary" data-act="home">‹ 一覧へ戻る</button>
    <button type="button" class="btn primary" data-act="${primaryAct}">${esc(primaryLabel)}</button>
  </div>`;
}

function fieldErr(id, value) {
  const err = numError(value);
  return err
    ? `<p class="field-error" id="${id}-err">${esc(err)}</p>`
    : `<p class="field-error" id="${id}-err" hidden></p>`;
}

function gateView() {
  return `<header class="gate-hero">
    <p class="brand">対馬 建具・採寸</p>
    <p class="gate-lead">現場の写真と寸法を、番号ごとに残します。</p>
  </header>
  <form class="gate">
    <label class="field">合言葉
      <input id="phrase" class="input" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
    </label>
    ${state.gateError ? `<p class="error" role="alert">${esc(state.gateError)}</p>` : ""}
    <button type="button" class="btn primary" data-act="unlock">開く</button>
    <p class="muted tiny">一度開くと、この端末では次回から聞きません。</p>
  </form>`;
}

function homeView() {
  const windows = state.openings.filter((o) => o.kind === "window");
  const doors = state.openings.filter((o) => o.kind === "door");
  const photoTotal = Object.values(state.counts).reduce((a, b) => a + b, 0);

  const oRows = (list) =>
    list
      .map((o) => {
        const n = state.counts[`opening:${o.id}`] || 0;
        const st = statusOfOpening(o);
        const miss = missingFields(o, n);
        const memo = o.note?.trim() || "メモなし";
        return `<button type="button" class="list-row st-row-${st}" data-act="open-opening" data-id="${esc(o.id)}">
          <span class="id-block">
            <span class="id-label">${esc(o.id)}</span>
            <span class="kind-tag">${o.kind === "door" ? "ドア" : "窓"}</span>
          </span>
          <span class="row-main">
            <strong class="row-memo">${esc(memo)}</strong>
            <span class="muted">${
              st === "完了" ? `写真 ${n}枚` : miss.length ? `不足: ${miss.join("・")}` : `写真 ${n}枚`
            }</span>
          </span>
          <span class="st st-${st}">${st === "完了" ? "✓ " : st === "途中" ? "● " : ""}${st}</span>
        </button>`;
      })
      .join("");

  return `<header class="app-header">
    <p class="brand-mark">対馬 建具・採寸</p>
    ${progressLine()}
  </header>
  <div class="actions twin">
    <button type="button" class="btn primary" data-act="add-window">窓を追加</button>
    <button type="button" class="btn secondary" data-act="add-door">ドアを追加</button>
  </div>
  <section class="section">
    <div class="section-head"><h2>窓</h2><span class="count-pill">${windows.length}</span></div>
    <div class="list">${
      windows.length
        ? oRows(windows)
        : `<div class="empty-box"><p class="empty">まだありません</p><button type="button" class="btn secondary" data-act="add-window">最初の窓を追加</button></div>`
    }</div>
  </section>
  <section class="section">
    <div class="section-head"><h2>ドア</h2><span class="count-pill">${doors.length}</span></div>
    <div class="list">${
      doors.length
        ? oRows(doors)
        : `<div class="empty-box"><p class="empty">まだありません</p><button type="button" class="btn secondary" data-act="add-door">最初のドアを追加</button></div>`
    }</div>
  </section>
  <section class="section">
    <h2>書き出し</h2>
    <button type="button" class="btn primary" data-act="export">ZIPを書き出す</button>
  </section>
  <details class="danger-box">
    <summary>データ全消去・ロック</summary>
    <p>アプリ内の写真と入力を消します。先にZIPバックアップを取ってください。</p>
    <button type="button" class="btn danger" data-act="wipe" data-count="${state.openings.length}" data-photos="${photoTotal}">全消去する</button>
    <button type="button" class="btn secondary" data-act="lock">合言葉ロックに戻す</button>
    <p class="muted tiny">版 ${APP_VERSION}</p>
  </details>`;
}

function openingView() {
  const o = state.openings.find((x) => x.id === state.openingId);
  if (!o) return homeView();
  const n = state.counts[`opening:${o.id}`] || 0;
  const st = statusOfOpening(o);
  const miss = missingFields(o, n);
  const done = miss.length === 0;
  const thumbs = state.thumbs
    .map(
      (t) => `<div class="thumb">
        <img src="${t.url}" alt=""/>
        <button type="button" class="thumb-del" data-act="del-photo" data-pid="${t.id}">削除</button>
      </div>`
    )
    .join("");
  const chips = MATERIALS.map(
    (m) =>
      `<button type="button" class="chip ${o.material === m ? "on" : ""}" data-act="mat" data-mat="${esc(m)}">${esc(m)}${
        o.material === m ? " ✓" : ""
      }</button>`
  ).join("");

  const nextCta = done ? "完了して一覧へ" : "一覧へ戻る（途中保存）";
  const nextAct = done ? "done-home" : "home";

  return `<header class="app-header row sticky-top">
    ${backBtn("‹ 戻る")}
    <div class="header-title">
      <h1>${esc(o.id)}</h1>
      <p class="muted tiny">${o.kind === "door" ? "ドア" : "窓"} · ${st} · ${esc(state.saveStatus)}</p>
    </div>
  </header>
  ${
    state.saveFailed
      ? `<div class="banner fail" role="alert">保存できていません。<button type="button" class="linkish" data-act="retry-save">再試行</button></div>`
      : ""
  }
  ${
    done
      ? `<div class="banner ok">✓ ${esc(o.id)} の入力は揃っています</div>`
      : `<div class="banner warn">未入力: ${esc(miss.join("・"))}</div>`
  }
  <div class="detail-stack ${state.appear ? "appear" : ""} has-sticky">
    <section class="block" id="sec-photo">
      <h2>写真 <span class="req">${n >= 1 ? "完了✓" : "必須"}</span></h2>
      <p class="muted tiny">複数枚登録できます。正本はアプリ内です。</p>
      <label class="btn primary file-btn">撮影する
        <input id="cam" type="file" accept="image/*" capture="environment"/>
      </label>
      <div class="thumbs">${thumbs || `<p class="empty tight">まだ写真がありません</p>`}</div>
      <p class="muted tiny">枚数: ${n}${n >= 1 ? " ✓" : ""}</p>
      ${n >= 1 && (!o.height || !o.width) ? `<button type="button" class="btn secondary jump" data-act="jump-size">次へ：寸法を入力</button>` : ""}
    </section>
    <section class="block" id="sec-size">
      <h2>寸法 <span class="req">${
        numOk(o.height) && numOk(o.width) && (o.kind !== "window" || numOk(o.sill)) ? "完了✓" : "必須"
      }</span></h2>
      <div class="dims">
        <label class="field">縦（cm）
          <input id="height" class="input num ${numError(o.height) ? "invalid" : ""}" inputmode="decimal" value="${esc(o.height)}">
          ${fieldErr("height", o.height)}
        </label>
        <label class="field">横（cm）
          <input id="width" class="input num ${numError(o.width) ? "invalid" : ""}" inputmode="decimal" value="${esc(o.width)}">
          ${fieldErr("width", o.width)}
        </label>
      </div>
      ${
        o.kind === "window"
          ? `<label class="field">床からの高さ（cm）
              <input id="sill" class="input num ${numError(o.sill) ? "invalid" : ""}" inputmode="decimal" value="${esc(o.sill)}">
              ${fieldErr("sill", o.sill)}
            </label>`
          : ""
      }
    </section>
    <section class="block">
      <h2>素材 <span class="req">${o.material && (o.material !== "その他" || o.materialOther) ? "完了✓" : "必須"}</span></h2>
      <div class="chips">${chips}</div>
      ${
        o.material === "その他"
          ? `<label class="field">具体的に<input id="materialOther" class="input" value="${esc(o.materialOther)}"></label>`
          : ""
      }
    </section>
    <section class="block">
      <h2>メモ <span class="optional">任意</span></h2>
      <textarea id="note" class="input area" rows="3" placeholder="例: 玄関南・引き戸／破損あり">${esc(o.note)}</textarea>
    </section>
    <section class="block danger-inline">
      <button type="button" class="btn danger quiet-danger" data-act="delete-opening">この建具を削除</button>
    </section>
  </div>
  ${stickyBackBar(nextCta, nextAct)}`;
}

function exportView() {
  const o = openingProgress(state.openings, state.counts);
  const photos = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const incomplete = state.openings.filter(
    (x) => !isOpeningDone(x, state.counts[`opening:${x.id}`] || 0)
  );
  return `<header class="app-header row sticky-top">
    ${backBtn("‹ 戻る")}
    <h1>ZIP書き出し</h1>
  </header>
  <ul class="summary">
    <li>建具 ${o.done}/${o.total} 完了</li>
    <li>写真 合計 ${photos}枚</li>
  </ul>
  ${
    incomplete.length
      ? `<p class="warn">未完了: ${incomplete.map((x) => x.id).join(", ")}（途中バックアップも可）</p>`
      : o.total
        ? `<p class="ok">一通り埋まっています。</p>`
        : `<p class="muted">まだ建具がありません。一覧で追加してください。</p>`
  }
  <div class="banner warn">次の画面で「ファイルに保存」などを選ぶまで、端末には残りません。</div>
  ${state.exportHint ? `<div class="banner ok">${esc(state.exportHint)}</div>` : ""}
  <p class="muted tiny">番号フォルダと建具.csv が入ります。</p>
  <button type="button" class="btn primary" data-act="do-export" ${o.total ? "" : "disabled"}>ZIPを作成して保存画面を開く</button>
  <div class="sticky-bar single">
    <button type="button" class="btn secondary" data-act="home">‹ 一覧へ戻る</button>
  </div>`;
}

function render() {
  const app = $("#app");
  let html = "";
  if (state.view === "gate") html = gateView();
  else if (state.view === "home") html = homeView();
  else if (state.view === "opening") html = openingView();
  else if (state.view === "export") html = exportView();
  const toastHtml = state.toast
    ? `<div class="toast">${esc(state.toast)}${
        state.toastAction
          ? ` <button type="button" class="toast-act" data-act="${esc(state.toastAction.act)}" data-id="${esc(
              state.toastAction.id || ""
            )}">${esc(state.toastAction.label)}</button>`
          : ""
      }</div>`
    : "";
  app.innerHTML = html + toastHtml;
  app.classList.toggle("has-sticky-bar", state.view === "opening" || state.view === "export");
  bind();
  if (state.view === "gate") $("#phrase")?.focus();
  state.appear = false;
}

function revokeThumbs() {
  for (const t of state.thumbs) URL.revokeObjectURL(t.url);
  state.thumbs = [];
}

async function loadThumbs(ownerId) {
  revokeThumbs();
  const photos = await photosFor("opening", ownerId);
  state.thumbs = photos.map((p) => ({ id: p.id, url: URL.createObjectURL(p.blob) }));
}

async function openOpening(id, { fromPop = false } = {}) {
  await flushSave();
  state.view = "opening";
  state.openingId = id;
  state.appear = true;
  await loadThumbs(id);
  render();
  if (!fromPop) syncHistory("opening");
}

function currentOpening() {
  return state.openings.find((x) => x.id === state.openingId);
}

async function readOpeningFieldsInto(o) {
  if (!o) return;
  const width = $("#width");
  const height = $("#height");
  const sill = $("#sill");
  const note = $("#note");
  const materialOther = $("#materialOther");
  if (width) o.width = width.value.trim();
  if (height) o.height = height.value.trim();
  if (sill) o.sill = sill.value.trim();
  if (note) o.note = note.value.trim();
  if (materialOther) o.materialOther = materialOther.value.trim();
}

async function saveOpeningFields() {
  const o = currentOpening();
  if (!o) return;
  await readOpeningFieldsInto(o);
  try {
    await dbPut("openings", o);
    state.saveStatus = "保存済み";
    state.saveFailed = false;
  } catch (err) {
    console.error(err);
    state.saveStatus = "保存失敗";
    state.saveFailed = true;
    toast("保存に失敗しました。再試行してください");
    throw err;
  }
}

function scheduleSave() {
  state.saveStatus = "保存中…";
  const el = document.querySelector("[data-save]");
  if (el) el.textContent = state.saveStatus;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveOpeningFields()
      .then(() => {
        if (state.view === "opening") {
          // soft refresh status texts without full wipe of focus if possible
          const missEl = document.querySelector(".banner.warn, .banner.ok");
          const o = currentOpening();
          if (o && missEl) {
            const n = state.counts[`opening:${o.id}`] || 0;
            const miss = missingFields(o, n);
            if (miss.length) {
              missEl.className = "banner warn";
              missEl.textContent = `未入力: ${miss.join("・")}`;
            } else {
              missEl.className = "banner ok";
              missEl.textContent = `✓ ${o.id} の入力は揃っています`;
            }
          }
          const headerStatus = document.querySelector(".header-title .muted");
          if (headerStatus && o) {
            headerStatus.textContent = `${o.kind === "door" ? "ドア" : "窓"} · ${statusOfOpening(o)} · ${state.saveStatus}`;
          }
          for (const id of ["height", "width", "sill"]) {
            const input = document.getElementById(id);
            const err = document.getElementById(`${id}-err`);
            if (!input || !err) continue;
            const msg = numError(input.value.trim());
            input.classList.toggle("invalid", !!msg);
            if (msg) {
              err.hidden = false;
              err.textContent = msg;
            } else {
              err.hidden = true;
              err.textContent = "";
            }
          }
        }
        const node = document.querySelector("[data-save]");
        if (node) {
          node.textContent = state.saveStatus;
          node.classList.toggle("fail", state.saveFailed);
        }
      })
      .catch(() => {
        render();
      });
  }, 350);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (state.view === "opening") await saveOpeningFields().catch(() => {});
}

async function createOpening(kind) {
  await flushSave();
  const prefix = kind === "door" ? "D" : "W";
  const id = nextId(state.openings, prefix);
  const opening = {
    id,
    kind,
    order: state.openings.length + 1,
    createdAt: Date.now(),
    width: "",
    height: "",
    sill: "",
    material: "",
    materialOther: "",
    note: ""
  };
  await dbPut("openings", opening);
  await refresh();
  clearTimeout(undoTimer);
  toast(`${id} を追加しました`, { act: "undo-add", id, label: "取り消す" }, 5000);
  undoTimer = setTimeout(() => {
    state.toastAction = null;
  }, 5000);
  await openOpening(id);
}

async function tryUnlock() {
  const phrase = $("#phrase")?.value || "";
  if (!(await checkPhrase(phrase))) {
    state.gateError = "合言葉が違います";
    render();
    return;
  }
  unlock();
  state.gateError = "";
  await bootApp();
}

function bind() {
  const app = $("#app");
  app.onclick = async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === "unlock") await tryUnlock();
      else if (act === "home" || act === "done-home") {
        if (act === "done-home") {
          await flushSave();
          const o = currentOpening();
          if (o) toast(`${o.id} を保存しました`);
        }
        await goHome();
      } else if (act === "retry-save") {
        await saveOpeningFields();
        render();
        toast("保存しました");
      } else if (act === "jump-size") {
        document.getElementById("sec-size")?.scrollIntoView({ behavior: "smooth", block: "start" });
        $("#height")?.focus();
      } else if (act === "open-opening") await openOpening(btn.dataset.id);
      else if (act === "add-window") await createOpening("window");
      else if (act === "add-door") await createOpening("door");
      else if (act === "undo-add") {
        const id = btn.dataset.id;
        clearTimeout(toastTimer);
        state.toast = "";
        state.toastAction = null;
        await deleteOpening(id);
        revokeThumbs();
        await refresh();
        state.view = "home";
        state.openingId = null;
        toast(`${id} を取り消しました`);
        render();
        syncHistory("home");
      } else if (act === "export") {
        await flushSave();
        state.view = "export";
        state.exportHint = "";
        render();
        syncHistory("export");
      } else if (act === "mat") {
        await flushSave();
        const o = currentOpening();
        if (!o) return;
        o.material = btn.dataset.mat;
        try {
          await dbPut("openings", o);
          state.saveStatus = "保存済み";
          state.saveFailed = false;
        } catch (err) {
          console.error(err);
          state.saveFailed = true;
          state.saveStatus = "保存失敗";
        }
        render();
      } else if (act === "del-photo") {
        if (!confirm("この写真を削除しますか？")) return;
        await deletePhoto(Number(btn.dataset.pid));
        await refresh();
        await loadThumbs(state.openingId);
        render();
      } else if (act === "delete-opening") {
        const o = currentOpening();
        if (!o) return;
        if (!confirm(`${o.id} と写真を削除しますか？この操作は取り消せません。`)) return;
        await flushSave();
        await deleteOpening(o.id);
        revokeThumbs();
        await refresh();
        state.view = "home";
        state.openingId = null;
        toast(`${o.id} を削除しました`);
        render();
        syncHistory("home");
      } else if (act === "do-export") {
        btn.disabled = true;
        btn.textContent = "作成中…";
        try {
          const photos = await allPhotos();
          const blob = await buildZip({
            openings: state.openings,
            photos,
            meta: {
              appVersion: APP_VERSION,
              schemaVersion: SCHEMA_VERSION
            }
          });
          const stamp = new Date().toISOString().slice(0, 10);
          downloadBlob(blob, `tsushima-tategu-${stamp}.zip`);
          const now = new Date();
          state.lastExportAt = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(
            now.getMinutes()
          ).padStart(2, "0")}`;
          try {
            localStorage.setItem("tategu-last-export", state.lastExportAt);
          } catch {
            /* ignore */
          }
          state.exportHint = "保存画面を開きました。Filesなどで保存できたか確認してください。";
          toast("次の画面で保存を完了してください");
          render();
        } catch (err) {
          console.error(err);
          toast("ZIPの作成に失敗しました。容量を確認して再試行してください");
          btn.disabled = false;
          btn.textContent = "ZIPを作成して保存画面を開く";
        }
      } else if (act === "lock") {
        lock();
        state.view = "gate";
        state.gateError = "";
        render();
      } else if (act === "wipe") {
        const oc = state.openings.length;
        const pc = Object.values(state.counts).reduce((a, b) => a + b, 0);
        if (
          !confirm(
            `建具 ${oc} 件・写真 ${pc} 枚を完全に削除します。元に戻せません。\n先にZIPバックアップを取りましたか？`
          )
        ) {
          return;
        }
        if (!confirm("本当に全消去しますか？")) return;
        await clearAll();
        await ensureSchema();
        await refresh();
        state.view = "home";
        state.lastExportAt = "";
        toast("すべて消去しました");
        render();
      }
    } catch (err) {
      console.error(err);
      toast(err?.message?.includes("Quota") ? "容量不足の可能性があります" : "エラーが起きました。もう一度試してください");
    }
  };

  app.onsubmit = async (e) => {
    e.preventDefault();
    if (state.view === "gate") await tryUnlock();
  };

  app.oninput = (e) => {
    if (!e.target.matches("input, textarea, select")) return;
    if (state.view === "opening") scheduleSave();
  };

  app.onchange = async (e) => {
    if (e.target.id !== "cam" || !e.target.files?.[0]) return;
    await flushSave();
    const file = e.target.files[0];
    try {
      const blob = await compressImage(file);
      await addPhoto("opening", state.openingId, blob);
      await refresh();
      await loadThumbs(state.openingId);
      toast("写真を保存しました");
      render();
    } catch (err) {
      console.error(err);
      toast("写真を保存できませんでした（容量不足の可能性）。枚数を減らして再試行してください");
    }
  };
}

async function updateOfflineReady() {
  if (!("serviceWorker" in navigator)) {
    state.offlineReady = location.protocol === "http:";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      state.offlineReady = false;
      return;
    }
    const cache = await caches.open("tategu-photos-v5");
    const need = ["./", "./index.html", "./js/app.js", "./css/app.css"];
    const ok = await Promise.all(need.map((u) => cache.match(u)));
    state.offlineReady = ok.every(Boolean);
  } catch {
    state.offlineReady = false;
  }
}

async function bootApp() {
  const { migrated } = await ensureSchema();
  await refresh();
  await updateOfflineReady();
  try {
    state.lastExportAt = localStorage.getItem("tategu-last-export") || "";
  } catch {
    state.lastExportAt = "";
  }
  state.view = "home";
  render();
  historySyncing = true;
  history.replaceState({ view: "home" }, "", "#/");
  historySyncing = false;
  if (migrated) {
    toast("リスト版に更新しました（データは空から開始）");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});

window.addEventListener("popstate", async () => {
  if (state.view === "gate") return;
  historySyncing = true;
  const hash = location.hash || "#/";
  try {
    if (hash.startsWith("#/o/")) {
      const id = decodeURIComponent(hash.slice(4));
      if (state.openings.some((o) => o.id === id)) await openOpening(id, { fromPop: true });
      else await goHome({ fromPop: true });
    } else if (hash === "#/export") {
      await flushSave();
      state.view = "export";
      render();
    } else {
      await goHome({ fromPop: true });
    }
  } finally {
    historySyncing = false;
  }
});

async function main() {
  const local = ["127.0.0.1", "localhost"].includes(location.hostname);
  if ("serviceWorker" in navigator) {
    if (local) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      state.offlineReady = true;
    } else {
      try {
        await navigator.serviceWorker.register("./sw.js");
        await updateOfflineReady();
      } catch (err) {
        console.warn(err);
      }
    }
  }
  if (!isUnlocked()) {
    state.view = "gate";
    render();
    return;
  }
  await bootApp();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("app").innerHTML =
    "<p>読み込みに失敗しました。通信できる場所でもう一度開いてください。</p>";
});
