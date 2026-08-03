/* ============================================================
   Quant Trading Studio — story labs
   No dependencies. Deterministic (seeded). Nothing loads over the network.

   Every formula, constant and threshold below is transcribed from the
   repository source; the *data* the labs run on is seeded synthetic data
   chosen to make each mechanism legible.
   ============================================================ */
"use strict";

/* ---------------------------------------------------------------- utils */

var C = {
  ink:'#e9eff7', ink2:'#c3cddb', mut:'#8b98ad', dim:'#5d6a7d',
  grid:'#1a2130', panel:'#0f141d', bg:'#05070b',
  teal:'#35c9bd', blue:'#5aa2e8', green:'#52c97a',
  amber:'#d9a44f', purple:'#9b84dc', red:'#e26a62'
};

function rng(seed){
  var s = (seed >>> 0) || 1;
  return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(r){
  var u = 1 - r(), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }
function fmt(n){ return Math.round(n).toLocaleString('en-US'); }
function pct(n, d){ return (n * 100).toFixed(d === undefined ? 1 : d) + '%'; }

/* linear ramp helpers — scripts/backtest/investor_summary.py:611 */
function scoreHigher(v, bad, good){ return clamp((v - bad) / (good - bad), 0, 1); }
function scoreLower(v, bad, good){ return clamp((bad - v) / (bad - good), 0, 1); }

function fit(cv, h){
  var dpr = window.devicePixelRatio || 1;
  // Never trust the measured width: a canvas that has not been laid out yet reports ~0,
  // and every lab below does arithmetic like (w - padding) that must stay positive.
  var w = Math.max(300, cv.clientWidth || cv.parentElement.clientWidth || 600);
  cv.style.height = h + 'px';
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  var ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx: ctx, w: w, h: h };
}
function poly(ctx, pts, color, width){
  if (!pts.length) return;
  ctx.beginPath();
  for (var i = 0; i < pts.length; i++){
    if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]);
  }
  ctx.strokeStyle = color; ctx.lineWidth = width || 2;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();
}
function rrect(ctx, x, y, w, h, r){
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function dashed(ctx, x1, y1, x2, y2, color, dash){
  ctx.save(); ctx.setLineDash(dash || [5, 5]); ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function label(ctx, text, x, y, color, align, weight){
  ctx.fillStyle = color; ctx.textAlign = align || 'left';
  ctx.font = (weight || '400') + ' 11.5px ' + (getComputedStyle(document.body).fontFamily);
  ctx.fillText(text, x, y);
}
function maxDrawdown(series){
  var peak = series[0], worst = 0;
  for (var i = 0; i < series.length; i++){
    if (series[i] > peak) peak = series[i];
    var d = peak - series[i];
    if (d > worst) worst = d;
  }
  return worst;
}

/* Lab registry — nothing initialises until it scrolls into view. */
var LABS = [];
function Lab(anchorId, setup){ LABS.push({ id: anchorId, setup: setup, done: false }); }

function bootLabs(){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      var rec = LABS.filter(function(l){ return l.observed === e.target; })[0];
      if (!rec || rec.done) return;
      rec.done = true;
      io.unobserve(e.target);
      try { rec.api = rec.setup(rec.el); } catch (err){ /* a broken lab must not break the page */ }
    });
  }, { rootMargin: '140px 0px', threshold: 0 });

  LABS.forEach(function(rec){
    var el = document.getElementById(rec.id);
    if (!el) return;
    rec.el = el;
    // observe a laid-out ancestor: some hosts (empty grids) have zero height until filled
    rec.observed = el.closest('.lab, .reveal, .act') || el;
    io.observe(rec.observed);
  });

  // Safety net: mount anything already on screen once layout has settled, in case the
  // observer's first callback was missed. Idempotent — `done` guards a second mount.
  function sweep(){
    LABS.forEach(function(rec){
      if (rec.done || !rec.observed) return;
      var r = rec.observed.getBoundingClientRect();
      if (r.top > window.innerHeight + 140 || r.bottom < -140) return;
      rec.done = true;
      io.unobserve(rec.observed);
      try { rec.api = rec.setup(rec.el); } catch (e){}
    });
  }
  window.addEventListener('load', function(){ setTimeout(sweep, 200); });

  var t = null;
  window.addEventListener('resize', function(){
    clearTimeout(t);
    t = setTimeout(function(){
      LABS.forEach(function(r){ if (r.done && r.api && r.api.draw) { try { r.api.draw(); } catch (e){} } });
    }, 140);
  }, { passive: true });
}

/* progress bar */
window.addEventListener('scroll', function(){
  var doc = document.documentElement;
  var st = doc.scrollTop || document.body.scrollTop;
  var sh = (doc.scrollHeight || document.body.scrollHeight) - doc.clientHeight;
  var bar = document.getElementById('pbar');
  if (bar) bar.style.width = (sh > 0 ? (st / sh * 100) : 0) + '%';
}, { passive: true });


/* ================================================================
   ACT 1 — Edge fragility  (scripts/backtest/analytics.py:1057)
   ================================================================ */
Lab('cv-frag', function(cv){
  var seed = 11, trades = [];
  var elN = document.getElementById('frag-n');
  var elPf = document.getElementById('frag-pf');
  var elShare = document.getElementById('frag-share');
  var elPf3 = document.getElementById('frag-pf3');
  var elScore = document.getElementById('frag-score');
  var elV = document.getElementById('frag-v');
  var slider = document.getElementById('frag-remove');

  function build(){
    var r = rng(seed);
    trades = [];
    for (var i = 0; i < 30; i++) trades.push(-(28 + r() * 42));
    for (var j = 0; j < 17; j++) trades.push(38 + r() * 40);
    for (var k = 0; k < 3; k++) trades.push(760 + r() * 340);
    // deterministic shuffle so the giants are scattered through the year
    for (var m = trades.length - 1; m > 0; m--){
      var n = Math.floor(r() * (m + 1));
      var tmp = trades[m]; trades[m] = trades[n]; trades[n] = tmp;
    }
  }

  /* faithful port of _edge_fragility + the Structure pillar.
     At removeN = 0 this is exactly what the pillar computes for the real strategy;
     above 0 the reader is asking the same question of what would have been left. */
  function pfWithoutTop(list, n){
    var desc = list.slice().sort(function(a, b){ return b - a; });
    var rem = {};
    for (var i = 0; i < n && i < desc.length; i++){
      for (var j = 0; j < list.length; j++){ if (list[j] === desc[i] && !rem[j]){ rem[j] = true; break; } }
    }
    var w = 0, l = 0;
    for (var t = 0; t < list.length; t++){
      if (rem[t]) continue;
      if (list[t] > 0) w += list[t]; else l += -list[t];
    }
    return l > 0 ? w / l : 0;
  }

  function evaluate(removeN){
    var sortedDesc = trades.slice().sort(function(a, b){ return b - a; });
    var removeSet = {};
    for (var i = 0; i < removeN; i++){
      for (var j = 0; j < trades.length; j++){
        if (trades[j] === sortedDesc[i] && !removeSet[j]) { removeSet[j] = true; break; }
      }
    }
    var kept = [], wins = 0, losses = 0, winN = 0, lossN = 0;
    for (var t = 0; t < trades.length; t++){
      if (removeSet[t]) continue;
      kept.push(trades[t]);
      if (trades[t] > 0){ wins += trades[t]; winN++; } else { losses += -trades[t]; lossN++; }
    }
    var pf = losses > 0 ? wins / losses : 0;

    var keptDesc = kept.slice().sort(function(a, b){ return b - a; });
    var gross = wins;
    var top3 = keptDesc.slice(0, 3).reduce(function(a, b){ return a + Math.max(0, b); }, 0);
    var shareTop3 = gross > 0 ? top3 / gross * 100 : 0;
    var pfNoTop3 = pfWithoutTop(kept, 3);

    var avgWin = winN ? wins / winN : 0, avgLoss = lossN ? losses / lossN : 0;
    var winRate = kept.length ? winN / kept.length : 0;
    var beWr = (avgWin + avgLoss) > 0 ? avgLoss / (avgWin + avgLoss) : 1;
    var payoff = avgLoss > 0 ? avgWin / avgLoss : 0;

    var score =
        scoreHigher(winRate - beWr, 0.0, 0.08) * 28
      + scoreHigher(payoff, 1.0, 2.2) * 24
      + scoreLower(shareTop3, 65.0, 30.0) * 24
      + scoreHigher(pfNoTop3, 1.0, 1.35) * 24;
    var capped = false;
    if (winRate <= beWr || payoff <= 1.0){ score = Math.min(score, 54); capped = true; }
    if (pfNoTop3 > 0 && pfNoTop3 < 1.0){ score = Math.min(score, 54); capped = true; }

    return { pf: pf, shareTop3: shareTop3, pfNoTop3: pfNoTop3, score: Math.round(score),
             capped: capped, removeSet: removeSet, sortedDesc: sortedDesc };
  }

  function draw(){
    var n = parseInt(slider.value, 10);
    var res = evaluate(n);
    var d = fit(cv, 260), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

    var padL = 46, padR = 14, padT = 22, padB = 26;
    var maxAbs = Math.max.apply(null, trades.map(Math.abs)) * 1.08;
    var zeroY = padT + (h - padT - padB) / 2;
    var half = (h - padT - padB) / 2;
    var bw = (w - padL - padR) / trades.length;

    dashed(ctx, padL, zeroY, w - padR, zeroY, C.grid, [3, 3]);
    label(ctx, '+$', padL - 10, padT + 8, C.dim, 'right');
    label(ctx, '$0', padL - 10, zeroY + 4, C.mut, 'right');
    label(ctx, '−$', padL - 10, h - padB - 2, C.dim, 'right');
    label(ctx, 'each bar is one closed trade, in time order', padL, h - 8, C.dim, 'left');

    var top3Cut = res.sortedDesc[2];
    for (var i = 0; i < trades.length; i++){
      var v = trades[i];
      var bh = Math.abs(v) / maxAbs * half;
      var x = padL + i * bw;
      var y = v >= 0 ? zeroY - bh : zeroY;
      var isGiant = v >= top3Cut;
      var removed = !!res.removeSet[i];
      if (removed){
        ctx.fillStyle = 'rgba(120,132,152,.16)';
        ctx.fillRect(x + .6, y, Math.max(1.4, bw - 1.6), bh);
        ctx.strokeStyle = 'rgba(226,106,98,.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + .6, zeroY); ctx.lineTo(x + bw - 1, v >= 0 ? y : y + bh); ctx.stroke();
      } else {
        ctx.fillStyle = v >= 0 ? (isGiant ? 'rgba(217,164,79,.92)' : 'rgba(82,201,122,.72)')
                               : 'rgba(226,106,98,.55)';
        ctx.fillRect(x + .6, y, Math.max(1.4, bw - 1.6), bh);
      }
    }
    // annotate the giants
    var lit = 0;
    for (var g = 0; g < trades.length; g++){
      if (trades[g] >= top3Cut && !res.removeSet[g] && lit < 3){
        var gx = padL + g * bw + bw / 2;
        var gy = zeroY - Math.abs(trades[g]) / maxAbs * half;
        label(ctx, '▲', gx, gy - 6, C.amber, 'center', '700');
        lit++;
      }
    }
    label(ctx, n > 0 ? n + ' removed' : 'the three amber bars are the whole edge',
          w - padR, padT - 6, n > 0 ? C.red : C.amber, 'right', '700');

    elN.textContent = n;
    elPf.textContent = res.pf > 0 ? res.pf.toFixed(2) : '—';
    elPf.style.color = res.pf < 1 ? C.red : C.ink;
    elShare.textContent = res.shareTop3.toFixed(1) + '%';
    elPf3.textContent = res.pfNoTop3.toFixed(2);
    elPf3.style.color = res.pfNoTop3 < 1 ? C.red : C.ink;
    elScore.textContent = res.score + ' / 100';
    elScore.style.color = res.score <= 54 ? C.red : C.ink;

    var v = elV;
    v.className = 'verdict show ' + (res.pfNoTop3 < 1 ? 'bad' : 'good');
    if (n === 0){
      v.innerHTML = 'Profit factor <span class="hl">' + res.pf.toFixed(2) + '</span> — on a scorecard, a good year. ' +
        'But <b>' + res.shareTop3.toFixed(0) + '%</b> of the gross profit came from three trades, and ' +
        '<code>pf_without_top3</code> is <span class="bad">' + res.pfNoTop3.toFixed(2) + '</span>. ' +
        'Two of the four Structure terms therefore score <b>zero</b>, and the sub-1.0 reading trips a hard cap at 54 ' +
        'as a backstop — so the pillar reads <span class="bad">' + res.score + '</span> while the headline number still ' +
        'says 2.8. Now remove them and watch the headline agree.';
    } else if (res.pf < 1){
      v.innerHTML = '<b>Profit factor ' + res.pf.toFixed(2) + '.</b> Below 1.0 — what is left can no longer pay ' +
        'for the losses. The pillar knew this at zero removals; the equity curve took ' + n + '. ' +
        'The edge was ' + (n <= 3 ? 'three trades' : n + ' trades') + ' wearing a strategy’s clothes.';
    } else {
      v.innerHTML = 'Profit factor <span class="hl">' + res.pf.toFixed(2) + '</span> after removing ' + n + '. ' +
        'Still above water — but <code>pf_without_top3</code> on what remains is ' +
        '<span class="' + (res.pfNoTop3 < 1 ? 'bad' : 'ok') + '">' + res.pfNoTop3.toFixed(2) + '</span>, ' +
        'so the same question just moves down the list.';
    }
  }

  build(); draw();
  slider.addEventListener('input', draw);
  document.getElementById('frag-shuffle').addEventListener('click', function(){
    seed += 17; build();
    slider.value = 0;
    draw();
  });
  return { draw: draw };
});


