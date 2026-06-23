/* =====================================================================
 * 廠商資料夾預審與歸檔 — 前端邏輯 v2
 * 對應後端：Module 8（掃描）+ Module 9（過濾/AI/執行）+ WebApp_API.gs
 * v2 變更：6 步進度條、一鍵跑到審查、審查清單可排序/搜尋/篩選/批次操作/即時統計、重複偵測
 *
 * 連線方式：fetch POST，body 送 JSON 字串、不加自訂 header（避 CORS 預檢；GAS 端照樣 JSON.parse）
 * 本檔放在自己網站（GitHub Pages），不是 claude.ai artifact，可正常用 localStorage。
 * ===================================================================== */
"use strict";

const $ = (id) => document.getElementById(id);
const LS_KEY = "tkb_inv_cfg";

/* ---------- 設定存取 ---------- */
function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    ["apiUrl","vendorId","vendorCode","sourceUrl","rootUrl"].forEach(k => { if (c[k]) $(k).value = c[k]; });
  } catch (e) {}
}
function saveCfg() {
  if (!$("remember").checked) return;
  const c = {};
  ["apiUrl","vendorId","vendorCode","sourceUrl","rootUrl"].forEach(k => c[k] = $(k).value.trim());
  localStorage.setItem(LS_KEY, JSON.stringify(c));
}
const cfg = {
  apiUrl:     () => $("apiUrl").value.trim(),
  vendorId:   () => $("vendorId").value.trim(),
  vendorCode: () => $("vendorCode").value.trim(),
  sourceUrl:  () => $("sourceUrl").value.trim(),
  rootUrl:    () => $("rootUrl").value.trim(),
};

/* ---------- API ---------- */
async function api(payload) {
  const url = cfg.apiUrl();
  if (!url) throw new Error("請先填 API URL");
  saveCfg();
  const res = await fetch(url, { method: "POST", body: JSON.stringify(payload), redirect: "follow" });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error("回傳不是 JSON（部署權限或網址有誤）：" + text.slice(0, 200)); }
}

/* ---------- 小工具 ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const show  = (el) => el && el.classList.remove("collapsed");
const hide  = (el) => el && el.classList.add("collapsed");
function setStatus(el, html, cls){ el.innerHTML = cls ? `<span class="${cls}">${html}</span>` : html; }
function setBusy(el, txt){ el.innerHTML = `<span class="spin"></span>${txt}`; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function summarize(d){
  const map = { copied:"複製", shortcut:"捷徑", failed:"失敗", remaining:"剩", processed:"已處理", exclude:"排除", ai_review:"待AI", total:"總計" };
  const parts = [];
  Object.keys(map).forEach(k => { if (typeof d[k] === "number") parts.push(map[k] + " " + d[k]); });
  return parts.length ? parts.join("／") : JSON.stringify(d);
}
function isDone(d){
  if (d.paused === true) return false;
  if (d.done === true) return true;
  if (d.done === false) return false;
  if (typeof d.remaining === "number") return d.remaining === 0;
  if (typeof d.message === "string" && /完成|已完成|done/i.test(d.message)) return true;
  return true;
}

/* ---------- 進度條 ---------- */
function setStep(n, state){ // state: 'active' | 'done' | ''
  const el = document.querySelector(`.step[data-step="${n}"]`);
  if (!el) return;
  el.classList.remove("active","done");
  if (state) el.classList.add(state);
}
function markCardDone(id){ const c = $(id); if (c) c.classList.add("done"); }

