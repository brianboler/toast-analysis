// site/js/map.js
// -----------------------------------------------------------------------------
// Task 20 — interactive US legality choropleth for #loophole.
//
// Self-initializing module: no-ops unless the inlined map SVG (#lp-map) is in
// the DOM. Data flow:
//   - fetches data/states.json (canonical, verified) and derives each state's
//     categorical class with the SAME rule documented in the fragment comment
//     and legend:
//         redzone   : excludedByOperators >= 2
//         contested : excludedByOperators < 2 && skillCashGames !== "allowed"
//         icasino   : remaining states with icasino === true
//         allowed   : everything else
//     Precedence: redzone > contested > icasino > allowed.
//   - paints the map by setting data-cat on every [data-state] fill target
//     (fills themselves live in css/sections-regulatory.css, both themes);
//   - if the fetch fails (e.g. file://), falls back to the data-cat attributes
//     baked into the pre-rendered side-panel articles, which were generated
//     from the same file with the same rule — and warns on any mismatch.
//
// Interaction (dataviz-skill contract):
//   - hover: per-mark tooltip (state name + class label) + CSS lift;
//   - click OR keyboard (states get tabindex=0 and role=button; Enter/Space
//     activates) opens the side panel's pre-rendered detail block, whose fact
//     citations app.js has already wired;
//   - Escape or the Close button clears the selection and restores focus.
//
// Zero external requests; graceful degradation; nothing throws if DOM absent.

const CAT_LABEL = {
  icasino: "Regulated iCasino state",
  allowed: "Skill-cash allowed in practice",
  contested: "Contested or restricted",
  redzone: "Operator-consensus red zone",
};

function classify(row) {
  if (row.excludedByOperators >= 2) return "redzone";
  if (row.skillCashGames !== "allowed") return "contested";
  if (row.icasino) return "icasino";
  return "allowed";
}

async function initMap() {
  const svg = document.getElementById("lp-map");
  const panel = document.getElementById("lp-panel");
  if (!svg || !panel) return; // fragment not spliced in — no-op

  const targets = Array.from(svg.querySelectorAll("[data-state]"));
  const details = new Map(
    Array.from(panel.querySelectorAll(".lp-state-detail")).map(a => [a.id.replace("lp-state-", ""), a])
  );
  const placeholder = document.getElementById("lp-panel-placeholder");
  const closeBtn = document.getElementById("lp-panel-close");
  const tooltip = document.getElementById("lp-map-tooltip");

  // ---- state names come from the SVG's own <title> children; we then strip
  // the <title>s so the custom tooltip doesn't fight the native one.
  const nameOf = new Map();
  targets.forEach(el => {
    const t = el.querySelector("title");
    const code = el.dataset.state;
    if (t) {
      if (!nameOf.has(code)) nameOf.set(code, t.textContent.trim());
      t.remove();
    }
  });
  details.forEach((art, code) => {
    if (!nameOf.has(code)) nameOf.set(code, art.dataset.name || code);
  });

  // ---- classification: fetch canonical data, fall back to baked attributes.
  let catOf = new Map();
  try {
    const res = await fetch("data/states.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    rows.forEach(row => catOf.set(row.state, classify(row)));
    // self-audit against the statically generated panel attributes
    catOf.forEach((cat, code) => {
      const art = details.get(code);
      if (art && art.dataset.cat !== cat) {
        console.warn(`map.js: class mismatch for ${code}: runtime ${cat} vs baked ${art.dataset.cat}`);
      }
    });
  } catch (err) {
    console.warn("map.js: could not load data/states.json — using classes baked into the fragment.", err);
    details.forEach((art, code) => catOf.set(code, art.dataset.cat));
  }

  targets.forEach(el => {
    const cat = catOf.get(el.dataset.state);
    if (cat) el.setAttribute("data-cat", cat);
  });

  // ---- selection ------------------------------------------------------------
  let selected = null; // state code
  let lastTrigger = null; // element to restore focus to on close

  function applySelection(code) {
    targets.forEach(el => {
      const on = el.dataset.state === code;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    details.forEach((art, c) => { art.hidden = c !== code; });
    if (placeholder) placeholder.hidden = !!code;
    if (closeBtn) closeBtn.hidden = !code;
    selected = code || null;
  }

  function open(code, { focusPanel = false, trigger = null } = {}) {
    if (!details.has(code)) return;
    lastTrigger = trigger;
    applySelection(code);
    hideTooltip();
    if (focusPanel) {
      const art = details.get(code);
      const h = art.querySelector("h4");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    }
  }

  function close() {
    applySelection(null);
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    lastTrigger = null;
  }

  if (closeBtn) closeBtn.addEventListener("click", close);
  panel.addEventListener("keydown", e => { if (e.key === "Escape" && selected) close(); });

  // ---- wire each fill target --------------------------------------------------
  // DC has two fill targets (sliver path + marker circle); only the circle
  // takes a tab stop so keyboard users don't hit DC twice.
  const seenTab = new Set();
  targets.forEach(el => {
    const code = el.dataset.state;
    const name = nameOf.get(code) || code;
    const cat = catOf.get(code);
    el.setAttribute("role", "button");
    el.setAttribute("aria-pressed", "false");
    el.setAttribute("aria-label", cat ? `${name} — ${CAT_LABEL[cat]}` : name);
    const isDcDup = code === "DC" && seenTab.has("DC") === false && el.tagName.toLowerCase() === "path";
    if (isDcDup) {
      // the tiny DC sliver stays clickable but out of the tab order
      el.setAttribute("tabindex", "-1");
    } else if (!seenTab.has(code)) {
      el.setAttribute("tabindex", "0");
      seenTab.add(code);
    } else {
      el.setAttribute("tabindex", "-1");
    }

    el.addEventListener("click", () => open(code, { trigger: el }));
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        open(code, { focusPanel: true, trigger: el });
      }
    });
  });

  // ---- hover tooltip (labels are data — textContent only) ---------------------
  function showTooltip(code, x, y) {
    if (!tooltip) return;
    const cat = catOf.get(code);
    tooltip.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = nameOf.get(code) || code;
    tooltip.appendChild(strong);
    const catRow = document.createElement("span");
    catRow.className = "lp-tooltip__cat";
    const dot = document.createElement("span");
    dot.className = "lp-ev__dot"; // reused purely for the dot shape
    dot.style.background = cat ? `var(--lp-cat-${cat})` : "var(--border-strong)";
    catRow.appendChild(dot);
    catRow.appendChild(document.createTextNode(cat ? CAT_LABEL[cat] : "unclassified"));
    tooltip.appendChild(catRow);
    tooltip.hidden = false;
    positionTooltip(x, y);
  }
  function positionTooltip(x, y) {
    if (!tooltip || tooltip.hidden) return;
    const pad = 14;
    const r = tooltip.getBoundingClientRect();
    let left = x + pad, top = y + pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }
  function hideTooltip() { if (tooltip) tooltip.hidden = true; }

  svg.addEventListener("pointermove", e => {
    const hit = e.target.closest && e.target.closest("[data-state]");
    if (hit) showTooltip(hit.dataset.state, e.clientX, e.clientY);
    else hideTooltip();
  });
  svg.addEventListener("pointerleave", hideTooltip);
  // keyboard "tooltip" equivalence: focus announces name + class via aria-label.
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}

export { classify }; // exposed for tests / later tasks
