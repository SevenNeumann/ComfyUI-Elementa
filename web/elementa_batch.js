// AFBL — Auto Folder Batch Loader. UI: file grid/list, toolbar, progress bar.
// Integration scheme (beforeRegisterNodeDef + onNodeCreated + app.queuePrompt hook) follows sequential-image-loader.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "Elementa_BatchLoader";
const LAST_DIR_KEY = "Elementa.lastDir";
const LEGACY_DIR_KEY = "BatchTools.lastDir";       // pre-rename key, read once as a fallback
const ACCENT_KEY = "BatchTools.accent";          // legacy (single accent) - migrated
const SCHEME_KEY = "Elementa.scheme";            // {acc, ok}
const LEGACY_SCHEME_KEY = "BatchTools.scheme";
// A scheme is a PAIR: accent (buttons, hover, "queued" tint, progress) + OK colour (current / sent / finished)
const SCHEMES = [
    ["Blue / Green",   "#0b8ae8", "#3fb27f"],
    ["Violet / Lime",  "#9b7bff", "#9bd13f"],
    ["Teal / Orange",  "#2bb5c9", "#f59a5a"],
    ["Pink / Mint",    "#e56aa8", "#4fd1a5"],
    ["Amber / Sky",    "#f0a030", "#4aa8ff"],
    ["Indigo / Gold",  "#5b6cff", "#f0c040"],
];
const DEFAULT_SCHEME = { acc: SCHEMES[0][1], ok: SCHEMES[0][2] };
const HEX = /^#[0-9a-f]{6}$/i;
const C_RED = "#e5534b";
const SLOT_ROW = 20;

