// site/js/diagram.js
// -----------------------------------------------------------------------------
// "How Toast works" matching-engine diagram — step-through control (Task 19).
// Self-initializing; a complete no-op if #matching-diagram isn't in the DOM,
// so this file is safe to include on any page.
//
// Design: the inline SVG's progressive elements each carry data-min / data-max
// (the inclusive step range in which they're visible) via a shared `.reveal`
// class, plus a `.dim-target` + data-undim-at pair for the India panel's
// dim -> matched transition. This module only ever toggles classes and the
// `hidden` attribute — it never rewrites innerHTML — so it can't disturb the
// citation engine's once-per-load [n] superscripts on the fact-id spans that
// live inside .diagram__step.
//
// Motion: all animation/transition timing lives in CSS (site/css/
// sections-toast.css) and is already neutralized site-wide by main.css's
// prefers-reduced-motion block. This file contains no requestAnimationFrame
// or setInterval loop of its own, so there is nothing extra to gate here.

const STEP_COUNT = 5;

const STEP_ANNOUNCEMENTS = [
  "Step 1 of 5. The US player taps Play on a blackjack table.",
  "Step 2 of 5. Toast's matching engine instantly pairs an offshore counterpart.",
  "Step 3 of 5. Both players are dealt the same hand by the same shared dealer.",
  "Step 4 of 5. Legal framing: player versus player counts as a game of skill.",
  "Step 5 of 5. The economics: who pays whom, and where the rake is taken."
];

function initDiagram() {
  const root = document.getElementById("matching-diagram");
  if (!root) return; // fragment not present on this page — no-op

  const svg = root.querySelector(".diagram__svg");
  const prevBtn = root.querySelector("[data-diagram-prev]");
  const nextBtn = root.querySelector("[data-diagram-next]");
  const announce = root.querySelector("[data-diagram-announce]");
  const countEl = root.querySelector("[data-step-current]");
  const dots = Array.from(root.querySelectorAll("[data-step-dot]"));
  const stepPanels = Array.from(root.querySelectorAll(".diagram__step[data-step]"));
  const revealEls = svg ? Array.from(svg.querySelectorAll(".reveal")) : [];
  const dimEls = svg ? Array.from(svg.querySelectorAll(".dim-target")) : [];

  if (!prevBtn || !nextBtn || !stepPanels.length) return; // malformed fragment — no-op

  let step = 1;

  function render() {
    root.dataset.step = String(step);

    revealEls.forEach(el => {
      const min = parseInt(el.dataset.min || "1", 10);
      const max = parseInt(el.dataset.max || String(STEP_COUNT), 10);
      el.classList.toggle("is-visible", step >= min && step <= max);
    });

    dimEls.forEach(el => {
      const undimAt = parseInt(el.dataset.undimAt || "1", 10);
      el.classList.toggle("is-undimmed", step >= undimAt);
    });

    stepPanels.forEach(panel => {
      const panelStep = parseInt(panel.dataset.step || "0", 10);
      panel.hidden = panelStep !== step;
    });

    dots.forEach(dot => {
      const dotStep = parseInt(dot.dataset.stepDot || "0", 10);
      dot.classList.toggle("is-current", dotStep === step);
    });

    if (countEl) countEl.textContent = String(step);
    if (announce) announce.textContent = STEP_ANNOUNCEMENTS[step - 1] || "";

    prevBtn.disabled = step === 1;
    nextBtn.disabled = step === STEP_COUNT;
  }

  function go(delta) {
    const next = step + delta;
    if (next < 1 || next > STEP_COUNT) return;
    step = next;
    render();
  }

  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));

  // Left/Right arrow keys anywhere inside the diagram card, in addition to the
  // buttons' native Enter/Space activation — an enhancement, not a substitute:
  // the Prev/Next buttons are real <button> elements and already fully
  // keyboard operable (focusable, Enter/Space triggers their click handler)
  // without any code here.
  root.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  });

  render();
}

initDiagram();
