// Oracle checks of the HIR side of the lint levels (levels.rs `shallow_lint_levels_on` / `LintLevelQueryMap` and its
// HIR visitor, rustc_middle lint.rs `lint_level_spec_at_node` walking up the HIR parents, expect.rs
// `lint_expectations` / `check_expectations`) against the pinned nightly rustc.
// The subject is src/rustc_lint/levels_hir_oracle/run.ts (see its header): the ported driver, then `generics_of` /
// `fn_sig` / field `type_of` per item (lints `invalid_type_param_default` through `TyCtxt::emit_node_span_lint`),
// `analysis`'s abort on non-lint errors, and `check_expectations(None)`. The oracle compiles the same file as a lib
// with std (`--emit=metadata`); each case only has diagnostics those steps produce, so stderr and the exit code
// must be identical.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "lint-levels-hir-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

interface Case {
  name: string;
  src: string[];
  edition?: string;
  flags?: string[];
  /** Text the output must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const UNFULFILLED = "this lint expectation is unfulfilled";

const CASES: Case[] = [
  {
    name: "unfulfilled #[expect] on a fn, a struct and its field, a local; reason note",
    src: [
      "#[expect(unused_variables)]",
      "pub fn h() {}",
      '#[expect(dead_code, reason = "because")]',
      "pub struct S {",
      "    #[expect(unused_mut)]",
      "    pub a: u8,",
      "}",
      "pub fn k() {",
      "    #[expect(unused_assignments)]",
      "    let _x = 1;",
      "}",
    ],
    expect: [UNFULFILLED, "= note: because"],
  },
  {
    name: "crate-level #![expect], fulfilled early-lint expectation, allow/deny on enclosing modules (other owners), trait and impl items",
    src: [
      "#![expect(non_snake_case)]",
      "#[expect(redundant_semicolons)]",
      "pub fn f() { ;; }",
      "#[allow(unfulfilled_lint_expectations)]",
      "pub mod m {",
      "    #[expect(dead_code)]",
      "    pub fn g() {}",
      "    pub mod n {",
      "        #[expect(while_true)]",
      "        pub fn h() {}",
      "    }",
      "}",
      "#[deny(unfulfilled_lint_expectations)]",
      "pub mod d {",
      "    #[expect(unused_unsafe)]",
      "    pub fn g() {}",
      "    #[expect(unfulfilled_lint_expectations)]",
      "    pub fn i() {}",
      "}",
      "pub trait T {",
      "    #[expect(unused)]",
      "    fn a(&self) {}",
      "    fn b(&self);",
      "}",
      "pub struct S;",
      "impl S {",
      '    #[expect(unused_variables, reason = "x")]',
      "    pub fn c(&self) {}",
      "}",
    ],
    expect: [UNFULFILLED, "the lint level is defined here", "error: aborting due to 2 previous errors; 3 warnings emitted"],
  },
  {
    name: "#![forbid] then #[allow] on a module (E0453 stops before check_expectations)",
    src: [
      "#![forbid(unfulfilled_lint_expectations)]",
      "#[allow(unfulfilled_lint_expectations)]",
      "pub mod m {",
      "    #[expect(dead_code)]",
      "    pub fn g() {}",
      "}",
      "#[expect(unused_mut)]",
      "pub fn h() {}",
    ],
    expect: ["E0453"],
  },
  {
    name: "#![deny(warnings)], inner #![warn], fields and variants with several attributes (HIR visit)",
    src: [
      "#![deny(warnings)]",
      "pub mod m {",
      "    #![warn(unfulfilled_lint_expectations)]",
      "    #[expect(dead_code)]",
      "    pub fn g() {}",
      "    pub struct S {",
      "        #[expect(unused)]",
      "        pub a: u8,",
      "        #[expect(unused)]",
      "        #[allow(unfulfilled_lint_expectations)]",
      "        pub b: u8,",
      "    }",
      "    pub enum E {",
      "        #[expect(unused)]",
      "        A { #[expect(unused)] x: u8 },",
      "    }",
      "}",
      "#[expect(unused_mut)]",
      "pub fn h() {}",
    ],
    expect: [UNFULFILLED, "implied by `#[deny(warnings)]`"],
  },
  {
    name: "a lint emitted from collect (invalid_type_param_default): allow, fulfilled expect, warn, default deny",
    src: [
      "#[allow(invalid_type_param_default)]",
      "pub fn a<T = u8>() {}",
      "#[expect(invalid_type_param_default)]",
      "pub fn b<T = u8>() {}",
      "#[warn(invalid_type_param_default)]",
      "pub fn c<T = u8>() {}",
      "pub fn d<T = u8>() {}",
    ],
    expect: ["defaults for generic parameters are not allowed here", "error: aborting due to 1 previous error; 1 warning emitted"],
  },
  {
    name: "attributes on generic params: one attribute per owner vs several (upstream does not visit generic params)",
    src: [
      "#[deny(dead_code)]",
      "pub fn e<#[allow(invalid_type_param_default)] T = u8>() {}",
      "pub fn f<#[allow(invalid_type_param_default)] T = u8>() {}",
      "pub struct S<#[expect(invalid_type_param_default)] T = u8>(pub T);",
    ],
    expect: ["defaults for generic parameters are not allowed here", UNFULFILLED],
  },
  {
    name: "--cap-lints warn",
    src: ["#[expect(invalid_type_param_default)]", "pub fn b<T = u8>() {}", "#[deny(invalid_type_param_default)]", "pub fn d<T = u8>() {}"],
    flags: ["--cap-lints", "warn"],
    expect: ["warning: defaults for generic parameters are not allowed here"],
  },
  {
    name: "--force-warn over #[allow], -D warnings",
    src: ["#[allow(invalid_type_param_default)]", "pub fn a<T = u8>() {}", "#[expect(unused)]", "pub fn h() {}"],
    flags: ["--force-warn", "invalid_type_param_default", "-D", "warnings"],
    expect: ["requested on the command line with `--force-warn invalid-type-param-default`", UNFULFILLED],
  },
  {
    name: "-A unfulfilled-lint-expectations on the command line, crate-level #![warn] overrides it",
    src: ["#![warn(unfulfilled_lint_expectations)]", "#[expect(unused)]", "pub fn h() {}", "pub mod m {", "    #![allow(unfulfilled_lint_expectations)]", "    #[expect(unused)]", "    pub fn g() {}", "}"],
    flags: ["-A", "unfulfilled-lint-expectations"],
    expect: [UNFULFILLED],
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`hir lint levels: ${c.name}`, () => {
    const file = `case${i}.rs`;
    writeFileSync(join(WORK, file), c.src.join("\n") + "\n");
    const args = [
      "--target",
      "x86_64-unknown-linux-gnu",
      "--sysroot",
      sysroot(),
      `--edition=${c.edition ?? "2021"}`,
      "--crate-type=lib",
      "--emit=metadata",
      "-o",
      `case${i}.rmeta`,
      ...(c.flags ?? []),
      file,
    ];
    const oracle = run([...RUSTC, ...args]);
    const ours = run([process.execPath, join(REPO, "src/rustc_lint/levels_hir_oracle/run.ts"), ...args]);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    expect(ours.stderr).toBe(oracle.stderr);
    expect(ours.code).toBe(oracle.code);
  });
}
