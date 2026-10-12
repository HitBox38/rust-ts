// tools/codegen/lints.ts: the committed src/rustc_lint_defs/builtin.gen.ts is what the generator makes
// from the pinned upstream, and the declare_lint! parser expands / rejects synthetic invocations as the
// macro would. Needs the upstream checkout ($RUST_TS_DATA/rust); skips visibly without it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { generate } from "./lints.ts";

const LIB = join(UPSTREAM, "compiler/rustc_lint_defs/src/lib.rs");
const BUILTIN = join(UPSTREAM, "compiler/rustc_lint_defs/src/builtin.rs");
const EDITION = join(UPSTREAM, "compiler/rustc_span/src/edition.rs");
const SKIP = !existsSync(LIB);
if (SKIP) console.log("SKIP: upstream checkout missing (bun scripts/upstream.ts)");

const read = (p: string): string => readFileSync(p, "utf8");
const HW = "use crate::{declare_lint, declare_lint_pass, fcw};\npub mod hardwired { use super::*; pub fn lint_vec() -> crate::LintVec { vec![A] } }\n";
const gen = (body: string, extra = ""): string => generate(read(LIB), `${HW}declare_lint! {\n${body}\n}\n${extra}`, read(EDITION)).text;

test.skipIf(SKIP)("committed builtin.gen.ts is up to date", () => {
  const g = generate(read(LIB), read(BUILTIN), read(EDITION));
  expect(g.lints.length).toBe(153);
  expect(read(join(REPO, "src/rustc_lint_defs/builtin.gen.ts"))).toBe(g.text);
});

test.skipIf(SKIP)("declare_lint! expansion: every optional part, field order and defaults", () => {
  const t = gen(
    `/// Doc line.
    #[doc = "x"]
    pub A, Allow, "a \\"b\\" \\
     c",
    @eval_always = true
    @feature_gate = must_not_suspend;
    @future_incompatible = FutureIncompatibleInfo {
        reason: fcw!(EditionAndFutureReleaseError 2018 "slug"),
        report_in_deps: true,
    };
    @edition Edition2021 => Deny;
    crate_level_only, report_in_external_macro`,
  );
  const block = t.slice(t.indexOf("// rustc-lint:"));
  expect(block).toContain('/// Doc line.\n// #[doc = "x"]\n');
  expect(block).toContain(
    [
      "export const A: Lint = Object.freeze<Lint>({",
      '  name: "A",',
      '  default_level: "Allow",',
      '  desc: "a \\"b\\" c",',
      '  edition_lint_opts: ["Edition2021", "Deny"],',
      "  report_in_external_macro: true,",
      '  future_incompatible: Object.freeze<FutureIncompatibleInfo>({ reason: { $: "EditionAndFutureReleaseError", _0: { edition: "Edition2018", page_slug: "slug" } }, explain_reason: true, report_in_deps: true }),',
      "  is_externally_loaded: false,",
      "  feature_gate: sym.must_not_suspend,",
      "  crate_level_only: true,",
      "  eval_always: true,",
      "  ignore_deny_warnings: false,",
      "  rust_version: undefined,",
      "});",
    ].join("\n"),
  );
  // first macro arm (no trailing comma) and a Custom fcw reason
  const u = gen(`pub A, Warn, "d"`);
  expect(u).toContain('  default_level: "Warn",\n  desc: "d",\n  edition_lint_opts: undefined,');
  const c = gen(`pub A, Warn, "d", @future_incompatible = FutureIncompatibleInfo { reason: fcw!("custom text" #12) };`);
  expect(c).toContain('reason: { $: "Custom", _0: "custom text", _1: { issue_number: 12 } }, explain_reason: true, report_in_deps: false');
  // declare_lint_pass!
  const p = gen(`pub A, Warn, "d"`, "declare_lint_pass!(P => [A]);\n");
  expect(p).toContain("export class P implements LintPass {");
});

test.skipIf(SKIP)("declare_lint! inputs the macro would reject are errors", () => {
  const bad = (body: string): void => {
    expect(() => gen(body)).toThrow(/^ERROR: /);
  };
  bad(`pub A, Loud, "d"`); // unknown level
  bad(`pub A, Warn, "d", @edition Edition2024 => Warn; @feature_gate = x;`); // out of macro order
  bad(`pub A, Warn, "d", @msrv = "1.2.3";`); // not supported yet
  bad(`pub A, Warn, "d", crate_level_only, crate_level_only`); // duplicate field
  bad(`pub A, Warn, "d", name`); // not a bool field
  bad(`pub A, Warn, "d", @future_incompatible = FutureIncompatibleInfo { reason: fcw!(EditionError 2027 "s") };`); // no fcw arm
  bad(`#[cfg(test)] pub A, Warn, "d"`);
  // a changed macro_rules! body is detected
  expect(() => generate(read(LIB).replace("is_externally_loaded: false,\n            $($v: true,)*", "$($v: true,)*"), `${HW}`, read(EDITION))).toThrow(
    /macro_rules! declare_lint changed upstream/,
  );
});
