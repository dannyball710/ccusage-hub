"use strict";

// dashboard controls
function markSeg(segId, attr, val) {
  var seg = $(segId);
  seg.querySelectorAll("button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.dataset[attr] === String(val)));
  });
}

function wireControls() {
  $("range-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.days = +b.dataset.days;
    markSeg("range-seg", "days", state.days);
    loadData();
  });
  $("dim-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.groupBy = b.dataset.dim;
    markSeg("dim-seg", "dim", state.groupBy);
    loadData();
  });
  $("cache-toggle").addEventListener("change", function (e) {
    state.includeCache = e.target.checked;
    if (state.data && state.data.rows.length) renderTokenChart();
  });
  $("theme-btn").addEventListener("click", function () {
    var order = ["auto", "light", "dark"];
    var cur = localStorage.getItem(THEME_KEY) || "auto";
    var next = order[(order.indexOf(cur) + 1) % order.length];
    localStorage.setItem(THEME_KEY, next);
    applyThemeAttr();
    if (state.data && state.data.rows.length) render();
  });
  $("signout-btn").addEventListener("click", function () { doLogout(); });
  $("keys-btn").addEventListener("click", openKeys);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if ((localStorage.getItem(THEME_KEY) || "auto") === "auto" && state.data) render();
  });
}

function startApp() {
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");
  markSeg("range-seg", "days", state.days);
  markSeg("dim-seg", "dim", state.groupBy);
  loadData();
}

// boot
function boot() {
  localStorage.removeItem("ccusage-hub-token"); // drop the retired v1 token key
  applyThemeAttr();
  wireControls();
  wireKeys();
  $("auth-form").addEventListener("submit", submitAuth);

  fetch("/api/setup-status")
    .then(function (res) { return res.json(); })
    .then(function (j) {
      if (j.needsSetup) { showAuth("setup"); return; }
      var saved = localStorage.getItem(SESSION_KEY);
      if (saved) { state.session = saved; startApp(); }
      else showAuth("login");
    })
    .catch(function () {
      // If setup-status is unreachable, fall back to login.
      var saved = localStorage.getItem(SESSION_KEY);
      if (saved) { state.session = saved; startApp(); }
      else showAuth("login");
    });
}

boot();