/* ================================================================
   ACT 2 — Rolling vs full-sample percentile
   (tool1_labeler/feature_extractor.py:131, config.py:15)
   ================================================================ */
Lab('cv-roll', function(cv){
  var N = 1000, price = [], vol = [];
  var elWin = document.getElementById('roll-win'), elWinV = document.getElementById('roll-win-v');
  var elWarm = document.getElementById('roll-warm'), elWarmV = document.getElementById('roll-warm-v');

  (function build(){
    var r = rng(404), p = 100;
    // two structural volatility eras, with real local bursts and calms inside each
    for (var i = 0; i < N; i++){
      var era = i < N * 0.5 ? 0.0055 : 0.0165;
      var burst = 1;
      if (i > 150 && i < 195) burst = 3.2;        // a real crisis inside the calm era
      if (i > 620 && i < 700) burst = 0.32;       // a real lull inside the wild era
      var sig = era * burst;
      p *= (1 + gauss(r) * sig + 0.00035);
      price.push(p);
      vol.push(sig);
    }
  })();

  // realized vol: trailing 20-day stdev of returns, annualised — feature_extractor.py:95
  var realized = (function(){
    var out = [], W = 20;
    for (var i = 0; i < N; i++){
      if (i < W){ out.push(null); continue; }
      var m = 0, rets = [];
      for (var k = i - W + 1; k <= i; k++){ var rr = Math.log(price[k] / price[k - 1]); rets.push(rr); m += rr; }
      m /= W;
      var s = 0; for (var q = 0; q < rets.length; q++) s += (rets[q] - m) * (rets[q] - m);
      out.push(Math.sqrt(s / W) * Math.sqrt(252));
    }
    return out;
  })();

  /* mid-rank percentile — scripts/market_analysis/common/stats.py:58 */
  function midRank(window, v){
    var less = 0, equal = 0;
    for (var i = 0; i < window.length; i++){
      if (window[i] < v) less++; else if (window[i] === v) equal++;
    }
    return (less + 0.5 * equal) / window.length;
  }

  // the broken version — ranked against the whole history, including the future. Computed once.
  var ALL = realized.filter(function(x){ return x !== null; });
  var FIXED = realized.map(function(v){ return v === null ? null : midRank(ALL, v); });

  function rollSeries(win, warm){
    var roll = new Array(N);
    for (var i = 0; i < N; i++){
      if (realized[i] === null){ roll[i] = null; continue; }
      var v = realized[i], lo = Math.max(0, i - win + 1);
      var less = 0, equal = 0, count = 0;
      for (var k = lo; k <= i; k++){
        var x = realized[k];
        if (x === null) continue;
        count++;
        if (x < v) less++; else if (x === v) equal++;
      }
      roll[i] = count < warm ? null : (less + 0.5 * equal) / count;   // warmup gate
    }
    return roll;
  }

  function draw(){
    var win = parseInt(elWin.value, 10), warm = parseInt(elWarm.value, 10);
    elWinV.textContent = win; elWarmV.textContent = warm;
    var s = { fixed: FIXED, roll: rollSeries(win, warm) };
    var TH = 0.55;   // config.py:40 high_vol_threshold

    var d = fit(cv, 330), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var padL = 12, padR = 12, priceH = 168, ribH = 30, gap = 15, topPad = 20;

    // price
    var mn = Math.min.apply(null, price), mx = Math.max.apply(null, price);
    var pts = [];
    for (var i = 0; i < N; i++){
      pts.push([padL + i / (N - 1) * (w - padL - padR),
                topPad + priceH - (price[i] - mn) / (mx - mn) * (priceH - 14)]);
    }
    ctx.save();
    var grad = ctx.createLinearGradient(0, topPad, 0, topPad + priceH);
    grad.addColorStop(0, 'rgba(53,201,189,.14)'); grad.addColorStop(1, 'rgba(53,201,189,0)');
    ctx.beginPath(); ctx.moveTo(pts[0][0], topPad + priceH);
    for (var q = 0; q < pts.length; q++) ctx.lineTo(pts[q][0], pts[q][1]);
    ctx.lineTo(pts[pts.length - 1][0], topPad + priceH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill(); ctx.restore();
    poly(ctx, pts, 'rgba(210,224,238,.9)', 1.5);

    // era divider
    var mid = padL + 0.5 * (w - padL - padR);
    dashed(ctx, mid, topPad - 6, mid, topPad + priceH + 6, 'rgba(139,152,173,.35)', [3, 4]);
    label(ctx, 'structurally calm era', padL + 8, topPad + 12, C.dim, 'left');
    label(ctx, 'structurally wild era', w - padR - 8, topPad + 12, C.dim, 'right');

    function ribbon(arr, y, title, note){
      label(ctx, title, padL, y - 6, C.mut, 'left', '700');
      label(ctx, note, w - padR, y - 6, C.dim, 'right');
      var bw = (w - padL - padR) / N;
      for (var i = 0; i < N; i++){
        var v = arr[i], col;
        if (v === null) col = 'rgba(93,106,125,.28)';
        else col = v >= TH ? 'rgba(217,164,79,.95)' : 'rgba(53,201,189,.6)';
        ctx.fillStyle = col;
        ctx.fillRect(padL + i * bw, y, Math.max(1, bw + .5), ribH);
      }
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      ctx.strokeRect(padL + .5, y + .5, w - padL - padR - 1, ribH - 1);
    }

    var y1 = topPad + priceH + gap + 14;
    ribbon(s.fixed, y1, 'FULL-SAMPLE PERCENTILE', 'the version that lies');
    var y2 = y1 + ribH + gap + 14;
    ribbon(s.roll, y2, 'ROLLING ' + win + '-DAY PERCENTILE', 'what Tool 1 runs');

    label(ctx, '■ high volatility (≥ 0.55)', padL, y2 + ribH + 16, C.amber, 'left');
    label(ctx, '■ calm', padL + 148, y2 + ribH + 16, C.teal, 'left');
    label(ctx, '■ no label — warmup', padL + 208, y2 + ribH + 16, C.dim, 'left');

    // readouts
    var halfN = Math.floor(N / 2), fH = 0, rH = 0, warmN = 0;
    for (var t = 0; t < halfN; t++){
      if (s.fixed[t] !== null && s.fixed[t] >= TH) fH++;
      if (s.roll[t] !== null && s.roll[t] >= TH) rH++;
    }
    for (var u = 0; u < N; u++) if (s.roll[u] === null) warmN++;
    document.getElementById('roll-fixed').textContent = fH + ' d';
    document.getElementById('roll-rollv').textContent = rH + ' d';
    document.getElementById('roll-warmcount').textContent = warmN + ' d';

    var v = document.getElementById('roll-v');
    var brokenish = win >= N * 0.6;
    v.className = 'verdict show ' + (brokenish || warm > win ? 'bad' : (fH < 8 && rH > 20 ? 'good' : ''));
    if (warm > win){
      v.innerHTML = '<b>Nothing is labelled at all.</b> The warmup floor (' + warm + ') is larger than the ' +
        'window (' + win + '), so no day ever accumulates enough observations to be ranked. The code returns ' +
        '<code>None</code>, that propagates to a forced R6 label at confidence 0.10, and the whole series is ' +
        'excluded from training. Refusing to answer is a valid output — and this is what it costs.';
    } else if (brokenish){
      v.innerHTML = '<b>The window is now most of the history</b>, so the rolling ribbon has collapsed into ' +
        'the full-sample one. Both say the same useless thing: the calm era was calm and the wild era was wild.';
    } else {
      v.innerHTML = 'The full-sample ribbon marks <span class="bad">' + fH + ' days</span> of the calm era as ' +
        'high-volatility; the rolling one marks <span class="ok">' + rH + '</span>. ' +
        'The crisis inside the calm era is real and the full-sample statistic cannot see it — ' +
        'it is only comparing the past against numbers the future produced. ' +
        (warmN > 0 ? 'And <b>' + warmN + ' days</b> carry no label at all: below <code>min_percentile_observations</code> the code returns nothing rather than a partial window.' : '');
    }
  }

  draw();
  elWin.addEventListener('input', draw);
  elWarm.addEventListener('input', draw);
  return { draw: draw };
});


/* ================================================================
   ACT 3 — Causal smoothing  (tool1_labeler/smoother.py:66)
   ================================================================ */
Lab('cv-reg', function(cv){
  var W = 168;
  var trueMem = [], rawMem = [], volIdx = [], conf = [], px = [];
  var REG = {
    'trend|hi':  ['R2', 'Crisis Trend',  C.blue],
    'trend|lo':  ['R1', 'Slow Trend',    C.teal],
    'revert|hi': ['R4', 'Volatile Chop', C.amber],
    'revert|lo': ['R3', 'Tight Range',   C.green],
    'random|hi': ['R6', 'Noise',         C.red],
    'random|lo': ['R5', 'Drift',         C.purple]
  };
  var ORDER = ['trend|lo', 'trend|hi', 'revert|lo', 'revert|hi', 'random|lo', 'random|hi'];

  (function build(){
    var r = rng(97);
    var blocks = [['trend', 24], ['revert', 19], ['random', 11], ['trend', 31],
                  ['revert', 24], ['random', 14], ['trend', 27], ['revert', 18]];
    var kinds = ['trend', 'revert', 'random'];
    blocks.forEach(function(b){ for (var i = 0; i < b[1]; i++) trueMem.push(b[0]); });
    trueMem = trueMem.slice(0, W);
    while (trueMem.length < W) trueMem.push('random');

    var p = 100;
    for (var t = 0; t < W; t++){
      // raw label is noisy: ~18% of weeks read as a different memory state
      var m = trueMem[t];
      if (r() < 0.18){ var alt = kinds[Math.floor(r() * 3)]; m = alt; }
      rawMem.push(m);
      var base = (t > 46 && t < 78) || (t > 118 && t < 142) ? 0.63 : 0.44;
      volIdx.push(clamp(base + gauss(r) * 0.11, 0, 1));
      conf.push(clamp(0.45 + r() * 0.5, 0, 1));
      p *= (1 + gauss(r) * 0.013 + (trueMem[t] === 'trend' ? 0.004 : 0));
      px.push(p);
    }
  })();

  function labelAt(i, th){ return rawMem[i] + '|' + (volIdx[i] >= th ? 'hi' : 'lo'); }

  /* faithful port of smooth_regime_labels + _candidate_is_confirmed */
  function smooth(confirmWeeks, th){
    var CONF_HI = 3, HI_TH = 0.75;
    var out = [], confirmed = null, candidate = null, streak = 0, cands = [];
    for (var i = 0; i < W; i++){
      var raw = labelAt(i, th);
      if (confirmed === null){ confirmed = raw; out.push(confirmed); continue; }
      if (raw === confirmed){ candidate = null; streak = 0; cands = []; out.push(confirmed); continue; }
      if (candidate !== raw){ candidate = raw; streak = 1; cands = [conf[i]]; }
      else { streak++; cands.push(conf[i]); }

      var ok = streak >= confirmWeeks;
      if (!ok && streak >= CONF_HI && cands.length >= CONF_HI){
        ok = cands.every(function(c){ return c >= HI_TH; });
      }
      if (ok){ confirmed = raw; candidate = null; streak = 0; cands = []; out.push(confirmed); continue; }
      out.push(confirmed);   // keep the OLD label; this week is a transition week
    }
    return out;
  }

  function segments(labels){
    var segs = [], cur = labels[0], len = 1;
    for (var i = 1; i < labels.length; i++){
      if (labels[i] === cur) len++;
      else { segs.push({ label: cur, len: len }); cur = labels[i]; len = 1; }
    }
    segs.push({ label: cur, len: len });
    return segs;
  }

  var gridEl = document.getElementById('reg-grid');
  ORDER.forEach(function(k){
    var n = REG[k];
    var el = document.createElement('div');
    el.className = 'cell'; el.id = 'rgc-' + n[0];
    el.style.setProperty('--c', n[2]);
    el.innerHTML = '<b>' + n[0] + ' <i data-c="' + n[0] + '">0</i></b><span>' + n[1] + '</span>';
    gridEl.appendChild(el);
  });

  function draw(){
    var cw = parseInt(document.getElementById('reg-confirm').value, 10);
    var th = parseInt(document.getElementById('reg-vol').value, 10) / 100;
    document.getElementById('reg-confirm-v').textContent = cw;
    document.getElementById('reg-vol-v').textContent = th.toFixed(2);

    var raw = [], i;
    for (i = 0; i < W; i++) raw.push(labelAt(i, th));
    var sm = smooth(cw, th);
    var segs = segments(sm);

    var d = fit(cv, 300), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var padL = 12, padR = 12, top = 18, priceH = 108, ribH = 34, gap = 34;
    var bw = (w - padL - padR) / W;

    // price
    var mn = Math.min.apply(null, px), mx = Math.max.apply(null, px), pts = [];
    for (i = 0; i < W; i++){
      pts.push([padL + i / (W - 1) * (w - padL - padR),
                top + priceH - (px[i] - mn) / (mx - mn) * (priceH - 10)]);
    }
    poly(ctx, pts, 'rgba(200,214,230,.75)', 1.4);

    function ribbon(labels, y, title, note, noteCol){
      label(ctx, title, padL, y - 7, C.mut, 'left', '700');
      label(ctx, note, w - padR, y - 7, noteCol || C.dim, 'right', '700');
      for (var k = 0; k < W; k++){
        var meta = REG[labels[k]];
        ctx.fillStyle = meta ? meta[2] : '#555';
        ctx.globalAlpha = .85;
        ctx.fillRect(padL + k * bw, y, Math.max(1, bw + .4), ribH);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.strokeRect(padL + .5, y + .5, w - padL - padR - 1, ribH - 1);
    }

    var y1 = top + priceH + gap;
    ribbon(raw, y1, 'RAW WEEKLY LABEL', 'noisy by nature');
    var y2 = y1 + ribH + gap;
    ribbon(sm, y2, 'AFTER CAUSAL SMOOTHING', 'confirm_weeks = ' + cw, C.teal);

    // segment boundaries on the smoothed ribbon
    var acc = 0;
    for (var s = 0; s < segs.length - 1; s++){
      acc += segs[s].len;
      var x = padL + acc * bw;
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y2 - 4); ctx.lineTo(x, y2 + ribH + 4); ctx.stroke();
    }

    // stats
    var oneWeek = segs.filter(function(x){ return x.len === 1; }).length;
    var onePct = segs.length ? oneWeek / segs.length : 0;
    var lens = segs.map(function(x){ return x.len; }).sort(function(a, b){ return a - b; });
    var median = lens.length ? (lens.length % 2 ? lens[(lens.length - 1) / 2]
                : (lens[lens.length / 2 - 1] + lens[lens.length / 2]) / 2) : 0;

    // lag at the last true memory turn that still has room to be measured
    var turn = -1;
    for (i = W - 20; i > 0; i--){ if (trueMem[i] !== trueMem[i - 1]){ turn = i; break; } }
    var lag = 0;
    if (turn > 0){
      var before = sm[turn - 1], found = -1;
      for (i = turn; i < W; i++){ if (sm[i] !== before){ found = i; break; } }
      lag = found < 0 ? (W - turn) : (found - turn);
      var tx = padL + turn * bw;
      dashed(ctx, tx, y2 - 12, tx, y2 + ribH + 12, 'rgba(255,255,255,.5)', [2, 3]);
      label(ctx, 'true turn', tx + 4, y2 - 16, C.ink2, 'left');
      if (found >= 0 && found > turn){
        var fx = padL + found * bw;
        ctx.strokeStyle = 'rgba(226,106,98,.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx, y2 + ribH + 9); ctx.lineTo(fx, y2 + ribH + 9); ctx.stroke();
        label(ctx, lag + 'w late', (tx + fx) / 2, y2 + ribH + 24, C.red, 'center', '700');
      }
    }

    document.getElementById('reg-segs').textContent = segs.length;
    document.getElementById('reg-median').textContent = median + ' w';
    document.getElementById('reg-oneweek').textContent = pct(onePct, 0);
    document.getElementById('reg-lag').textContent = lag + ' w';

    // regime grid counts
    var counts = {};
    sm.forEach(function(l){ counts[l] = (counts[l] || 0) + 1; });
    ORDER.forEach(function(k){
      var meta = REG[k], cell = document.getElementById('rgc-' + meta[0]);
      var c = counts[k] || 0;
      cell.classList.toggle('lit', c > 0);
      cell.querySelector('i').textContent = c + 'w';
    });

    // validator verdict — tool1_labeler/validator.py:233
    var fail = (median < 2) || (onePct >= 0.35) || (segs.length / (W / 52) > 12);
    var warn = !fail && (median < 4 || onePct >= 0.20 || segs.length / (W / 52) > 8);
    var v = document.getElementById('reg-v');
    v.className = 'verdict show ' + (fail ? 'bad' : (warn ? '' : 'good'));
    if (fail){
      v.innerHTML = '<b>Map quality: FAIL.</b> ' + pct(onePct, 0) + ' of segments last a single week ' +
        '(median ' + median + 'w). The labeler grades its own output and rejects this — a regime map ' +
        'that flips weekly cannot be used to split time, because there is no second occurrence of ' +
        'anything to validate on.';
    } else if (lag >= 6){
      v.innerHTML = '<b>Map quality: clean, and blind.</b> Segments are long and stable, but the last real ' +
        'turn took <span class="bad">' + lag + ' weeks</span> to show up. Stubbornness has a price and this is it: ' +
        'you get an honest map of the past and a late one of the present.';
    } else {
      v.innerHTML = '<b>Map quality: pass.</b> ' + segs.length + ' segments, median ' + median + ' weeks, ' +
        pct(onePct, 0) + ' one-week. The turn was caught <span class="ok">' + lag + ' weeks</span> late — ' +
        'the cost of requiring ' + cw + ' consecutive weeks before believing a change.';
    }
  }

  draw();
  document.getElementById('reg-confirm').addEventListener('input', draw);
  document.getElementById('reg-vol').addEventListener('input', draw);
  return { draw: draw };
});


/* ================================================================
   ACT 4 — Quality coverage  (optimizer/auto/coverage.py:16)
   ================================================================ */
Lab('cv-cov', function(cv){
  var P = 2000, BINS = 40, passes = [];
  (function build(){
    var r = rng(7331);
    function landscape(x){
      var a = Math.exp(-Math.pow((x - 0.30) / 0.135, 2)) * 1.00;   // global best basin
      var b = Math.exp(-Math.pow((x - 0.70) / 0.150, 2)) * 0.94;   // secondary basin
      var c = Math.exp(-Math.pow((x - 0.50) / 0.230, 2)) * 0.86;   // broad shoulder between them
      return (a + b + c) * 100;
    }
    for (var i = 0; i < P; i++){
      // GA concentrates near the basins; the tails are visited but never scored well
      var x;
      var u = r();
      if (u < 0.50) x = clamp(0.30 + gauss(r) * 0.10, 0, 1);
      else if (u < 0.80) x = clamp(0.70 + gauss(r) * 0.11, 0, 1);
      else x = r();
      var s = Math.max(1, landscape(x) + gauss(r) * 7);
      passes.push({ x: x, s: s });
    }
  })();

  var best = Math.max.apply(null, passes.map(function(p){ return p.s; }));
  var binBest = new Array(BINS).fill(-Infinity);
  var binCount = new Array(BINS).fill(0);
  passes.forEach(function(p){
    var b = Math.min(BINS - 1, Math.floor(p.x * BINS));
    binCount[b]++;
    if (p.s > binBest[b]) binBest[b] = p.s;
  });

  function analyse(qr){
    qr = clamp(qr, 0, 0.999);                       // coverage.py:34
    var th = best * qr;
    var covered = binBest.map(function(v){ return v >= th; });
    var covPct = covered.filter(Boolean).length / BINS;
    var gaps = [], run = 0;
    for (var i = 0; i <= BINS; i++){
      if (i < BINS && !covered[i]) run++;
      else { if (run > 0){ var ratio = run / BINS; if (ratio >= 0.05) gaps.push({ start: i - run, len: run, ratio: ratio }); } run = 0; }
    }
    return { th: th, covered: covered, covPct: covPct, gaps: gaps };
  }

  function draw(){
    var qr = parseInt(document.getElementById('cov-q').value, 10) / 1000;
    document.getElementById('cov-q-v').textContent = qr.toFixed(3);
    var a = analyse(qr);

    var d = fit(cv, 300), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var padL = 44, padR = 16, padT = 22, scatterH = 196, binY = padT + scatterH + 16, binH = 26;
    var X = function(x){ return padL + x * (w - padL - padR); };
    var Y = function(s){ return padT + scatterH - (s / (best * 1.06)) * scatterH; };

    // gap bands behind everything
    a.gaps.forEach(function(g){
      var x0 = X(g.start / BINS), x1 = X((g.start + g.len) / BINS);
      ctx.fillStyle = 'rgba(217,164,79,.09)';
      ctx.fillRect(x0, padT - 6, x1 - x0, scatterH + 6);
    });

    // axes
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT - 6); ctx.lineTo(padL, padT + scatterH);
    ctx.lineTo(w - padR, padT + scatterH); ctx.stroke();
    label(ctx, 'score', padL - 8, padT + 4, C.dim, 'right');
    label(ctx, 'one parameter’s domain →', padL, h - 8, C.dim, 'left');

    // passes
    for (var i = 0; i < passes.length; i++){
      var p = passes[i];
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.s), 1.7, 0, 6.283);
      ctx.fillStyle = p.s >= a.th ? 'rgba(82,201,122,.55)' : 'rgba(120,140,175,.28)';
      ctx.fill();
    }

    // threshold line
    var ty = Y(a.th);
    dashed(ctx, padL, ty, w - padR, ty, 'rgba(53,201,189,.85)', [6, 4]);
    label(ctx, 'quality bar = ' + qr.toFixed(3) + ' × best', w - padR, ty - 7, C.teal, 'right', '700');

    // bins
    var bwid = (w - padL - padR) / BINS;
    for (var b = 0; b < BINS; b++){
      ctx.fillStyle = a.covered[b] ? 'rgba(82,201,122,.72)' : 'rgba(217,164,79,.75)';
      ctx.fillRect(padL + b * bwid + .6, binY, bwid - 1.2, binH);
    }
    label(ctx, 'covered', padL, binY + binH + 15, C.green, 'left', '700');
    label(ctx, 'gap — no near-best score was ever found here', padL + 62, binY + binH + 15, C.amber, 'left');

    document.getElementById('cov-pct').textContent = pct(a.covPct, 0);
    document.getElementById('cov-gaps').textContent = a.gaps.length;
    var widest = a.gaps.reduce(function(m, g){ return Math.max(m, g.ratio); }, 0);
    document.getElementById('cov-widest').textContent = widest > 0 ? pct(widest, 0) + ' of domain' : '—';

    var v = document.getElementById('cov-v');
    if (qr <= 0.02){
      v.className = 'verdict show bad';
      v.innerHTML = '<b>Coverage 100%. Zero gaps. Every time, forever.</b> ' +
        'This is visit-based coverage, and it is the metric the code was written to throw away: ' +
        'with 16,000 genetic-algorithm rows every parameter value gets visited eventually, so the ' +
        'number is always 1.0 and the gap-finder never fires once. A metric that cannot fail tells you nothing.';
    } else if (qr >= 0.95){
      v.className = 'verdict show bad';
      v.innerHTML = '<b>The other end of the mistake.</b> At ' + qr.toFixed(3) + ' only the single basin holding ' +
        'the global best counts as covered, so almost the whole domain reads as a gap. The bar has to be ' +
        'demanding enough to fail and loose enough to mean something — the shipped default is <b>0.7</b>.';
    } else {
      v.className = 'verdict show ' + (a.gaps.length > 0 ? 'good' : '');
      v.innerHTML = 'Coverage <span class="hl">' + pct(a.covPct, 0) + '</span>, <b>' + a.gaps.length +
        '</b> gap' + (a.gaps.length === 1 ? '' : 's') + ' past the 5% minimum width. Now the number can be wrong, ' +
        'which is the only thing that makes it worth computing. The search visited those bands — it just never ' +
        'found anything good in them.';
    }
  }

  draw();
  document.getElementById('cov-q').addEventListener('input', draw);
  return { draw: draw };
});