/* ---------- 通用分批 pump ---------- */
async function pump(firstPayload, loopPayload, ctx){
  loopPayload = loopPayload || firstPayload;
  const { statusEl, moreBtn, autoEl, label } = ctx;
  let first = true;
  setBusy(statusEl, label + "中…");
  try {
    while (true) {
      const d = await api(first ? firstPayload : loopPayload);
      first = false;
      if (!d || d.success === false) { setStatus(statusEl, "✗ " + ((d && d.error) || "失敗"), "bad"); if (moreBtn) show(moreBtn); return d; }
      const done = isDone(d);
      setStatus(statusEl, (done ? "✓ " : "⏸ ") + (d.message || summarize(d)), done ? "ok" : "warn");
      if (ctx.onEachDone) ctx.onEachDone(d);
      if (done) { if (moreBtn) hide(moreBtn); return d; }
      if (autoEl && autoEl.checked) { await sleep(900); continue; }
      if (moreBtn) show(moreBtn);
      return d;
    }
  } catch (e) { setStatus(statusEl, "✗ " + e.message, "bad"); if (moreBtn) show(moreBtn); }
}

function requireBasics(){
  if (!cfg.apiUrl())   { alert("請先填 API URL"); return false; }
  if (!cfg.vendorId()) { alert("請先填廠商 ID"); return false; }
  return true;
}

/* ===================================================================
 * 一鍵：過濾 → 命名 → 載入審查
 * =================================================================== */
