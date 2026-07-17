import os from "node:os";
import { join } from "node:path";
import { Document, isMap, isSeq, parseDocument } from "yaml";
import { FIX_HINT, installSafely } from "./fs-safe.js";
import { isJsonObject } from "./json-merge.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

const TIMEOUT_SEC = 30;

// NOT `on_session_end`: despite the name, that event fires once per *turn*,
// because Hermes calls run_conversation() once per user message. Only
// on_session_finalize runs once, at the end of the session.
const EVENT = "on_session_finalize";
const AUTO_ACCEPT = "hooks_auto_accept";

function defaultPath(): string {
  return join(process.env.HERMES_HOME || join(os.homedir(), ".hermes"), "config.yaml");
}

function seqRunsCcusageHub(seq: { items: unknown[] }): boolean {
  return seq.items.some((item) => {
    if (!isMap(item)) return false;
    const command = item.get("command");
    return typeof command === "string" && command.includes("ccusage-hub");
  });
}

// hooks:
//   on_session_finalize:
//     - command: "..."
//       timeout: 30
// hooks_auto_accept: true
function installHermesHook(settingsPath: string = defaultPath()): string {
  let autoAcceptWasFalse = false;

  const message = installSafely<Document>({
    settingsPath,
    // parseDocument keeps the CST, so the user's comments, anchors and
    // formatting survive the round-trip.
    parse: (raw) => {
      if (raw.trim() === "") return new Document({});
      const doc = parseDocument(raw);
      if (doc.errors.length > 0) throw new Error(`${settingsPath} is not valid YAML. ${FIX_HINT}`);
      if (!isMap(doc.contents)) {
        throw new Error(`${settingsPath} is not a YAML mapping. ${FIX_HINT}`);
      }
      return doc;
    },
    create: () => new Document({}),
    topLevelKeys: (doc) => {
      const js: unknown = doc.toJS();
      return isJsonObject(js) ? Object.keys(js) : [];
    },
    hasHook: (doc) => {
      const seq = doc.getIn(["hooks", EVENT], true);
      return isSeq(seq) && seqRunsCcusageHub(seq);
    },
    addHook: (doc) => {
      const hooks = doc.get("hooks", true);
      if (hooks !== undefined && hooks !== null && !isMap(hooks)) {
        throw new Error(`${settingsPath} "hooks" is not a mapping. ${FIX_HINT}`);
      }
      // Hermes runs hooks via shlex.split() with shell=False, so no pipes or
      // redirection -- HOOK_COMMAND must stay a plain argv, which it is.
      const entry = { command: HOOK_COMMAND, timeout: TIMEOUT_SEC };
      const existing = doc.getIn(["hooks", EVENT], true);
      if (existing === undefined || existing === null) {
        doc.setIn(["hooks", EVENT], doc.createNode([entry]));
      } else if (!isSeq(existing)) {
        throw new Error(`${settingsPath} "hooks.${EVENT}" is not a list. ${FIX_HINT}`);
      } else {
        existing.add(doc.createNode(entry));
      }

      // Without auto-accept, the first run of each (event, command) pair blocks
      // on an interactive consent prompt -- useless for an unattended sync hook.
      // Set it only when absent; an explicit false is the user's call to make.
      const autoAccept = doc.get(AUTO_ACCEPT);
      if (autoAccept === undefined || autoAccept === null) doc.set(AUTO_ACCEPT, true);
      else if (autoAccept === false) autoAcceptWasFalse = true;
    },
    serialize: (doc) => doc.toString(),
  });

  if (!autoAcceptWasFalse) return message;
  return `${message}; set ${AUTO_ACCEPT}: true (or pass --accept-hooks) so it can run without a prompt`;
}

export const hermes: Platform = {
  id: "hermes",
  label: "Hermes",
  installHook: installHermesHook,
};