/* ================================================================
   ACT 5 — k-means on parameters only  (optimizer/auto/representatives.py:201)
   ================================================================ */
Lab('cv-clus', function(cv){
  var N = 2000, K = 8, rows = [];
  var basins = [[0.22, 0.30], [0.74, 0.24], [0.55, 0.72], [0.16, 0.80]];
  var basinPeak = [1.00, 0.86, 0.71, 0.58];

  (function build(){
    var r = rng(5150);
    for (var i = 0; i < N; i++){
      var b = 0, u = r();
      if (u < 0.40) b = 0; else if (u < 0.68) b = 1; else if (u < 0.88) b = 2; else b = 3;
      var x = clamp(basins[b][0] + gauss(r) * 0.085, 0.02, 0.98);
      var y = clamp(basins[b][1] + gauss(r) * 0.085, 0.02, 0.98);
      if (r() < 0.12){ x = r(); y = r(); }        // GA strays
      var s = 0;
      for (var k = 0; k < basins.length; k++){
        var dx = x - basins[k][0], dy = y - basins[k][1];
        s = Math.max(s, basinPeak[k] * Math.exp(-(dx * dx + dy * dy) / 0.022));
      }
      s = clamp(s * 100 + gauss(r) * 4, 1, 120);
      rows.push({ x: x, y: y, s: s });
    }
  })();

  function kmeans(data, k, dims, seedv){
    var r = rng(seedv), cent = [], i, j;
    // k-means++ style spread: first random, rest far from existing
    cent.push(data[Math.floor(r() * data.length)].f.slice());
    while (cent.length < k){
      var bestI = 0, bestD = -1;
      for (i = 0; i < data.length; i += 7){
        var dmin = Infinity;
        for (j = 0; j < cent.length; j++) dmin = Math.min(dmin, dist2(data[i].f, cent[j], dims));
        if (dmin > bestD){ bestD = dmin; bestI = i; }
      }
      cent.push(data[bestI].f.slice());
    }
    var assign = new Array(data.length).fill(0);
    for (var it = 0; it < 40; it++){
      var moved = false;
      for (i = 0; i < data.length; i++){
        var b = 0, bd = Infinity;
        for (j = 0; j < k; j++){ var dd = dist2(data[i].f, cent[j], dims); if (dd < bd){ bd = dd; b = j; } }
        if (assign[i] !== b){ assign[i] = b; moved = true; }
      }
      var sums = [], cnt = new Array(k).fill(0);
      for (j = 0; j < k; j++) sums.push(new Array(dims).fill(0));
      for (i = 0; i < data.length; i++){
        cnt[assign[i]]++;
        for (var q = 0; q < dims; q++) sums[assign[i]][q] += data[i].f[q];
      }
      for (j = 0; j < k; j++){ if (cnt[j]) for (var z = 0; z < dims; z++) cent[j][z] = sums[j][z] / cnt[j]; }
      if (!moved && it > 2) break;
    }
    return { assign: assign, cent: cent };
  }
  function dist2(a, b, dims){
    var s = 0; for (var i = 0; i < dims; i++){ var d = a[i] - b[i]; s += d * d; }
    return s;
  }

  function compute(useScore, truncate){
    var data = rows.map(function(p, i){ return { i: i, p: p }; });
    if (truncate){
      data.sort(function(a, b){ return b.p.s - a.p.s; });
      data = data.slice(0, 500);
    }
    // Parameters are min-max scaled into [0,1] (representatives.py:214). A score column
    // would arrive in its own raw units — which is precisely why appending it takes over
    // the distance metric and the clusters quietly become score bands.
    var dims = useScore ? 3 : 2;
    data.forEach(function(d){
      d.f = useScore ? [d.p.x, d.p.y, d.p.s / 12] : [d.p.x, d.p.y];
    });
    var km = kmeans(data, K, dims, 4242);

    // one representative per cluster: max score within the cluster (balance preset)
    var reps = [];
    for (var c = 0; c < K; c++){
      var best = null;
      for (var i = 0; i < data.length; i++){
        if (km.assign[i] !== c) continue;
        if (!best || data[i].p.s > best.p.s) best = data[i];
      }
      if (best) reps.push(best.p);
    }
    /* Is a cluster a NEIGHBOURHOOD or a SHELL?
       That is the entire question. A cluster built from parameters is a local patch of
       parameter space, so its members sit close to its own centre. A cluster built with
       an outcome column becomes an iso-score band — a ring that wraps right around the
       landscape, whose members are scattered over the whole domain. Measure the radius. */
    var widest = 0;
    for (var c2 = 0; c2 < K; c2++){
      var mx2 = 0, my = 0, cnt2 = 0;
      for (var i = 0; i < data.length; i++){
        if (km.assign[i] !== c2) continue;
        mx2 += data[i].p.x; my += data[i].p.y; cnt2++;
      }
      if (cnt2 < 2) continue;
      mx2 /= cnt2; my /= cnt2;
      var rad = 0;
      for (var j2 = 0; j2 < data.length; j2++){
        if (km.assign[j2] !== c2) continue;
        var ex = data[j2].p.x - mx2, ey = data[j2].p.y - my;
        rad += Math.sqrt(ex * ex + ey * ey);
      }
      rad /= cnt2;
      if (rad > widest) widest = rad;
    }

    // basins reached
    var hit = {};
    reps.forEach(function(rp){
      for (var k = 0; k < basins.length; k++){
        var dx2 = rp.x - basins[k][0], dy2 = rp.y - basins[k][1];
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < 0.14) hit[k] = 1;
      }
    });
    return { data: data, assign: km.assign, reps: reps, widest: widest,
             basins: Object.keys(hit).length, truncated: truncate };
  }

  var CLUS = ['#35c9bd', '#5aa2e8', '#52c97a', '#d9a44f', '#9b84dc', '#e26a62', '#4fd1c5', '#8fa3bd'];

  function draw(){
    var useScore = document.getElementById('clus-score').getAttribute('aria-pressed') === 'true';
    var trunc = document.getElementById('clus-trunc').getAttribute('aria-pressed') === 'true';
    var res = compute(useScore, trunc);

    var d = fit(cv, 340), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var pad = 34, size = Math.max(120, Math.min(w - pad * 2, h - pad * 2));
    var ox = (w - size) / 2, oy = (h - size) / 2;
    var X = function(x){ return ox + x * size; };
    var Y = function(y){ return oy + size - y * size; };

    ctx.strokeStyle = C.grid; ctx.strokeRect(ox + .5, oy + .5, size, size);
    label(ctx, 'parameter A →', ox, oy + size + 18, C.dim, 'left');
    ctx.save(); ctx.translate(ox - 12, oy + size); ctx.rotate(-Math.PI / 2);
    label(ctx, 'parameter B →', 0, 0, C.dim, 'left'); ctx.restore();

    // ghost of everything, so truncation is visible as loss
    if (trunc){
      for (var g = 0; g < rows.length; g++){
        ctx.beginPath(); ctx.arc(X(rows[g].x), Y(rows[g].y), 1.2, 0, 6.283);
        ctx.fillStyle = 'rgba(120,134,158,.1)'; ctx.fill();
      }
    }
    for (var i = 0; i < res.data.length; i++){
      var p = res.data[i].p;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.1, 0, 6.283);
      ctx.fillStyle = CLUS[res.assign[i] % CLUS.length]; ctx.globalAlpha = .55; ctx.fill();
    }
    ctx.globalAlpha = 1;
    // where the good scores actually live
    basins.forEach(function(b, k){
      ctx.beginPath(); ctx.arc(X(b[0]), Y(b[1]), 0.13 * size, 0, 6.283);
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.stroke(); ctx.setLineDash([]);
      label(ctx, 'peak ' + Math.round(basinPeak[k] * 100), X(b[0]), Y(b[1]) - 0.13 * size - 5,
            'rgba(255,255,255,.34)', 'center');
    });
    // representatives
    res.reps.forEach(function(rp){
      ctx.beginPath(); ctx.arc(X(rp.x), Y(rp.y), 7.5, 0, 6.283);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(rp.x), Y(rp.y), 3, 0, 6.283);
      ctx.fillStyle = '#fff'; ctx.fill();
    });
    label(ctx, '○ representative kept', ox + 6, oy + 16, C.ink, 'left', '700');
    label(ctx, 'colour = cluster', ox + size - 6, oy + 16, C.mut, 'right');

    document.getElementById('clus-k').textContent = res.reps.length + ' of ' + K;
    document.getElementById('clus-spread').textContent = res.widest.toFixed(3);
    document.getElementById('clus-basins').textContent = res.basins + ' of 4';

    var v = document.getElementById('clus-v');
    var m = res.widest.toFixed(3);
    if (useScore){
      v.className = 'verdict show bad';
      v.innerHTML = '<b>Look at the shapes.</b> The clusters are no longer patches — they are ' +
        '<b>iso-score bands</b>, rings wrapped around the peaks. The outcome column arrives in its own units ' +
        'and takes over the distance metric, so the widest cluster now has a radius of ' +
        '<span class="bad">' + m + '</span> and sprawls across the whole domain. A representative drawn from a ring ' +
        'represents nothing: its cluster-mates share a score and share no settings. ' +
        (trunc ? 'Truncating to the top 500 first makes it worse — ' : '') +
        '<b>' + res.basins + ' of 4</b> basins end up with a survivor.';
    } else if (trunc){
      v.className = 'verdict show bad';
      v.innerHTML = 'Clustering only the top 500 rows keeps the shapes local — widest radius ' + m + ' — but every ' +
        'cluster now starts life inside a winning basin, so <b>' + res.basins + ' of 4</b> get a representative and ' +
        'the losing regions are not even candidates. The source refuses this explicitly: ' +
        '<em>"ALL rows are clustered; nothing is truncated."</em>';
    } else {
      v.className = 'verdict show good';
      v.innerHTML = '<b>Parameters only, every row included.</b> Each cluster is a genuine neighbourhood — widest ' +
        'radius <span class="ok">' + m + '</span> — so a representative really does stand for its cluster. ' +
        '<b>' + res.basins + ' of 4</b> basins get one, including the mediocre ones, which is the point: those are ' +
        'the settings you have not yet proved wrong. Score enters exactly once, later, to pick which member to keep.';
    }
  }

  function bindToggle(id){
    var el = document.getElementById(id);
    el.addEventListener('click', function(){
      el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      draw();
    });
  }
  bindToggle('clus-score'); bindToggle('clus-trunc');
  draw();
  return { draw: draw };
});