$("btnAuto").addEventListener("click", async () => {
  if (!requireBasics()) return;
  if (!cfg.vendorCode()) { alert("AI 命名需要廠商代號（vendorCode）"); return; }
  const btn = $("btnAuto"); btn.disabled = true;
  try {
    // 2 過濾
    setStep(2, "active"); setBusy($("stAuto"), "① 過濾中…");
    const f = await api({ action: "inv_filter", vendorId: cfg.vendorId() });
    if (f.success === false) { setStatus($("stAuto"), "✗ 過濾失敗：" + f.error, "bad"); return; }
    showFilterPills(f); markCardDone("card2"); setStep(2, "done");

    // 3 AI 命名（自動連續到完成）
    setStep(3, "active");
    while (true) {
      setBusy($("stAuto"), "② AI 命名中…（自動連續）");
      const a = await api({ action: "inv_analyze", vendorId: cfg.vendorId(), vendorCode: cfg.vendorCode() });
      if (a.success === false) { setStatus($("stAuto"), "✗ AI 命名失敗：" + a.error, "bad"); return; }
      setStatus($("st3"), (isDone(a)?"✓ ":"⏸ ") + (a.message || summarize(a)), isDone(a)?"ok":"warn");
      if (isDone(a)) break;
      await sleep(900);
    }
    markCardDone("card3"); setStep(3, "done");

    // 4 載入審查
    setBusy($("stAuto"), "③ 載入審查清單…");
    await loadReview();
    setStatus($("stAuto"), "✓ 已跑到審查。請在下方第 4 步檢查、勾選、儲存確認。", "ok");
    $("card4").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { setStatus($("stAuto"), "✗ " + e.message, "bad"); }
  finally { btn.disabled = false; }
});

/* ===================================================================
 * 步驟 1：掃描
 * =================================================================== */
$("btnScan").addEventListener("click", () => {
  if (!requireBasics()) return;
  if (!cfg.sourceUrl()) { alert("請先填廠商唯讀來源資料夾 URL"); return; }
  setStep(1, "active");
  pump(
    { action: "inv_startScan", vendorId: cfg.vendorId(), vendorCode: cfg.vendorCode(), sourceFolderUrl: cfg.sourceUrl() },
    { action: "inv_scanBatch", vendorId: cfg.vendorId() },
    { statusEl: $("st1"), moreBtn: $("btnScanMore"), autoEl: $("autoScan"), label: "掃描",
      onEachDone: (d) => { if (isDone(d)) { markCardDone("card1"); setStep(1, "done"); } } }
  );
});
$("btnScanMore").addEventListener("click", () => {
  pump({ action: "inv_scanBatch", vendorId: cfg.vendorId() }, null,
    { statusEl: $("st1"), moreBtn: $("btnScanMore"), autoEl: $("autoScan"), label: "掃描",
      onEachDone: (d) => { if (isDone(d)) { markCardDone("card1"); setStep(1, "done"); } } });
});
$("btnScanProg").addEventListener("click", async () => {
  setBusy($("st1"), "查詢中…");
  try { const d = await api({ action: "inv_scanProgress", vendorId: cfg.vendorId() });
    setStatus($("st1"), (d.message || summarize(d)), d.success === false ? "bad" : ""); }
  catch (e) { setStatus($("st1"), "✗ " + e.message, "bad"); }
});

/* ===================================================================
 * 步驟 2：過濾
 * =================================================================== */
function showFilterPills(d){
  $("pills2").innerHTML =
    `<span class="pill copy">真複製（含關鍵影音） 待AI ${d.ai_review ?? 0}</span>` +
    `<span class="pill sc">捷徑（影音／圖片） ${d.shortcut ?? 0}</span>` +
    `<span class="pill ex">排除 ${d.exclude ?? 0}</span>` +
    `<span class="pill">總處理 ${d.total ?? 0}</span>`;
}
$("btnFilter").addEventListener("click", async () => {
  if (!requireBasics()) return;
  setStep(2, "active"); setBusy($("st2"), "過濾中…"); $("pills2").innerHTML = "";
  try {
    const d = await api({ action: "inv_filter", vendorId: cfg.vendorId() });
    if (d.success === false) { setStatus($("st2"), "✗ " + d.error, "bad"); return; }
    setStatus($("st2"), "✓ " + (d.message || "過濾完成"), "ok");
    showFilterPills(d); markCardDone("card2"); setStep(2, "done");
  } catch (e) { setStatus($("st2"), "✗ " + e.message, "bad"); }
});

/* ===================================================================
 * 步驟 3：AI 命名
 * =================================================================== */
function runAI(){
  if (!requireBasics()) return;
  if (!cfg.vendorCode()) { alert("AI 命名需要廠商代號（vendorCode）"); return; }
  setStep(3, "active");
  const p = { action: "inv_analyze", vendorId: cfg.vendorId(), vendorCode: cfg.vendorCode() };
  pump(p, p, { statusEl: $("st3"), moreBtn: $("btnAIMore"), autoEl: $("autoAI"), label: "AI 命名",
    onEachDone: (d) => { if (isDone(d)) { markCardDone("card3"); setStep(3, "done"); } } });
}
$("btnAI").addEventListener("click", runAI);
$("btnAIMore").addEventListener("click", runAI);

/* ===================================================================
 * 步驟 4：審查清單（資料驅動：reviewItems 為真實來源，DOM 只反映）
 * =================================================================== */
const ACTION_LABEL = { ai_review: "複製", shortcut: "捷徑", exclude: "略過" };
const CONF_RANK = { high: 3, medium: 2, low: 1, "": 0 };
let reviewItems = [];          // 每筆含 _checked / _action / _name / _dest
let sortKey = "conf", sortDir = "asc";

function actionSelectHtml(current){
  return ["ai_review","shortcut","exclude"].map(x =>
    `<option value="${x}"${x===current?" selected":""}>${ACTION_LABEL[x]}</option>`).join("");
}
function confHtml(c){
  if (!c) return "";
  const cls = c==="high" ? "conf-high" : (c==="medium" ? "conf-medium" : "conf-low");
  return `<span class="${cls}">${esc(c)}</span>`;
}

function visibleItems(){
  const kw = $("searchBox").value.trim().toLowerCase();
  const fa = $("filterAction").value;
  let list = reviewItems.filter(it => {
    if (fa && it._action !== fa) return false;
    if (kw) {
      const hay = (String(it.originalName) + " " + String(it.originalPath)).toLowerCase();
      if (hay.indexOf(kw) === -1) return false;
    }
    return true;
  });
  const dir = sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let va, vb;
    switch (sortKey) {
      case "size": va = a.sizeBytes||0; vb = b.sizeBytes||0; break;
      case "conf": va = CONF_RANK[a.confidence]||0; vb = CONF_RANK[b.confidence]||0; break;
      case "action": va = a._action||""; vb = b._action||""; break;
      case "dest": va = (a._dest||"").toLowerCase(); vb = (b._dest||"").toLowerCase(); break;
      default: va = (a.originalName||"").toLowerCase(); vb = (b.originalName||"").toLowerCase();
    }
    if (va < vb) return -1*dir; if (va > vb) return 1*dir; return 0;
  });
  return list;
}

