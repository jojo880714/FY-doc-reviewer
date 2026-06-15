/* =====================================================================
 * 廠商資料夾預審與歸檔 — 前端邏輯（獨立靜態站，呼叫 GAS /exec API）
 * 對應後端：Module 8（掃描）+ Module 9（過濾/AI/執行）+ WebApp_API.gs v3.8.0
 *
 * 連線方式：fetch POST，body 直接送 JSON 字串、不加自訂 header
 *           （讓 Content-Type 維持 text/plain，避開 CORS 預檢；GAS 端照樣 JSON.parse）
 * 本檔是放在你自己網站（如 GitHub Pages）的檔案，不是 claude.ai artifact，
 * 所以可以正常使用 localStorage 記住設定。
 * ===================================================================== */

"use strict";

const $ = (id) => document.getElementById(id);
const LS_KEY = "tkb_inv_cfg";

/* ---------- 設定存取 ---------- */
function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    if (c.apiUrl)     $("apiUrl").value     = c.apiUrl;
    if (c.vendorId)   $("vendorId").value   = c.vendorId;
    if (c.vendorCode) $("vendorCode").value = c.vendorCode;
    if (c.sourceUrl)  $("sourceUrl").value  = c.sourceUrl;
    if (c.rootUrl)    $("rootUrl").value    = c.rootUrl;
  } catch (e) { /* ignore */ }
}
function saveCfg() {
  if (!$("remember").checked) return;
  const c = {
    apiUrl:     $("apiUrl").value.trim(),
    vendorId:   $("vendorId").value.trim(),
    vendorCode: $("vendorCode").value.trim(),
    sourceUrl:  $("sourceUrl").value.trim(),
    rootUrl:    $("rootUrl").value.trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(c));
}

const cfg = {
  apiUrl:     () => $("apiUrl").value.trim(),
  vendorId:   () => $("vendorId").value.trim(),
  vendorCode: () => $("vendorCode").value.trim(),
  sourceUrl:  () => $("sourceUrl").value.trim(),
  rootUrl:    () => $("rootUrl").value.trim(),
};

/* ---------- API 呼叫 ---------- */
async function api(payload) {
  const url = cfg.apiUrl();
  if (!url) throw new Error("請先填 API URL");
  saveCfg();
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error("回傳不是 JSON（可能部署權限或網址有誤）：" + text.slice(0, 200)); }
  return data;
}

/* ---------- 小工具 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show  = (el) => el && el.classList.remove("collapsed");
const hide  = (el) => el && el.classList.add("collapsed");

function setStatus(el, html, cls) {
  el.innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
}
function setBusy(el, txt) {
  el.innerHTML = `<span class="spin"></span>${txt}`;
}
function summarize(d) {
  const parts = [];
  const map = {
    copied: "複製", shortcut: "捷徑", failed: "失敗", remaining: "剩",
    processed: "已處理", exclude: "排除", ai_review: "待AI", total: "總計",
  };
  Object.keys(map).forEach((k) => {
    if (typeof d[k] === "number") parts.push(map[k] + " " + d[k]);
  });
  return parts.length ? parts.join("／") : JSON.stringify(d);
}
/** 判斷一個分批回傳是否「做完了」 */
function isDone(d) {
  if (d.paused === true) return false;
  if (d.done === true) return true;
  if (d.done === false) return false;
  if (typeof d.remaining === "number") return d.remaining === 0;
  if (typeof d.message === "string" && /完成|已完成|done/i.test(d.message)) return true;
  return true; // 單次型（如過濾）視為完成
}

/* ---------- 通用分批 pump ---------- */
/**
 * @param firstPayload 第一次呼叫
 * @param loopPayload  續跑時呼叫（不給=同 firstPayload）
 * @param ctx {statusEl, moreBtn, autoEl, label, onEachDone}
 */