/* ================================================================
   ACT 6 — Train / Validate  (ui/Optimization/Stage0TrainValidateModel.cs)
   ================================================================ */
Lab('val-wins', function(host){
  var WINDOWS = [
    { name: 'Build / Tune',      role: 'Build',            pf: 1.95, q: 0.00 },
    { name: 'Validate 2019 R2',  role: 'Primary Validate', pf: 1.28, q: 0.95 },
    { name: 'Validate 2022 R2',  role: 'Can Validate',     pf: 1.11, q: 0.80 },
    { name: 'Synthetic window',  role: 'Reference Only',   pf: 1.04, q: 0.50 }
  ];
  var PRESETS = {
    balanced:      { 'Build': 0.50, 'Primary Validate': 1.00, 'Can Validate': 0.70, 'Reference Only': 0.20 },
    validatefirst: { 'Build': 0.30, 'Primary Validate': 1.00, 'Can Validate': 0.70, 'Reference Only': 0.20 },
    insample:      { 'Build': 1.00, 'Primary Validate': 1.00, 'Can Validate': 0.70, 'Reference Only': 0.20 },
    oosonly:       { 'Build': 0.00, 'Primary Validate': 1.00, 'Can Validate': 0.70, 'Reference Only': 0.00 }
  };
  var FLOOR_PF = 0.5;   // FloorFor(ProfitFactor)

  WINDOWS.forEach(function(win, i){
    var el = document.createElement('div');
    el.className = 'win';
    el.innerHTML =
      '<div class="win__name">' + win.name + '</div>' +
      '<span class="win__role">' + win.role + '</span>' +
      '<div class="win__pf" id="wpf-' + i + '">' + win.pf.toFixed(2) + '</div>' +
      '<input type="range" id="wsl-' + i + '" min="20" max="260" value="' + Math.round(win.pf * 100) + '" step="1" aria-label="Profit factor for ' + win.name + '">' +
      '<div class="win__w" id="ww-' + i + '">weight —</div>';
    host.appendChild(el);
  });

  function weightedMean(samples){
    var sw = 0, sxw = 0;
    samples.forEach(function(s){ if (s.w <= 0 || !isFinite(s.v)) return; sw += s.w; sxw += s.v * s.w; });
    return sw <= 0 ? 0 : sxw / sw;
  }
  function weightedStdev(samples){
    var m = weightedMean(samples), sw = 0, sxw = 0;
    samples.forEach(function(s){ if (s.w <= 0 || !isFinite(s.v)) return; var d = s.v - m; sw += s.w; sxw += d * d * s.w; });
    return sw <= 0 ? 0 : Math.sqrt(sxw / sw);
  }
  function stability(samples, floor){
    var contributing = samples.filter(function(s){ return s.w > 0; }).length;
    if (contributing < 2) return 0;                              // Stage0TrainValidateModel.cs:134
    var m = weightedMean(samples), sd = weightedStdev(samples);
    var scale = Math.max(Math.abs(m), Math.max(floor, 1e-9));
    return 100 * (1 - Math.min(sd / scale, 1));
  }
  function regimeFit(samples){
    var sw = 0, sxw = 0;
    samples.forEach(function(s){
      var w = Math.max(s.q, 0) * Math.max(s.w, 0);
      if (w <= 0) return;
      sw += w; sxw += clamp(s.pf - 1, -1, 1) * w;
    });
    return sw <= 0 ? 0 : sxw / sw;
  }

  function draw(){
    var presetKey = document.getElementById('val-preset').value;
    var weights = PRESETS[presetKey];
    var samples = WINDOWS.map(function(win, i){
      var pf = parseInt(document.getElementById('wsl-' + i).value, 10) / 100;
      var w = weights[win.role];
      document.getElementById('wpf-' + i).textContent = pf.toFixed(2);
      document.getElementById('wpf-' + i).style.color = pf < 1 ? C.red : (pf >= 1.3 ? C.green : C.ink);
      document.getElementById('ww-' + i).textContent = 'weight ' + w.toFixed(2) + (w === 0 ? ' — excluded' : '');
      document.getElementById('ww-' + i).style.color = w === 0 ? '#3f4a5c' : '';
      return { v: pf, pf: pf, w: w, q: win.q, role: win.role };
    });

    var buildPf = samples[0].pf;
    var oos = samples.slice(1);
    var minPf = Math.min.apply(null, oos.map(function(s){ return s.pf; }));
    var mean = weightedMean(samples);
    var stab = stability(samples, FLOOR_PF);
    var fit = regimeFit(samples);

    document.getElementById('val-minpf').textContent = minPf.toFixed(2);
    document.getElementById('val-meanpf').textContent = mean.toFixed(2);
    document.getElementById('val-stab').textContent = stab.toFixed(0);
    document.getElementById('val-fit').textContent = (fit >= 0 ? '+' : '') + fit.toFixed(2);

    // the documented (non-existent) rule
    var degrade = minPf < 0.85 * buildPf;
    var mv = document.getElementById('val-minverdict');
    mv.textContent = degrade ? 'DEGRADE' : 'PASS';
    mv.className = 'compare__verdict ' + (degrade ? 'fail' : 'pass');

    var rv = document.getElementById('val-realverdict');
    rv.textContent = 'Stability ' + stab.toFixed(0) + ' · rank by consistency';
    rv.className = 'compare__verdict ' + (stab >= 60 ? 'pass' : (stab < 35 ? 'fail' : ''));

    var buildW = weights['Build'];
    var note = document.getElementById('val-note');
    if (buildW >= 1.0){
      note.innerHTML = 'Build weight <b style="color:var(--red)">1.00</b> — the in-sample window now carries as ' +
        'much as the primary validate window. The ranking is majority in-sample.';
    } else if (buildW === 0){
      note.innerHTML = 'Build weight <b style="color:var(--green)">0.00</b> — the only preset where the ranking ' +
        'is genuinely out-of-sample. It is not the default.';
    } else {
      note.innerHTML = 'Build weight <b>' + buildW.toFixed(2) + '</b> sits inside the Stability sample, so this ' +
        'number blends in-sample with out-of-sample.';
    }

    var hint = document.getElementById('val-hint');
    if (hint){
      hint.textContent = degrade && stab >= 55
        ? 'The two columns disagree: one window collapsed, and consistency still reads well.'
        : '';
    }
  }

  WINDOWS.forEach(function(_, i){
    document.getElementById('wsl-' + i).addEventListener('input', draw);
  });
  document.getElementById('val-preset').addEventListener('change', draw);
  draw();
  return { draw: draw };
});