function renderTable(){
  const list = visibleItems();
  const body = $("reviewBody");
  body.innerHTML = list.map(it =>
    `<tr data-row="${it.rowIndex}">` +
      `<td><input type="checkbox" class="rchk"${it._checked?" checked":""}></td>` +
      `<td><select class="ract">${actionSelectHtml(it._action)}</select></td>` +
      `<td><div>${esc(it.originalName)}</div><div class="src">${esc(it.originalPath)}</div>` +
        (it.aiReason ? `<div class="src" title="${esc(it.aiReason)}">🤖 ${esc(it.aiReason).slice(0,60)}</div>` : "") +
        `<div class="src">規則 ${esc(it.matchedRule)}</div></td>` +
      `<td><input type="text" class="rname" value="${esc(it._name)}"></td>` +
      `<td><input type="text" class="rdest" value="${esc(it._dest)}"></td>` +
      `<td>${esc(it.sizeText)}</td>` +
      `<td>${confHtml(it.confidence)}</td>` +
    `</tr>`).join("");
  // 排序箭頭
  document.querySelectorAll("th.sortable").forEach(th => {
    th.classList.remove("sorted");
    const a = th.querySelector(".arr"); if (a) a.textContent = "↕";
    if (th.dataset.sort === sortKey) { th.classList.add("sorted"); if (a) a.textContent = sortDir==="asc"?"↑":"↓"; }
  });
  $("count-shown") && ($("count-shown").textContent = list.length);
  updateSummary();
}

function updateSummary(){
  let copy=0, sc=0, skip=0;
  reviewItems.forEach(it => {
    if (!it._checked || it._action === "exclude") skip++;
    else if (it._action === "shortcut") sc++;
    else copy++;
  });
  const total = reviewItems.length;
  show($("reviewSummary"));
  $("reviewSummary").innerHTML =
    `清單共 <b>${total}</b> 筆（顯示 ${visibleItems().length}）　→　將處理：複製 <b>${copy}</b>、捷徑 <b>${sc}</b>；略過 <b>${skip}</b>`;
  $("btnConfirm").disabled = total === 0;
}

function detectDupes(){
  const byName = {};
  reviewItems.forEach(it => { const k = it.originalName; byName[k] = (byName[k]||0)+1; });
  const dup = Object.keys(byName).filter(k => byName[k] > 1);
  const box = $("dupeWarn");
  if (dup.length) {
    box.style.display = "block";
    box.innerHTML = `⚠ 偵測到 ${dup.length} 個檔名重複出現（可能掃描了多次）。建議先在 GAS 編輯器執行 ` +
      `<code>dedupeVendorInventory("${esc(cfg.vendorId())}")</code> 清掉重複列，再重新載入。`;
  } else { box.style.display = "none"; box.innerHTML = ""; }
}

async function loadReview(){
  if (!requireBasics()) return;
  setStep(4, "active"); setBusy($("st4"), "載入中…");
  try {
    const d = await api({ action: "inv_getList", vendorId: cfg.vendorId(), status: "待確認" });
    if (d.success === false) { setStatus($("st4"), "✗ " + d.error, "bad"); return; }
    let items = d.items || [];
    if ($("showExcluded").checked) {
      const d2 = await api({ action: "inv_getList", vendorId: cfg.vendorId(), status: "已排除" });
      if (d2.items) items = items.concat(d2.items);
    }
    // 套上編輯狀態
    reviewItems = items.map(it => ({
      ...it,
      _checked: it.status !== "已排除",
      _action:  it.status === "已排除" ? "exclude" : (it.filterResult || "ai_review"),
      _name:    it.confirmedName || it.suggestedName || it.originalName || "",
      _dest:    it.confirmedDest || it.suggestedDest || "",
    }));
    show($("tblWrap"));
    renderTable();
    detectDupes();
    setStatus($("st4"), reviewItems.length ? "" : "目前沒有待審項目（先跑過濾／AI 命名）", reviewItems.length ? "" : "warn");
  } catch (e) { setStatus($("st4"), "✗ " + e.message, "bad"); }
}
$("btnLoad").addEventListener("click", loadReview);
$("showExcluded").addEventListener("change", () => { if (!$("tblWrap").classList.contains("collapsed")) loadReview(); });