// ---------- icons (lucide style) ----------
const ICONS = {
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    snowflake: '<path d="M2 12h20M12 2v20"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    prev: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    next: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    stop: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    pointer: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    list2: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
    funnel: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
};
const svg = (n, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

// ---------- styles ----------
if (!document.getElementById("elm-style")) {
    const st = document.createElement("style");
    st.id = "elm-style";
    st.textContent = `
.elm-root{position:relative;display:flex;flex-direction:column;gap:8px;padding:0 6px 6px;box-sizing:border-box;width:100%;height:100%;min-height:330px;overflow:hidden;
  color:#cfd2d6;font:12px Inter,system-ui,sans-serif;--elm-acc:#0b8ae8;--elm-ok:#3fb27f;--elm-tile:110px;--elm-cols:auto-fill;--elm-cell:var(--elm-tile)}
.elm-root *{box-sizing:border-box}
.elm-searchrow{display:none;gap:6px}.elm-searchrow.on{display:flex}
.elm-input{background:#141414;color:#ddd;border:1px solid #444;border-radius:6px;padding:5px 8px;font-size:12px;min-width:0;flex:1}
.elm-input:focus{outline:1px solid var(--elm-acc)}
.elm-grid{flex:1 1 0;min-height:120px;overflow-y:auto;overflow-x:hidden;align-content:start;padding-right:6px;
  scrollbar-gutter:stable;display:grid;grid-template-columns:repeat(var(--elm-cols),var(--elm-cell));grid-auto-rows:var(--elm-cell);justify-content:start;gap:5px}
.elm-grid.list{display:flex;flex-direction:column;gap:2px}
.elm-grid.list2{grid-template-columns:1fr 1fr;grid-auto-rows:30px;justify-content:normal;gap:2px 5px}
.elm-grid::-webkit-scrollbar{width:8px}.elm-grid::-webkit-scrollbar-track{background:#2a2c30;border-radius:4px}
.elm-grid::-webkit-scrollbar-thumb{background:#4a4d53;border-radius:4px}
.elm-empty{grid-column:1/-1;color:#888;text-align:center;margin-top:40px;line-height:1.6}
.elm-item{position:relative;border-radius:10px;background:#1a1a1a;border:4px solid transparent;overflow:hidden;cursor:pointer;user-select:none}
.elm-item:hover{border-color:var(--elm-acc)}
.elm-item img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .15s}
.elm-item img.ok{opacity:1}
.elm-dot{position:absolute;top:8px;left:8px;width:14px;height:14px;border-radius:50%;background:#555;box-shadow:0 0 0 2px rgba(0,0,0,.45);z-index:2}
.elm-dot::after{content:"";position:absolute;inset:-6px}
.elm-idx{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.65);color:#ddd;font-size:10px;padding:1px 6px;border-radius:8px;z-index:2}
.elm-fname{display:none}
.elm-grid.list .elm-item,.elm-grid.list2 .elm-item{height:30px;display:flex;align-items:center;gap:8px;padding:0 6px;border-radius:6px;border-width:2px}
.elm-grid.list .elm-dot,.elm-grid.list2 .elm-dot,.elm-grid.list .elm-idx,.elm-grid.list2 .elm-idx{position:static;flex:none}
.elm-grid.list .elm-idx,.elm-grid.list2 .elm-idx{background:none;min-width:26px;text-align:right;color:#888}
.elm-grid.list .elm-item img,.elm-grid.list2 .elm-item img{position:static;width:24px;height:24px;flex:none;border-radius:4px}
.elm-grid.list .elm-fname,.elm-grid.list2 .elm-fname{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.elm-item.st-done .elm-dot{background:var(--elm-acc)}
.elm-item.st-run .elm-dot,.elm-item.next .elm-dot{background:var(--elm-ok)}
.elm-item.st-err .elm-dot{background:${C_RED}}
.elm-item.st-off .elm-dot,.elm-item.st-off .elm-idx{visibility:hidden}
.elm-item.st-off img{filter:grayscale(1);opacity:.25!important}
.elm-item.st-off .elm-fname{opacity:.45;text-decoration:line-through}
.elm-item.next,.elm-item.st-run{border-color:var(--elm-ok)}
.elm-item.next-dash{border-style:dashed;border-color:color-mix(in srgb,var(--elm-ok) 65%,transparent)}
.elm-item.tg img,.elm-item.ta img{filter:grayscale(1)}
.elm-item.tg::after,.elm-item.ta::after{content:"";position:absolute;inset:0;opacity:.6;pointer-events:none;z-index:1}
.elm-item.tg::after{background:var(--elm-ok)}
.elm-item.ta::after{background:var(--elm-acc)}
.elm-tb{display:flex;align-items:center;gap:5px}
.elm-grp{display:flex;align-items:center;gap:2px;background:#2a2c30;border-radius:22px;padding:3px 8px}
.elm-grp.c{flex:1;justify-content:center;gap:6px}
.elm-ib{background:none;border:0;color:#9ea3aa;cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.elm-ib:hover{color:#fff;background:#383b41}
.elm-ib.on{color:var(--elm-acc)}
.elm-ib.act,.elm-ib.act:hover{background:var(--elm-acc);color:#fff}
.elm-ib.stop:active,.elm-ib.stop.flash{background:${C_RED};color:#fff}
.elm-meta{display:flex;justify-content:space-between;gap:10px;color:#9ea3aa;font-size:12px}
.elm-meta b{font-weight:500;color:#cfd2d6}.elm-file{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.elm-bar{display:flex;gap:5px;height:30px}
.elm-seg{display:flex;align-items:center;border-radius:9px;font-size:13px;min-width:44px;flex:0 1 0;overflow:hidden;transition:flex-grow .25s}
.elm-seg.done{background:var(--elm-acc);color:#fff;padding-left:10px}
.elm-seg.rest{background:#38393d;color:#ddd;padding-right:10px;justify-content:flex-end}
.elm-seg.cur{background:var(--elm-ok);flex:none;width:5px;min-width:0}
.elm-seg.done.complete{background:var(--elm-ok)}
.elm-pop{position:absolute;z-index:20;width:290px;max-width:calc(100% - 8px);max-height:calc(100% - 16px);overflow-y:auto;background:#25272b;border:1px solid #484b51;
  border-radius:10px;padding:10px;box-shadow:0 8px 30px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:8px}
.elm-pop h4{margin:0;font-size:12px;color:#fff}
.elm-pop label{display:flex;flex-direction:column;gap:3px;color:#9ea3aa}
.elm-pop label.row{flex-direction:row;align-items:center;gap:6px;color:#cfd2d6}
.elm-inline{display:flex;gap:6px;align-items:center}
.elm-btn{cursor:pointer;padding:5px 10px;font-size:12px;border-radius:6px;border:1px solid #555;background:#2f3136;color:#ddd;white-space:nowrap}
.elm-btn:hover{filter:brightness(1.25)}.elm-btn.on{border-color:var(--elm-acc);color:var(--elm-acc)}
.elm-btn:disabled{opacity:.4;cursor:not-allowed}
.elm-menu{display:flex;flex-direction:column;gap:2px}
.elm-menu .elm-btn{text-align:left;border-color:transparent;background:none}.elm-menu .elm-btn:hover{background:#383b41}
.elm-seg3{display:flex;gap:4px}.elm-seg3 .elm-btn{flex:1;display:flex;justify-content:center;padding:6px}
.elm-sw{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
.elm-sw.on{border-color:#fff}
.elm-hint{color:#777;font-size:11px;line-height:1.4}
.elm-sep{border-top:1px solid #3a3d42;margin:2px 0}
`;
    document.head.appendChild(st);
}

// ---------- helpers ----------
const findWidget = (node, name) => node.widgets?.find((w) => w.name === name);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const props = (n) => (n.properties = n.properties || {});

function setWidget(w, value) {
    if (!w) return;
    w.value = value;
    try { w.callback?.(value); } catch (e) { /* ignore */ }
    app.graph?.setDirtyCanvas(true, true);
}
function hideWidget(w, tag) {
    if (!w) return;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    w.type = tag;
    if (w.element) w.element.style.display = "none";
}
function toast(severity, detail) {
    try { app.extensionManager?.toast?.add?.({ severity, summary: "AFBL", detail, life: 4000 }); } catch (e) { /* ignore */ }
}
const btNodes = () => ((app.graph && app.graph._nodes) || []).filter((n) => n?.type === NODE_NAME);
const isLive = (n) => n.mode !== 2 && n.mode !== 4;

// ---------- selection model ----------
// Normal mode:   everything is selected except `excluded` (file order / shuffle order).
// Order mode:    only files in `order` are processed, in exactly that order.
const isOff = (n, rel) => (n._btOrderMode ? !n._btOrderSet.has(rel) : n._btExcluded.has(rel));
function enabledRun(n) {
    if (n._btOrderMode) { const fs = n._btFileSet || new Set(); return n._btOrder.filter((f) => fs.has(f)); }
    return (n._btRun || []).filter((f) => !n._btExcluded.has(f));
}
const curPos = (n) => {
    const t = enabledRun(n).length;
    const i = Number(findWidget(n, "index")?.value) || 0;
    return t ? ((i % t) + t) % t : 0;
};
function setOrder(n, arr) {
    n._btOrder = arr;
    n._btOrderSet = new Set(arr);
    n._btExcluded = new Set((n._btFiles || []).filter((f) => !n._btOrderSet.has(f)));
}
function includeMany(n, list, on) {
    if (n._btOrderMode) {
        if (on) setOrder(n, [...n._btOrder, ...list.filter((f) => !n._btOrderSet.has(f))]);
        else { const rm = new Set(list); setOrder(n, n._btOrder.filter((f) => !rm.has(f))); }
    } else {
        for (const f of list) on ? n._btExcluded.delete(f) : n._btExcluded.add(f);
    }
}
function loadSelection(node) {
    node._btExcluded = new Set();
    node._btLegacy = null;
    node._btOrderMode = false;
    node._btOrder = [];
    node._btOrderSet = new Set();
    try {
        const d = JSON.parse(findWidget(node, "selected_files_json")?.value || "[]");
        if (Array.isArray(d) && d.length) node._btLegacy = new Set(d);
        else if (d && typeof d === "object") {
            node._btExcluded = new Set(d.excluded || []);
            if (Array.isArray(d.order)) { node._btOrderMode = true; node._btOrder = d.order; node._btOrderSet = new Set(d.order); }
        }
    } catch (e) { /* ignore */ }
}
function saveSelection(node) {
    const w = findWidget(node, "selected_files_json");
    if (!w) return;
    const d = { excluded: [...node._btExcluded] };
    if (node._btOrderMode) d.order = [...node._btOrder];
    w.value = JSON.stringify(d);
}
function resetProgress(node) {
    node._btDone.clear();
    node._btErr.clear();
    node._btRunning = null;
}
function setOrderMode(node, on) {
    if (on === !!node._btOrderMode) return;
    if (on) {
        const cur = enabledRun(node);
        node._btOrderMode = true;
        setOrder(node, cur);
        const sw = findWidget(node, "shuffle_seed");
        if (Number(sw?.value) > 0) { setWidget(sw, 0); refreshFileList(node); }
    } else {
        node._btOrderMode = false;
        node._btExcluded = new Set((node._btFiles || []).filter((f) => !node._btOrderSet.has(f)));
    }
    saveSelection(node);
    resetProgress(node);
    setWidget(findWidget(node, "index"), 0);
    refreshStates(node, false);
}

// ---------- thumbnails (bounded queue, lazy via IntersectionObserver) ----------
const thumbQ = [];
let thumbActive = 0;
function pumpThumbs() {
    while (thumbActive < 6 && thumbQ.length) {
        const job = thumbQ.shift();
        thumbActive++;
        job().catch(() => {}).finally(() => { thumbActive--; pumpThumbs(); });
    }
}
function requestThumb(node, img) {
    const url = img.dataset.url;
    if (!url || img.dataset.state) return;
    img.dataset.state = "q";
    thumbQ.push(async () => {
        if (!img.isConnected) { img.dataset.state = ""; return; }
        let obj = node._btThumbs.get(url);
        if (!obj) {
            const res = await api.fetchApi(url);
            if (!res.ok) { img.dataset.state = "err"; return; }
            obj = URL.createObjectURL(await res.blob());
            node._btThumbs.set(url, obj);
        }
        img.src = obj;
        img.classList.add("ok");
        img.dataset.state = "ok";
    });
    pumpThumbs();
}
function clearThumbs(node) {
    for (const u of node._btThumbs.values()) URL.revokeObjectURL(u);
    node._btThumbs.clear();
}

// ---------- file list ----------
async function refreshFileList(node) {
    const seq = (node._btReq = (node._btReq || 0) + 1);
    const dir = (findWidget(node, "folder_path")?.value || "").trim();
    let files = [], run = null;
    if (dir) {
        try {
            const res = await api.fetchApi("/elementa/list_files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    folder_path: dir,
                    include_subfolders: !!findWidget(node, "include_subfolders")?.value,
                    filetype: findWidget(node, "filetype")?.value || "all",
                    reverse: !!findWidget(node, "reverse")?.value,
                    sort_by: findWidget(node, "sort_by")?.value || "name",
                    shuffle_seed: Number(findWidget(node, "shuffle_seed")?.value) || 0,
                }),
            });
            const data = await res.json();
            if (node._btReq !== seq) return;
            files = Array.isArray(data.files) ? data.files : [];
            run = Array.isArray(data.run) ? data.run : null;
        } catch (e) {
            if (node._btReq !== seq) return;
        }
    }
    node._btFileSet = new Set(files);
    node._btRun = run || files;
    node._btFiles = files;
    if (node._btLegacy) {   // migrate legacy format (list of included files)
        const base = (p) => p.split("/").pop();
        node._btExcluded = new Set(files.filter((f) => !node._btLegacy.has(f) && !node._btLegacy.has(base(f))));
        node._btLegacy = null;
        saveSelection(node);
    }
    if (node._btOrderMode) setOrder(node, node._btOrder);   // re-sync `excluded` with the file list
    const sig = files.join("\n") + "|" + dir;
    if (sig !== node._btSig) {
        node._btSig = sig;
        buildTiles(node);
    }
    refreshStates(node, false);
}