/* ================================================================
   ACT 7 — Investment is a veto  (backtest/investor_summary.py:499)
   ================================================================ */
Lab('cv-veto', function(cv){
  var PILLARS = [
    { key: 'edge',       name: 'Edge',       w: 0.28, start: 92 },
    { key: 'risk',       name: 'Risk',       w: 0.28, start: 88 },
    { key: 'structure',  name: 'Structure',  w: 0.22, start: 90 },
    { key: 'time',       name: 'Timing',     w: 0.22, start: 86 },
    { key: 'investment', name: 'Investment', w: null, start: 80 }
  ];
  var host = document.getElementById('veto-pillars');
  PILLARS.forEach(function(p){
    var el = document.createElement('div');
    el.className = 'pillar' + (p.key === 'investment' ? ' pillar--veto' : '');
    el.innerHTML =
      '<div class="pillar__name">' + p.name + '</div>' +
      '<div class="pillar__w">' + (p.w !== null ? 'operating × ' + p.w.toFixed(2) : 'blended 0.18 · VETO') + '</div>' +
      '<div class="pillar__val" id="pv-' + p.key + '">' + p.start + '</div>' +
      '<input type="range" id="ps-' + p.key + '" min="0" max="100" value="' + p.start + '" step="1" aria-label="' + p.name + ' pillar score">' +
      '<div class="pillar__dec" id="pd-' + p.key + '">—</div>';
    host.appendChild(el);
  });

  function decide(key, s){
    if (key === 'investment') return s >= 70 ? 'INVEST' : s >= 52 ? 'MARGINAL' : 'NOT WORTH CAPITAL';
    if (key === 'edge')       return s >= 74 ? 'USE' : s >= 56 ? 'WATCH' : 'REJECT';
    if (key === 'risk')       return s >= 70 ? 'RISK OK' : s >= 45 ? 'RISK WATCH' : 'RISK BAD';
    if (key === 'structure')  return s >= 70 ? 'HEALTHY' : s >= 40 ? 'FRAGILE' : 'BAD';
    return s >= 70 ? 'TIME EDGE' : s >= 45 ? 'TIME WATCH' : 'NO TIME EDGE';
  }

  function draw(){
    var vals = {};
    PILLARS.forEach(function(p){
      vals[p.key] = parseInt(document.getElementById('ps-' + p.key).value, 10);
      document.getElementById('pv-' + p.key).textContent = vals[p.key];
      var dec = decide(p.key, vals[p.key]);
      var el = document.getElementById('pd-' + p.key);
      el.textContent = dec;
      el.className = 'pillar__dec ' + (/REJECT|BAD|NOT WORTH|NO TIME/.test(dec) ? 'bad'
                    : /USE|OK|HEALTHY|INVEST|EDGE/.test(dec) ? 'ok' : '');
    });

    // investor_summary.py:499
    var operating = vals.edge * 0.28 + vals.risk * 0.28 + vals.structure * 0.22 + vals.time * 0.22;
    var score = Math.round(clamp(operating * 0.82 + vals.investment * 0.18, 0, 100));
    var uncapped = score;
    var hardBad = decide('edge', vals.edge) === 'REJECT'
               || decide('risk', vals.risk) === 'RISK BAD'
               || decide('investment', vals.investment) === 'NOT WORTH CAPITAL';
    var anyBad = hardBad || decide('structure', vals.structure) === 'BAD';
    var anyWatch = PILLARS.some(function(p){ return /WATCH|MARGINAL/.test(decide(p.key, vals[p.key])); });
    if (hardBad) score = Math.min(score, 39);
    else if (anyBad) score = Math.min(score, 54);
    var decision = score >= 74 ? 'USE' : score >= 56 ? 'WATCH' : score >= 40 ? 'WEAK' : 'REJECT';
    if (hardBad) decision = 'REJECT';
    else if ((anyBad || anyWatch) && decision === 'USE') decision = 'WATCH';

    document.getElementById('veto-core').textContent = operating.toFixed(1);
    document.getElementById('veto-score').textContent = score;
    var dEl = document.getElementById('veto-decision');
    dEl.textContent = decision;
    dEl.className = 'decision ' + decision.toLowerCase();

    // gauge
    var d = fit(cv, 150), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = 'transparent'; ctx.clearRect(0, 0, w, h);
    var padL = 8, padR = 8, barY = 66, barH = 30;
    var bands = [[0, 40, 'rgba(226,106,98,.16)'], [40, 56, 'rgba(139,152,173,.14)'],
                 [56, 74, 'rgba(217,164,79,.16)'], [74, 100, 'rgba(82,201,122,.16)']];
    var X = function(v){ return padL + v / 100 * (w - padL - padR); };
    bands.forEach(function(b){
      ctx.fillStyle = b[2]; ctx.fillRect(X(b[0]), barY, X(b[1]) - X(b[0]), barH);
    });
    [40, 56, 74].forEach(function(t){
      dashed(ctx, X(t), barY - 4, X(t), barY + barH + 4, 'rgba(139,152,173,.4)', [2, 3]);
      label(ctx, String(t), X(t), barY + barH + 17, C.dim, 'center');
    });
    // uncapped ghost
    if (hardBad && uncapped > score){
      ctx.fillStyle = 'rgba(139,152,173,.2)';
      ctx.fillRect(X(0), barY + 6, X(uncapped) - X(0), barH - 12);
      label(ctx, 'would have been ' + uncapped, X(uncapped) - 6, barY - 10, C.dim, 'right');
    }
    var col = decision === 'USE' ? C.green : decision === 'WATCH' ? C.amber
            : decision === 'REJECT' ? C.red : C.mut;
    rrect(ctx, X(0), barY, Math.max(3, X(score) - X(0)), barH, 5);
    ctx.fillStyle = col; ctx.fill();
    label(ctx, 'OVERALL', padL, barY - 12, C.mut, 'left', '700');
    if (hardBad){
      ctx.strokeStyle = C.red; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(39), barY - 8); ctx.lineTo(X(39), barY + barH + 8); ctx.stroke();
      label(ctx, 'hard cap 39', X(39) + 6, barY - 10, C.red, 'left', '700');
    }

    var v = document.getElementById('veto-v');
    if (hardBad && decide('investment', vals.investment) === 'NOT WORTH CAPITAL'){
      v.className = 'verdict show bad';
      v.innerHTML = '<b>Overall just fell from ' + uncapped + ' to ' + score + '.</b> ' +
        'Nothing about the other four pillars changed. Investment returned ' +
        '<span class="bad">NOT WORTH CAPITAL</span>, which caps Overall at 39 and forces REJECT. ' +
        'An 18% weight that behaves like a switch — because you are allocating capital, not scoring a game.';
    } else if (vals.investment < 62){
      v.className = 'verdict show';
      v.innerHTML = 'Investment is <b>' + vals.investment + '</b> — MARGINAL. Overall drifts down gently and ' +
        'the verdict softens from USE to WATCH. Keep dragging: the interesting part is not the slope.';
    } else {
      v.className = 'verdict show good';
      v.innerHTML = 'Overall <span class="ok">' + score + '</span> · ' + decision + '. ' +
        'Investment carries only 18% of the weighted score, so from here it looks like the least ' +
        'important of the five. Drag it below 52 and see.';
    }
  }

  PILLARS.forEach(function(p){ document.getElementById('ps-' + p.key).addEventListener('input', draw); });
  draw();
  return { draw: draw };
});


