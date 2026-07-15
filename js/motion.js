// site/js/motion.js
// -----------------------------------------------------------------------------
// Scroll-reveal engine (Task: redesign polish pass). One IntersectionObserver
// drives every reveal on the page. Self-initialising module; no imports, no
// external requests; a complete no-op-safe fallback when reduced motion is
// requested or IntersectionObserver is unavailable.
//
// AUTHORING CONTRACT (for the content agent + forecast-charts.js)
//   Add `data-reveal="up" | "fade" | "stagger"` to any element:
//     up      — element fades + rises into place
//     fade    — element fades in (no movement)
//     stagger — the element's DIRECT CHILDREN fade/rise in sequence
//   On first scroll-in this module:
//     • adds `.is-revealed` to the element, and
//     • dispatches a bubbling `reveal` CustomEvent on it.
//   The hidden pre-state lives behind `html.reveal-ready [data-reveal]` in
//   enhance.css, so if this script never runs the content is simply shown.
//
//   CHARTS: every `[data-chart]` mount is observed too, so charts (charts.js
//   and the separate forecast-charts.js) receive the same `.is-revealed`
//   class + `reveal` event when they scroll in. A chart can draw on either
//   hook, e.g.  mount.addEventListener('reveal', draw)  — or gate its CSS
//   animation on `[data-chart].is-revealed`. (charts.js also self-observes as
//   a belt-and-braces fallback, so its charts animate even without this file.)
//
//   Reduced motion: everything is revealed immediately, with no transform/
//   opacity transition (enforced here AND in the enhance.css reduced-motion
//   block), so nothing ever animates for those users.

(function () {
  "use strict";

  var SELECTOR = "[data-reveal],[data-chart]";
  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  // Index the direct children of a stagger container so CSS can offset each
  // one's transition-delay via calc(var(--i) * step).
  function indexStagger(el) {
    if (el.getAttribute("data-reveal") !== "stagger") return;
    var kids = el.children, i = 0;
    for (; i < kids.length; i++) kids[i].style.setProperty("--i", String(i));
  }

  function reveal(el) {
    if (el.__revealed) return;
    el.__revealed = true;
    el.classList.add("is-revealed");
    // bubbling so a delegated listener higher up can also catch it
    el.dispatchEvent(new CustomEvent("reveal", { bubbles: true }));
  }

  function init() {
    var root = document.documentElement;
    // Marks that the hidden pre-state is safe to apply (see enhance.css). Only
    // added when this engine is live, so a missing/failed script leaves every
    // [data-reveal] element fully visible.
    root.classList.add("reveal-ready");

    var els = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
    els.forEach(indexStagger);

    // Reduced motion or no IO support → reveal everything up front, no motion.
    if ((reduce && reduce.matches) || !("IntersectionObserver" in window)) {
      els.forEach(reveal);
      // keep future-injected fragments visible too
      observeMutations(function (el) {
        indexStagger(el);
        reveal(el);
      });
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            reveal(e.target);
            io.unobserve(e.target);
          }
        });
      },
      { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );

    var watch = function (el) {
      if (el.__seen) return;
      el.__seen = true;
      indexStagger(el);
      io.observe(el);
    };
    els.forEach(watch);

    // Late-injected content (section fragments, charts rendered after load).
    observeMutations(watch);

    // Failsafe sweep: a passive scroll/resize/load pass reveals anything already
    // in the viewport, in case an IntersectionObserver callback is delayed (some
    // browsers throttle IO in backgrounded/occluded tabs). reveal() is idempotent
    // so this never double-fires, and it only ever reveals what's actually in
    // view — the scroll-reveal effect is preserved.
    var sweep = function () {
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      document.querySelectorAll(SELECTOR).forEach(function (el) {
        if (el.__revealed) return;
        var r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) { reveal(el); io.unobserve(el); }
      });
    };
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; sweep(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    window.addEventListener("load", sweep);
    sweep();
  }

  // Watch for [data-reveal]/[data-chart] elements added after initial load.
  function observeMutations(onFound) {
    var scan = function () {
      document.querySelectorAll(SELECTOR).forEach(onFound);
    };
    var start = function () {
      if (!document.body) return;
      var mo = new MutationObserver(scan);
      mo.observe(document.body, { childList: true, subtree: true });
      scan();
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