async function pump(firstPayload, loopPayload, ctx) {
  loopPayload = loopPayload || firstPayload;
  const { statusEl, moreBtn, autoEl, label } = ctx;
  let first = true;
  setBusy(statusEl, label + "中…");
  try {
    while (true) {
      const payload = first ? firstPayload : loopPayload;
      first = false;
      const d = await api(payload);
      if (!d || d.success === false) {
        setStatus(statusEl, "✗ " + ((d && d.error) || "失敗"), "bad");
        if (moreBtn) show(moreBtn);
        return d;
      }
      const done = isDone(d);
      setStatus(statusEl, (done ? "✓ " : "⏸ ") + (d.message || summarize(d)), done ? "ok" : "warn");
      if (ctx.onEachDone) ctx.onEachDone(d);
      if (done) { if (moreBtn) hide(moreBtn); return d; }
      // 還沒做完
      if (autoEl && autoEl.checked) { await sleep(900); continue; }
      if (moreBtn) show(moreBtn);
      return d;
    }
  } catch (e) {
    setStatus(statusEl, "✗ " + e.message, "bad");
    if (moreBtn) show(moreBtn);
  }
}

/* ===================================================================
 * 步驟 1：掃描
 * =================================================================== */
function requireBasics() {
  if (!cfg.apiUrl())   { alert("請先填 API URL"); return false; }
  if (!cfg.vendorId()) { alert("請先填廠商 ID"); return false; }
  return true;
}

$("btnScan").addEventListener("click", () => {
  if (!requireBasics()) return;
  if (!cfg.sourceUrl()) { alert("請先填廠商唯讀來源資料夾 URL"); return; }
  pump(
    { action: "inv_startScan", vendorId: cfg.vendorId(), vendorCode: cfg.vendorCode(), sourceFolderUrl: cfg.sourceUrl() },
    { action: "inv_scanBatch", vendorId: cfg.vendorId() },
    { statusEl: $("st1"), moreBtn: $("btnScanMore"), autoEl: $("autoScan"), label: "掃描" }
  );
});
$("btnScanMore").addEventListener("click", () => {
  pump(
    { action: "inv_scanBatch", vendorId: cfg.vendorId() },
    null,
    { statusEl: $("st1"), moreBtn: $("btnScanMore"), autoEl: $("autoScan"), label: "掃描" }
  );
});
$("btnScanProg").addEventListener("click", async () => {
  setBusy($("st1"), "查詢中…");
  try {
    const d = await api({ action: "inv_scanProgress", vendorId: cfg.vendorId() });
    setStatus($("st1"), (d.message || summarize(d)), d.success === false ? "bad" : "");
  } catch (e) { setStatus($("st1"), "✗ " + e.message, "bad"); }
});

/* ===================================================================
 * 步驟 2：過濾
 * =================================================================== */
$("btnFilter").addEventListener("click", async () => {
  if (!requireBasics()) return;
  setBusy($("st2"), "過濾中…");
  $("pills2").innerHTML = "";
  try {
    const d = await api({ action: "inv_filter", vendorId: cfg.vendorId() });
    if (d.success === false) { setStatus($("st2"), "✗ " + d.error, "bad"); return; }
    setStatus($("st2"), "✓ " + (d.message || "過濾完成"), "ok");
    $("card2").classList.add("done");
    $("pills2").innerHTML =
      `<span class="pill copy">真複製（含關鍵影音） 待AI ${d.ai_review ?? 0}</span>` +
      `<span class="pill sc">捷徑（影音／圖片） ${d.shortcut ?? 0}</span>` +
      `<span class="pill ex">排除 ${d.exclude ?? 0}</span>` +
      `<span class="pill">總處理 ${d.total ?? 0}</span>`;
  } catch (e) { setStatus($("st2"), "✗ " + e.message, "bad"); }
});

/* ===================================================================
 * 步驟 3：AI 命名
 * =================================================================== */
$("btnAI").addEventListener("click", () => {
  if (!requireBasics()) return;
  if (!cfg.vendorCode()) { alert("AI 命名需要廠商代號（vendorCode）"); return; }
  const p = { action: "inv_analyze", vendorId: cfg.vendorId(), vendorCode: cfg.vendorCode() };
  pump(p, p, { statusEl: $("st3"), moreBtn: $("btnAIMore"), autoEl: $("autoAI"), label: "AI 命名",
               onEachDone: (d) => { if (isDone(d)) $("card3").classList.add("done"); } });
});
$("btnAIMore").addEventListener("click", () => {
  const p = { action: "inv_analyze", vendorId: cfg.vendorId(), vendorCode: cfg.vendorCode() };
  pump(p, p, { statusEl: $("st3"), moreBtn: $("btnAIMore"), autoEl: $("autoAI"), label: "AI 命名",
               onEachDone: (d) => { if (isDone(d)) $("card3").classList.add("done"); } });
});

