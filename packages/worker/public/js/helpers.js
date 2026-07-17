"use strict";

// constants
var SESSION_KEY = "ccusage-hub-session";
var THEME_KEY = "ccusage-hub-theme"; // "auto" | "light" | "dark"

// dataviz reference palette, keyed by mode. Categorical slots in fixed order.
var THEMES = {
  light: {
    surface: "#fcfcfb", text: "#0b0b0b", secondary: "#52514e", muted: "#898781",
    grid: "#e1e0d9", baseline: "#c3c2b7", other: "#898781",
    series: ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834", "#4a3aa7", "#e34948"],
  },
  dark: {
    surface: "#1a1a19", text: "#ffffff", secondary: "#c3c2b7", muted: "#898781",
    grid: "#2c2c2a", baseline: "#383835", other: "#898781",
    series: ["#3987e5", "#008300", "#d55181", "#c98500", "#199e70", "#d95926", "#9085e9", "#e66767"],
  },
};

var DIM_NOUN = { machine: "machine", agent: "agent", model: "model" };

// state
var state = {
  session: null,
  days: 30,
  groupBy: "machine",
  includeCache: false,
  data: null, // { rows, totals }
  loading: false,
  lastKey: null, // full ccu_ key from the most recent creation (for the generator)
};
var charts = { cost: null, token: null, share: null };
var authMode = "login"; // "setup" | "login"

// helpers
function $(id) { return document.getElementById(id); }

function mode() {
  var pref = localStorage.getItem(THEME_KEY) || "auto";
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function theme() { return THEMES[mode()]; }

function applyThemeAttr() {
  var pref = localStorage.getItem(THEME_KEY) || "auto";
  if (pref === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pref);
}

var fmtCompact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
var fmtInt = new Intl.NumberFormat("en");
function money(n) {
  return "$" + n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Local calendar date (not UTC): ccusage reports rows by local date, and
// toISOString() would lag a day behind for users east of UTC.
function isoDate(d) {
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}
function rangeDates() {
  var to = new Date();
  var from = new Date();
  from.setDate(to.getDate() - (state.days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

// Assign a stable color per entity: index by alphabetical order of all keys,
// so a given machine/agent/model keeps its hue regardless of range or rank.
function colorMap(allKeys) {
  var sorted = allKeys.slice().sort();
  var t = theme();
  // Null-prototyped: keys are upload-supplied, so "__proto__" must map to a color
  // rather than reading through to Object.prototype.
  var map = Object.create(null);
  sorted.forEach(function (k, i) {
    map[k] = i < t.series.length ? t.series[i] : t.other;
  });
  return map;
}

function shortDate(iso) {
  var p = iso.split("-");
  var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1] - 1];
  return m + " " + (+p[2]);
}

function fmtDate(iso) {
  if (!iso) return "—";
  return shortDate(iso.slice(0, 10)) + ", " + iso.slice(0, 4);
}

// Relative time for "last used": just now / 5m / 3h / 2d, else absolute date.
function relTime(iso) {
  if (!iso) return "Never";
  var diff = Date.now() - Date.parse(iso);
  if (isNaN(diff)) return "—";
  var min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var day = Math.floor(hr / 24);
  if (day < 30) return day + "d ago";
  return fmtDate(iso);
}

function resetCopyBtn(btn) { btn.classList.remove("done", "failed"); btn.textContent = "Copy"; }

function copyText(text, btn) {
  var done = function () {
    btn.textContent = "Copied";
    btn.classList.add("done");
    setTimeout(function () { resetCopyBtn(btn); }, 1600);
  };
  var fail = function () {
    btn.textContent = "Copy failed";
    btn.classList.add("failed");
    setTimeout(function () { btn.classList.remove("failed"); resetCopyBtn(btn); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text) ? done() : fail(); });
  } else {
    fallbackCopy(text) ? done() : fail();
  }
}
// Returns true only if the copy actually succeeded.
function fallbackCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function escapeAttr(s) { return escapeHtml(s); }
