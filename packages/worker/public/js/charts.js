"use strict";

// render
function render() {
  var data = state.data;
  applyThemeAttr();
  var totals = data.totals || {};
  var tk = tokenTotal(totals);
  $("stat-cost").textContent = money(totals.costUsd || 0);
  $("stat-cost-sub").textContent = state.days + "-day total";
  $("stat-tokens").textContent = fmtCompact.format(tk);
  $("stat-tokens-sub").textContent = fmtInt.format(tk) + " tokens";
  $("stat-output").textContent = fmtCompact.format(totals.outputTokens || 0);
  $("stat-machines").textContent = totals.machines != null ? totals.machines : "—";

  var noun = DIM_NOUN[state.groupBy];
  $("cost-hint").textContent = "stacked by " + noun;
  $("share-hint").textContent = "by " + noun;

  if (!data.rows.length) {
    destroyCharts();
    showEmpty();
    return;
  }

  renderCostChart();
  renderTokenChart();
  renderShareChart();
}

function renderCostChart() {
  var t = theme();
  var rows = state.data.rows;
  var dates = uniqueSortedDates(rows);
  // Row keys are attacker-controllable (any upload key can send machine/agent/model
  // names, including "__proto__"), so every object keyed by them is null-prototyped.
  var allKeys = Object.keys(rows.reduce(function (a, r) { a[r.key] = 1; return a; }, Object.create(null)));
  var cmap = colorMap(allKeys);

  var byKey = Object.create(null);
  rows.forEach(function (r) {
    if (!byKey[r.key]) byKey[r.key] = Object.create(null);
    byKey[r.key][r.date] = (byKey[r.key][r.date] || 0) + (r.costUsd || 0);
  });
  var keys = allKeys.slice().sort();

  var datasets = keys.map(function (k) {
    return {
      label: k,
      data: dates.map(function (d) { return +((byKey[k][d] || 0).toFixed(4)); }),
      backgroundColor: cmap[k],
      borderColor: t.surface,
      borderWidth: 2,
      borderRadius: 3,
      borderSkipped: false,
      maxBarThickness: 26,
      categoryPercentage: 0.7,
      barPercentage: 0.9,
    };
  });

  if (charts.cost) charts.cost.destroy();
  charts.cost = new Chart($("cost-chart"), {
    type: "bar",
    data: { labels: dates.map(shortDate), datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: baseScales(t, true),
      plugins: {
        legend: legendConf(t),
        tooltip: Object.assign(tooltipConf(t), {
          callbacks: {
            label: function (c) { return c.dataset.label + ": " + money(c.parsed.y); },
            footer: function (items) {
              var sum = items.reduce(function (a, i) { return a + i.parsed.y; }, 0);
              return "Total: " + money(sum);
            },
          },
          footerColor: t.text,
        }),
      },
    },
  });
}

function renderTokenChart() {
  var t = theme();
  var rows = state.data.rows;
  var dates = uniqueSortedDates(rows);

  var acc = {};
  dates.forEach(function (d) { acc[d] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }; });
  rows.forEach(function (r) {
    var a = acc[r.date];
    a.input += r.inputTokens || 0;
    a.output += r.outputTokens || 0;
    a.cacheCreation += r.cacheCreationTokens || 0;
    a.cacheRead += r.cacheReadTokens || 0;
  });

  // Cache tokens (read especially) are ~100x input/output, so they are OFF by
  // default; showing them flattens input/output to invisible slivers. The
  // toggle adds them back for a full-volume view.
  var series = [
    { key: "input", label: "Input", color: t.series[0] },
    { key: "output", label: "Output", color: t.series[1] },
  ];
  if (state.includeCache) {
    series.push({ key: "cacheCreation", label: "Cache write", color: t.series[2] });
    series.push({ key: "cacheRead", label: "Cache read", color: t.series[3] });
  }

  var datasets = series.map(function (s) {
    return {
      label: s.label,
      data: dates.map(function (d) { return acc[d][s.key]; }),
      backgroundColor: s.color,
      borderColor: t.surface,
      borderWidth: 2,
      borderRadius: 3,
      borderSkipped: false,
      maxBarThickness: 26,
      categoryPercentage: 0.7,
      barPercentage: 0.9,
    };
  });

  if (charts.token) charts.token.destroy();
  charts.token = new Chart($("token-chart"), {
    type: "bar",
    data: { labels: dates.map(shortDate), datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: (function () {
        var sc = baseScales(t, true);
        sc.y.ticks.callback = function (v) { return fmtCompact.format(v); };
        return sc;
      })(),
      plugins: {
        legend: legendConf(t),
        tooltip: Object.assign(tooltipConf(t), {
          callbacks: {
            label: function (c) { return c.dataset.label + ": " + fmtInt.format(c.parsed.y); },
          },
        }),
      },
    },
  });
}

function renderShareChart() {
  var t = theme();
  var rows = state.data.rows;
  // Null-prototyped for the same reason as renderCostChart: keys come from uploads.
  var allKeys = Object.keys(rows.reduce(function (a, r) { a[r.key] = 1; return a; }, Object.create(null)));
  var cmap = colorMap(allKeys);
  var totalByKey = Object.create(null);
  rows.forEach(function (r) { totalByKey[r.key] = (totalByKey[r.key] || 0) + (r.costUsd || 0); });
  var keys = allKeys.slice().sort();
  var values = keys.map(function (k) { return +totalByKey[k].toFixed(2); });
  var colors = keys.map(function (k) { return cmap[k]; });

  if (charts.share) charts.share.destroy();
  charts.share = new Chart($("share-chart"), {
    type: "doughnut",
    data: {
      labels: keys,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: t.surface,
        borderWidth: 2,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: Object.assign(legendConf(t), { position: "right", align: "center" }),
        tooltip: Object.assign(tooltipConf(t), {
          callbacks: {
            label: function (c) {
              var sum = c.dataset.data.reduce(function (a, b) { return a + b; }, 0);
              var pct = sum ? Math.round((c.parsed / sum) * 100) : 0;
              return c.label + ": " + money(c.parsed) + " (" + pct + "%)";
            },
          },
        }),
      },
    },
  });
}