/* DOM 編輯 → 同步回 reviewItems（用事件委派） */
function findItem(rowIndex){ return reviewItems.find(it => String(it.rowIndex) === String(rowIndex)); }
$("reviewBody").addEventListener("change", (e) => {
  const tr = e.target.closest("tr"); if (!tr) return;
  const it = findItem(tr.dataset.row); if (!it) return;
  if (e.target.classList.contains("rchk"))  it._checked = e.target.checked;
  if (e.target.classList.contains("ract"))  it._action  = e.target.value;
  if (e.target.classList.contains("rname")) it._name    = e.target.value;
  if (e.target.classList.contains("rdest")) it._dest    = e.target.value;
  updateSummary();
});

/* 排序表頭 */
document.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => {
  const k = th.dataset.sort;
  if (sortKey === k) sortDir = (sortDir === "asc" ? "desc" : "asc");
  else { sortKey = k; sortDir = "asc"; }
  renderTable();
}));
/* 搜尋 / 篩選 */
$("searchBox").addEventListener("input", renderTable);
$("filterAction").addEventListener("change", renderTable);
/* 全選框 */
$("chkAll").addEventListener("change", (e) => { reviewItems.forEach(it => it._checked = e.target.checked); renderTable(); });
/* 批次 */
$("bulkAll").addEventListener("click", () => { reviewItems.forEach(it => it._checked = true); renderTable(); });
$("bulkNone").addEventListener("click", () => { reviewItems.forEach(it => it._checked = false); renderTable(); });
$("bulkUncheckLow").addEventListener("click", () => { reviewItems.forEach(it => { if (it.confidence === "low") it._checked = false; }); renderTable(); });
$("bulkCopy").addEventListener("click", () => { reviewItems.forEach(it => { if (it._checked) it._action = "ai_review"; }); renderTable(); });
$("bulkShortcut").addEventListener("click", () => { reviewItems.forEach(it => { if (it._checked) it._action = "shortcut"; }); renderTable(); });

/* 儲存確認 */
$("btnConfirm").addEventListener("click", async () => {
  if (!reviewItems.length) { alert("沒有可確認的項目"); return; }
  const confirmations = reviewItems.map(it => {
    let status, filterResult;
    if (!it._checked || it._action === "exclude") { status = "已排除"; filterResult = "exclude"; }
    else { status = "已確認"; filterResult = it._action; }
    return { rowIndex: it.rowIndex, confirmedName: it._name.trim(), confirmedDest: it._dest.trim(), filterResult, status };
  });
  setBusy($("st4"), "儲存中…");
  try {
    const d = await api({ action: "inv_confirm", confirmations });
    if (d.success === false) { setStatus($("st4"), "✗ " + d.error, "bad"); return; }
    const keep = confirmations.filter(c => c.status === "已確認").length;
    setStatus($("st4"), `✓ 已儲存 ${confirmations.length} 筆，其中 ${keep} 筆待執行`, "ok");
    markCardDone("card4"); setStep(4, "done");
  } catch (e) { setStatus($("st4"), "✗ " + e.message, "bad"); }
});

/* ===================================================================
 * 步驟 5：執行
 * =================================================================== */
