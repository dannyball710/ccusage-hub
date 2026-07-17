"use strict";

// API
function api(path, opts) {
  opts = opts || {};
  var headers = Object.assign({ Authorization: "Bearer " + state.session }, opts.headers || {});
  return fetch(path, Object.assign({}, opts, { headers: headers }));
}

// stats loading
function setLoading(on) {
  state.loading = on;
  ["cost", "token", "share"].forEach(function (id) {
    var el = $(id + "-state");
    if (on) {
      el.innerHTML = '<div class="spinner"></div>';
      el.classList.add("show");
    } else if (state.data && state.data.rows.length) {
      el.classList.remove("show");
    }
  });
}

function showEmpty() {
  ["cost", "token", "share"].forEach(function (id) {
    var el = $(id + "-state");
    el.innerHTML = "<div>No usage in this range.</div><div style='color:var(--muted)'>Create an API key in Settings, then run the CLI on a machine.</div>";
    el.classList.add("show");
  });
}

function loadData() {
  var r = rangeDates();
  setLoading(true);
  var q = "/api/stats?from=" + r.from + "&to=" + r.to + "&groupBy=" + state.groupBy;
  api(q)
    .then(function (res) {
      if (res.status === 401) { signOut("Session expired. Sign in again."); throw new Error("401"); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (json) {
      state.data = { rows: json.rows || [], totals: json.totals || {} };
      setLoading(false);
      render();
    })
    .catch(function (err) {
      if (err.message === "401") return;
      setLoading(false);
      ["cost", "token", "share"].forEach(function (id) {
        var el = $(id + "-state");
        el.innerHTML = "<div>Failed to load.</div><div style='color:var(--muted)'></div>";
        el.lastElementChild.textContent = err.message;
        el.classList.add("show");
      });
    });
}

// aggregation
function uniqueSortedDates(rows) {
  var set = {};
  rows.forEach(function (r) { set[r.date] = true; });
  return Object.keys(set).sort();
}

function tokenTotal(t) {
  return (t.inputTokens || 0) + (t.outputTokens || 0) + (t.cacheCreationTokens || 0) + (t.cacheReadTokens || 0);
}