// ---------- tiles ----------
function buildTiles(node) {
    const grid = node._btGrid;
    node._btIO?.disconnect();
    clearThumbs(node);
    grid.replaceChildren();
    node._btItems = new Map();
    const files = node._btFiles || [];
    if (!files.length) {
        const dir = (findWidget(node, "folder_path")?.value || "").trim();
        const d = el("div", "elm-empty");
        d.innerHTML = dir ? "No matching files.<br>Check the path and format in ⚙ Settings."
                          : "No folder selected.<br>Open ⚙ Settings and choose a folder.";
        grid.appendChild(d);
        return;
    }
    const folder = encodeURIComponent((findWidget(node, "folder_path")?.value || "").trim());
    const frag = document.createDocumentFragment();
    for (const rel of files) {
        const it = el("div", "elm-item");
        it.dataset.rel = rel;
        it.title = rel;
        const img = el("img");
        img.alt = "";
        img.draggable = false;
        img.dataset.url = `/elementa/thumb?folder=${folder}&file=${encodeURIComponent(rel)}`;
        const idx = el("span", "elm-idx", "");
        it.append(el("span", "elm-dot"), img, idx, el("span", "elm-fname", rel));
        frag.appendChild(it);
        node._btItems.set(rel, { el: it, idx, cls: "", hidden: false, idxText: "" });
    }
    grid.appendChild(frag);
    for (const it of node._btItems.values()) node._btIO?.observe(it.el);
}

