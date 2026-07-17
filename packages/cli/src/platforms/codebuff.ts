import type { Platform } from "./types.js";

// No installHook: Codebuff has no session-end mechanism at all, and its
// ~/.config/manicode/ directory is auth-only.
export const codebuff: Platform = { id: "codebuff", label: "Codebuff" };
