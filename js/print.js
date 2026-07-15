// site/js/print.js
// -----------------------------------------------------------------------------
// PDF export controller (Task: redesign polish pass). Self-initialising; no
// imports, no external requests; a no-op if no `.pdf-btn` is present.
//
// AUTHORING CONTRACT (for the content agent)
//   Place buttons anywhere:
//     <button class="pdf-btn" data-pdf="full">Full report (PDF)</button>
//     <button class="pdf-btn" data-pdf="medium">Standard (PDF)</button>
//     <button class="pdf-btn" data-pdf="small">Brief (PDF)</button>
//
//   Tag each section (or block) with the SMALLEST export level it belongs to:
//     data-pdf-min="small"   → in small, medium AND full   (small ⊂ medium ⊂ full)
//     data-pdf-min="medium"  → in medium AND full
//     data-pdf-min="full"    → in full only
//   Untagged content is always printed. The include/exclude rules live in the
//   `@media print` block of enhance.css and key off :root[data-pdf="<level>"].
//
//   On click this module:
//     1. sets  document.documentElement.dataset.pdf = level   (drives print CSS)
//     2. opens every <details> so collapsed data-tables/questions print
//     3. calls window.print()
//     4. restores the <details> open-states and clears data-pdf on afterprint
//        (or after a fallback timeout if afterprint never fires).

(function () {
  "use strict";

  var LEVELS = { small: 1, medium: 1, full: 1 };
  var restore = null; // pending cleanup fn

  function openAllDetails() {
    var changed = [];
    document.querySelectorAll("details").forEach(function (d) {
      if (!d.open) { d.open = true; changed.push(d); }
    });
    return changed;
  }

  function cleanup(reopened) {
    if (!restore) return;
    restore = null;
    document.documentElement.removeAttribute("data-pdf");
    (reopened || []).forEach(function (d) { d.open = false; });
  }

  function run(level) {
    if (!LEVELS[level]) level = "full";
    var root = document.documentElement;
    root.dataset.pdf = level;

    var reopened = openAllDetails();

    var done = function () {
      window.removeEventListener("afterprint", done);
      cleanup(reopened);
    };
    restore = done;
    window.addEventListener("afterprint", done);
    // Fallback: some browsers never fire afterprint (or the user cancels the
    // dialog with no event). Restore anyway so the screen view isn't stuck in
    // print state.
    setTimeout(function () { if (restore === done) done(); }, 60000);

    // Let the data-pdf attribute + opened <details> paint before printing.
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { window.print(); });
      });
    } else {
      window.print();
    }
  }

  function init() {
    var btns = document.querySelectorAll(".pdf-btn");
    if (!btns.length) return; // no export controls on this build — no-op
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        run(b.getAttribute("data-pdf") || "full");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