function refreshStates(node, follow) {
    const run = enabledRun(node);
    const pos = new Map(run.map((f, i) => [f, i]));
    const next = run.length ? run[curPos(node)] : null;
    const running = node._btRunning;
    const q = (node._btSearch || "").toLowerCase();
    let done = 0;
    for (const f of run) if (node._btDone.has(f)) done++;
    const frozen = !!props(node).frozen;
    const active = !!(node._btAuto || node._btRunning);      // a queue is running (or paused)
    for (const [rel, it] of node._btItems || []) {
        let st;
        if (isOff(node, rel)) st = "off";
        else if (rel === running) st = "run";
        else if (node._btErr.has(rel)) st = "err";
        else if (node._btDone.has(rel)) st = "done";
        else st = "wait";
        const isNext = st !== "off" && rel === next;
        let tint = "";
        if (st === "done") tint = " tg";                                    // already sent -> OK colour
        else if (st === "wait" && (active || (frozen && !isNext))) tint = " ta";   // queued -> accent (only while running / frozen)
        const cls = `elm-item st-${st}` + (isNext ? (running ? " next-dash" : " next") : "") + tint;
        if (it.cls !== cls) { it.el.className = cls; it.cls = cls; }
        const t = st === "off" || !pos.has(rel) ? "–" : String(pos.get(rel) + 1);
        if (it.idxText !== t) { it.idx.textContent = t; it.idxText = t; }
        const hide = !!q && !rel.toLowerCase().includes(q);
        if (it.hidden !== hide) { it.el.style.display = hide ? "none" : ""; it.hidden = hide; }
    }
    if (follow && next) node._btItems?.get(next)?.el.scrollIntoView({ block: "nearest" });

    const total = run.length;
    const runCnt = running && pos.has(running) ? 1 : 0;
    const rest = Math.max(0, total - done - runCnt);
    const ui = node._btUI;
    if (!ui) return;
    ui.file.textContent = running || next || "—";
    ui.prog.textContent = `progress: ${done} / ${total}`;
    ui.done.style.flexGrow = String(done);
    ui.rest.style.flexGrow = String(rest);
    ui.doneT.textContent = String(done);
    ui.restT.textContent = String(rest);
    const finished = total > 0 && done >= total && !runCnt;
    ui.cur.style.display = runCnt ? "" : "none";                 // only while an image is being processed
    ui.rest.style.display = rest > 0 ? "" : "none";              // gone once everything is sent
    ui.done.classList.toggle("complete", finished);              // whole bar turns green when finished

    const auto = node._btAuto && !node._btPaused;
    ui.play.innerHTML = svg(auto ? "pause" : "play");
    ui.play.title = auto ? "Pause" : (node._btPaused ? "Resume queue" : "Start queue");
    ui.lock.classList.toggle("act", frozen);
    ui.play.classList.toggle("act", !!auto);
    ui.done.style.display = done > 0 ? "" : "none";     // appears only after the first image is done
    node._btGrid.classList.toggle("frozen", frozen);
    ui.shuffle.classList.toggle("on", (Number(findWidget(node, "shuffle_seed")?.value) || 0) > 0);
    ui.search.classList.toggle("on", !!q);
}

// ---------- layout: the grid always fits the node and scrolls ----------
function updateLayout(node) {
    const root = node._btRoot;
    if (!root) return;
    updateCells(node);
    const wd = node._btWidget;
    const wy = wd?.last_y ?? wd?.y;
    const startY = typeof wy === "number" && wy > 0 ? wy : 8 + (node.outputs?.length || 0) * SLOT_ROW;
    // The panel height comes ONLY from the node size (the frontend's own value can be stale);
    // inside the panel the grid takes the remaining space (flex) and scrolls.
    const h = Math.max(330, Math.floor(node.size[1] - startY - 36));
    if (h !== node._btRootH) { node._btRootH = h; root.style.height = h + "px"; }
}
function layoutTick(node) {
    if (!node._btGrid) return;
    const wd = node._btWidget;
    const key = [node.size[0], node.size[1], wd?.last_y ?? wd?.y].join("|");
    if (key !== node._btLayoutKey) { node._btLayoutKey = key; updateLayout(node); }
}
// The experimental "outputs at the bottom" option was removed: undo anything it left in saved workflows.
function cleanupLegacyOutputs(node) {
    if (node.properties) delete node.properties.outputsBottom;
    if (node.widgets_start_y !== undefined) node.widgets_start_y = undefined;
    (node.outputs || []).forEach((o) => { if (o.pos) delete o.pos; });
    node._btLayoutKey = null;
}

// ---------- actions ----------
function goTo(node, pos, follow = true) {
    const t = enabledRun(node).length;
    if (!t) return;
    setWidget(findWidget(node, "index"), ((pos % t) + t) % t);
    refreshStates(node, follow);
}
function startQueue(node) {
    if (props(node).frozen) { app.queuePrompt(0, 1); return; }   // frozen: a single run of the current image
    const run = enabledRun(node);
    if (!run.length) return;
    if (props(node).startFromSelected === false) {                 // always restart from the first image
        setWidget(findWidget(node, "index"), 0);
        node._btDone.clear(); node._btErr.clear();
    } else if (run.every((f) => node._btDone.has(f))) { node._btDone.clear(); node._btErr.clear(); }
    node._btAuto = true;
    node._btPaused = false;
    refreshStates(node, true);
    app.queuePrompt(0, 1);
}
function togglePlay(node) {
    if (!node._btAuto) return startQueue(node);
    if (!node._btPaused) { node._btPaused = true; refreshStates(node, false); return; }   // pause: the current run finishes
    node._btPaused = false;
    refreshStates(node, false);
    if (!node._btRunning) app.queuePrompt(0, 1);
}
function stopQueue(node) {
    const wasRunning = !!node._btRunning;
    node._btAuto = false;
    node._btPaused = false;
    resetProgress(node);
    setWidget(findWidget(node, "index"), 0);
    refreshStates(node, true);
    if (wasRunning) { try { api.interrupt(); } catch (e) { /* ignore */ } }
}
function toggleShuffle(node, reroll) {
    const w = findWidget(node, "shuffle_seed");
    const on = (Number(w?.value) || 0) > 0;
    if (node._btOrderMode) { setOrderMode(node, false); toast("info", "Selection order turned off (shuffle is active)."); }
    if (on && !reroll) setWidget(w, 0);
    else setWidget(w, 1 + Math.floor(Math.random() * 0x7FFFFFFE));
    resetProgress(node);
    setWidget(findWidget(node, "index"), 0);
    refreshFileList(node);
}
function itemClick(node, rel, e) {
    const onDot = !!e.target.closest(".elm-dot");
    if (e.shiftKey && node._btAnchor && node._btItems.has(node._btAnchor)) {
        const files = node._btFiles;
        let a = files.indexOf(node._btAnchor), b = files.indexOf(rel);
        if (a > b) [a, b] = [b, a];
        includeMany(node, files.slice(a, b + 1), !isOff(node, node._btAnchor));
        saveSelection(node);
        refreshStates(node, false);
        return;
    }
    if (onDot || e.ctrlKey || e.metaKey) {      // toggle whether the file takes part
        includeMany(node, [rel], isOff(node, rel));
        node._btAnchor = rel;
        saveSelection(node);
        refreshStates(node, false);
        return;
    }
    if (isOff(node, rel)) { includeMany(node, [rel], true); saveSelection(node); }   // plain click = jump to this image
    node._btAnchor = rel;
    const i = enabledRun(node).indexOf(rel);
    if (i >= 0) goTo(node, i, false);
}

