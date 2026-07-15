// site/js/charts.js
// -----------------------------------------------------------------------------
// Toast research site — hand-rolled SVG chart builders (Task 21).
//
// No chart libraries. Every mark is emitted as an SVG string; the module reads
// site/data/{market,companies,funding}.json via fetch (same-origin, no external
// requests) and renders into any element carrying a `data-chart="<name>"` attr:
//
//   market-bars   horizontal bar chart of market magnitudes (colour = evidence tier)
//   tam-sam-som   nested TAM ⊃ SAM ⊃ SOM containment bars
//   quadrant      stakes × matching 2×2 (house-banked entrants marked distinctly)
//   funding       dot-timeline of rounds (x = date, size = amount)
//   sklz          SKLZ/FIRY monthly close, LOG scale, annotated
//
// Self-initialising and idempotent: it renders on DOMContentLoaded, immediately
// once data has loaded, and via a MutationObserver — so it also works when the
// controller injects the section fragments after this script has run. It no-ops
// when no `[data-chart]` mount is present, and fails soft (console.warn) if the
// data can't be fetched — the static prose + <figcaption> still read fine.
//
// Accessibility: each chart's <svg> carries role="img" + a summarising
// aria-label, and every chart ships a <details> data-table fallback so the
// numbers are reachable without seeing the marks. Source credit lives in the
// static <figcaption> (data-fact-id spans wired by app.js's citation engine).
//
// Colour is validated per the dataviz skill (scripts/validate_palette.js):
//   bars      → site tier tokens A/B/C/D (CVD ΔE ~57-60, contrast ≥3:1)
//   funding   → Toast accent vs field blue (CVD ΔE ~60)
//   quadrant  → shape + 45° texture, colour never load-bearing alone
// All series identity is doubled by legend + direct labels + shape/badge.
(function () {
  "use strict";

  var CHARTS = ["market-bars", "tam-sam-som", "quadrant", "funding", "sklz"];
  var DATA = null;      // { market, companies, funding }
  var loading = false;

  // ---- tiny helpers ---------------------------------------------------------
  var NS = "http://www.w3.org/2000/svg";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // USD from a raw dollar amount → "$78.72B" / "$384.1M" / "$1.6M"
  function usd(v) {
    var a = Math.abs(v), s;
    if (a >= 1e9) s = trim(v / 1e9, a / 1e9 >= 100 ? 0 : 2) + "B";
    else if (a >= 1e6) s = trim(v / 1e6, a / 1e6 >= 100 ? 0 : 1) + "M";
    else if (a >= 1e3) s = trim(v / 1e3, 0) + "K";
    else s = trim(v, 0);
    return "$" + s;
  }
  function trim(n, dp) {
    var t = n.toFixed(dp);
    if (t.indexOf(".") > -1) t = t.replace(/0+$/, "").replace(/\.$/, "");
    return t;
  }
  function monthLabel(ym) { // "2020-09" → "Sep 2020"
    var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var p = ym.split("-");
    return m[(+p[1]) - 1] + " " + p[0];
  }
  function ymToNum(ym) { var p = ym.split("-"); return (+p[0]) + ((+p[1]) - 1) / 12; }

  // Shared tooltip (one node, moved around)
  var tip = null;
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("role", "status");
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(html, x, y) {
    var t = ensureTip();
    t.innerHTML = html;
    t.hidden = false;
    var pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    var left = x + pad, top = y + pad;
    if (left + w > window.innerWidth - 6) left = x - w - pad;
    if (top + h > window.innerHeight - 6) top = y - h - pad;
    t.style.left = Math.max(6, left) + "px";
    t.style.top = Math.max(6, top) + "px";
  }
  function hideTip() { if (tip) tip.hidden = true; }

  // Build a <details> data-table fallback and place it after the chart-wrap.
  function attachTable(mount, caption, headers, rows) {
    var fig = mount.closest(".chart-fig") || mount.parentNode;
    if (fig.querySelector(".chart-data")) return;
    var d = document.createElement("details");
    d.className = "chart-data";
    var h = "<summary>Data table</summary><div class=\"chart-wrap\"><table class=\"data\"><caption>" +
      esc(caption) + "</caption><thead><tr>";
    headers.forEach(function (hd, i) {
      h += "<th" + (i ? " class=\"num\"" : "") + " scope=\"col\">" + esc(hd) + "</th>";
    });
    h += "</tr></thead><tbody>";
    rows.forEach(function (r) {
      h += "<tr>";
      // data-label mirrors the column header so the table reflows to labelled
      // cards on narrow screens (enhance.css td[data-label]::before).
      r.forEach(function (c, i) {
        h += "<td" + (i ? " class=\"num\"" : "") + " data-label=\"" + esc(headers[i]) + "\">" + esc(c) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    d.innerHTML = h;
    fig.appendChild(d);
  }

  function svgOpen(w, h, aria, minW) {
    return '<svg class="chart-svg" viewBox="0 0 ' + w + " " + h + '" role="img" ' +
      'aria-label="' + esc(aria) + '" preserveAspectRatio="xMinYMin meet" ' +
      'style="width:100%;height:auto;' + (minW ? "min-width:" + minW + "px" : "") + '">';
  }

  // ---- logo-chip helpers (shared by the quadrant + funding charts) ----------
  // Resolve a free-text company name (naming differs across data files) to a
  // logo slug, then to a self-hosted asset path. dream11/games24x7 have no
  // reliable logo asset and fall back to a coloured monogram chip.
  var LOGO_TESTS = [
    [/skillz|firy/i, "skillz"], [/papaya/i, "papaya"], [/avia/i, "aviagames"],
    [/triumph/i, "triumph"], [/worldwinner|game taco/i, "worldwinner"], [/voodoo|blitz/i, "voodoo"],
    [/\bmpl\b|mobile premier/i, "mpl"], [/winzo/i, "winzo"], [/zupee/i, "zupee"],
    [/dream ?11|dream sports/i, "dream11"], [/draftkings/i, "draftkings"], [/fanduel/i, "fanduel"],
    [/prizepicks/i, "prizepicks"], [/underdog/i, "underdog"], [/sleeper/i, "sleeper"],
    [/\bvgw\b|chumba|luckyland|global poker/i, "vgw"], [/stake/i, "stakeus"],
    [/games ?24 ?x ?7/i, "games24x7"], [/toast|carnival/i, "toast"]
  ];
  var LOGO_FILE = { skillz:1, papaya:1, aviagames:1, triumph:1, worldwinner:1, voodoo:1, mpl:1,
    winzo:1, zupee:1, draftkings:1, fanduel:1, prizepicks:1, underdog:1, vgw:1, stakeus:1, sleeper:1 };
  function logoSlug(name) {
    var n = String(name == null ? "" : name);
    for (var i = 0; i < LOGO_TESTS.length; i++) if (LOGO_TESTS[i][0].test(n)) return LOGO_TESTS[i][1];
    return null;
  }
  function logoHref(slug) {
    if (slug === "toast") return "assets/toast-logo.png";
    return LOGO_FILE[slug] ? "assets/logos/" + slug + ".png" : null;
  }
  // SVG for a single logo chip (rect + image), or a coloured monogram chip when
  // no asset exists. x,y is the top-left; sz the side length.
  function chipInner(x, y, sz, slug, name) {
    var rx = (sz * 0.24).toFixed(1), pad = sz * 0.15;
    var href = logoHref(slug);
    if (href) {
      return '<rect class="q-chip-bg" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + sz.toFixed(1) +
        '" height="' + sz.toFixed(1) + '" rx="' + rx + '"/>' +
        '<image href="' + href + '" x="' + (x + pad).toFixed(1) + '" y="' + (y + pad).toFixed(1) +
        '" width="' + (sz - 2 * pad).toFixed(1) + '" height="' + (sz - 2 * pad).toFixed(1) + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    var mono = slug === "dream11" ? "11" : (slug === "games24x7" ? "24" : (String(name).replace(/[^A-Za-z0-9]/g, "").charAt(0) || "?").toUpperCase());
    var fill = slug === "dream11" ? "#d13239" : (slug === "games24x7" ? "#d6336c" : "#3a3f47");
    return '<rect class="q-chip-bg" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + sz.toFixed(1) +
      '" height="' + sz.toFixed(1) + '" rx="' + rx + '" style="fill:' + fill + '"/>' +
      '<text class="q-chip-mono" x="' + (x + sz / 2).toFixed(1) + '" y="' + (y + sz / 2).toFixed(1) +
      '" text-anchor="middle" dominant-baseline="central" style="font-size:' + (sz * 0.44).toFixed(1) + 'px">' + esc(mono) + "</text>";
  }

  // ===========================================================================
  // 1. MARKET BARS — horizontal bars, colour = evidence tier, labels above bar
  // ===========================================================================
  function renderMarketBars(mount, market) {
    var rows = market.marketBars.slice().sort(function (a, b) { return b.valueUSD - a.valueUSD; });
    var display = {
      "wsb-aga-2025-total-revenue": "US commercial gaming, total",
      "wsb-aga-2025-igaming-revenue": "US iGaming (online casino)",
      "wsb-aga-illegal-igaming": "Illegal online casino (US, est.)",
      "wsb-skillz-revenue-2021": "Skillz revenue, 2021 peak",
      "wsb-skillz-revenue-2024": "Skillz revenue, 2024 trough",
      "wsb-papaya-revenue-estimate": "Papaya revenue (est., unconfirmed)",
      "wsb-skill-gaming-mill-databridge": "Global skill-gaming (research est.)",
      "wsb-tam-p2p-skill-gaming": "TAM — P2P skill-gaming ceiling",
      "wsb-sam-p2p-skill-gaming": null // disambiguated below (two SOMs share id)
    };
    // Distinct display labels straight off the source label, shortened:
    function label(r) {
      var l = r.label;
      if (/^TAM/.test(l)) return "TAM — P2P skill-gaming ceiling";
      if (/^SAM/.test(l)) return "SAM — illegal iCasino demand proxy";
      if (/^SOM/.test(l)) return /low/.test(l) ? "SOM — obtainable, low" : "SOM — obtainable, high";
      return display[r.factId] || l;
    }

    var W = 640, padL = 14, padR = 14, padT = 8, rowH = 46, barH = 16, gap = 30, valW = 78;
    var H = padT + rows.length * rowH + 8;
    var max = rows[0].valueUSD;
    var barMaxW = W - padL - padR - valW;   // reserve space so value labels sit OUTSIDE bars

    var s = svgOpen(W, H, "Bar chart comparing US gaming and skill-gaming market magnitudes, coloured by evidence tier. Largest: US commercial gaming " + usd(market.marketBars[0].valueUSD) + " and the theoretical TAM " + usd(86e9) + "; smallest: realistic obtainable revenue from " + usd(50e6) + ".", 560);
    rows.forEach(function (r, i) {
      var y = padT + i * rowH;
      var w = Math.max(2, (r.valueUSD / max) * barMaxW);
      var tierD = r.tier === "D";
      var lab = label(r);
      s += '<g class="bar-row">';
      // category label above the bar (full width available, no truncation)
      s += '<text class="c-cat" x="' + padL + '" y="' + (y + 12) + '">' + esc(lab) + '</text>';
      // tier-D badge pill, placed AFTER the label so it never overlaps the text
      if (tierD) {
        var bx = padL + textAdvance(lab);
        s += '<rect class="c-dpill" x="' + bx + '" y="' + (y + 2) + '" width="16" height="13" rx="3"/>' +
          '<text class="c-dpill-t" x="' + (bx + 8) + '" y="' + (y + 12) + '" text-anchor="middle">D</text>';
      }
      // bar (--i drives the staggered grow-in; see sections-market.css)
      s += '<rect class="c-bar bar-' + r.tier + '" style="--i:' + i + '" x="' + padL + '" y="' + (y + gap - 4) + '" width="' + w +
        '" height="' + barH + '" rx="3" data-i="' + i + '"><title>' + esc(r.label) + " — " + usd(r.valueUSD) +
        " (tier " + r.tier + ")</title></rect>";
      // value label — always to the right of the bar, readable on the surface
      s += '<text class="c-val" x="' + (padL + w + 7) + '" y="' + (y + gap + 8) + '" text-anchor="start">' +
        usd(r.valueUSD) + "</text>";
      s += "</g>";
    });
    s += "</svg>";
    mount.innerHTML = s;

    // per-bar hover
    wireHover(mount, ".c-bar", function (el) {
      var r = rows[+el.getAttribute("data-i")];
      return "<b>" + esc(r.label) + "</b><span class=\"tt-val\">" + usd(r.valueUSD) +
        "</span><span class=\"tt-meta\">tier " + r.tier + " · " + esc(r.asOf) + "</span>";
    });

    attachTable(mount, "Market magnitudes (sorted by value)",
      ["Segment", "Value (USD)", "Tier", "As of"],
      rows.map(function (r) { return [r.label, usd(r.valueUSD), r.tier, r.asOf]; }));
  }

  // ===========================================================================
  // 2. TAM / SAM / SOM — proportional containment bars (linear) + ratios
  // ===========================================================================
  function renderTamSamSom(mount, market) {
    var t = market.tamSamSom;
    var tam = t.find(function (x) { return /^TAM/.test(x.label); });
    var sam = t.find(function (x) { return /^SAM/.test(x.label); });
    var somLo = t.find(function (x) { return /low/.test(x.label); });
    var somHi = t.find(function (x) { return /high/.test(x.label); });
    var max = tam.valueUSD;

    var W = 640, padL = 14, padR = 14, padT = 8, rowH = 62;
    var H = padT + 3 * rowH + 6;
    var barMaxW = W - padL - padR - 62;   // reserve room for the TAM value label
    function xw(v) { return (v / max) * barMaxW; }

    var s = svgOpen(W, H, "Containment chart: TAM " + usd(tam.valueUSD) + " contains SAM " + usd(sam.valueUSD) +
      " (about 22% of TAM), which contains the realistic obtainable revenue SOM of " + usd(somLo.valueUSD) +
      " to " + usd(somHi.valueUSD) + " (well under 1% of TAM). All three are tier-D estimates.", 560);

    var tiers = [
      { r: tam, name: "TAM", sub: "theoretical ceiling", w: xw(tam.valueUSD), ratio: "" },
      { r: sam, name: "SAM", sub: "illegal iCasino demand proxy", w: xw(sam.valueUSD),
        ratio: Math.round((sam.valueUSD / tam.valueUSD) * 100) + "% of TAM" }
    ];
    tiers.forEach(function (d, i) {
      var y = padT + i * rowH;
      s += '<text class="c-cat" x="' + padL + '" y="' + (y + 12) + '">' + esc(d.name) + " — " + esc(d.sub) +
        '</text>';
      s += '<rect class="c-dpill" x="' + (padL + textAdvance(d.name + " — " + d.sub) ) + '" y="' + (y + 1) + '" width="16" height="13" rx="3"/>' +
        '<text class="c-dpill-t" x="' + (padL + textAdvance(d.name + " — " + d.sub) + 8) + '" y="' + (y + 11) + '" text-anchor="middle">D</text>';
      s += '<rect class="c-bar bar-D tsm-bar" style="--i:' + i + '" x="' + padL + '" y="' + (y + 22) + '" width="' + Math.max(2, d.w) +
        '" height="18" rx="3"><title>' + esc(d.r.label) + " — " + usd(d.r.valueUSD) + "</title></rect>";
      s += '<text class="c-val" x="' + (padL + Math.max(2, d.w) + 7) + '" y="' + (y + 35) + '">' +
        usd(d.r.valueUSD) + (d.ratio ? '  ·  ' + d.ratio : "") + "</text>";
    });
    // SOM row — a sliver range from lo→hi, labelled with a leader
    var y2 = padT + 2 * rowH;
    var xlo = xw(somLo.valueUSD), xhi = xw(somHi.valueUSD);
    s += '<text class="c-cat" x="' + padL + '" y="' + (y2 + 12) + '">SOM — realistic 3–5yr obtainable</text>';
    s += '<rect class="c-dpill" x="' + (padL + textAdvance("SOM — realistic 3–5yr obtainable")) + '" y="' + (y2 + 1) + '" width="16" height="13" rx="3"/>' +
      '<text class="c-dpill-t" x="' + (padL + textAdvance("SOM — realistic 3–5yr obtainable") + 8) + '" y="' + (y2 + 11) + '" text-anchor="middle">D</text>';
    // draw a minimum-visible marker for the sliver, plus a faint "= this thin" note
    var somW = Math.max(3, xhi - xlo);
    s += '<rect class="c-bar bar-D tsm-som" style="--i:2" x="' + padL + '" y="' + (y2 + 22) + '" width="' + somW +
      '" height="18" rx="2"><title>' + esc(somLo.label) + " to " + esc(somHi.label) + " — " +
      usd(somLo.valueUSD) + "–" + usd(somHi.valueUSD) + "</title></rect>";
    s += '<line class="tsm-leader" x1="' + (padL + somW) + '" y1="' + (y2 + 31) + '" x2="' + (padL + 150) + '" y2="' + (y2 + 31) + '"/>';
    s += '<text class="c-val" x="' + (padL + 156) + '" y="' + (y2 + 35) + '">' +
      usd(somLo.valueUSD) + "–" + usd(somHi.valueUSD) +
      "  ·  " + (somLo.valueUSD / sam.valueUSD * 100).toFixed(1) + "–" + (somHi.valueUSD / sam.valueUSD * 100).toFixed(1) + "% of SAM</text>";
    s += "</svg>";
    mount.innerHTML = s;

    attachTable(mount, "TAM / SAM / SOM (all tier-D estimates)",
      ["Layer", "Value (USD)", "Basis"],
      [
        [tam.label, usd(tam.valueUSD), "≈300M non-iCasino residents × ~$288/capita"],
        [sam.label, usd(sam.valueUSD), "AGA measured illegal online casino demand"],
        ["SOM (low–high)", usd(somLo.valueUSD) + "–" + usd(somHi.valueUSD), "0.5× Skillz trough → ~1.04× Skillz peak"]
      ]);
  }
  // crude monospace advance estimate for placing a badge after a label (≈6.1px/char @ 11px)
  function textAdvance(str) { return Math.round(str.length * 6.15) + 8; }

  // ===========================================================================
  // 3. QUADRANT — stakes (casual/mid/casino) × matching (async/realtime)
  // ===========================================================================
  // company name (as it appears in companies.json) -> logo slug. Unmapped or
  // asset-less companies fall back to a coloured monogram chip.
  var QUAD_SLUG = {
    "Skillz (Firy Inc.)": "skillz", "Papaya Gaming": "papaya", "AviaGames": "aviagames",
    "Triumph Labs": "triumph", "WorldWinner / Game Taco": "worldwinner",
    "Voodoo / Blitz - Win Cash": "voodoo", "MPL (Mobile Premier League)": "mpl",
    "WinZO": "winzo", "Zupee": "zupee", "Dream11 (Dream Sports)": "dream11",
    "DraftKings": "draftkings", "FanDuel": "fanduel", "PrizePicks": "prizepicks",
    "Underdog": "underdog", "Sleeper": "sleeper",
    "VGW (Chumba Casino, LuckyLand Slots, Global Poker)": "vgw",
    "Stake.us": "stakeus", "Toast (Carnival)": "toast"
  };
  function renderQuadrant(mount, companies) {
    var cols = ["casual", "mid", "casino"], colLabel = { casual: "Casual", mid: "Mid", casino: "Casino" };
    var rows = ["realtime", "async"], rowLabel = { realtime: "Real-time", async: "Async" };
    var W = 620, H = 380, padL = 92, padT = 30, padB = 46, padR = 16;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var cw = plotW / cols.length, ch = plotH / rows.length;

    // bucket companies by cell
    var cells = {};
    companies.forEach(function (c) {
      var k = c.quadrant.stakes + "|" + c.quadrant.matching;
      (cells[k] = cells[k] || []).push(c);
    });

    var s = svgOpen(W, H, "Two-by-two market map. Vertical axis: matching model (real-time vs async). Horizontal axis: stakes (casual, mid, casino). Toast is the only peer-to-peer entrant in the casino-stakes × real-time cell; VGW and Stake.us share that cell but are house-banked sweepstakes casinos, a different legal workaround, marked with a dashed border. Off the researched roster, crypto-native (bjb.gg) and B2B (Thndr) products also run real-time peer-to-peer real-money blackjack.", 520);
    // hatch pattern for house-banked markers
    s += '<defs><pattern id="q-hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
      '<line class="q-hatch-l" x1="0" y1="0" x2="0" y2="5"/></pattern></defs>';

    // highlight the casino×realtime headline cell
    var hx = padL + 2 * cw, hy = padT + 0 * ch;
    s += '<rect class="q-spot" x="' + hx + '" y="' + hy + '" width="' + cw + '" height="' + ch + '" rx="6"/>';

    // grid
    for (var ci = 0; ci <= cols.length; ci++) {
      var x = padL + ci * cw;
      s += '<line class="c-grid" x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + plotH) + '"/>';
    }
    for (var ri = 0; ri <= rows.length; ri++) {
      var y = padT + ri * ch;
      s += '<line class="c-grid" x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '"/>';
    }
    // axis labels
    cols.forEach(function (c, i) {
      s += '<text class="c-axis-label" x="' + (padL + i * cw + cw / 2) + '" y="' + (padT + plotH + 20) + '" text-anchor="middle">' + esc(colLabel[c]) + "</text>";
    });
    rows.forEach(function (r, i) {
      s += '<text class="c-axis-label" x="' + (padL - 10) + '" y="' + (padT + i * ch + ch / 2) + '" text-anchor="end" dominant-baseline="middle">' + esc(rowLabel[r]) + "</text>";
    });
    s += '<text class="c-axis-title" x="' + (padL + plotW / 2) + '" y="' + (H - 8) + '" text-anchor="middle">Stakes →</text>';
    s += '<text class="c-axis-title" x="' + 14 + '" y="' + (padT + plotH / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + (padT + plotH / 2) + ')">Matching model</text>';

    // dots packed per cell (qi = running index → staggered fade-in)
    var qi = 0;
    rows.forEach(function (r, ri2) {
      cols.forEach(function (c, ci2) {
        var list = cells[c + "|" + r] || [];
        if (!list.length) {
          if (c === "casino" && r === "realtime") return; // headline cell has entries
          return;
        }
        var cx0 = padL + ci2 * cw, cy0 = padT + ri2 * ch;
        var perRow = Math.ceil(Math.sqrt(list.length));
        var innerW = cw - 22, innerH = ch - 26;
        var stepX = innerW / perRow, stepY = innerH / Math.ceil(list.length / perRow);
        // one logo chip per company, sized to the cell's packing so dense
        // cells (casual×async has 8) never overlap.
        var sz = Math.max(18, Math.min(30, Math.min(stepX, stepY) - 8));
        list.forEach(function (co, k) {
          var gx = cx0 + 12 + (k % perRow) * stepX + stepX / 2;
          var gy = cy0 + 16 + Math.floor(k / perRow) * stepY + stepY / 2;
          var toast = /^Toast/.test(co.name);
          var house = co.houseBanked === true;
          var slug = QUAD_SLUG[co.name];
          var payload = quadPayload(co);
          var st = ' style="--i:' + (qi++) + '"';
          var x = (gx - sz / 2).toFixed(1), y = (gy - sz / 2).toFixed(1);
          var rx = (sz * 0.24).toFixed(1), pad = sz * 0.15;
          var cls = "q-mark q-chip" + (toast ? " q-toast" : "") + (house ? " q-house" : "");
          var inner;
          if (slug && slug !== "dream11") {
            var href = slug === "toast" ? "assets/toast-logo.png" : "assets/logos/" + slug + ".png";
            inner = '<rect class="q-chip-bg" x="' + x + '" y="' + y + '" width="' + sz + '" height="' + sz + '" rx="' + rx + '"/>' +
              '<image href="' + href + '" x="' + (gx - sz / 2 + pad).toFixed(1) + '" y="' + (gy - sz / 2 + pad).toFixed(1) +
              '" width="' + (sz - 2 * pad).toFixed(1) + '" height="' + (sz - 2 * pad).toFixed(1) + '" preserveAspectRatio="xMidYMid meet"/>';
          } else {
            // monogram fallback (dream11 has no reliable logo asset)
            var mono = slug === "dream11" ? "11" : (co.name[0] || "?");
            var fill = slug === "dream11" ? "#d13239" : "#3a3f47";
            inner = '<rect class="q-chip-bg" x="' + x + '" y="' + y + '" width="' + sz + '" height="' + sz + '" rx="' + rx + '" style="fill:' + fill + '"/>' +
              '<text class="q-chip-mono" x="' + gx + '" y="' + gy + '" text-anchor="middle" dominant-baseline="central" style="font-size:' + (sz * 0.46).toFixed(1) + 'px">' + esc(mono) + "</text>";
          }
          s += '<g class="' + cls + '"' + st + ' data-p="' + esc(payload) + '" tabindex="0" role="img" aria-label="' + esc(quadAria(co)) + '">' +
            '<g class="q-chip-inner">' + inner + "</g>" +
            (toast ? '<text class="q-toast-lbl" x="' + gx + '" y="' + (gy - sz / 2 - 5).toFixed(1) + '" text-anchor="middle">Toast</text>' : "") +
            "</g>";
        });
      });
    });
    s += "</svg>";
    mount.innerHTML = s;

    // hover / focus tooltips
    bindMarks(mount, ".q-mark");

    attachTable(mount, "Competitor positioning (stakes × matching)",
      ["Company", "Stakes", "Matching", "Model"],
      companies.map(function (co) {
        return [co.name + (co.houseBanked ? " (house-banked)" : ""), co.quadrant.stakes, co.quadrant.matching,
          co.houseBanked ? "house-banked sweepstakes" : "peer-to-peer"];
      }));
  }
  function quadAria(co) {
    return co.name + ", " + co.quadrant.stakes + " stakes, " + co.quadrant.matching + " matching, " +
      (co.houseBanked ? "house-banked (not peer-to-peer)" : "peer-to-peer");
  }
  function quadPayload(co) {
    return JSON.stringify({
      n: co.name, f: co.founded, m: co.model.split(" — ")[0],
      r: co.totalRaisedUSD ? usd(co.totalRaisedUSD) + " raised" : "raise undisclosed",
      h: !!co.houseBanked
    });
  }

  // ===========================================================================
  // 4. FUNDING DOT-TIMELINE — x = date, size = amount, colour Toast vs field
  // ===========================================================================
  function renderFunding(mount, funding) {
    var rounds = funding.slice().sort(function (a, b) { return ymToNum(a.date) - ymToNum(b.date); });
    var W = 700, padL = 16, padR = 16, padT = 44, padB = 40;
    var H = 300, plotW = W - padL - padR, plotH = H - padT - padB;
    var years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
    var xmin = 2020.5, xmax = 2026.0;
    function X(ym) { return padL + ((ymToNum(ym) - xmin) / (xmax - xmin)) * plotW; }
    var amax = Math.max.apply(null, rounds.map(function (r) { return r.amountUSD; }));
    var amin = Math.min.apply(null, rounds.map(function (r) { return r.amountUSD; }));
    // radius by sqrt(amount) → area ∝ amount, clamped to [6, 26]
    function R(a) {
      var t = (Math.sqrt(a) - Math.sqrt(amin)) / (Math.sqrt(amax) - Math.sqrt(amin));
      return 6 + t * 20;
    }
    var baseY = padT + plotH * 0.56;

    var s = svgOpen(W, H, "Funding dot-timeline of skill-gaming and P2P gaming rounds, 2020–2025. Dot area is proportional to round size, from Toast's " + usd(1.6e6) + " pre-seed to PrizePicks' " + usd(1.6e9) + " Allwyn deal. Toast is highlighted in the accent colour.", 640);
    // x axis
    s += '<line class="c-axis" x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (padL + plotW) + '" y2="' + (padT + plotH) + '"/>';
    years.forEach(function (y) {
      var x = padL + ((y - xmin) / (xmax - xmin)) * plotW;
      if (x < padL - 1 || x > padL + plotW + 1) return;
      s += '<line class="c-grid" x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + plotH) + '"/>';
      s += '<text class="c-axis-label" x="' + x + '" y="' + (padT + plotH + 18) + '" text-anchor="middle">' + y + "</text>";
    });

    // collision de-clutter: stack same-month dots vertically around baseY
    // place each round at its date; chip side scales with round size (keeps the
    // amount encoding). Then greedily nudge overlapping chips apart vertically —
    // this declutters exact-month AND near-month clusters (2021–22) alike, which
    // the old same-month-only stacking left overlapping.
    var placed = rounds.map(function (r) {
      return { r: r, x: X(r.date), y: baseY, sz: Math.max(15, Math.min(24, R(r.amountUSD) * 1.15)) };
    });
    var yLo = padT + 14, yHi = padT + plotH - 14;
    placed.slice().sort(function (a, b) { return a.x - b.x; }).forEach(function (p, i, arr) {
      var seen = arr.slice(0, i);
      function hits(y) {
        for (var j = 0; j < seen.length; j++) {
          var q = seen[j];
          if (Math.abs(p.x - q.x) < (p.sz + q.sz) / 2 + 3 && Math.abs(y - q.y) < (p.sz + q.sz) / 2 + 3) return true;
        }
        return false;
      }
      var step = 0, dir = 1, tries = 0;
      while (hits(p.y) && tries < 60) {
        step++; dir = -dir;
        p.y = Math.max(yLo, Math.min(yHi, baseY + dir * step * 7));
        tries++;
      }
    });

    // notable rounds get a direct label
    var labelSet = { "Skillz|2020-09": "Skillz $849M", "Dream11 (Dream Sports)|2021-11": "Dream11 $840M",
      "PrizePicks|2025-09": "PrizePicks $1.6B", "Toast|2025-09": "Toast $1.6M" };

    placed.forEach(function (p, i) {
      var r = p.r, toast = /^Toast/.test(r.company), sz = p.sz;
      var slug = logoSlug(r.company);
      s += '<g class="f-mark f-chip ' + (toast ? "f-toast" : "f-field") + '" style="--i:' + i + '" data-i="' + i + '" tabindex="0" role="img" aria-label="' +
        esc(r.company + " " + r.round + ", " + monthLabel(r.date) + ", " + usd(r.amountUSD)) + '">' +
        '<g class="q-chip-inner">' + chipInner(p.x - sz / 2, p.y - sz / 2, sz, slug, r.company) + "</g></g>";
      var key = r.company + "|" + r.date;
      if (labelSet[key]) {
        var above = p.y - sz / 2 - 6 > padT + 6;
        s += '<text class="f-lbl' + (toast ? " f-lbl-toast" : "") + '" x="' + p.x + '" y="' +
          (above ? (p.y - sz / 2 - 6) : (p.y + sz / 2 + 12)) + '" text-anchor="middle">' + esc(labelSet[key]) + "</text>";
      }
    });
    s += "</svg>";
    mount.innerHTML = s;

    wireHover(mount, ".f-mark", function (el) {
      var r = placed[+el.getAttribute("data-i")].r;
      return "<b>" + esc(r.company) + "</b><span class=\"tt-val\">" + usd(r.amountUSD) +
        "</span><span class=\"tt-meta\">" + esc(r.round) + " · " + monthLabel(r.date) + "</span>" +
        "<span class=\"tt-meta\">Lead: " + esc(r.lead) + "</span>";
    });

    attachTable(mount, "Funding rounds (chronological)",
      ["Company", "Round", "Date", "Amount", "Lead"],
      rounds.map(function (r) { return [r.company, r.round, monthLabel(r.date), usd(r.amountUSD), r.lead]; }));
  }

  // ===========================================================================
  // 5. SKLZ / FIRY LINE — monthly close, LOG scale, annotated
  // ===========================================================================
  function renderSklz(mount, market) {
    var series = market.sklzSeries;
    var W = 700, padL = 46, padR = 32, padT = 22, padB = 28;
    var H = 340, plotW = W - padL - padR, plotH = H - padT - padB;
    var ymin = 1, ymax = 1000; // log domain (covers $2.50 trough … $874 ATH)
    function Y(v) {
      var lv = Math.log10(Math.max(ymin, v));
      return padT + plotH - ((lv - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin))) * plotH;
    }
    function X(i) { return padL + (i / (series.length - 1)) * plotW; }
    var yticks = [1, 3, 10, 30, 100, 300, 1000];

    var s = svgOpen(W, H, "Line chart, log scale: Skillz / Firy (ticker SKLZ→FIRY) monthly closing share price from December 2020 to July 2026. It falls from a split-adjusted ~$400 at listing to an all-time-high $874 in February 2021, collapses about 99% to a $2.50 trough in March 2026, then rebounds to $8.54 by July 2026 after the Papaya verdict. Prices are split-adjusted for the June 2023 1-for-20 reverse split.", 600);

    // gridlines + y labels (log)
    yticks.forEach(function (t) {
      var y = Y(t);
      s += '<line class="c-grid" x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '"/>';
      s += '<text class="c-axis-label c-num" x="' + (padL - 8) + '" y="' + (y + 3) + '" text-anchor="end">$' + t + "</text>";
    });
    // x year ticks
    var seen = {};
    series.forEach(function (d, i) {
      var yr = d.date.slice(0, 4);
      // skip the single partial Dec-2020 point's year — it collides with the 2021 tick
      if (seen[yr] || yr === "2020") return; seen[yr] = 1;
      var x = X(i);
      s += '<text class="c-axis-label" x="' + x + '" y="' + (padT + plotH + 18) + '" text-anchor="middle">' + yr + "</text>";
    });
    s += '<text class="c-axis-title c-axis-title--y" x="12" y="' + (padT + plotH / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + (padT + plotH / 2) + ')">Monthly close · log scale (USD)</text>';

    // ---- gradient area fill under the line (emitted before the line so the
    // stroke rides on top). Fades in on scroll-reveal (sections-market.css).
    var dpath = series.map(function (d, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(d.close).toFixed(1); }).join(" ");
    var floorY = padT + plotH;
    var areaPath = "M" + X(0).toFixed(1) + " " + floorY.toFixed(1) + " " +
      series.map(function (d, i) { return "L" + X(i).toFixed(1) + " " + Y(d.close).toFixed(1); }).join(" ") +
      " L" + X(series.length - 1).toFixed(1) + " " + floorY.toFixed(1) + " Z";
    s += '<defs><linearGradient id="sklz-fill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop class="c-area-top" offset="0"/><stop class="c-area-bot" offset="1"/></linearGradient></defs>';
    s += '<path class="c-area" d="' + areaPath + '"/>';

    // the line — pathLength=1 lets the draw-in animation run in normalized units
    s += '<path class="c-line" pathLength="1" d="' + dpath + '"/>';

    // ---- annotations. Decluttered: four spread markers each with a short
    // connector to its label; the crowded 2026 cluster is NOT triple-labelled —
    // the latest point gets its own emphasized marker below. The full 68-point
    // series stays in the <details> data table.
    function idx(date) { for (var i = 0; i < series.length; i++) if (series[i].date === date) return i; return -1; }
    var anns = [
      { i: idx("2020-12"), t: "Listing ~$400", sub: "(IPO $17.89 pre-split)", place: "below" },
      { i: idx("2021-02"), t: "ATH $874", sub: "Feb 5, 2021", place: "above" },
      { i: idx("2023-06"), t: "1-for-20 reverse split", sub: "no false cliff (adjusted)", place: "below" },
      { i: idx("2026-03"), t: "Trough $2.50", sub: "−99.7% from ATH", place: "below" },
    ];
    anns.forEach(function (a) {
      if (a.i < 0) return;
      var x = X(a.i), y = Y(series[a.i].close), above = a.place === "above";
      var anchor = "middle";
      if (x < padL + 64) anchor = "start";
      else if (x > padL + plotW - 64) anchor = "end";
      var ty = above ? y - 14 : y + 18;
      var sy = above ? ty - 11 : ty + 11;
      // short connector from the data point to its label
      s += '<line class="c-ann-leader" x1="' + x.toFixed(1) + '" y1="' + (above ? y - 5 : y + 5).toFixed(1) +
        '" x2="' + x.toFixed(1) + '" y2="' + (above ? ty + 3 : ty - 9).toFixed(1) + '"/>';
      s += '<circle class="c-ann-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.2"/>';
      s += '<text class="c-ann" x="' + x + '" y="' + ty + '" text-anchor="' + anchor + '">' + esc(a.t) + "</text>";
      s += '<text class="c-ann c-ann-sub" x="' + x + '" y="' + sy + '" text-anchor="' + anchor + '">' + esc(a.sub) + "</text>";
    });

    // ---- emphasized latest point ($8.54, Jul 2026): halo + solid dot + label
    var li = series.length - 1, lx = X(li), ly = Y(series[li].close);
    s += '<circle class="c-last-halo" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="9"/>';
    s += '<circle class="c-last" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="4.5"/>';
    s += '<text class="c-ann c-ann-sub" x="' + (lx + 3) + '" y="' + (ly - 25) + '" text-anchor="end">' + monthLabel(series[li].date) + "</text>";
    s += '<text class="c-ann c-ann-latest" x="' + (lx + 3) + '" y="' + (ly - 13) + '" text-anchor="end">$' + series[li].close.toFixed(2) + "</text>";

    // crosshair + tooltip overlay
    s += '<line class="c-cross" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + plotH) + '" style="display:none"/>';
    s += '<circle class="c-cross-dot" r="4" style="display:none"/>';
    s += '<rect class="c-hit" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + plotH + '" fill="transparent"/>';
    s += "</svg>";
    mount.innerHTML = s;

    var svg = mount.querySelector("svg");
    var hit = svg.querySelector(".c-hit");
    var cross = svg.querySelector(".c-cross");
    var cdot = svg.querySelector(".c-cross-dot");
    function pt(evt) {
      var box = svg.getBoundingClientRect();
      var sx = W / box.width;
      var cx = evt.clientX != null ? evt.clientX : (evt.touches && evt.touches[0].clientX);
      return (cx - box.left) * sx;
    }
    function move(evt) {
      var vx = pt(evt);
      var i = Math.round(((vx - padL) / plotW) * (series.length - 1));
      i = Math.max(0, Math.min(series.length - 1, i));
      var d = series[i], x = X(i), y = Y(d.close);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.style.display = "";
      cdot.setAttribute("cx", x); cdot.setAttribute("cy", y); cdot.style.display = "";
      var ce = evt.clientX != null ? evt : (evt.touches && evt.touches[0]);
      showTip("<b>" + monthLabel(d.date) + "</b><span class=\"tt-val\">$" + d.close.toFixed(2) + "</span>",
        ce.clientX, ce.clientY);
    }
    function leave() { cross.style.display = "none"; cdot.style.display = "none"; hideTip(); }
    hit.addEventListener("mousemove", move);
    hit.addEventListener("mouseleave", leave);
    hit.addEventListener("touchmove", function (e) { move(e); }, { passive: true });
    hit.addEventListener("touchend", leave);

    attachTable(mount, "SKLZ / FIRY monthly close (split-adjusted)",
      ["Month", "Close (USD)"],
      series.map(function (d) { return [monthLabel(d.date), "$" + d.close.toFixed(2)]; }));
  }

  // ---- generic hover wiring (event delegation) ------------------------------
  function wireHover(mount, sel, html) {
    var svg = mount.querySelector("svg");
    if (!svg) return;
    svg.addEventListener("mouseover", function (e) {
      var el = e.target.closest(sel);
      if (!el) return;
      el.classList.add("is-hot");
      showTip(html(el), e.clientX, e.clientY);
    });
    svg.addEventListener("mousemove", function (e) {
      var el = e.target.closest(sel);
      if (el) showTip(html(el), e.clientX, e.clientY);
    });
    svg.addEventListener("mouseout", function (e) {
      var el = e.target.closest(sel);
      if (el) el.classList.remove("is-hot");
      hideTip();
    });
  }
  // for pre-serialised JSON payloads on marks (quadrant)
  function bindMarks(mount, sel) {
    var svg = mount.querySelector("svg");
    if (!svg) return;
    function render(el, cx, cy) {
      var p;
      try { p = JSON.parse(el.getAttribute("data-p")); } catch (e) { return; }
      var h = "<b>" + esc(p.n) + "</b><span class=\"tt-meta\">Founded " + esc(p.f) + " · " + esc(p.r) + "</span>" +
        "<span class=\"tt-meta\">" + esc(p.m) + "</span>" +
        (p.h ? "<span class=\"tt-flag\">house-banked — not P2P</span>" : "");
      showTip(h, cx, cy);
    }
    svg.addEventListener("mouseover", function (e) {
      var el = e.target.closest(sel); if (!el) return;
      el.classList.add("is-hot"); render(el, e.clientX, e.clientY);
    });
    svg.addEventListener("mousemove", function (e) {
      var el = e.target.closest(sel); if (el) render(el, e.clientX, e.clientY);
    });
    svg.addEventListener("mouseout", function (e) {
      var el = e.target.closest(sel); if (el) el.classList.remove("is-hot");
      hideTip();
    });
    svg.addEventListener("focusin", function (e) {
      var el = e.target.closest(sel); if (!el) return;
      var b = el.getBoundingClientRect();
      render(el, b.left + b.width / 2, b.top);
    });
    svg.addEventListener("focusout", hideTip);
  }

  // ---- dispatch / boot ------------------------------------------------------
  // ---- draw-on-scroll ------------------------------------------------------
  // Chart draw/fade animations are gated on `[data-chart].is-revealed` (see
  // sections-market.css). motion.js adds that class + fires a `reveal` event on
  // every [data-chart] mount; this self-observer is a belt-and-braces fallback
  // so charts still animate on scroll-in even if motion.js isn't present.
  // forecast-charts.js can hook the SAME contract: gate its CSS on
  // `[data-chart].is-revealed`, or `mount.addEventListener('reveal', draw)`.
  var revealIO = null;
  function armReveal(mount) {
    if (mount.classList.contains("is-revealed")) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) { mount.classList.add("is-revealed"); return; }
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("is-revealed"); revealIO.unobserve(e.target); }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    }
    revealIO.observe(mount);
  }

  function renderOne(mount) {
    if (mount.getAttribute("data-rendered")) return;
    var kind = mount.getAttribute("data-chart");
    try {
      if (kind === "market-bars") renderMarketBars(mount, DATA.market);
      else if (kind === "tam-sam-som") renderTamSamSom(mount, DATA.market);
      else if (kind === "quadrant") renderQuadrant(mount, DATA.companies);
      else if (kind === "funding") renderFunding(mount, DATA.funding);
      else if (kind === "sklz") renderSklz(mount, DATA.market);
      else return;
      mount.setAttribute("data-rendered", "1");
      armReveal(mount);
    } catch (err) {
      console.error("charts.js: failed to render " + kind, err);
    }
  }
  function boot() {
    if (!DATA) return;
    var mounts = document.querySelectorAll("[data-chart]:not([data-rendered])");
    if (!mounts.length) return;
    mounts.forEach(renderOne);
  }

  function load() {
    if (loading || DATA) return;
    loading = true;
    Promise.all([
      fetch("data/market.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
      fetch("data/companies.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }),
      fetch("data/funding.json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
    ]).then(function (res) {
      DATA = { market: res[0], companies: res[1], funding: res[2] };
      boot();
    }).catch(function (err) {
      console.warn("charts.js: could not load chart data — charts stay as their <figcaption>/table fallback. " +
        "If opened via file://, serve the site instead (python3 -m http.server from site/).", err);
    });
  }

  // Only fetch if there is (or might soon be) something to draw.
  function maybeStart() {
    if (document.querySelector("[data-chart]")) load();
  }

  // late-injected fragments: watch for [data-chart] appearing, then render.
  var mo = new MutationObserver(function () {
    if (!DATA) { maybeStart(); return; }
    boot();
  });
  if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener("DOMContentLoaded", function () {
    mo.observe(document.body, { childList: true, subtree: true });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeStart);
  } else {
    maybeStart();
  }
})();
