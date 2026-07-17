"use strict";

// Device names are restricted to this safe set so the generated command can
// never carry a shell metacharacter. Quoting escape rules differ across
// PowerShell and bash, so we allowlist rather than try to escape. A leading "-"
// is also rejected: it would parse as a flag to the CLI's own arg parser.
var MACHINE_RE = /^(?!-)[A-Za-z0-9._ -]*$/;
function machineValid(name) { return MACHINE_RE.test(name); }
function sanitizeMachine(name) {
  return (name || "").replace(/[^A-Za-z0-9._ -]/g, "").trim().replace(/^-+/, "");
}

// Build the CLI one-liner. Endpoint = this dashboard's origin (Worker serves both).
// `machine` is assumed already validated against MACHINE_RE; within that set a
// double-quoted value is safe on both PowerShell and bash.
function buildInitCommand(key, machine, editor) {
  var origin = window.location.origin;
  var cmd = "npx -y ccusage-hub@latest init --endpoint " + origin + " --key " + key;
  var m = (machine || "").trim();
  if (m) cmd += " --machine " + (/\s/.test(m) ? '"' + m + '"' : m);
  cmd += " --editor " + editor + " --yes";
  return cmd;
}

function updateEditorNote(editor) {
  // Only the claude editor installs the auto-sync hook; flag the others.
  var note = $("gen-note");
  if (editor === "claude") {
    note.classList.add("hidden");
    note.textContent = "";
  } else {
    note.classList.remove("hidden");
    note.textContent =
      "No auto-sync hook is installed for this editor — run ccusage-hub sync on that machine (or rely on another machine's Claude Code hook if home is shared).";
  }
}

function updateCommand() {
  if (!state.lastKey) return;
  var machine = $("gen-machine").value;
  var editor = $("gen-editor").value;
  var input = $("gen-machine");
  var errEl = $("gen-machine-err");
  updateEditorNote(editor);
  if (!machineValid(machine)) {
    input.classList.add("invalid");
    errEl.textContent = "Only letters, digits, space, . _ - and cannot start with -";
    $("gen-command").textContent = "Enter a valid device name to generate the command.";
    $("gen-copy").disabled = true;
    resetCopyBtn($("gen-copy"));
    return;
  }
  input.classList.remove("invalid");
  errEl.textContent = "";
  $("gen-copy").disabled = false;
  $("gen-command").textContent = buildInitCommand(state.lastKey, machine, editor);
  resetCopyBtn($("gen-copy"));
}
