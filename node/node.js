/* ============================================================
   The Node — evidence board renderer
   Fetches links.json, pins clue cards to the corkboard, strings
   red thread between cards that share a tag, and wires up search,
   category filters, sort, tag-following, the detail overlay, and
   a personal (localStorage) investigation status per clue.
   ============================================================ */
(() => {
  "use strict";

  const GAP = 26;
  const STATUS_KEY = "node_status";
  const MOBILE = () => window.matchMedia("(max-width: 720px)").matches;

  const els = {
    board:     document.getElementById("board"),
    cards:     document.getElementById("cards"),
    threads:   document.getElementById("threads"),
    filters:   document.getElementById("filters"),
    search:    document.getElementById("search"),
    sort:      document.getElementById("sort"),
    hideDone:  document.getElementById("hideDone"),
    activeTag: document.getElementById("activetag"),
    tagClear:  document.getElementById("activetag-clear"),
    empty:     document.getElementById("empty"),
    loading:   document.getElementById("loading"),
    count:     document.getElementById("count"),
    overlay:   document.getElementById("overlay"),
    ov: {
      photo: document.getElementById("ov-photo"),
      cat:   document.getElementById("ov-cat"),
      title: document.getElementById("ov-title"),
      desc:  document.getElementById("ov-desc"),
      tags:  document.getElementById("ov-tags"),
      visit: document.getElementById("ov-visit"),
      date:  document.getElementById("ov-date"),
      close: document.getElementById("ov-close"),
      statusBtns: [...document.querySelectorAll(".status-btn")],
    },
  };

  let LINKS = [];
  let CATS = {};                 // id -> {label, color}
  const cardById = new Map();    // link id -> card element
  const activeCats = new Set();  // currently shown categories
  let query = "";
  let sortMode = "recent";       // recent | oldest | az
  let hideDone = false;
  let activeTag = null;
  let currentLink = null;        // link open in the overlay
  let statusOverrides = {};      // personal status, persisted to localStorage

  try { statusOverrides = JSON.parse(localStorage.getItem(STATUS_KEY) || "{}"); }
  catch { statusOverrides = {}; }

  /* ---------- helpers ---------- */

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function spread(h, min, max) { return min + ((h % 1000) / 1000) * (max - min); }

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }); }
    catch { return ""; }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function getStatus(link) { return statusOverrides[link.id] || link.status || "active"; }

  function matchesQuery(link) {
    if (!query) return true;
    const hay = [
      link.title, link.description, domainOf(link.url),
      (link.tags || []).join(" "), (CATS[link.category] || {}).label || "",
    ].join(" ").toLowerCase();
    return hay.includes(query);
  }
  function isVisible(link) {
    if (!activeCats.has(link.category)) return false;
    if (!matchesQuery(link)) return false;
    if (hideDone && getStatus(link) === "done") return false;
    if (activeTag && !(link.tags || []).includes(activeTag)) return false;
    return true;
  }

  /* ---------- build DOM ---------- */

  function buildCard(link, index) {
    const cat = CATS[link.category] || { color: "#d63d3d", label: link.category };
    const h = hash(link.id);

    const card = document.createElement("article");
    card.className = "card reveal";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${link.title}`);
    card.dataset.id = link.id;
    card.dataset.cat = link.category;
    card.dataset.tags = (link.tags || []).join(",");
    card.style.setProperty("--i", index);
    card.style.setProperty("--accent", cat.color);
    card.style.setProperty("--rot", spread(h, -4, 4).toFixed(2) + "deg");
    card.style.setProperty("--rot-m", spread(h, -2.2, 2.2).toFixed(2) + "deg");

    const imgSrc = link.ogImage || link.favicon || "";
    const isIcon = !link.ogImage;
    card.innerHTML = `
      <span class="card-fresh">just pinned</span>
      <img class="card-photo${isIcon ? " is-icon" : ""}" src="${imgSrc}" alt="" loading="lazy"
           onerror="this.classList.add('is-icon');this.src='${link.favicon || ""}'">
      <span class="card-stamp"></span>
      <h3 class="card-title">${escapeHtml(link.title)}</h3>
      <p class="card-domain"><span class="card-catdot"></span>${escapeHtml(domainOf(link.url))}</p>
    `;

    applyStatusToCard(card, getStatus(link));
    card.addEventListener("click", () => openOverlay(link));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOverlay(link); }
    });
    cardById.set(link.id, card);
    return card;
  }

  function applyStatusToCard(card, status) {
    card.dataset.status = status;
    card.classList.toggle("is-done", status === "done");
    const stamp = card.querySelector(".card-stamp");
    stamp.className = "card-stamp " + status;
    stamp.textContent = status === "done" ? "closed" : status;
    const fresh = card.querySelector(".card-fresh");
    if (fresh) fresh.style.display = status === "inbox" ? "" : "none";
  }

  function buildFilters() {
    els.filters.innerHTML = "";
    Object.entries(CATS).forEach(([id, cat], i) => {
      const btn = document.createElement("button");
      btn.className = "filter-pin";
      btn.type = "button";
      btn.textContent = cat.label;
      btn.dataset.cat = id;
      btn.setAttribute("aria-pressed", "true");
      btn.style.setProperty("--dot", cat.color);
      btn.style.setProperty("--tilt", (i % 2 ? 1.2 : -1.2) + "deg");
      btn.addEventListener("click", () => {
        if (activeCats.has(id)) { activeCats.delete(id); btn.setAttribute("aria-pressed", "false"); }
        else { activeCats.add(id); btn.setAttribute("aria-pressed", "true"); }
        refresh();
      });
      els.filters.appendChild(btn);
    });
  }

  /* ---------- sort & tag-follow ---------- */

  function sortedLinks() {
    const arr = LINKS.slice();
    if (sortMode === "az") arr.sort((a, b) => a.title.localeCompare(b.title));
    else {
      arr.sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""));
      if (sortMode === "oldest") arr.reverse();
    }
    return arr;
  }
  function applySort() {
    sortedLinks().forEach((link) => {
      const card = cardById.get(link.id);
      if (card) els.cards.appendChild(card); // re-append into sorted order
    });
  }

  function setActiveTag(tag) {
    activeTag = tag;
    if (tag) {
      els.activeTag.hidden = false;
      els.tagClear.textContent = tag;
    } else {
      els.activeTag.hidden = true;
    }
    refresh();
  }

  /* ---------- layout & threads ---------- */

  function visibleCards() {
    return [...els.cards.children].filter((c) => !c.classList.contains("hide"));
  }

  function applyVisibility() {
    let shown = 0;
    for (const card of els.cards.children) {
      const link = LINKS.find((l) => l.id === card.dataset.id);
      const vis = link && isVisible(link);
      card.classList.toggle("hide", !vis);
      if (vis) shown++;
    }
    els.empty.hidden = shown > 0;
    els.count.textContent = `${shown} ${shown === 1 ? "clue" : "clues"} on the board`;
  }

  function layout() {
    const cards = visibleCards();
    if (MOBILE()) {
      els.cards.style.removeProperty("--board-h");
      cards.forEach((c) => { c.style.removeProperty("--x"); c.style.removeProperty("--y"); });
      clearThreads();
      return;
    }

    const boardW = els.cards.clientWidth;
    const cardW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--card-w")) || 210;
    const colW = cardW + GAP;
    const cols = Math.max(1, Math.floor((boardW + GAP) / colW));
    const used = cols * colW - GAP;
    const startX = Math.max(0, (boardW - used) / 2);
    const colH = new Array(cols).fill(14);

    cards.forEach((card) => {
      let c = 0;
      for (let i = 1; i < cols; i++) if (colH[i] < colH[c]) c = i;
      const h = hash(card.dataset.id + "pos");
      const x = startX + c * colW + spread(h, -7, 7);
      const y = colH[c] + spread(h >> 3, 0, 12);
      card.style.setProperty("--x", x.toFixed(1) + "px");
      card.style.setProperty("--y", y.toFixed(1) + "px");
      colH[c] = y + card.offsetHeight + GAP;
    });

    els.cards.style.setProperty("--board-h", Math.max(...colH, 200) + 30 + "px");
    drawThreads(cards);
  }

  function clearThreads() { while (els.threads.firstChild) els.threads.removeChild(els.threads.firstChild); }

  // String red thread between visible cards that share a tag. Thicker / more
  // opaque the more tags two clues have in common.
  function drawThreads(cards) {
    clearThreads();
    if (MOBILE()) return;
    const nodes = cards.map((card) => ({
      x: parseFloat(card.style.getPropertyValue("--x")) + card.offsetWidth / 2,
      y: parseFloat(card.style.getPropertyValue("--y")) + 14,
      tags: new Set((card.dataset.tags || "").split(",").filter(Boolean)),
    }));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let shared = 0;
        for (const t of nodes[i].tags) if (nodes[j].tags.has(t)) shared++;
        if (!shared) continue;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", nodes[i].x); line.setAttribute("y1", nodes[i].y);
        line.setAttribute("x2", nodes[j].x); line.setAttribute("y2", nodes[j].y);
        line.setAttribute("stroke-width", (1.5 + shared * 0.8).toFixed(1));
        line.setAttribute("stroke-opacity", Math.min(0.9, 0.45 + shared * 0.22).toFixed(2));
        els.threads.appendChild(line);
      }
    }
  }

  /* ---------- overlay ---------- */

  function openOverlay(link) {
    currentLink = link;
    const cat = CATS[link.category] || { color: "#d63d3d", label: link.category };
    const o = els.ov;
    const imgSrc = link.ogImage || link.favicon || "";
    o.photo.src = imgSrc;
    o.photo.classList.toggle("is-icon", !link.ogImage);
    o.photo.onerror = () => { o.photo.classList.add("is-icon"); o.photo.src = link.favicon || ""; };
    o.cat.textContent = cat.label;
    o.cat.style.background = cat.color;
    els.overlay.querySelector(".overlay-card").style.setProperty("--accent", cat.color);
    o.title.textContent = link.title;
    o.desc.textContent = link.description || "";
    o.tags.innerHTML = (link.tags || [])
      .map((t) => `<button type="button" class="tag-chip clickable" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
      .join("");
    o.tags.querySelectorAll(".tag-chip").forEach((chip) =>
      chip.addEventListener("click", () => { setActiveTag(chip.dataset.tag); closeOverlay(); }));
    o.visit.href = link.url;
    o.date.textContent = link.dateAdded ? "pinned " + fmtDate(link.dateAdded) : "";
    syncOverlayStatus(getStatus(link));
    els.overlay.hidden = false;
    o.close.focus();
  }
  function syncOverlayStatus(status) {
    els.ov.statusBtns.forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.status === status ? "true" : "false"));
  }
  function closeOverlay() { els.overlay.hidden = true; currentLink = null; }

  function setStatus(link, status) {
    statusOverrides[link.id] = status;
    try { localStorage.setItem(STATUS_KEY, JSON.stringify(statusOverrides)); } catch { /* ignore */ }
    const card = cardById.get(link.id);
    if (card) applyStatusToCard(card, status);
    syncOverlayStatus(status);
    refresh();
  }

  /* ---------- orchestration ---------- */

  function refresh() { applyVisibility(); layout(); }

  let resizeT;
  function onResize() { clearTimeout(resizeT); resizeT = setTimeout(layout, 120); }

  async function init() {
    els.ov.close.addEventListener("click", closeOverlay);
    els.overlay.addEventListener("click", (e) => { if (e.target === els.overlay) closeOverlay(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });
    els.ov.statusBtns.forEach((btn) =>
      btn.addEventListener("click", () => { if (currentLink) setStatus(currentLink, btn.dataset.status); }));

    els.search.addEventListener("input", () => { query = els.search.value.trim().toLowerCase(); refresh(); });
    els.sort.addEventListener("change", () => { sortMode = els.sort.value; applySort(); refresh(); });
    els.hideDone.addEventListener("click", () => {
      hideDone = !hideDone;
      els.hideDone.setAttribute("aria-pressed", String(hideDone));
      refresh();
    });
    els.tagClear.addEventListener("click", () => setActiveTag(null));
    window.addEventListener("resize", onResize);

    let data;
    try {
      const res = await fetch("links.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
    } catch (err) {
      els.loading.textContent = "Could not open the case files (" + err.message + ").";
      return;
    }

    (data.categories || []).forEach((c) => {
      CATS[c.id] = { label: c.label, color: c.color };
      activeCats.add(c.id);
    });
    LINKS = (data.links || []).slice();

    buildFilters();
    els.cards.innerHTML = "";
    sortedLinks().forEach((link, i) => els.cards.appendChild(buildCard(link, i)));
    els.loading.remove();

    applyVisibility();
    requestAnimationFrame(() => requestAnimationFrame(layout));
    window.addEventListener("load", layout);
  }

  init();
})();
