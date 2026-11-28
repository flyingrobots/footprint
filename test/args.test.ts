// The arguments a command's handler sees. Valued flags take `--flag value` or `--flag=value`; a
// boolean flag, `--no-fetch` (flyingrobots/footprint#80), takes none and refuses one.
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args.ts";

describe("parseArgs", () => {
  test("a boolean flag takes no value, and the next argument stays a positional", () => {
    expect(parseArgs(["--no-fetch", "origin/main"], ["--max-chars"], ["--no-fetch"])).toEqual({ ok: true, positionals: ["origin/main"], flags: { "--no-fetch": "true" } });
  });

  test("a boolean flag given a value, or twice, is refused", () => {
    expect(parseArgs(["--no-fetch=yes"], [], ["--no-fetch"])).toMatchObject({ ok: false });
    expect(parseArgs(["--no-fetch", "--no-fetch"], [], ["--no-fetch"])).toMatchObject({ ok: false });
  });

  test("valued flags work as before, and an unknown flag is still an error", () => {
    expect(parseArgs(["--max-chars", "40960", "a..b"], ["--max-chars"], ["--no-fetch"])).toEqual({ ok: true, positionals: ["a..b"], flags: { "--max-chars": "40960" } });
    expect(parseArgs(["--fetch"], ["--max-chars"], ["--no-fetch"])).toMatchObject({ ok: false });
  });
});