/* ================================================================
   ACT 8 — Lot lattice + two risk models  (portfolio/service.py:1295, :2102)
   ================================================================ */
Lab('cv-lat', function(cv){
  var EAS = [
    { name: 'A', ddPerLot: 260, retPerLot: 118 },
    { name: 'B', ddPerLot: 175, retPerLot:  74 },
    { name: 'C', ddPerLot: 420, retPerLot: 205 }
  ];
  var LEVELS = 8, DAYS = 760;
  var combos = [];

  (function build(){
    var r = rng(2027);
    // three daily series with genuine, different correlation structure
    var common = [];
    for (var t = 0; t < DAYS; t++) common.push(gauss(r));
    var series = EAS.map(function(ea, k){
      var beta = [0.55, 0.20, 0.70][k];
      var s = [];
      for (var t = 0; t < DAYS; t++){
        s.push((beta * common[t] + Math.sqrt(1 - beta * beta) * gauss(r)) * (ea.ddPerLot / 22)
               + ea.retPerLot / 21 / 22);
      }
      // Calibrate so ONE lot of this strategy really does draw down `ddPerLot`.
      // That makes the additive bound exactly "sum of each strategy's own drawdown",
      // which is what service.py:1295 assumes — and lets the merged path disagree honestly.
      var eq = 0, path = [];
      for (var q = 0; q < s.length; q++){ eq += s[q]; path.push(eq); }
      var own = maxDrawdown(path) || 1;
      var scale = ea.ddPerLot / own;
      for (var z = 0; z < s.length; z++) s[z] *= scale;
      return s;
    });

    for (var a = 0; a <= LEVELS; a++)
      for (var b = 0; b <= LEVELS; b++)
        for (var c = 0; c <= LEVELS; c++){
          if (a + b + c === 0) continue;
          var lots = [a, b, c];
          var additive = a * EAS[0].ddPerLot + b * EAS[1].ddPerLot + c * EAS[2].ddPerLot;
          // merged path: daily_matrix @ scale_vector  (service.py:2102)
          var equity = 0, path = [], monthly = [], acc = 0;
          for (var t = 0; t < DAYS; t++){
            var v = a * series[0][t] + b * series[1][t] + c * series[2][t];
            equity += v; path.push(equity); acc += v;
            if ((t + 1) % 21 === 0){ monthly.push(acc); acc = 0; }
          }
          var mergedDD = maxDrawdown(path);
          var mean = monthly.reduce(function(x, y){ return x + y; }, 0) / monthly.length;
          var varr = monthly.reduce(function(x, y){ return x + (y - mean) * (y - mean); }, 0) / monthly.length;
          combos.push({ lots: lots, additive: additive, mergedDD: mergedDD,
                        ret: mean, risk: Math.sqrt(varr) });
        }
  })();

  function draw(){
    var budget = parseInt(document.getElementById('lat-budget').value, 10);
    document.getElementById('lat-budget-v').textContent = fmt(budget);

    var feasible = combos.filter(function(c){ return c.additive <= budget; });
    // rejected by the additive bound although the real merged path fits
    var falseNeg = combos.filter(function(c){ return c.additive > budget && c.mergedDD <= budget; });

    // Pareto staircase — service.py:1485
    var sorted = feasible.slice().sort(function(x, y){
      return x.risk - y.risk || y.ret - x.ret;
    });
    var frontier = [], bestRet = -Infinity;
    sorted.forEach(function(c){ if (c.ret > bestRet){ bestRet = c.ret; frontier.push(c); } });

    var d = fit(cv, 330), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var padL = 56, padR = 18, padT = 22, padB = 42;
    var maxRisk = 0, maxRet = 0;
    combos.forEach(function(c){ maxRisk = Math.max(maxRisk, c.risk); maxRet = Math.max(maxRet, c.ret); });
    maxRisk *= 1.05; maxRet *= 1.06;
    var X = function(v){ return padL + v / maxRisk * (w - padL - padR); };
    var Y = function(v){ return h - padB - v / maxRet * (h - padT - padB); };

    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h - padB); ctx.lineTo(w - padR, h - padB); ctx.stroke();
    label(ctx, 'expected risk — σ of monthly P/L  ($)', (w + padL) / 2, h - 12, C.dim, 'center');
    ctx.save(); ctx.translate(16, (h - padB + padT) / 2); ctx.rotate(-Math.PI / 2);
    label(ctx, 'expected return / month ($)', 0, 0, C.dim, 'center'); ctx.restore();

    // all combos, dim
    combos.forEach(function(c){
      if (c.additive <= budget) return;
      ctx.beginPath(); ctx.arc(X(c.risk), Y(c.ret), 1.6, 0, 6.283);
      ctx.fillStyle = 'rgba(110,124,148,.16)'; ctx.fill();
    });
    // false negatives — real path fits, additive bound says no
    falseNeg.forEach(function(c){
      ctx.beginPath(); ctx.arc(X(c.risk), Y(c.ret), 2.3, 0, 6.283);
      ctx.fillStyle = 'rgba(217,164,79,.5)'; ctx.fill();
    });
    // feasible
    feasible.forEach(function(c){
      ctx.beginPath(); ctx.arc(X(c.risk), Y(c.ret), 2.1, 0, 6.283);
      ctx.fillStyle = 'rgba(120,150,190,.5)'; ctx.fill();
    });
    // staircase
    if (frontier.length){
      ctx.beginPath();
      ctx.moveTo(X(frontier[0].risk), Y(frontier[0].ret));
      for (var i = 1; i < frontier.length; i++){
        ctx.lineTo(X(frontier[i].risk), Y(frontier[i - 1].ret));
        ctx.lineTo(X(frontier[i].risk), Y(frontier[i].ret));
      }
      ctx.strokeStyle = C.purple; ctx.lineWidth = 2.2; ctx.lineJoin = 'miter'; ctx.stroke();
      frontier.forEach(function(c){
        ctx.beginPath(); ctx.arc(X(c.risk), Y(c.ret), 3, 0, 6.283);
        ctx.fillStyle = C.purple; ctx.fill();
      });
    }
    label(ctx, '■ admitted', padL + 6, padT + 6, '#7896be', 'left');
    label(ctx, '■ rejected by the additive bound, but the merged path fits the budget',
          padL + 78, padT + 6, C.amber, 'left');
    label(ctx, '— Pareto staircase', w - padR - 6, padT + 6, C.purple, 'right', '700');

    document.getElementById('lat-raw').textContent = fmt(combos.length + 1);
    document.getElementById('lat-feasible').textContent = fmt(feasible.length);
    document.getElementById('lat-front').textContent = fmt(frontier.length);

    var v = document.getElementById('lat-v');
    if (falseNeg.length > 0){
      v.className = 'verdict show bad';
      v.innerHTML = '<b>' + fmt(falseNeg.length) + ' combinations</b> (amber) were thrown out before they were ever ' +
        'priced — the additive bound added up each strategy’s own drawdown and declared them over budget. ' +
        'Their actual merged daily path never comes within the budget of trouble. ' +
        'Generation assumes <span class="bad">zero diversification</span>; admission then measures the real, ' +
        'correlated path. Both assumptions are in the same pipeline, four hundred lines apart.';
    } else {
      v.className = 'verdict show';
      v.innerHTML = 'At this budget every combination the additive bound admits is also fine on its merged path, ' +
        'so the two risk models happen to agree. Lower the budget until they don’t.';
    }
  }

  draw();
  document.getElementById('lat-budget').addEventListener('input', draw);
  return { draw: draw };
});


