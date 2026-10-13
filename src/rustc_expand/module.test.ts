// Oracle tests for lane expand-base: out-of-line module loading (module.rs), cfg-stripping and
// `cfg_attr` expansion (config.rs: `StripUnconfigured`, `pre_configure_attrs`, `features`), and the
// generated diagnostics they emit. Each case in expand_oracle/cases/ was run through the pinned rustc
// (`-Zunpretty=expanded -Zcrate-attr=feature(no_core) -Zcrate-attr=no_core -Zui-testing`, see
// expand_oracle/gen.ts) and recorded in expand_oracle/expected.json. The TS side is
// expand_oracle/walk.ts on the same files and flags: stdout (the crate after cfg-stripping and module
// loading), stderr (diagnostics byte for byte) and the exit code must match.
//
// PENDING: cases that need other lanes' code (name -> the `unported` they reach). Root deletes an entry
// once it matches; until then the test checks that the case stops at exactly that point.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = join(import.meta.dir, "expand_oracle");
const expected: Record<string, { args: string[]; stdout: string; stderr: string; exit: number }> = JSON.parse(
  readFileSync(join(HERE, "expected.json"), "utf8"),
);

const PENDING: Record<string, string> = {
};

function run_walk(name: string, args: string[]): { stdout: string; stderr: string; exit: number } {
  const p = Bun.spawnSync([process.execPath, join(HERE, "walk.ts"), ...args], {
    cwd: join(HERE, "cases", name),
    env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
  });
  return { stdout: p.stdout.toString(), stderr: p.stderr.toString(), exit: p.exitCode ?? -1 };
}

describe("rustc_expand module loading + cfg stripping vs oracle", () => {
  for (const [name, exp] of Object.entries(expected)) {
    test(name, () => {
      const got = run_walk(name, exp.args);
      const pending = PENDING[name];
      if (pending !== undefined) {
        expect(got.exit).toBe(70);
        expect(got.stderr).toContain(pending);
        return;
      }
      expect(got.stderr).toBe(exp.stderr);
      expect(got.stdout).toBe(exp.stdout);
      expect(got.exit).toBe(exp.exit);
    });
  }
});