// ---------- popovers ----------
function closePop(node) {
    if (!node._btPop) return;
    node._btPop.el.remove();
    document.removeEventListener("pointerdown", node._btPop.away, true);
    node._btPop = null;
}
function openPop(node, key, anchor, build) {
    const was = node._btPop?.key;
    closePop(node);
    if (was === key) return;
    const pop = el("div", "elm-pop");
    build(pop);
    const root = node._btRoot;
    root.appendChild(pop);
    const cx = anchor.offsetLeft + anchor.offsetWidth / 2;   // offset* keeps this correct at any canvas zoom
    const w = pop.offsetWidth;
    pop.style.left = Math.max(4, Math.min(root.clientWidth - w - 4, cx - w / 2)) + "px";
    pop.style.bottom = (root.clientHeight - anchor.offsetTop + 6) + "px";
    const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop(node); };
    document.addEventListener("pointerdown", away, true);
    node._btPop = { key, el: pop, away };
}
const menuBtn = (label, fn) => { const b = el("button", "elm-btn", label); b.type = "button"; b.addEventListener("click", fn); return b; };
function checkRow(label, checked, onChange, title) {
    const l = el("label", "row");
    const c = el("input");
    c.type = "checkbox"; c.checked = !!checked;
    c.addEventListener("change", () => onChange(c.checked));
    l.append(c, document.createTextNode(label));
    if (title) l.title = title;
    return l;
}

function buildSettings(node, pop) {
    const dirW = findWidget(node, "folder_path");
    pop.append(el("h4", "", "Settings"));
    const l1 = el("label", "", "Image folder");
    const row = el("div", "elm-inline");
    const inp = el("input", "elm-input");
    inp.value = dirW?.value || "";
    inp.placeholder = "C:/path/to/folder";
    const apply = () => { if (inp.value.trim() !== (dirW?.value || "")) setWidget(dirW, inp.value.trim()); };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") apply(); });
    inp.addEventListener("change", apply);
    const br = menuBtn("📁", () => openFolderPicker(node, (p) => { inp.value = p; }));
    br.title = "Browse folders on the server";
    row.append(inp, br);
    l1.appendChild(row);

    const ftW = findWidget(node, "filetype");
    const sel = el("select", "elm-input");
    for (const v of ftW?.options?.values || ["all"]) { const o = el("option", "", v); o.value = v; sel.appendChild(o); }
    sel.value = ftW?.value || "all";
    sel.addEventListener("change", () => setWidget(ftW, sel.value));
    const ftL = el("label", "row"); ftL.append(document.createTextNode("Format"), sel);
    const l2 = el("div", "elm-inline");
    l2.append(ftL, checkRow("Subfolders", findWidget(node, "include_subfolders")?.value,
        (v) => setWidget(findWidget(node, "include_subfolders"), v)));

    const l3 = el("label", "", "Color scheme (accent + OK color)");
    const sw = el("div", "elm-inline");
    sw.style.flexWrap = "wrap";
    let sc = loadScheme();
    const pair = (a2, o2) => `linear-gradient(90deg, ${a2} 50%, ${o2} 50%)`;
    const mark = () => {
        sw.querySelectorAll(".elm-sw").forEach((x) => x.classList.toggle("on", x.dataset.acc === sc.acc.toLowerCase() && x.dataset.ok === sc.ok.toLowerCase()));
    };
    for (const [name, acc, ok] of SCHEMES) {
        const b = el("button", "elm-sw"); b.type = "button"; b.title = name;
        b.dataset.acc = acc.toLowerCase(); b.dataset.ok = ok.toLowerCase();
        b.style.background = pair(acc, ok);
        b.addEventListener("click", () => {
            sc = { acc, ok }; setScheme(sc); mark();
            accIn.value = acc; okIn.value = ok;
        });
        sw.appendChild(b);
    }
    const mkColor = (label, key) => {
        const w = el("label", "row"); w.append(document.createTextNode(label));
        const i = el("input"); i.type = "color"; i.value = sc[key]; i.style.cssText = "width:34px;height:24px;padding:0;border:1px solid #555;background:none";
        i.addEventListener("input", () => { sc = { ...sc, [key]: i.value }; setScheme(sc); mark(); });
        w.appendChild(i);
        return [w, i];
    };
    const [accW, accIn] = mkColor("Accent", "acc");
    const [okW, okIn] = mkColor("OK", "ok");
    const custom = el("div", "elm-inline"); custom.append(accW, okW);
    mark();
    l3.append(sw, custom);

    const p = props(node);
    pop.append(l1, l2, l3, el("div", "elm-sep"), el("h4", "", "Queue"),
        checkRow("Start from the selected file", p.startFromSelected !== false,
            (v) => { p.startFromSelected = v; },
            "On: Play starts from the image with the green dot. Off: Play always starts from the first image."),
        checkRow("Process in selection order", node._btOrderMode,
            (v) => setOrderMode(node, v),
            "Only selected files run, in the order you selected them (Ctrl+click tiles)."),
        el("div", "elm-sep"),
        menuBtn("↻ Refresh file list", () => { node._btSig = ""; refreshFileList(node); }));
}

function buildSelectMenu(node, pop) {
    const m = el("div", "elm-menu");
    const files = () => node._btFiles || [];
    const done = () => { saveSelection(node); refreshStates(node); closePop(node); };
    m.append(
        menuBtn("✓ Select all", () => { includeMany(node, files(), true); done(); }),
        menuBtn("✗ Deselect all", () => { includeMany(node, files(), false); done(); }),
        menuBtn("⇄ Invert selection", () => {
            const on = files().filter((f) => isOff(node, f)), off = files().filter((f) => !isOff(node, f));
            includeMany(node, off, false); includeMany(node, on, true); done();
        }),
    );
    if (node._btSearch) {
        const q = node._btSearch.toLowerCase();
        m.append(menuBtn("🔍 Only matches", () => {
            const hit = files().filter((f) => f.toLowerCase().includes(q));
            includeMany(node, files().filter((f) => !f.toLowerCase().includes(q)), false);
            includeMany(node, hit, true); done();
        }));
    }
    pop.append(m, el("div", "elm-hint", node._btOrderMode
        ? "Selection order is ON: Ctrl+click tiles in the order you want. The numbers show the run order."
        : "Click a tile: jump to it · Ctrl+click or click the dot: include/exclude · Shift+click: range"));
}