/* ================================================================
   ACT 9a — THE 0.75  (portfolio/service.py:899)
   ================================================================ */
Lab('cv-dd', function(cv){
  var DAYS = 620, path = [], BUDGET = 1000, TRUE_DD;

  (function build(){
    var r = rng(1337), eq = 0;
    for (var t = 0; t < DAYS; t++){
      var drift = 3.4;
      // one long sustained drawdown — the case where historical_dd wins the max()
      if (t > 250 && t < 400) drift = -9.2;
      eq += drift + gauss(r) * 16;
      path.push(eq);
    }
    TRUE_DD = maxDrawdown(path);
    var k = 1333 / TRUE_DD;                     // scale so the story's arithmetic is exact
    for (var i = 0; i < path.length; i++) path[i] *= k;
    TRUE_DD = maxDrawdown(path);
  })();

  function draw(){
    var mult = parseInt(document.getElementById('dd-mult').value, 10) / 100;
    document.getElementById('dd-mult-v').textContent = mult.toFixed(2);
    var gate = TRUE_DD * mult;
    var admitted = gate <= BUDGET;
    var over = TRUE_DD / BUDGET - 1;

    var d = fit(cv, 320), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var padL = 62, padR = 118, padT = 24, padB = 34;

    // find peak & trough of the deepest drawdown
    var peak = path[0], peakI = 0, worst = 0, wPeakI = 0, wTroughI = 0;
    for (var i = 0; i < path.length; i++){
      if (path[i] > peak){ peak = path[i]; peakI = i; }
      var dd = peak - path[i];
      if (dd > worst){ worst = dd; wPeakI = peakI; wTroughI = i; }
    }
    var mn = Math.min.apply(null, path), mx = Math.max.apply(null, path);
    var span = (mx - mn) * 1.12, base = mn - (mx - mn) * 0.06;
    var X = function(i){ return padL + i / (DAYS - 1) * (w - padL - padR); };
    var Y = function(v){ return h - padB - (v - base) / span * (h - padT - padB); };

    var peakV = path[wPeakI];
    var yPeak = Y(peakV);
    var yBudget = Y(peakV - BUDGET);
    var yGate = Y(peakV - gate);
    var yTrough = Y(path[wTroughI]);

    // the un-budgeted zone
    ctx.fillStyle = 'rgba(226,106,98,.13)';
    ctx.fillRect(padL, yBudget, w - padL - padR, yTrough - yBudget);

    // equity
    var pts = [];
    for (var k = 0; k < DAYS; k++) pts.push([X(k), Y(path[k])]);
    poly(ctx, pts, 'rgba(210,224,238,.9)', 1.6);

    // markers
    dashed(ctx, padL, yPeak, w - padR, yPeak, 'rgba(139,152,173,.4)', [3, 4]);
    label(ctx, 'peak', w - padR + 8, yPeak + 4, C.dim, 'left');

    dashed(ctx, padL, yBudget, w - padR, yBudget, 'rgba(82,201,122,.85)', [6, 4]);
    label(ctx, 'budget', w - padR + 8, yBudget - 3, C.green, 'left', '700');
    label(ctx, '$' + fmt(BUDGET), w - padR + 8, yBudget + 12, C.green, 'left');

    dashed(ctx, padL, yGate, w - padR, yGate, 'rgba(53,201,189,.9)', [4, 3]);
    label(ctx, 'gate reads', w - padR + 8, yGate - 3, C.teal, 'left', '700');
    label(ctx, '$' + fmt(gate), w - padR + 8, yGate + 12, C.teal, 'left');

    ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, yTrough); ctx.lineTo(w - padR, yTrough); ctx.stroke();
    label(ctx, 'actual trough', w - padR + 8, yTrough - 3, C.red, 'left', '700');
    label(ctx, '$' + fmt(TRUE_DD), w - padR + 8, yTrough + 12, C.red, 'left');

    // drawdown bracket
    var bx = X(wTroughI);
    ctx.strokeStyle = 'rgba(226,106,98,.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, yPeak); ctx.lineTo(bx, yTrough); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, yTrough, 4, 0, 6.283); ctx.fillStyle = C.red; ctx.fill();

    if (yTrough - yBudget > 14){
      label(ctx, 'nobody budgeted for this', (padL + w - padR) / 2, (yBudget + yTrough) / 2 + 4,
            'rgba(255,180,173,.95)', 'center', '700');
    }
    label(ctx, 'merged portfolio equity — the backtest I already had', padL, h - 10, C.dim, 'left');

    var under = TRUE_DD - gate;
    document.getElementById('dd-budget').textContent = '$' + fmt(BUDGET);
    document.getElementById('dd-gate').textContent = '$' + fmt(gate);
    document.getElementById('dd-real').textContent = '$' + fmt(TRUE_DD);
    var elOver = document.getElementById('dd-over');
    elOver.textContent = under < 1 ? '$0' : '$' + fmt(under);
    elOver.style.color = under < 1 ? C.green : C.red;

    var v = document.getElementById('dd-v');
    if (!admitted){
      v.className = 'verdict show good';
      v.innerHTML = '<b>Rejected — correctly.</b> At a multiplier of ' + mult.toFixed(2) + ' the gate reads ' +
        '$' + fmt(gate) + ', above the $' + fmt(BUDGET) + ' budget, so this portfolio never reaches the frontier. ' +
        'Nothing is understated and nothing is admitted that shouldn’t be. This is what I believed was happening.';
    } else if (Math.abs(mult - 0.75) < 0.006){
      v.className = 'verdict show bad';
      v.innerHTML = '<b>Admitted.</b> The gate reads $' + fmt(gate) + ' — exactly the budget. And the drawdown ' +
        'this portfolio <em>had already produced, in the backtest, on my screen</em> is ' +
        '<span class="bad">$' + fmt(TRUE_DD) + '</span>: ' + pct(over, 1) + ' past the number I set. ' +
        'I recorded this in my journal as the market surprising me. It was line 902.';
    } else {
      v.className = 'verdict show bad';
      v.innerHTML = '<b>Admitted at ' + mult.toFixed(2) + '.</b> Gate $' + fmt(gate) + ' fits the $' + fmt(BUDGET) +
        ' budget, while the observed drawdown is $' + fmt(TRUE_DD) + ' — <span class="bad">' + pct(over, 1) +
        '</span> beyond it. The smaller the multiplier, the more comfortable the report and the worse the surprise.';
    }
  }

  draw();
  document.getElementById('dd-mult').addEventListener('input', draw);
  return { draw: draw };
});