function runExec(){
  if (!requireBasics()) return;
  if (!cfg.rootUrl()) { alert("請先填我方廠商根資料夾 URL"); return; }
  setStep(5, "active");
  const p = { action: "inv_execute", vendorId: cfg.vendorId(), ourVendorRootUrl: cfg.rootUrl() };
  pump(p, p, { statusEl: $("st5"), moreBtn: $("btnExecMore"), autoEl: $("autoExec"), label: "執行",
    onEachDone: (d) => { if (isDone(d)) { markCardDone("card5"); setStep(5, "done"); } } });
}
$("btnExec").addEventListener("click", runExec);
$("btnExecMore").addEventListener("click", runExec);

/* ===================================================================
 * 步驟 6：報告
 * =================================================================== */
const STATUS_PILL = { "已複製":"copy", "已建捷徑":"sc", "已排除":"ex", "失敗":"ex" };
$("btnReport").addEventListener("click", async () => {
  if (!requireBasics()) return;
  setStep(6, "active"); setBusy($("st6"), "統計中…"); $("pills6").innerHTML = ""; $("failsBox").innerHTML = "";
  try {
    const d = await api({ action: "inv_summary", vendorId: cfg.vendorId() });
    if (d.success === false) { setStatus($("st6"), "✗ " + d.error, "bad"); return; }
    const counts = d.counts || {};
    const order = ["已複製","已建捷徑","已排除","失敗","已確認","待確認","待AI","待過濾"];
    const keys = order.filter(k => counts[k]).concat(Object.keys(counts).filter(k => order.indexOf(k) === -1));
    $("pills6").innerHTML = keys.map(k => `<span class="pill ${STATUS_PILL[k]||""}">${esc(k)} ${counts[k]}</span>`).join("") +
      `<span class="pill">總計 ${d.total||0}</span>`;
    setStatus($("st6"), "✓ 報告完成（完整紀錄在 Vendor_Inventory 工作表）", "ok");
    markCardDone("card6"); setStep(6, "done");

    const fails = d.failures || [];
    if (fails.length) {
      let html = `<details class="fails" open><summary>失敗清單（${fails.length}）</summary>` +
        `<div class="tbl-wrap" style="max-height:280px;margin-top:8px"><table><thead><tr><th>名稱</th><th>目的夾</th><th>錯誤</th></tr></thead><tbody>`;
      fails.forEach(f => { html += `<tr><td>${esc(f.name)}<div class="src">${esc(f.path)}</div></td><td>${esc(f.dest)}</td><td class="bad">${esc(f.error)}</td></tr>`; });
      html += `</tbody></table></div></details>`;
      $("failsBox").innerHTML = html;
    }
  } catch (e) { setStatus($("st6"), "✗ " + e.message, "bad"); }
});

/* ---------- 初始化 ---------- */
loadCfg();
["apiUrl","vendorId","vendorCode","sourceUrl","rootUrl"].forEach(id => $(id).addEventListener("change", saveCfg));

/* ---------- embed bootstrap：由廠商系統 iframe 帶入設定（Route A） ----------
 * 只在 ?embed=1 時啟動，獨立使用完全不受影響。
 * 接在 loadCfg() 之後執行 → query 參數會覆蓋 localStorage 載入的舊值，
 * 並透過 dispatch change 觸發既有 saveCfg（記住設定）。
 * srcFolder 不一定帶（PM 在畫面手動貼 sourceUrl）。
 */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get("embed") !== "1") return;
  document.documentElement.classList.add("embed");
  const MAP = {
    apiUrl:     "apiUrl",      // API URL
    vendorId:   "vendorId",    // 廠商 ID
    vendorCode: "vendorCode",  // 廠商代號（AI 命名前綴）
    srcFolder:  "sourceUrl",   // 廠商唯讀來源資料夾
    dstFolder:  "rootUrl",     // 我方廠商根資料夾（歸檔目的地）
  };
  Object.entries(MAP).forEach(([param, id]) => {
    const v = q.get(param);
    const el = document.getElementById(id);
    if (!el || v == null || v === "") return;
    el.value = v;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
})();