const GRID_GAP = 5;
function updateCells(node) {
    const grid = node._btGrid;
    if (!grid || (props(node).view || "tile") !== "tile") return;
    const avail = grid.clientWidth - 6;               // minus the right padding
    if (avail <= 0) return;
    const tile = props(node).tile || 110;
    const cols = Math.max(1, Math.floor((avail + GRID_GAP) / (tile + GRID_GAP)));
    const cell = Math.floor(((avail - GRID_GAP * (cols - 1)) / cols) * 100) / 100;
    if (cols !== node._btCols || cell !== node._btCell) {
        node._btCols = cols; node._btCell = cell;
        node._btRoot.style.setProperty("--elm-cols", String(cols));
        node._btRoot.style.setProperty("--elm-cell", cell + "px");
    }
}
function loadScheme() {
    try {
        const j = JSON.parse(localStorage.getItem(SCHEME_KEY) || localStorage.getItem(LEGACY_SCHEME_KEY) || "null");
        if (j && HEX.test(j.acc) && HEX.test(j.ok)) return { acc: j.acc, ok: j.ok };
        const old = localStorage.getItem(ACCENT_KEY);       // migrate the old single accent
        if (old && HEX.test(old)) return { acc: old, ok: DEFAULT_SCHEME.ok };
    } catch (e) { /* ignore */ }
    return { ...DEFAULT_SCHEME };
}
function paintScheme(root, sc) {
    root.style.setProperty("--elm-acc", sc.acc);
    root.style.setProperty("--elm-ok", sc.ok);
}
function setScheme(sc) {
    try { localStorage.setItem(SCHEME_KEY, JSON.stringify(sc)); } catch (e) { /* ignore */ }
    btNodes().forEach((n) => n._btRoot && paintScheme(n._btRoot, sc));
}
function applyView(node) {
    const p = props(node);
    const mode = p.view || "tile";
    node._btGrid.className = "elm-grid" + (mode === "tile" ? "" : " " + mode) + (p.frozen ? " frozen" : "");
    node._btRoot.style.setProperty("--elm-tile", (p.tile || 110) + "px");
    if (mode !== "tile") { node._btCols = node._btCell = null; node._btRoot.style.removeProperty("--elm-cols"); node._btRoot.style.removeProperty("--elm-cell"); }
    updateCells(node);
}
function buildViewMenu(node, pop) {
    const p = props(node);
    const g = el("div", "elm-seg3");
    const mk = (mode, icon, title) => {
        const b = el("button", "elm-btn" + ((p.view || "tile") === mode ? " on" : ""));
        b.type = "button"; b.title = title; b.innerHTML = svg(icon);
        b.addEventListener("click", () => {
            p.view = mode; applyView(node);
            g.querySelectorAll(".elm-btn").forEach((x) => x.classList.toggle("on", x === b));
        });
        return b;
    };
    g.append(mk("tile", "grid", "Tiles"), mk("list", "list", "List"), mk("list2", "list2", "List, 2 columns"));
    const l = el("label", "", "Tile size");
    const r = el("input");
    r.type = "range"; r.min = "60"; r.max = "220"; r.step = "10"; r.value = String(p.tile || 110);
    r.addEventListener("input", () => { p.tile = Number(r.value); applyView(node); });
    l.appendChild(r);
    pop.append(el("h4", "", "View"), g, l);
}

const SORTS = [["name", "By name"], ["date", "By date modified"], ["format", "By format"], ["resolution", "By resolution"]];
function buildSortMenu(node, pop) {
    const sW = findWidget(node, "sort_by"), rW = findWidget(node, "reverse");
    pop.append(el("h4", "", "Sort"));
    const m = el("div", "elm-menu");
    const changed = () => { resetProgress(node); setWidget(findWidget(node, "index"), 0); draw(); refreshFileList(node); };
    const draw = () => {
        m.replaceChildren();
        for (const [k, label] of SORTS) m.appendChild(menuBtn((sW.value === k ? "● " : "○ ") + label, () => { setWidget(sW, k); changed(); }));
        m.appendChild(menuBtn(rW.value ? "↓ Descending (Z→A)" : "↑ Ascending (A→Z)", () => { setWidget(rW, !rW.value); changed(); }));
    };
    draw();
    pop.append(m);
}

