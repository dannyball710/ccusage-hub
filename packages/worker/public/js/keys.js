"use strict";

// keys modal
function openKeys() {
  $("keys-overlay").classList.add("show");
  $("keys-overlay").setAttribute("aria-hidden", "false");
  $("key-reveal").classList.add("hidden");
  $("key-create-err").textContent = "";
  $("key-name").value = "";
  state.lastKey = null;
  loadKeys();
  $("key-name").focus();
}
function closeKeys() {
  $("keys-overlay").classList.remove("show");
  $("keys-overlay").setAttribute("aria-hidden", "true");
}

function loadKeys() {
  var list = $("keys-list");
  list.innerHTML = '<div class="keys-loading">Loading…</div>';
  api("/api/keys")
    .then(function (res) {
      if (res.status === 401) { closeKeys(); signOut("Session expired. Sign in again."); throw new Error("401"); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (json) { renderKeysList(json.keys || []); })
    .catch(function (err) {
      if (err.message === "401") return;
      list.innerHTML = '<div class="keys-empty"></div>';
      list.firstElementChild.textContent = "Failed to load keys: " + err.message;
    });
}

function renderKeysList(keys) {
  var list = $("keys-list");
  if (!keys.length) {
    list.innerHTML = '<div class="keys-empty">No keys yet. Create one above to connect a machine.</div>';
    return;
  }
  var rows = keys.map(function (k) {
    var status = k.revoked
      ? '<span class="badge revoked">Revoked</span>'
      : '<span class="badge active">Active</span>';
    var action = k.revoked
      ? ""
      : '<button class="link-accent" data-setup="' + escapeAttr(k.name) + '">Set up</button>' +
        '<button class="link-danger" data-revoke="' + escapeAttr(k.id) + '" data-name="' + escapeAttr(k.name) + '">Revoke</button>';
    return (
      "<tr>" +
      '<td class="name">' + escapeHtml(k.name) + "</td>" +
      '<td class="num">' + fmtDate(k.createdAt) + "</td>" +
      '<td class="num">' + relTime(k.lastUsedAt) + "</td>" +
      "<td>" + status + "</td>" +
      '<td style="text-align:right">' + action + "</td>" +
      "</tr>"
    );
  });
  list.innerHTML =
    '<table class="keys-table"><thead><tr>' +
    "<th>Name</th><th>Created</th><th>Last used</th><th>Status</th><th></th>" +
    "</tr></thead><tbody>" + rows.join("") + "</tbody></table>";

  list.querySelectorAll("[data-revoke]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      revokeKey(btn.getAttribute("data-revoke"), btn.getAttribute("data-name"));
    });
  });
  list.querySelectorAll("[data-setup]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openGeneratorForExisting(btn.getAttribute("data-setup"));
    });
  });
}

function createKey() {
  var name = $("key-name").value.trim();
  var errEl = $("key-create-err");
  errEl.textContent = "";
  if (!name) { errEl.textContent = "Enter a name first."; return; }
  var btn = $("key-create");
  btn.disabled = true; btn.textContent = "Creating…";
  api("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name }),
  })
    .then(function (res) {
      if (res.status === 401) { closeKeys(); signOut("Session expired. Sign in again."); throw new Error("401"); }
      return res.json().then(function (j) {
        if (!res.ok || !j.ok) throw new Error(j.error || "HTTP " + res.status);
        return j;
      });
    })
    .then(function (j) {
      btn.disabled = false; btn.textContent = "Create key";
      $("key-name").value = "";
      state.lastKey = j.key;
      // created mode: reveal the real key once, hide the placeholder note
      $("reveal-created").classList.remove("hidden");
      $("reveal-existing").classList.add("hidden");
      $("reveal-key").textContent = j.key;
      $("gen-machine").value = sanitizeMachine(name); // seed device name with the key name
      $("gen-editor").value = "claude";
      updateCommand();
      $("key-reveal").classList.remove("hidden");
      resetCopyBtn($("reveal-key-copy"));
      resetCopyBtn($("gen-copy"));
      loadKeys();
    })
    .catch(function (err) {
      btn.disabled = false; btn.textContent = "Create key";
      if (err.message === "401") return;
      errEl.textContent = err.message;
    });
}

// Reopen the generator for an existing key, whose full value we can't retrieve —
// so the command carries a <YOUR_API_KEY> placeholder the user replaces.
function openGeneratorForExisting(name) {
  state.lastKey = "<YOUR_API_KEY>";
  $("reveal-created").classList.add("hidden");
  $("reveal-existing").classList.remove("hidden");
  $("reveal-existing-title").textContent = 'Set up "' + name + '"';
  $("gen-machine").value = sanitizeMachine(name);
  $("gen-editor").value = "claude";
  updateCommand();
  $("key-reveal").classList.remove("hidden");
  resetCopyBtn($("gen-copy"));
  $("key-reveal").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function revokeKey(id, name) {
  if (!window.confirm('Revoke key "' + name + '"? Machines using it will stop uploading.')) return;
  api("/api/keys/" + encodeURIComponent(id), { method: "DELETE" })
    .then(function (res) {
      if (res.status === 401) { closeKeys(); signOut("Session expired. Sign in again."); throw new Error("401"); }
      if (!res.ok) throw new Error("HTTP " + res.status);
      loadKeys();
    })
    .catch(function (err) {
      if (err.message === "401") return;
      window.alert("Failed to revoke: " + err.message);
    });
}

function wireKeys() {
  $("keys-close").addEventListener("click", closeKeys);
  $("keys-overlay").addEventListener("click", function (e) {
    if (e.target === $("keys-overlay")) closeKeys();
  });
  $("key-create").addEventListener("click", createKey);
  $("key-name").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); createKey(); }
  });
  $("gen-machine").addEventListener("input", updateCommand);
  $("gen-editor").addEventListener("change", updateCommand);
  $("reveal-key-copy").addEventListener("click", function () { copyText(state.lastKey || "", $("reveal-key-copy")); });
  $("gen-copy").addEventListener("click", function () { copyText($("gen-command").textContent, $("gen-copy")); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && $("keys-overlay").classList.contains("show")) closeKeys();
  });
}