/* ================================================================
   ACT 9b — closed-trade daily buckets  (portfolio/service.py:481)
   ================================================================ */
Lab('cv-basis', function(cv){
  var D = 16, PER = 34, intraday = [], dailyClose = [];

  (function build(){
    var r = rng(88), eq = 0;
    for (var day = 0; day < D; day++){
      var openEq = eq;
      var target = openEq + (gauss(r) * 34 + 4);
      // a deep intraday excursion that mostly recovers by the close
      var depth = (day === 6) ? -420 : (day === 7 ? -300 : gauss(r) * 55 - 30);
      for (var t = 0; t < PER; t++){
        var u = t / (PER - 1);
        var arc = Math.sin(Math.PI * u) * depth;
        var v = openEq + (target - openEq) * u + arc + gauss(r) * 9;
        intraday.push(v);
      }
      eq = target;
      dailyClose.push(eq);
    }
  })();

  function draw(){
    var d = fit(cv, 240), ctx = d.ctx, w = d.w, h = d.h;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    var padL = 54, padR = 14, gap = 16;
    var topH = (h - 46 - gap) / 2;

    var all = intraday.concat(dailyClose);
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    var pad = (mx - mn) * 0.12;

    function panel(y0, hh, sub, title, col){
      var X = function(i, n){ return padL + i / (n - 1) * (w - padL - padR); };
      var Y = function(v){ return y0 + hh - (v - (mn - pad)) / ((mx + pad) - (mn - pad)) * hh; };
      label(ctx, title, padL, y0 - 5, col, 'left', '700');
      // peak-to-trough on this representation
      var peak = sub[0], worst = 0, pi = 0, ti = 0, cp = 0;
      for (var i = 0; i < sub.length; i++){
        if (sub[i] > peak){ peak = sub[i]; cp = i; }
        var dd = peak - sub[i];
        if (dd > worst){ worst = dd; pi = cp; ti = i; }
      }
      var yPeak = Y(sub[pi]), yTr = Y(sub[ti]);
      ctx.fillStyle = 'rgba(226,106,98,.1)';
      ctx.fillRect(padL, yPeak, w - padL - padR, yTr - yPeak);

      var pts = [];
      for (var k = 0; k < sub.length; k++) pts.push([X(k, sub.length), Y(sub[k])]);
      poly(ctx, pts, col, 1.6);

      var bx = X(ti, sub.length);
      ctx.strokeStyle = 'rgba(226,106,98,.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, yPeak); ctx.lineTo(bx, yTr); ctx.stroke();
      label(ctx, '−$' + fmt(worst), bx + 6, (yPeak + yTr) / 2 + 4, C.red, 'left', '700');
      return worst;
    }

    var trueDD = panel(24, topH, intraday, 'TRUE EQUITY — every tick, floating P/L included', 'rgba(226,106,98,.9)');
    var seenDD = panel(24 + topH + gap + 22, topH, dailyClose,
                       'WHAT THE MODEL SEES — closed-trade profit summed into daily buckets', 'rgba(90,162,232,.9)');

    document.getElementById('basis-true').textContent = '−$' + fmt(trueDD);
    document.getElementById('basis-seen').textContent = '−$' + fmt(seenDD);
    document.getElementById('basis-hidden').textContent = '−$' + fmt(Math.max(0, trueDD - seenDD));
  }

  draw();
  return { draw: draw };
});


/* ================================================================
   ACT 9c — the unwired instruments
   ================================================================ */
Lab('deadmap', function(host){
  var ROWS = [
    { sig: 'max_drawdown_dollar(balance, series)',            line: 'metrics.py:70',  live: true },
    { sig: 'bootstrap_paths(series, block_length, trials)',   line: 'metrics.py:113', live: false },
    { sig: 'bootstrap_drawdown_p95(...)',                     line: 'metrics.py:143', live: false },
    { sig: 'evaluate_portfolio(...)',                         line: 'metrics.py:156', live: false },
    { sig: 'co_drawdown_jaccard(series_a, series_b)',         line: 'metrics.py:230', live: false },
    { sig: 'tail_dependence(series_a, series_b, tail_pct)',   line: 'metrics.py:245', live: false }
  ];
  ROWS.forEach(function(r){
    var el = document.createElement('div');
    el.className = 'dead' + (r.live ? ' dead--live' : '');
    el.innerHTML =
      '<span class="dead__sig">' + r.sig + '</span>' +
      '<span class="dead__line">' + r.line + '</span>' +
      '<span class="dead__tag">' + (r.live ? 'in use' : '0 callers') + '</span>';
    host.appendChild(el);
  });
  return {};
});


/* ---------------------------------------------------------------- boot */
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bootLabs);
} else {
  bootLabs();
}
