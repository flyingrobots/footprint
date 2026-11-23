// The arguments a command's handler sees, after parley-emit has removed its own flags (--human,
// --dry-run, --schema, --help). Every flag a command takes carries a value, as `--flag value` or
// `--flag=value`; an unknown flag is an error rather than a positional, so `--max-chars 40960`
// can never be read as a range named `40960`.

export type Parsed =
  | { readonly ok: true; readonly positionals: readonly string[]; readonly flags: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly problem: string };

export function parseArgs(argv: readonly string[], valued: readonly string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("-")) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq < 0 ? a : a.slice(0, eq);
    if (!valued.includes(name)) return { ok: false, problem: `unknown flag ${name}; this command takes ${valued.join(", ") || "no flags"}` };
    const value = eq < 0 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined) return { ok: false, problem: `${name} needs a value` };
    if (name in flags) return { ok: false, problem: `${name} was given twice` };
    flags[name] = value;
  }
  return { ok: true, positionals, flags };
}
