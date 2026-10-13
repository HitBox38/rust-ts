// Oracle checks of the lint level machinery (levels.rs, context.rs `check_lint_name`, rustc_middle lint.rs
// `emit_lint_base`) against the pinned nightly rustc.
//   - EARLY cases run src/rust_ts/lintlevels.ts: the ported driver up to the crate root, then the pre-expansion
//     and early `check_ast_node` on it (command-line `-A/-W/-D/-F/--force-warn/--cap-lints` and crate-level
//     `#![allow/warn/deny/forbid/expect]`). The oracle compiles the same file as a `#![no_core]` lib
//     (`--emit=metadata`), whose only diagnostics are the lint level ones, emitted by the same two passes.
//   - DRIVER cases run src/rust_ts/main.ts (`-Zunpretty=expanded`), which now gets through the pre-expansion lint
//     pass (KeywordIdents) to the next unported step.
// Both must print a non-empty prefix of the oracle's stderr. DRIVER cases then stop at `rust-ts: unported: <what>`
// (exit 70). EARLY cases run all early passes (lane lint-early-b) and stop after them, so their stderr minus the
// final summary (`N warnings emitted` / `aborting due to ..`) must be a prefix of the oracle's (which goes on to the
// later phases).
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

const WORK = join(DATA, "tmp", "lint-levels-oracle", process.env.RUST_TS_AGENT ?? "default");
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
const nocore = (edition: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot(),
  `--edition=${edition}`,
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
];

interface Case {
  name: string;
  src: string;
  edition?: string;
  flags?: string[];
  /** Text our output must contain (the diagnostics under test were really emitted). */
  expect: string[];
  /** Set for the EARLY cases: the test driver stops after the early lint passes (see `check`). */
  stops_after_early_lints?: boolean;
}

const EARLY: Case[] = [
  {
    name: "unknown, renamed, removed, tool and malformed lint attributes; forbid group then allow (FCW)",
    src: [
      "#![allow(unknwn_lint, unused_variabels)]",
      "#![deny(bare_trait_object, raw_pointer_derive)]",
      "#![warn(clippy::foo, nonexistent_tool::bar, UNUSED)]",
      "#![forbid(unused)]",
      "#![allow(unused_variables)]",
      '#![allow(foo = "x", reason = 1)]',
      '#![expect(dead_code, reason = "because")]',
      "",
    ].join("\n"),
    flags: ["-W", "unknown_x", "-D", "renamed_and_removed_lints", "-A", "non_fmt_panic", "--force-warn", "warnings", "-Wclippy::x"],
    expect: ["unknown lint: `unknown_x`", "did you mean: `unused_variables`", "E0710", "E0452", "overruled by previous forbid"],
  },
  {
    name: "forbid then allow of a single lint (E0453), reason note",
    src: '#![forbid(unused_variables, reason = "no")]\n#![allow(unused_variables)]\n#![deny(unused_variables)]\n',
    expect: ["E0453", "`forbid` level set here"],
  },
  {
    name: "-F on the command line then #![allow]",
    src: "#![allow(dead_code, unused)]\n",
    flags: ["-F", "dead_code", "-F", "unused_imports"],
    expect: ["`forbid` lint level was set on command line (`-F dead_code`)"],
  },
  {
    name: "--cap-lints=warn caps #![deny(unknown_lints)]",
    src: "#![deny(unknown_lints)]\n#![allow(foo_bar)]\n#![warn(nonstandard_style, bad_style, rust_2018_idiom)]\n",
    flags: ["--cap-lints=warn"],
    expect: ["unknown lint: `foo_bar`", "did you mean: `rust_2018_idioms`"],
  },
  {
    name: "#![deny(warnings)] and -D warnings on a warn-by-default lint",
    src: "#![deny(warnings)]\n#![allow(unkown_lints_x)]\n",
    flags: ["-W", "missing_doc"],
    expect: ["implied by `#[deny(warnings)]`"],
  },
  {
    name: "renamed / removed / unknown lints on the command line with suggestions",
    src: "\n",
    flags: ["-A", "single_use_lifetime", "-W", "raw_pointer_deriving", "-D", "unused_variabels", "-W", "UNUSED_IMPORTS", "-W", "clippy::all", "-A", "rustdoc::foo"],
    expect: ["has been renamed to `single_use_lifetimes`", "has been removed", "did you mean"],
  },
  {
    name: "feature-gated lint without its feature",
    src: "#![allow(must_not_suspend)]\n#![warn(unknown_lints)]\n#![deny(test_unstable_lint)]\n",
    expect: ["the `must_not_suspend` lint is unstable"],
  },
  {
    name: "deprecated lint group name with a tool prefix",
    src: "#![allow(rustc::internal)]\n#![allow(clippy::style)]\n#![allow(broken_intra_doc_links)]\n",
    flags: ["-Wrust_2018_idioms"],
    expect: [],
  },
];

