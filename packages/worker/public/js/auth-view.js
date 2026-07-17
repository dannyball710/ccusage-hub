"use strict";

// auth
function showAuth(m, msg) {
  authMode = m;
  $("app").classList.add("hidden");
  $("gate").classList.remove("hidden");
  var setup = m === "setup";
  $("auth-title").textContent = setup ? "Welcome to ccusage-hub" : "ccusage-hub";
  $("auth-sub").textContent = setup
    ? "First run — choose an admin password (min 8 characters)."
    : "Sign in to view usage.";
  $("pw-input").setAttribute("autocomplete", setup ? "new-password" : "current-password");
  $("pw-confirm-field").classList.toggle("hidden", !setup);
  $("auth-submit").textContent = setup ? "Create password" : "Sign in";
  $("auth-err").textContent = msg || "";
  $("pw-input").value = "";
  $("pw-confirm").value = "";
  $("pw-input").focus();
}

function submitAuth(e) {
  e.preventDefault();
  var pw = $("pw-input").value;
  var errEl = $("auth-err");
  errEl.textContent = "";
  var setup = authMode === "setup";

  if (setup) {
    if (pw.length < 8) { errEl.textContent = "Password must be at least 8 characters."; return; }
    if (pw !== $("pw-confirm").value) { errEl.textContent = "Passwords do not match."; return; }
  } else if (!pw) {
    return;
  }

  var btn = $("auth-submit");
  btn.disabled = true; btn.textContent = setup ? "Creating…" : "Signing in…";
  var path = setup ? "/api/setup" : "/api/login";
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  })
    .then(function (res) {
      return res.json().then(function (j) {
        if (res.status === 401) throw new Error("Incorrect password.");
        if (!res.ok || !j.ok) throw new Error(j.error || "Server error (" + res.status + ").");
        return j;
      });
    })
    .then(function (j) {
      localStorage.setItem(SESSION_KEY, j.session);
      state.session = j.session;
      btn.disabled = false; btn.textContent = setup ? "Create password" : "Sign in";
      startApp();
    })
    .catch(function (err) {
      btn.disabled = false; btn.textContent = setup ? "Create password" : "Sign in";
      errEl.textContent = err.message;
    });
}

function signOut(msg) {
  // Local-only sign out (no server call). Used on 401 / expiry.
  localStorage.removeItem(SESSION_KEY);
  state.session = null;
  state.data = null;
  destroyCharts();
  showAuth("login", msg);
}

function doLogout() {
  // Explicit logout: invalidate the session server-side, then reset.
  if (state.session) {
    api("/api/logout", { method: "POST" }).catch(function () {});
  }
  signOut();
}
