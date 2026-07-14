// site/js/app.js
// -----------------------------------------------------------------------------
// Toast research site — citation engine, auto-bibliography, and nav scrollspy.
//
// Authoring contract for content tasks (18-22): wrap any sourced number/claim
// in an element carrying `data-fact-id="<ledger id>"`, e.g.
//   <span class="stat" data-fact-id="wsb-aga-2025-igaming-revenue">$10.74B</span>
// On load this module:
//   - appends a numbered superscript `<a class="cite">[n]</a>` link, numbered
//     in first-appearance order across the page;
//   - attaches a hover/keyboard-focus source-card (claim, tier badge, quote,
//     accessed/as-of dates, source + archive links);
//   - tags tier-C/D facts with a class so their visual "per company" / "our
//     estimate" qualifier renders automatically;
//   - builds the auto-generated bibliography inside `#sources`;
//   - exposes `window.FACTS` (id -> fact) for charts.js and later tasks.
//
// Zero external runtime requests: data/facts.json here is a synced copy of
// the ledger (see scripts/sync_site_data.sh; site/data/ is gitignored).
//
// Graceful degradation: with JS disabled the static HTML/CSS reads fine as
// prose. If fetch itself fails — e.g. the page is opened via file:// where
// browsers block fetching local files — citations quietly stay as their
// underlying text/number with no [n] marker, a console warning is logged,
// and nothing throws.

const TIER_LABEL = { A: "Primary source", B: "Reputable secondary", C: "Company claim", D: "Our estimate" };
const TIER_VAR = { A: "a", B: "b", C: "c", D: "d" }; // whitelist: never interpolate f.tier straight into CSS

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function init() {
  document.documentElement.classList.add("js");

  // Nav scrollspy has no dependency on the ledger — wire it regardless of
  // whether the fetch below succeeds.
  navProgress();

  let facts;
  try {
    const res = await fetch("data/facts.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    facts = await res.json();
    if (!Array.isArray(facts)) throw new Error("data/facts.json did not parse to an array");
  } catch (err) {
    console.warn(
      "Citation engine: could not load data/facts.json — citations will render as plain text. " +
        "If you opened this file directly (file://), serve it instead, e.g. `python3 -m http.server` from site/.",
      err
    );
    return;
  }

  const byId = Object.fromEntries(facts.map(f => [f.id, f]));
  window.FACTS = byId;

  const order = [];
  document.querySelectorAll("[data-fact-id]").forEach(el => {
    const f = byId[el.dataset.factId];
    if (!f) {
      el.classList.add("cite-missing");
      console.error("Unknown fact:", el.dataset.factId);
      return;
    }
    if (!order.includes(f.id)) order.push(f.id);
    const n = order.indexOf(f.id) + 1;

    // The card contains real links, so it must NOT live inside the citation
    // anchor (<a> may not contain <a> — invalid content model, trips a11y
    // validators). Wrap anchor + card as SIBLINGS in a positioned span; the
    // hover/focus trigger is .cite-wrap:hover / :focus-within in CSS.
    // (Deviation from the plan outline's a.appendChild(card) — authorized by
    // the controller in the Task 17 review.)
    const wrap = document.createElement("span");
    wrap.className = "cite-wrap";

    const a = document.createElement("a");
    a.className = "cite";
    a.href = `#src-${f.id}`;
    a.textContent = `[${n}]`;
    a.setAttribute("aria-label", `Source: ${f.sourceName}`);

    const card = hoverCard(f);
    wrap.appendChild(a);
    wrap.appendChild(card);
    wrap.addEventListener("mouseenter", () => positionCard(card));
    // focus doesn't bubble; focusin does — covers the sup anchor AND the
    // card's inner links (keyboard users tabbing through the open card).
    wrap.addEventListener("focusin", () => positionCard(card));

    el.appendChild(wrap);

    if (f.tier === "C" || f.tier === "D") {
      el.classList.add(`tier-${f.tier}`);
      // Symmetric provenance qualifiers, per the methodology legend: tier-C
      // renders " per company", tier-D renders " our estimate".
      el.classList.add(f.tier === "C" ? "is-percompany" : "is-ourestimate");
    }
  });

  bibliography(order.map(id => byId[id]));

  // Cards are laid out (absolute, not display:none) as soon as they exist, so
  // we can measure and flip edge-overflowing ones ahead of any hover/focus.
  layoutCiteCards();
  window.addEventListener("resize", debounce(layoutCiteCards, 150));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(layoutCiteCards).catch(() => {});
  }
}

function hoverCard(f) {
  const d = document.createElement("span");
  d.className = "cite-card";
  const tierVar = TIER_VAR[f.tier] || "d";
  d.innerHTML = `
    <b>${esc(f.sourceName)}</b>
    <span class="tier-badge" style="background:var(--tier-${tierVar})">${esc(f.tier)} &middot; ${esc(TIER_LABEL[f.tier] || "")}</span>
    ${f.quote ? `<q>${esc(f.quote)}</q>` : ""}
    <small>as of ${esc(f.asOf || "—")} &middot; accessed ${esc(f.accessed)}</small>
    <a href="${encodeURI(f.sourceUrl)}" target="_blank" rel="noopener">open source ↗</a>
    ${f.archiveUrl ? `<a href="${encodeURI(f.archiveUrl)}" target="_blank" rel="noopener">archived copy</a>` : ""}`;
  return d;
}

function bibliography(facts) {
  const ol = document.querySelector("#sources ol");
  if (!ol) return;
  facts.forEach(f => {
    const li = document.createElement("li");
    li.id = `src-${f.id}`;
    const tierVar = TIER_VAR[f.tier] || "d";
    li.innerHTML = `<a href="${encodeURI(f.sourceUrl)}" target="_blank" rel="noopener">${esc(f.sourceName)}</a>
      &mdash; ${esc(f.claim)}
      <span class="tier-badge" style="background:var(--tier-${tierVar})">${esc(f.tier)}</span>
      <small>accessed ${esc(f.accessed)}</small>`;
    ol.appendChild(li);
  });
}

// ---- Hover-card edge-aware positioning ------------------------------------
function positionCard(card) {
  card.classList.remove("is-flipped");
  const rect = card.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) card.classList.add("is-flipped");
}

function layoutCiteCards() {
  document.querySelectorAll(".cite-card").forEach(positionCard);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- Sticky-nav scrollspy ---------------------------------------------------
function navProgress() {
  if (!("IntersectionObserver" in window)) return;

  const sections = Array.from(document.querySelectorAll("main > section[id]"));
  const links = new Map(
    Array.from(document.querySelectorAll(".nav__link")).map(a => [a.getAttribute("href").replace(/^#/, ""), a])
  );
  if (!sections.length || !links.size) return;

  const navEl = document.querySelector(".nav");
  const navH = navEl ? navEl.offsetHeight : 0;
  const state = new Map(sections.map(s => [s.id, false]));

  const activate = id => {
    links.forEach((a, key) => {
      const isActive = key === id;
      a.classList.toggle("is-active", isActive);
      if (isActive) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  };

  const io = new IntersectionObserver(
    entries => {
      entries.forEach(entry => state.set(entry.target.id, entry.isIntersecting));
      // Prefer the bottommost (most-recently-entered) intersecting section —
      // the conventional scrollspy tie-break during the handoff between two
      // adjacent sections.
      const current = sections.filter(s => state.get(s.id)).pop();
      activate(current && links.has(current.id) ? current.id : null);
    },
    { root: null, rootMargin: `-${navH + 8}px 0px -60% 0px`, threshold: 0 }
  );
  sections.forEach(s => io.observe(s));
}

init();
