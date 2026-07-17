export interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Map<string, string>;
}

export function parseArgs(argv: string[], valueFlags: string[]): Flags {
  const positional: string[] = [];
  const bool = new Set<string>();
  const value = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (valueFlags.includes(name)) {
        // Don't consume a following flag as this flag's value; treat it as missing.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value.set(name, next);
          i++;
        } else {
          value.set(name, "");
        }
      } else {
        bool.add(name);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, bool, value };
}