// ---------- build UI ----------
function attachUI(node) {
    node._btFiles = []; node._btRun = []; node._btItems = new Map(); node._btFileSet = new Set();
    node._btDone = new Set(); node._btErr = new Set(); node._btThumbs = new Map();
    node._btRunning = null; node._btAuto = false; node._btPaused = false; node._btSearch = "";
    loadSelection(node);

    for (const n of ["index", "selected_files_json", "reset_to_first", "folder_path", "include_subfolders", "filetype", "reverse", "sort_by", "shuffle_seed"]) {
        hideWidget(findWidget(node, n), "hidden_bt_" + n);
    }
    const rf = findWidget(node, "reset_to_first");
    if (rf) rf.value = false;

    const root = el("div", "elm-root");
    node._btRoot = root;
    paintScheme(root, loadScheme());

    const sr = el("div", "elm-searchrow");
    const sInp = el("input", "elm-input");
    sInp.placeholder = "Search by file name…";
    sInp.addEventListener("input", () => { node._btSearch = sInp.value.trim(); refreshStates(node, false); });
    sInp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { sInp.value = ""; node._btSearch = ""; sr.classList.remove("on"); refreshStates(node, false); updateLayout(node); }
    });
    sr.appendChild(sInp);

    const grid = el("div", "elm-grid");
    node._btGrid = grid;
    if (typeof IntersectionObserver !== "undefined") {
        node._btIO = new IntersectionObserver((entries) => {
            for (const en of entries) if (en.isIntersecting) { const img = en.target.querySelector("img"); if (img) requestThumb(node, img); }
        }, { root: grid, rootMargin: "300px" });
    }
    grid.addEventListener("click", (e) => {
        const it = e.target.closest(".elm-item");
        if (it) { e.stopPropagation(); itemClick(node, it.dataset.rel, e); }
    });

    const ib = (name, title, fn) => {
        const b = el("button", "elm-ib"); b.type = "button"; b.title = title; b.innerHTML = svg(name);
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(e, b); });
        return b;
    };
    const tb = el("div", "elm-tb");
    const gL = el("div", "elm-grp"), gC = el("div", "elm-grp c"), gR = el("div", "elm-grp");
    const bSet = ib("settings", "Settings", (e, b) => openPop(node, "set", b, (p) => buildSettings(node, p)));
    const bLock = ib("snowflake", "Freeze: stay on the current image (click a tile to choose it)", () => {
        props(node).frozen = !props(node).frozen; refreshStates(node, false);
    });
    const bPrev = ib("prev", "Previous image", () => goTo(node, curPos(node) - 1));
    const bPlay = ib("play", "Start queue", () => togglePlay(node));
    const bStop = ib("stop", "Stop and return to the start", () => {
        stopQueue(node);
        bStop.classList.add("flash"); setTimeout(() => bStop.classList.remove("flash"), 350);   // visible even on a quick click
    });
    bStop.classList.add("stop");
    const bNext = ib("next", "Next image", () => goTo(node, curPos(node) + 1));
    const bShuf = ib("shuffle", "Random order (Shift+click to reshuffle)", (e) => toggleShuffle(node, e.shiftKey));
    const bSel = ib("pointer", "Selection", (e, b) => openPop(node, "sel", b, (p) => buildSelectMenu(node, p)));
    const bSea = ib("search", "Search", () => {
        sr.classList.toggle("on");
        if (sr.classList.contains("on")) sInp.focus();
        updateLayout(node);
    });
    const bView = ib("grid", "View", (e, b) => openPop(node, "view", b, (p) => buildViewMenu(node, p)));
    const bSort = ib("funnel", "Sort", (e, b) => openPop(node, "sort", b, (p) => buildSortMenu(node, p)));
    gL.append(bSet, bLock);
    gC.append(bPrev, bPlay, bStop, bNext, bShuf);
    gR.append(bSel, bSea, bView, bSort);
    tb.append(gL, gC, gR);

    const meta = el("div", "elm-meta");
    const fileS = el("span", "elm-file");
    fileS.append(document.createTextNode("file:  "), el("b", "elm-filename"));
    const prog = el("span");
    meta.append(fileS, prog);
    const bar = el("div", "elm-bar");
    const sDone = el("div", "elm-seg done"), sCur = el("div", "elm-seg cur"), sRest = el("div", "elm-seg rest");
    const doneT = el("span"), restT = el("span");
    sDone.append(doneT); sRest.append(restT);
    bar.append(sDone, sCur, sRest);

    root.append(sr, grid, tb, meta, bar);
    node._btUI = {
        file: fileS.querySelector(".elm-filename"), prog, done: sDone, doneT, cur: sCur, rest: sRest, restT,
        play: bPlay, lock: bLock, shuffle: bShuf, search: bSea,
    };

    const widget = node.addDOMWidget("elementa_ui", "elementa_panel", root, {
        serialize: false, hideOnZoom: false, getMinHeight: () => 330,
    });
    node._btWidget = widget;
    try {
        Object.defineProperty(widget, "width", {
            configurable: true, enumerable: true,
            get() { return node.size ? node.size[0] : undefined; },
            set(_v) { /* ignore */ },
        });
    } catch (e) { /* ignore */ }

    for (const wn of ["folder_path", "include_subfolders", "filetype", "reverse"]) {
        const w = findWidget(node, wn);
        if (!w) continue;
        const orig = w.callback;
        w.callback = (v, ...rest) => {
            try { orig?.call(w, v, ...rest); } catch (e) { /* ignore */ }
            if (wn === "folder_path" && v) { try { localStorage.setItem(LAST_DIR_KEY, String(v).trim()); } catch (e) { /* ignore */ } }
            if (wn === "folder_path") { resetProgress(node); setWidget(findWidget(node, "index"), 0); }
            refreshFileList(node);
        };
    }
    const fw = findWidget(node, "folder_path");
    if (fw && (!fw.value || fw.value === "C:/my_images")) {
        try { const last = localStorage.getItem(LAST_DIR_KEY) || localStorage.getItem(LEGACY_DIR_KEY); if (last) fw.value = last; } catch (e) { /* ignore */ }
    }

    applyView(node);
    cleanupLegacyOutputs(node);
    refreshStates(node, false);
    setTimeout(() => refreshFileList(node), 50);
}

// ---------- global hooks ----------
function installQueueHook() {
    if (app._ElementaQueueHook || typeof app.queuePrompt !== "function") return;
    const orig = app.queuePrompt.bind(app);
    app.queuePrompt = async function (...args) {
        const live = btNodes().filter(isLive);
        for (const n of live) {   // which image goes into this run
            const run = enabledRun(n);
            n._btRunning = run.length ? run[curPos(n)] : null;
            refreshStates(n, false);
        }
        let result;
        try {
            result = await orig(...args);   // the index is already serialized
        } catch (e) {
            for (const n of live) { n._btRunning = null; refreshStates(n, false); }
            throw e;
        }
        try {
            for (const n of live) {
                if (!props(n).frozen) {
                    const t = enabledRun(n).length;
                    setWidget(findWidget(n, "index"), t > 0 ? (curPos(n) + 1) % t : 0);
                }
                refreshStates(n, true);
            }
        } catch (e) { console.warn("[AFBL] queue hook error", e); }
        return result;
    };
    app._ElementaQueueHook = true;
}

