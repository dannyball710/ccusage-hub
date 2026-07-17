"use strict";

function destroyCharts() {
  ["cost", "token", "share"].forEach(function (k) {
    if (charts[k]) { charts[k].destroy(); charts[k] = null; }
  });
}

function baseScales(t, stacked) {
  return {
    x: {
      stacked: !!stacked,
      grid: { display: false },
      border: { color: t.baseline },
      ticks: { color: t.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
    },
    y: {
      stacked: !!stacked,
      beginAtZero: true,
      grid: { color: t.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: t.muted, font: { size: 11 }, padding: 8 },
    },
  };
}

function legendConf(t) {
  return {
    position: "top",
    align: "end",
    labels: {
      color: t.secondary, boxWidth: 8, boxHeight: 8, usePointStyle: true,
      pointStyle: "circle", padding: 14, font: { size: 12 },
    },
  };
}

function tooltipConf(t) {
  return {
    backgroundColor: t.surface,
    titleColor: t.text,
    bodyColor: t.secondary,
    borderColor: t.baseline,
    borderWidth: 1,
    padding: 10,
    boxPadding: 4,
    usePointStyle: true,
    cornerRadius: 8,
  };
}