/* ===================================================================
 * 步驟 4：審查清單
 * =================================================================== */
const ACTION_LABEL = { ai_review: "複製", shortcut: "捷徑", exclude: "略過" };

function actionSelect(current) {
  const v = ["ai_review", "shortcut", "exclude"];
  return `<select class="ract">` +
    v.map((x) => `<option value="${x}"${x === current ? " selected" : ""}>${ACTION_LABEL[x]}</option>`).join("") +
    `</select>`;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function confTag(c) {
  if (!c) return "";
  const cls = c === "high" ? "conf-high" : (c === "medium" ? "conf-medium" : "conf-low");
  return `<span class="${cls}">${esc(c)}</span>`;
}

function renderRows(items) {
  const body = $("reviewBody");
  body.innerHTML = "";
  items.forEach((it) => {
    const isExcluded = it.status === "已排除";
    const action = isExcluded ? "exclude" : (it.filterResult || "ai_review");
    const name = it.confirmedName || it.suggestedName || it.originalName || "";
    const dest = it.confirmedDest || it.suggestedDest || "";
    const tr = document.createElement("tr");
    tr.dataset.row = it.rowIndex;
    tr.innerHTML =
      `<td><input type="checkbox" class="rchk"${isExcluded ? "" : " checked"}></td>` +
      `<td>${actionSelect(action)}</td>` +
      `<td><div>${esc(it.originalName)}</div>` +
        `<div class="src">${esc(it.originalPath)}</div>` +
        (it.aiReason ? `<div class="src" title="${esc(it.aiReason)}">🤖 ${esc(it.aiReason).slice(0, 60)}</div>` : "") +
        `<div class="src">規則 ${esc(it.matchedRule)}</div></td>` +
      `<td><input type="text" class="rname" value="${esc(name)}"></td>` +
      `<td><input type="text" class="rdest" value="${esc(dest)}"></td>` +
      `<td>${esc(it.sizeText)}</td>` +
      `<td>${confTag(it.confidence)}</td>`;
    body.appendChild(tr);
  });
  $("reviewCount").textContent = `共 ${items.length} 筆`;
  show($("tblWrap"));
  $("btnConfirm").disabled = items.length === 0;
}

async function loadReview() {
  if (!requireBasics()) return;
  setBusy($("st4"), "載入中…");
  try {
    const d = await api({ action: "inv_getList", vendorId: cfg.vendorId(), status: "待確認" });
    if (d.success === false) { setStatus($("st4"), "✗ " + d.error, "bad"); return; }
    let items = d.items || [];
    if ($("showExcluded").checked) {
      const d2 = await api({ action: "inv_getList", vendorId: cfg.vendorId(), status: "已排除" });
      if (d2.items) items = items.concat(d2.items);
    }
    renderRows(items);
    setStatus($("st4"), items.length ? "" : "目前沒有待審項目（先跑過濾／AI 命名）", items.length ? "" : "warn");
  } catch (e) { setStatus($("st4"), "✗ " + e.message, "bad"); }
}
$("btnLoad").addEventListener("click", loadReview);
$("showExcluded").addEventListener("change", () => { if (!$("tblWrap").classList.contains("collapsed")) loadReview(); });

$("chkAll").addEventListener("change", (e) => {
  document.querySelectorAll("#reviewBody .rchk").forEach((c) => { c.checked = e.target.checked; });
});

$("btnConfirm").addEventListener("click", async () => {
  const rows = document.querySelectorAll("#reviewBody tr");
  if (!rows.length) { alert("沒有可確認的項目"); return; }
  const confirmations = [];
  rows.forEach((tr) => {
    const rowIndex = Number(tr.dataset.row);
    const checked = tr.querySelector(".rchk").checked;
    const action  = tr.querySelector(".ract").value;
    const name    = tr.querySelector(".rname").value.trim();
    const dest    = tr.querySelector(".rdest").value.trim();
    let status, filterResult;
    if (!checked || action === "exclude") { status = "已排除"; filterResult = "exclude"; }
    else { status = "已確認"; filterResult = action; }
    confirmations.push({ rowIndex, confirmedName: name, confirmedDest: dest, filterResult, status });
  });
  setBusy($("st4"), "儲存中…");
  try {
    const d = await api({ action: "inv_confirm", confirmations });
    if (d.success === false) { setStatus($("st4"), "✗ " + d.error, "bad"); return; }
    const keep = confirmations.filter((c) => c.status === "已確認").length;
    setStatus($("st4"), `✓ 已儲存 ${confirmations.length} 筆，其中 ${keep} 筆待執行`, "ok");
    $("card4").classList.add("done");
  } catch (e) { setStatus($("st4"), "✗ " + e.message, "bad"); }
});

/* ===================================================================
 * 步驟 5：執行
 * =================================================================== */
$("btnExec").addEventListener("click", () => {
  if (!requireBasics()) return;
  if (!cfg.rootUrl()) { alert("請先填我方廠商根資料夾 URL"); return; }
  const p = { action: "inv_execute", vendorId: cfg.vendorId(), ourVendorRootUrl: cfg.rootUrl() };
  pump(p, p, { statusEl: $("st5"), moreBtn: $("btnExecMore"), autoEl: $("autoExec"), label: "執行",
               onEachDone: (d) => { if (isDone(d)) $("card5").classList.add("done"); } });
});
$("btnExecMore").addEventListener("click", () => {
  const p = { action: "inv_execute", vendorId: cfg.vendorId(), ourVendorRootUrl: cfg.rootUrl() };
  pump(p, p, { statusEl: $("st5"), moreBtn: $("btnExecMore"), autoEl: $("autoExec"), label: "執行",
               onEachDone: (d) => { if (isDone(d)) $("card5").classList.add("done"); } });
});

/* ===================================================================
 * 步驟 6：報告
 * =================================================================== */
const STATUS_PILL = {
  "已複製": "copy", "已建捷徑": "sc", "已排除": "ex", "失敗": "ex",
  "待過濾": "", "待AI": "", "待確認": "", "已確認": "",
};
$("btnReport").addEventListener("click", async () => {
  if (!requireBasics()) return;
  setBusy($("st6"), "統計中…");
  $("pills6").innerHTML = "";
  $("failsBox").innerHTML = "";
  try {
    const d = await api({ action: "inv_summary", vendorId: cfg.vendorId() });
    if (d.success === false) { setStatus($("st6"), "✗ " + d.error, "bad"); return; }
    const counts = d.counts || {};
    const order = ["已複製", "已建捷徑", "已排除", "失敗", "已確認", "待確認", "待AI", "待過濾"];
    const keys = order.filter((k) => counts[k]).concat(Object.keys(counts).filter((k) => order.indexOf(k) === -1));
    $("pills6").innerHTML = keys.map((k) =>
      `<span class="pill ${STATUS_PILL[k] || ""}">${esc(k)} ${counts[k]}</span>`).join("") +
      `<span class="pill">總計 ${d.total || 0}</span>`;
    setStatus($("st6"), "✓ 報告完成（完整紀錄在 Vendor_Inventory 工作表）", "ok");

    const fails = d.failures || [];
    if (fails.length) {
      let html = `<details class="fails" open><summary>失敗清單（${fails.length}）</summary>`;
      html += `<div class="tbl-wrap" style="max-height:280px;margin-top:8px"><table><thead><tr>` +
              `<th>名稱</th><th>目的夾</th><th>錯誤</th></tr></thead><tbody>`;
      fails.forEach((f) => {
        html += `<tr><td>${esc(f.name)}<div class="src">${esc(f.path)}</div></td>` +
                `<td>${esc(f.dest)}</td><td class="bad">${esc(f.error)}</td></tr>`;
      });
      html += `</tbody></table></div></details>`;
      $("failsBox").innerHTML = html;
    }
  } catch (e) { setStatus($("st6"), "✗ " + e.message, "bad"); }
});

/* ---------- 初始化 ---------- */
loadCfg();
["apiUrl", "vendorId", "vendorCode", "sourceUrl", "rootUrl"].forEach((id) =>
  $(id).addEventListener("change", saveCfg));