function installExecutionHooks() {
    if (app._ElementaExecHooks) return;
    api.addEventListener("execution_success", () => {
        let more = false;
        for (const n of btNodes()) {
            const was = n._btRunning;
            n._btRunning = null;
            if (was) n._btDone.add(was);
            if (n._btAuto && was) {
                const run = enabledRun(n);
                if (run.indexOf(was) >= run.length - 1) {          // the last image is done
                    n._btAuto = false; n._btPaused = false;
                    toast("success", `Done: ${run.length} file(s) processed.`);
                } else if (!n._btPaused) more = true;
            }
            refreshStates(n, true);
        }
        if (more) setTimeout(() => app.queuePrompt(0, 1), 0);
    });
    const fail = (markErr) => () => {
        for (const n of btNodes()) {
            if (markErr && n._btRunning) n._btErr.add(n._btRunning);
            n._btRunning = null; n._btAuto = false; n._btPaused = false;
            refreshStates(n, false);
        }
    };
    api.addEventListener("execution_error", fail(true));
    api.addEventListener("execution_interrupted", fail(false));
    api.addEventListener("status", (e) => {   // safety net: queue is empty but a node still shows "running"
        if (e?.detail?.exec_info?.queue_remaining === 0) {
            for (const n of btNodes()) if (n._btRunning && !n._btAuto) { n._btRunning = null; refreshStates(n, false); }
        }
    });
    app._ElementaExecHooks = true;
}

// ---------- server-side folder picker ----------
function openFolderPicker(node, onPicked) {
    const dirW = findWidget(node, "folder_path");
    const filetype = findWidget(node, "filetype")?.value || "all";
    const state = { cwd: "", parent: null };
    const backdrop = el("div");
    backdrop.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center";
    const modal = el("div");
    modal.style.cssText = "width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;background:#232323;color:#ddd;border:1px solid #555;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);font:13px sans-serif;overflow:hidden";
    backdrop.appendChild(modal);
    const header = el("div", "", "📁 Select image folder");
    header.style.cssText = "padding:10px 12px;border-bottom:1px solid #444;font-weight:bold;background:#1c1c1c";
    const pathRow = el("div");
    pathRow.style.cssText = "display:flex;gap:6px;padding:10px 12px 6px";
    const pathInput = el("input", "elm-input");
    pathInput.placeholder = "Paste a path and press Enter";
    const upBtn = menuBtn("⬆ Up", () => navigate(state.parent ?? ""));
    pathRow.append(pathInput, upBtn);
    const listWrap = el("div");
    listWrap.style.cssText = "flex:1;overflow-y:auto;margin:4px 12px;padding:4px;background:#181818;border:1px solid #3a3a3a;border-radius:4px;min-height:160px";
    const footer = el("div");
    footer.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #444;background:#1c1c1c";
    const countEl = el("span");
    countEl.style.cssText = "flex:1;font-size:12px;color:#9cf";
    const close = () => { document.removeEventListener("keydown", onKey, true); backdrop.remove(); };
    const useBtn = menuBtn("✓ Use this folder", () => {
        const chosen = (state.cwd || pathInput.value || "").trim();
        if (!chosen) return;
        setWidget(dirW, chosen);
        onPicked?.(chosen);
        close();
    });
    footer.append(countEl, menuBtn("Cancel", close), useBtn);
    modal.append(header, pathRow, listWrap, footer);
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    document.addEventListener("keydown", onKey, true);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });

    function renderDirs(data) {
        listWrap.replaceChildren();
        const note = (t) => { const d = el("div", "", t); d.style.cssText = "padding:8px;color:#888"; listWrap.appendChild(d); };
        if (data.is_roots) note("Drives / roots:");
        else if (!(data.dirs || []).length) note("(no subfolders)");
        for (const d of data.dirs || []) {
            const it = el("div", "", "📁 " + d.name);
            it.title = d.path;
            it.style.cssText = "padding:5px 9px;border-radius:3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
            it.addEventListener("mouseenter", () => { it.style.background = "#2e3a52"; });
            it.addEventListener("mouseleave", () => { it.style.background = "transparent"; });
            it.addEventListener("click", () => navigate(d.path));
            listWrap.appendChild(it);
        }
    }
    async function navigate(path) {
        try {
            const res = await api.fetchApi("/elementa/browse", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: path || "", filetype }),
            });
            const data = await res.json();
            state.cwd = data.cwd || ""; state.parent = data.parent;
            pathInput.value = state.cwd;
            upBtn.disabled = !!data.is_roots;
            countEl.textContent = state.cwd ? `Images in this folder: ${data.image_count}` : "";
            renderDirs(data);
        } catch (e) { countEl.textContent = "Could not read this path."; }
    }
    pathInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); navigate(pathInput.value.trim()); } });
    document.body.appendChild(backdrop);
    navigate((dirW?.value || "").trim());
}

// ---------- registration ----------
app.registerExtension({
    name: "Elementa.BatchLoader.UI",

    async setup() {
        installQueueHook();
        installExecutionHooks();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            attachUI(this);
            const min = [540, 760];
            if (this.size[0] < min[0]) this.size[0] = min[0];
            if (this.size[1] < min[1]) this.size[1] = min[1];
            updateLayout(this);
            this._btTimer = setInterval(() => layoutTick(this), 250);   // fallback if draw/resize hooks are not called
        };

        const onConf = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConf?.apply(this, arguments);
            const rf = findWidget(this, "reset_to_first");
            if (rf) rf.value = false;
            loadSelection(this);
            if (this._btGrid) { applyView(this); cleanupLegacyOutputs(this); }
            this._btSig = "";
            setTimeout(() => refreshFileList(this), 50);
        };

        // keep the panel height in sync with the node size (resize, load, ...)
        const onDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function () {
            onDraw?.apply(this, arguments);
            layoutTick(this);
        };
        const onRes = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            onRes?.apply(this, arguments);
            layoutTick(this);
        };

        const onExec = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExec?.apply(this, arguments);
            try {
                const i = message?.batch_info?.[0];
                if (!i) return;
                const rel = i.rel || i.name;
                if (rel) this._btDone.add(rel);
                refreshStates(this, false);
            } catch (e) { /* ignore */ }
        };

        const onRem = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            closePop(this);
            clearInterval(this._btTimer);
            this._btIO?.disconnect();
            clearThumbs(this);
            onRem?.apply(this, arguments);
        };
    },
});