const DRIVER: Case[] = [
  {
    name: "keyword_idents (pre-expansion KeywordIdents) with #![warn(keyword_idents)]",
    src: "#![warn(keyword_idents)]\nfn async() {}\nmacro_rules! m { ($async:ident) => { fn r#try() {} async } }\nfn main() { let dyn = 1; let gen = 2; }\n",
    edition: "2015",
    expect: ["`async` is a keyword in the 2018 edition", "implied by `#[warn(keyword_idents)]`", "`dyn` is a keyword"],
  },
  {
    name: "keyword_idents_2024 via -D on the command line, in 2021",
    src: "fn gen() {}\n",
    edition: "2021",
    flags: ["-D", "keyword-idents-2024"],
    expect: ["`gen` is a keyword in the 2024 edition", "requested on the command line with `-D keyword-idents-2024`"],
  },
  {
    name: "keyword_idents under -A warnings",
    src: "#![warn(keyword_idents)]\nfn async() {}\n",
    edition: "2015",
    flags: ["-A", "warnings", "-W", "unknwn"],
    expect: [],
  },
];

function check(c: Case, ours: Out, oracle: Out): void {
  const marker = "rust-ts: unported: ";
  const i = ours.stderr.indexOf(marker);
  if (ours.code === 70 && i >= 0) {
    const prefix = ours.stderr.slice(0, i);
    expect(oracle.stderr.startsWith(prefix)).toBe(true);
    for (const e of c.expect) expect(prefix).toContain(e);
  } else if (c.stops_after_early_lints) {
    // lane lint-early-b: the test driver stops after the early lint passes; rustc goes on to later phases.
    expect(ours.stderr).not.toContain("rust-ts: ");
    const prefix = strip_summary(ours.stderr);
    expect(oracle.stderr.startsWith(prefix)).toBe(true);
    for (const e of c.expect) expect(prefix).toContain(e);
  } else {
    expect(ours.stderr).toBe(oracle.stderr);
    expect(ours.code).toBe(oracle.code);
  }
}

/** Drops the final summary lines (`warning: N warnings emitted`, `error: aborting due to ..`, `For more information ..`). */
function strip_summary(s: string): string {
  const lines = s.split("\n");
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l === "" || /^warning: \d+ warnings? emitted$/.test(l) || /^error: aborting due to/.test(l) || /^(For more information|Some errors have detailed)/.test(l)) end = i;
    else break;
  }
  return lines.slice(0, end).join("\n");
}

for (const [i, c] of EARLY.entries()) {
  test.skipIf(SKIP)(`early: ${c.name}`, () => {
    const file = `early${i}.rs`;
    writeFileSync(join(WORK, file), c.src);
    const args = [...nocore(c.edition ?? "2021"), "--crate-type=lib", "--emit=metadata", "-o", "/dev/null", ...(c.flags ?? []), file];
    const oracle = run([...RUSTC, ...args]);
    const ours = run([process.execPath, join(REPO, "src/rust_ts/lintlevels.ts"), ...args]);
    check({ ...c, stops_after_early_lints: true }, ours, oracle);
  });
}

for (const [i, c] of DRIVER.entries()) {
  test.skipIf(SKIP)(`driver: ${c.name}`, () => {
    const file = `driver${i}.rs`;
    writeFileSync(join(WORK, file), c.src);
    const args = [...nocore(c.edition ?? "2021"), "-Zunpretty=expanded", ...(c.flags ?? []), file];
    const oracle = run([...RUSTC, ...args]);
    const ours = run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args]);
    check(c, ours, oracle);
  });
}
