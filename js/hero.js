// site/js/hero.js
// -----------------------------------------------------------------------------
// Hero stat-strip count-up. Self-initializing module — no exports, runs on
// load, no-ops gracefully if the hero stat strip isn't in the DOM.
//
// Contract:
//   - Reads every value it animates FROM THE DOM (data-count-to / data-prefix
//     / data-suffix / data-decimals, plus the element's own static text as
//     the authoritative final string) — no fact figures are duplicated here.
//   - Respects prefers-reduced-motion: reveals final values instantly, with
//     no counting animation, when the user has requested reduced motion (or
//     when IntersectionObserver isn't available to drive a scroll trigger).
//   - Ties the existing .stat--big underline (--u custom property, see
//     main.css) to the same progress as the number, so both animate together.

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function formatValue(n, decimals, prefix, suffix) {
  const fixed = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
  return `${prefix}${fixed}${suffix}`;
}

function revealInstantly(el, valueEl, finalText) {
  valueEl.textContent = finalText;
  el.style.setProperty("--u", "100%");
}

function animateStat(el) {
  const valueEl = el.querySelector(".stat__value");
  if (!valueEl) return; // no dedicated text node to animate — leave static markup as-is

  // The static markup is the source of truth for the final displayed string
  // (captured before any animation touches the DOM), so the animation always
  // lands on exactly what the page's authors/citation ledger say, never a
  // recomputed rounding of the target number.
  const finalText = valueEl.textContent.trim();

  const target = parseFloat(el.dataset.countTo);
  if (Number.isNaN(target)) {
    el.style.setProperty("--u", "100%");
    return;
  }
  const decimals = parseInt(el.dataset.decimals || "0", 10) || 0;
  const prefix = el.dataset.prefix || "";
  const suffix = el.dataset.suffix || "";

  if (prefersReducedMotion()) {
    revealInstantly(el, valueEl, finalText);
    return;
  }

  const duration = 1100; // ms
  const start = performance.now();

  function frame(now) {
    // Clamp to [0, 1]: the timestamp a rAF callback receives can occasionally
    // predate the performance.now() sampled synchronously just before the
    // first requestAnimationFrame call, which would otherwise produce a
    // fleeting negative `t` (and, through easeOutCubic, a fleeting negative
    // displayed value) on the very first frame.
    const elapsed = now - start;
    const t = Math.max(0, Math.min(1, elapsed / duration));
    const eased = easeOutCubic(t);

    if (t >= 1) {
      revealInstantly(el, valueEl, finalText);
      return;
    }

    valueEl.textContent = formatValue(target * eased, decimals, prefix, suffix);
    el.style.setProperty("--u", `${(eased * 100).toFixed(1)}%`);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function init() {
  const container = document.querySelector(".hero__stats");
  if (!container) return; // hero fragment not present on this build — no-op

  const stats = Array.from(container.querySelectorAll("[data-count-to]"));
  if (!stats.length) return;

  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    stats.forEach(el => {
      const valueEl = el.querySelector(".stat__value");
      if (valueEl) revealInstantly(el, valueEl, valueEl.textContent.trim());
      else el.style.setProperty("--u", "100%");
    });
    return;
  }

  const io = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        stats.forEach(animateStat);
        io.disconnect(); // count up once, on first scroll into view
      });
    },
    { threshold: 0.35 }
  );
  io.observe(container);
}

init();
