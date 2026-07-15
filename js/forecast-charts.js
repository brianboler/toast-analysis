// site/js/forecast-charts.js
// -----------------------------------------------------------------------------
// Toast research site — Forecast & scenario model charts (hand-rolled SVG).
//
// No chart libraries. Reads site/data/forecast.json via fetch (same-origin, no
// external requests) and renders three charts into fixed mount ids:
//
//   #fc-revenue    5-year net-revenue trajectory — 3 lines (bull/base/bear),
//                  emphasized terminal points + terminal EV callouts.
//   #fc-kpi        the KPI build for a selected case (default BASE): small
//                  multiples of paying users, ARPPU, GMV, take rate over Y1-5.
//                  Case toggle (bull/base/bear) re-renders in place.
//   #fc-valuation  valuation bridge per case: terminal revenue x multiple = EV,
//                  as horizontal bars — bull (incl. the DKNG-parity stretch),
//                  base (0.68-1.0x range), bear (sub-0.5x, impaired).
//
// Self-initialising + idempotent: renders on DOMContentLoaded, once data loads,
// and via a MutationObserver (so it also works when the content agent splices
// the fragment in after this script runs). No-ops when no mount is present;
// fails soft (console.warn) if data can't be fetched — the fragment's static
// table + <details> fallbacks still read fine.
//
// Accessibility: each <svg> carries role="img" + a summarising aria-label, and
// every chart ships a <details> data-table fallback. Colour is doubled by
// direct labels + legend (bull=accent green, base=tier-B blue, bear=danger red).
//
// Motion: if prefers-reduced-motion is set, charts draw fully static. Otherwise
// they draw-animate (lines sweep, bars grow) when scrolled into view, or when
// their mount gains `.is-revealed` / receives a `reveal` event (design motion
// engine hook), whichever comes first.
(function () {
  "use strict";

  var IDS = ["fc-revenue", "fc-kpi", "fc-valuation"];
  var DATA = null;
  var loading = false;
  var kpiCase = null; // remembered toggle selection for #fc-kpi
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var CASES = ["bull", "base", "bear"];
  var CASE_CLASS = { bull: "fc-bull", base: "fc-base", bear: "fc-bear" };

  // ---- tiny helpers ---------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function trim(n, dp) {
    var t = (+n).toFixed(dp);
    if (t.indexOf(".") > -1) t = t.replace(/0+$/, "").replace(/\.$/, "");
    return t;
  }
  // a $M number → "$397M" / "$8.6M"
  function fmtM(v) { return "$" + trim(v, Math.abs(v) < 100 ? 1 : 0) + "M"; }
  function pct(v) { return trim(v, 0) + "%"; }
  function svgOpen(w, h, aria, minW) {
    return '<svg class="fc-svg" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' +
      esc(aria) + '" preserveAspectRatio="xMinYMin meet" style="width:100%;height:auto;' +
      (minW ? "min-width:" + minW + "px" : "") + '">';
  }
  function byId(id) { return document.getElementById(id); }

  // Build a <details> data-table fallback after the mount (once).
  function attachTable(mount, caption, headers, rows) {
    var host = mount.closest(".fc-fig") || mount.parentNode || mount;
    var old = host.querySelector(":scope > .fc-data");
    if (old) old.remove();
    var d = document.createElement("details");
    d.className = "fc-data chart-data";
    var h = '<summary>Data table</summary><div class="chart-wrap"><table class="data"><caption>' +
      esc(caption) + "</caption><thead><tr>";
    headers.forEach(function (hd, i) {
      h += "<th" + (i ? ' class="num"' : "") + ' scope="col">' + esc(hd) + "</th>";
    });
    h += "</tr></thead><tbody>";
    rows.forEach(function (r) {
      h += "<tr>";
      r.forEach(function (c, i) {
        h += (i ? '<td class="num" data-label="' + esc(headers[i]) + '">' : '<th scope="row">') +
          esc(c) + (i ? "</td>" : "</th>");
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    d.innerHTML = h;
    host.appendChild(d);
  }

  // ---- reveal / draw animation ---------------------------------------------
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.top < (window.innerHeight || 0) * 0.92 && r.bottom > 0;
  }
  function setFrom(svg) {
    svg.querySelectorAll(".fc-line").forEach(function (p) {
      var L = 0;
      try { L = p.getTotalLength(); } catch (e) { L = 0; }
      if (L) { p.style.strokeDasharray = L; p.style.strokeDashoffset = L; }
    });
    svg.querySelectorAll(".fc-grow").forEach(function (b) {
      b.style.transformBox = "fill-box"; b.style.transformOrigin = "left center"; b.style.transform = "scaleX(0)";
    });
    svg.querySelectorAll(".fc-growy").forEach(function (b) {
      b.style.transformBox = "fill-box"; b.style.transformOrigin = "bottom"; b.style.transform = "scaleY(0)";
    });
    svg.querySelectorAll(".fc-fade").forEach(function (g) { g.style.opacity = "0"; });
  }
  function setTo(svg) {
    svg.querySelectorAll(".fc-line").forEach(function (p) {
      p.style.transition = "stroke-dashoffset 1.05s cubic-bezier(.4,0,.2,1)"; p.style.strokeDashoffset = "0";
    });
    svg.querySelectorAll(".fc-grow").forEach(function (b) {
      b.style.transition = "transform .85s cubic-bezier(.4,0,.2,1)"; b.style.transform = "scaleX(1)";
    });
    svg.querySelectorAll(".fc-growy").forEach(function (b) {
      b.style.transition = "transform .85s cubic-bezier(.4,0,.2,1)"; b.style.transform = "scaleY(1)";
    });
    svg.querySelectorAll(".fc-fade").forEach(function (g, i) {
      g.style.transition = "opacity .5s ease " + (0.45 + i * 0.05) + "s"; g.style.opacity = "1";
    });
  }
  function prepReveal(mount) {
    if (REDUCE) return;            // static: leave fully drawn
    var svg = mount.querySelector("svg");
    if (!svg) return;
    setFrom(svg);
    var done = false;
    function go() {
      if (done) return; done = true;
      requestAnimationFrame(function () { setTo(svg); });
    }
    if (mount.classList.contains("is-revealed") || inView(mount)) { go(); return; }
    mount.addEventListener("reveal", go, { once: true });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); go(); } });
      }, { threshold: 0.18 });
      io.observe(mount);
    } else { go(); }
  }

  // ===========================================================================
  // 1. REVENUE TRAJECTORY — 3 lines, terminal points + EV callouts
  // ===========================================================================
  function renderRevenue(mount, data) {
    var W = 700, padL = 52, padR = 104, padT = 24, padB = 42, H = 344;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var ymax = 420;
    function X(y) { return padL + ((y - 1) / 4) * plotW; }
    function Y(v) { return padT + plotH - (Math.max(0, v) / ymax) * plotH; }

    var s = svgOpen(W, H,
      "Line chart: five-year net-revenue trajectory for three scenario cases. The bull case compounds to about $397M in Year 5 (enterprise value about $0.6B, stretch $0.9B); the base case rises to about $148M (EV $100-150M); the bear case peaks near $25M in Year 2 then a Year-3 shock truncates it to about $13M (impaired). Scenario projection, tier D.",
      620);

    // gridlines + y labels
    [0, 100, 200, 300, 400].forEach(function (t) {
      var y = Y(t);
      s += '<line class="fc-grid" x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '"/>';
      s += '<text class="fc-axis-label" x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">$' + t + "M</text>";
    });
    // x ticks
    for (var yr = 1; yr <= 5; yr++) {
      s += '<text class="fc-axis-label" x="' + X(yr) + '" y="' + (padT + plotH + 20) + '" text-anchor="middle">Y' + yr + "</text>";
    }
    s += '<text class="fc-axis-title" x="' + (padL + plotW / 2) + '" y="' + (H - 4) + '" text-anchor="middle">Scenario year</text>';

    // lines (draw base+bear first, bull on top)
    ["bear", "base", "bull"].forEach(function (ck) {
      var c = data.cases[ck], pts = c.years;
      var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p.year).toFixed(1) + " " + Y(p.netRevenue).toFixed(1); }).join(" ");
      s += '<path class="fc-line ' + CASE_CLASS[ck] + '" d="' + d + '"/>';
    });

    // terminal markers + callouts (fade-in group), stagger vertically to avoid overlap
    var calloutY = { bull: 0, base: 0, bear: 0 };
    CASES.forEach(function (ck) {
      var c = data.cases[ck], last = c.years[c.years.length - 1];
      var x = X(last.year), y = Y(last.netRevenue);
      s += '<g class="fc-fade">';
      s += '<circle class="fc-term ' + CASE_CLASS[ck] + '-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5"/>';
      var lx = x + 10;
      var l1 = c.label + " " + fmtM(last.netRevenue);
      var l2 = "EV " + c.exit.evLabel;
      var ty = y;
      if (ck === "bear") ty = Math.min(y, padT + plotH - 6);
      s += '<text class="fc-term-lbl ' + CASE_CLASS[ck] + '-fg" x="' + lx + '" y="' + (ty - 2) + '">' + esc(l1) + "</text>";
      s += '<text class="fc-term-sub" x="' + lx + '" y="' + (ty + 11) + '">' + esc(l2) + "</text>";
      if (ck === "bull" && c.exit.stretch) {
        s += '<text class="fc-term-sub" x="' + lx + '" y="' + (ty + 22) + '">stretch ' + esc(c.exit.stretch.evLabel) + "</text>";
      }
      s += "</g>";
    });
    s += "</svg>";

    // legend
    s += legend([
      { cls: "fc-bull", t: "Bull — compounds" },
      { cls: "fc-base", t: "Base — niche" },
      { cls: "fc-bear", t: "Bear — shock / impaired" }
    ]);

    mount.innerHTML = s;

    attachTable(mount, "Net revenue by scenario year (USD millions)",
      ["Year", "Bull", "Base", "Bear"],
      [1, 2, 3, 4, 5].map(function (yr) {
        return ["Y" + yr,
          fmtM(data.cases.bull.years[yr - 1].netRevenue),
          fmtM(data.cases.base.years[yr - 1].netRevenue),
          fmtM(data.cases.bear.years[yr - 1].netRevenue)];
      }).concat([["Exit EV",
        data.cases.bull.exit.evLabel + " (stretch " + data.cases.bull.exit.stretch.evLabel + ")",
        data.cases.base.exit.evLabel, data.cases.bear.exit.evLabel]]));

    prepReveal(mount);
  }

  // ===========================================================================
  // 2. KPI BUILD — small multiples for one case (default base) + toggle
  // ===========================================================================
  var KPIS = [
    { key: "payingUsersK", label: "Paying users (PMAU, K)", fmt: function (v) { return trim(v, 0) + "K"; } },
    { key: "arppu", label: "ARPPU ($/mo)", fmt: function (v) { return "$" + trim(v, 0); } },
    { key: "gmv", label: "GMV ($M)", fmt: function (v) { return fmtM(v); } },
    { key: "takeRatePct", label: "Take rate", fmt: pct }
  ];

  function renderKpi(mount, data) {
    if (!kpiCase) kpiCase = (data.meta && data.meta.defaultCase) || "base";
    var c = data.cases[kpiCase];

    // toolbar (case toggle) — injected once, above the chart host
    var host = mount;
    host.innerHTML = "";
    var bar = document.createElement("div");
    bar.className = "fc-toggle";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Select scenario case for the KPI build");
    CASES.forEach(function (ck) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fc-toggle-btn " + CASE_CLASS[ck] + (ck === kpiCase ? " is-on" : "");
      b.setAttribute("aria-pressed", ck === kpiCase ? "true" : "false");
      b.textContent = data.cases[ck].label;
      b.addEventListener("click", function () { kpiCase = ck; renderKpi(mount, data); });
      bar.appendChild(b);
    });
    host.appendChild(bar);
    var svgHost = document.createElement("div");
    svgHost.className = "fc-kpi-svghost";
    host.appendChild(svgHost);

    // 2x2 small multiples
    var W = 700, H = 372, cols = 2, rows = 2;
    var mgX = 16, mgTop = 26, mgBot = 22, gapX = 26, gapY = 30;
    var panelW = (W - gapX) / 2, panelH = (H - gapY) / 2;

    var s = svgOpen(W, H,
      c.label + " case KPI build over five years: paying users " +
      KPIS[0].fmt(c.years[0].payingUsersK) + " to " + KPIS[0].fmt(c.years[4].payingUsersK) + "; ARPPU " +
      KPIS[1].fmt(c.years[0].arppu) + " to " + KPIS[1].fmt(c.years[4].arppu) + "; GMV " +
      KPIS[2].fmt(c.years[0].gmv) + " to " + KPIS[2].fmt(c.years[4].gmv) + "; take rate " +
      KPIS[3].fmt(c.years[0].takeRatePct) + " to " + KPIS[3].fmt(c.years[4].takeRatePct) +
      ". Scenario projection, tier D.", 600);

    KPIS.forEach(function (m, idx) {
      var col = idx % 2, row = Math.floor(idx / 2);
      var ox = col * (panelW + gapX), oy = row * (panelH + gapY);
      var px = ox + mgX, pt = oy + mgTop, pw = panelW - mgX * 2, ph = panelH - mgTop - mgBot;
      var vals = c.years.map(function (y) { return y[m.key]; });
      var vmax = Math.max.apply(null, vals), vmin = Math.min.apply(null, vals);
      var top = vmax * 1.15, bot = Math.max(0, vmin - (vmax - vmin) * 0.35);
      if (top === bot) top = bot + 1;
      function X(i) { return px + (i / 4) * pw; }
      function Y(v) { return pt + ph - ((v - bot) / (top - bot)) * ph; }

      // panel title
      s += '<text class="fc-panel-title" x="' + ox + mgX + '" y="' + (oy + 12) + '">' + esc(m.label) + "</text>";
      // baseline
      s += '<line class="fc-grid" x1="' + px + '" y1="' + (pt + ph) + '" x2="' + (px + pw) + '" y2="' + (pt + ph) + '"/>';
      // line
      var d = vals.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
      s += '<path class="fc-line ' + CASE_CLASS[kpiCase] + '" d="' + d + '"/>';
      // dots
      s += '<g class="fc-fade">';
      vals.forEach(function (v, i) {
        s += '<circle class="fc-kpi-dot ' + CASE_CLASS[kpiCase] + '-dot" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6"/>';
      });
      // first + last value labels
      s += '<text class="fc-val" x="' + px + '" y="' + (Y(vals[0]) - 7) + '" text-anchor="start">' + esc(m.fmt(vals[0])) + "</text>";
      s += '<text class="fc-kpi-end ' + CASE_CLASS[kpiCase] + '-fg" x="' + (px + pw) + '" y="' + (Y(vals[4]) - 7) + '" text-anchor="end">' + esc(m.fmt(vals[4])) + "</text>";
      s += "</g>";
      // x labels Y1 / Y5
      s += '<text class="fc-axis-label" x="' + px + '" y="' + (pt + ph + 15) + '" text-anchor="start">Y1</text>';
      s += '<text class="fc-axis-label" x="' + (px + pw) + '" y="' + (pt + ph + 15) + '" text-anchor="end">Y5</text>';
    });
    s += "</svg>";
    svgHost.innerHTML = s;

    attachTable(mount, c.label + " case — KPI build by year",
      ["Metric", "Y1", "Y2", "Y3", "Y4", "Y5"],
      KPIS.map(function (m) {
        return [m.label].concat(c.years.map(function (y) { return m.fmt(y[m.key]); }));
      }));

    prepReveal(svgHost);
  }

  // ===========================================================================
  // 3. VALUATION BRIDGE — terminal revenue x multiple = EV (horizontal bars)
  // ===========================================================================
  function renderValuation(mount, data) {
    var b = data.cases.bull, ba = data.cases.base, be = data.cases.bear;
    // bar rows: [label, revenue, multipleText, EV($M), evLabel, class, extra]
    var rows = [
      { lab: "Bull — defensible", sub: fmtM(b.exit.exitRevenue) + " x " + b.exit.evRevenueMultiple + "x", ev: b.exit.enterpriseValue, evl: b.exit.evLabel, cls: "fc-bull" },
      { lab: "Bull — DKNG stretch", sub: fmtM(b.exit.exitRevenue) + " x " + b.exit.stretch.multiple + "x", ev: b.exit.stretch.enterpriseValue, evl: b.exit.stretch.evLabel, cls: "fc-bull", hatch: true },
      { lab: "Base — niche", sub: fmtM(ba.exit.exitRevenue) + " x " + ba.exit.evRevenueMultipleLow + "-" + ba.exit.evRevenueMultipleHigh + "x", ev: ba.exit.enterpriseValue, evl: ba.exit.evLabel, cls: "fc-base", lo: ba.exit.enterpriseValueLow, hi: ba.exit.enterpriseValueHigh },
      { lab: "Bear — impaired", sub: fmtM(be.exit.exitRevenue) + " x " + be.exit.evRevenueMultiple + "x", ev: be.exit.enterpriseValue, evl: be.exit.evLabel, cls: "fc-bear", impaired: true }
    ];
    var W = 700, padL = 150, padR = 116, padT = 18, padB = 16;
    var rowH = 52, H = padT + rows.length * rowH + padB;
    var plotW = W - padL - padR;
    var max = 885;
    function Xw(v) { return (v / max) * plotW; }

    var s = svgOpen(W, H,
      "Valuation bridge, terminal net revenue times an EV/revenue multiple. Bull: $397M x 1.5 = about $0.6B, with a DraftKings-parity stretch at 2.23x of about $0.9B. Base: $148M x 0.68 to 1.0 = $100-150M. Bear: $13M x under 0.5 = about $5M, equity impaired toward zero. Scenario projection, tier D.",
      620);
    // axis ticks
    [0, 200, 400, 600, 800].forEach(function (t) {
      var x = padL + Xw(t);
      s += '<line class="fc-grid" x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + rows.length * rowH) + '"/>';
      s += '<text class="fc-axis-label" x="' + x + '" y="' + (padT + rows.length * rowH + 12) + '" text-anchor="middle">$' + t + "M</text>";
    });

    rows.forEach(function (r, i) {
      var y = padT + i * rowH;
      var bh = 22, by = y + (rowH - bh) / 2 - 4;
      var w = Math.max(3, Xw(r.ev));
      s += '<text class="fc-row-lab" x="' + (padL - 12) + '" y="' + (by + 10) + '" text-anchor="end">' + esc(r.lab) + "</text>";
      s += '<text class="fc-row-sub" x="' + (padL - 12) + '" y="' + (by + 22) + '" text-anchor="end">' + esc(r.sub) + "</text>";
      // range whisker for base (behind bar)
      if (r.lo != null && r.hi != null) {
        var xl = padL + Xw(r.lo), xh = padL + Xw(r.hi), yc = by + bh / 2;
        s += '<line class="fc-whisker" x1="' + xl + '" y1="' + yc + '" x2="' + xh + '" y2="' + yc + '"/>';
        s += '<line class="fc-whisker" x1="' + xl + '" y1="' + (yc - 5) + '" x2="' + xl + '" y2="' + (yc + 5) + '"/>';
        s += '<line class="fc-whisker" x1="' + xh + '" y1="' + (yc - 5) + '" x2="' + xh + '" y2="' + (yc + 5) + '"/>';
      }
      s += '<rect class="fc-bar-rect fc-grow ' + r.cls + '-fill' + (r.hatch ? " fc-hatch" : "") + (r.impaired ? " fc-impaired" : "") +
        '" x="' + padL + '" y="' + by + '" width="' + w.toFixed(1) + '" height="' + bh + '" rx="3"><title>' +
        esc(r.lab + ": " + r.evl) + "</title></rect>";
      s += '<text class="fc-ev ' + r.cls + '-fg" x="' + (padL + w + 8) + '" y="' + (by + 15) + '" text-anchor="start">' + esc(r.evl) + "</text>";
    });
    s += "</svg>";

    s += legend([
      { cls: "fc-bull", t: "Bull" },
      { cls: "fc-base", t: "Base (0.68-1.0x range)" },
      { cls: "fc-bear", t: "Bear (impaired)" },
      { cls: "fc-hatch-key", t: "stretch (above defensible band)" }
    ]);

    mount.innerHTML = s;

    attachTable(mount, "Valuation bridge — terminal revenue x multiple = enterprise value",
      ["Case", "Terminal revenue", "Multiple", "Enterprise value"],
      [
        ["Bull — defensible", fmtM(b.exit.exitRevenue), b.exit.evRevenueMultiple + "x", b.exit.evLabel],
        ["Bull — DKNG stretch", fmtM(b.exit.exitRevenue), b.exit.stretch.multiple + "x", b.exit.stretch.evLabel],
        ["Base — niche", fmtM(ba.exit.exitRevenue), ba.exit.evRevenueMultipleLow + "-" + ba.exit.evRevenueMultipleHigh + "x", ba.exit.evLabel],
        ["Bear — impaired", fmtM(be.exit.exitRevenue), be.exit.evRevenueMultiple + "x", be.exit.evLabel]
      ]);

    prepReveal(mount);
  }

  // ---- legend builder (HTML, sits under the svg) ----------------------------
  function legend(items) {
    var h = '<ul class="fc-legend">';
    items.forEach(function (it) {
      h += '<li class="fc-legend-item"><span class="fc-swatch ' + it.cls + '"></span>' + esc(it.t) + "</li>";
    });
    return h + "</ul>";
  }

  // ---- dispatch / boot ------------------------------------------------------
  function renderOne(id) {
    var mount = byId(id);
    if (!mount) return;
    // Render each mount at most once from the observer/boot path. #fc-kpi is
    // re-rendered on case-toggle by its buttons' own click handlers calling
    // renderKpi() directly (see below) — it must NOT be exempted from this
    // guard, or the MutationObserver below (which fires on renderKpi's own
    // innerHTML write) re-enters boot() → renderKpi → … an infinite loop that
    // freezes the page.
    if (mount.getAttribute("data-rendered")) return;
    try {
      if (id === "fc-revenue") renderRevenue(mount, DATA);
      else if (id === "fc-kpi") renderKpi(mount, DATA);
      else if (id === "fc-valuation") renderValuation(mount, DATA);
      mount.setAttribute("data-rendered", "1");
    } catch (err) {
      console.error("forecast-charts.js: failed to render #" + id, err);
    }
  }
  function boot() {
    if (!DATA) return;
    IDS.forEach(function (id) {
      var m = byId(id);
      if (m && !m.getAttribute("data-rendered")) renderOne(id);
    });
  }
  function present() { return IDS.some(function (id) { return byId(id); }); }

  function load() {
    if (loading || DATA) { boot(); return; }
    loading = true;
    fetch("data/forecast.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) { DATA = json; boot(); })
      .catch(function (err) {
        console.warn("forecast-charts.js: could not load data/forecast.json — charts stay as their static table fallback. " +
          "If opened via file://, serve the site instead (python3 -m http.server from site/).", err);
      });
  }
  function maybeStart() { if (present()) load(); }

  // late-injected fragment: watch for the mounts appearing, then render.
  var mo = new MutationObserver(function () {
    if (!DATA) { maybeStart(); return; }
    if (present()) boot();
  });
  function observe() { if (document.body) mo.observe(document.body, { childList: true, subtree: true }); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { observe(); maybeStart(); });
  } else { observe(); maybeStart(); }
})();
