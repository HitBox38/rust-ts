// Oracle checks of the JSON diagnostic emitter (rustc_errors/src/json.rs, wired through
// rustc_session's `default_emitter` / `mk_emitter`): small programs with parse errors and warnings run
// through `rustc --error-format=json|pretty-json ... -Zparse-crate-root-only|-Zunpretty=ast-tree` on the
// pinned nightly and on `src/rust_ts/main.ts`; stdout, stderr and exit code must be byte-identical.
//   - CASES must match exactly (an `unported` exit 70 fails them).
//   - EXPECTED_UNPORTED cases stop at a known `unported(..)` (each with its reason); everything printed
//     before that point must be a prefix of the oracle's output.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

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
function requireRustc(): void {
  if (!HAVE) throw new Error(`ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1`);
}

const WORK = test_scratch_dir("json-oracle");
mkdirSync(WORK, { recursive: true });

// Same environment for both sides; no inherited jobserver or logging.
const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "COLORTERM", "TERM"].includes(k)) {
    ENV[k] = v;
  }
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const oracle = (args: string[]): Out => run([...RUSTC, ...args]);
const ours = (args: string[]): Out => run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args]);

const JSON_ = ["--edition=2021", "--error-format=json", "-Zparse-crate-root-only"];
const PRETTY = ["--edition=2021", "--error-format=pretty-json", "-Zparse-crate-root-only"];

/** Sources (file name -> bytes as a JS string; `\u{..}` escapes are written as UTF-8). */
const SRC: Record<string, string> = {
  "expr.rs": "fn main() {\n    let x = 1 +;\n}\n",
  "eqeq.rs": "fn main() {\n    let x == 1;\n}\n",
  "mismatch.rs": "fn main() {\n    let x = (1, 2];\n}\n",
  "unclosed.rs": "fn main() {\n    let x = 1;\n",
  "tab_nonascii.rs": 'fn main() {\n\tlet x = "héllo" + ;\n}\n',
  "structsemi.rs": "struct S {\n    a: i32;\n    b: u8,\n}\n",
  "missingsemi.rs": "fn f() {\n    let v = (1, 2, 3)\n    let w = 4;\n}\n",
  "emoji.rs": "fn main() {\n    let \u{1F600} = 1;\n}\n",
  "elseif.rs": "fn main() {\n    if x == 1 {\n    } else if {\n    }\n}\n",
  "floatfield.rs": "fn main() { let x = 1.0.0; }\n",
  "constsemi.rs": "const X: i32 = 1\nfn main() {}\n",
  "arr.rs": "fn main() {\n    let x = [1, 2, 3,;\n}\n",
  "trailingattr.rs": "#[derive(Debug)]\n",
  "fnparen.rs": "fn foo(a: i32, b: i32 {\n}\n",
  "turbofish.rs": "fn main() { let x: Vec<i32> = Vec::<i32>new(); }\n",
  "chained.rs": "fn main() { a < b > c; }\n",
  "tripleeq.rs": "fn main() { let _ = 1 === 2; }\n",
  "incr.rs": "fn main() { let _ = x++; }\n",
  "andkw.rs": "fn main() { if 1 and 2 {} }\n",
  "extra_brace.rs": 'fn main() {\n    let s = 1;\n    match s {\n        1 => {}\n        _ => {}\n    }}\n}\n',
  "usecomma.rs": "use std::{io, fmt,,};\n",
  "charlit.rs": "fn main() { let c = 'ab'; }\n",
  "multiline.rs": "fn main() {\n    let x = 1;\n    x =\n        ;\n}\n",
  "multiline2.rs": "fn main() {\n    let a = if true { 1 } else { 2 }\n        + 3 +;\n}\n",
  "ctrl.rs": 'fn main() {\n    let x = "\u0001\u007f\u001b\\"\\\\";\n    let y = 1 +;\n}\n',
  "crlf.rs": "fn main() {\r\n    let x = 1 +;\r\n}\r\n",
  "bom.rs": "\u{feff}fn main() {\n    let x = 1 +;\n}\n",
  "extraclose.rs": "fn main() { let x = 1; }}\n",
  "mutmut.rs": "fn main() { let mut mut x = 1; }\n",
  "noerr.rs": "fn main() { let x: i32 = 1; }\n",
  "label.rs": "fn main() { loop { break 'a 1; } }\n",
  "castlt.rs": "fn main() { let x = 1 as usize < 2; }\n",
  "skiplines.rs": 'fn main() {\n    let s = "a\\\n\n    b";\n}\n',
  "skipws.rs": 'fn main() {\n    let s = "a\\\n b";\n}\n',
  "multi.rs": "fn a() { let x = 1 +; }\nfn b() { let y = (1, 2]; }\nfn c() { let z == 3; }\n",
  "longline.rs": `fn main() {\n    let ${"a".repeat(30)} = ${"1 + ".repeat(30)};\n    let ${"b".repeat(10)} = 2 +;\n}\n`,
  "stray.rs": "fn main() {}\n;\nstruct S;\n",
  "confusable.rs": "fn main() {\n    let x = 1\u{ff1b}\n    let y = 2 \u2212 1;\n}\n",
  "straysemi2.rs": "fn main() {}\n\n#[attr] ;\n",
  "structlit.rs": "fn main() { let f = Foo { a: 1, ..Default::default(), }; }\n",
  "fnsemi.rs": "fn f() -> i32;\nfn main() {}\n",
  "ifelse.rs": "fn main() {\n    if true {\n        1\n    } else {\n        2\n    }\n    else {}\n}\n",
  "nonascii_multi.rs": "// üöä 中文\nfn main() {\n    let é = (1,\n        2];\n}\n",
};

/** [case name, args (the file name is appended)] */
const CASES: [string, string[]][] = [
  ...[
    "expr.rs",
    "eqeq.rs",
    "mismatch.rs",
    "unclosed.rs",
    "tab_nonascii.rs",
    "structsemi.rs",
    "missingsemi.rs",
    "emoji.rs",
    "elseif.rs",
    "floatfield.rs",
    "constsemi.rs",
    "arr.rs",
    "trailingattr.rs",
    "fnparen.rs",
    "turbofish.rs",
    "chained.rs",
    "tripleeq.rs",
    "incr.rs",
    "andkw.rs",
    "extra_brace.rs",
    "usecomma.rs",
    "charlit.rs",
    "multiline.rs",
    "multiline2.rs",
    "ctrl.rs",
    "crlf.rs",
    "bom.rs",
    "extraclose.rs",
    "mutmut.rs",
    "noerr.rs",
    "label.rs",
    "castlt.rs",
    "skiplines.rs",
    "skipws.rs",
    "multi.rs",
    "longline.rs",
    "stray.rs",
    "confusable.rs",
    "straysemi2.rs",
    "structlit.rs",
    "fnsemi.rs",
    "ifelse.rs",
    "nonascii_multi.rs",
  ].map((f): [string, string[]] => [f, JSON_]),
  // pretty-json
  ["expr.rs", PRETTY],
  ["noerr.rs", PRETTY],
  ["tab_nonascii.rs", PRETTY],
  ["multi.rs", PRETTY],
  ["mutmut.rs", PRETTY],
  ["skiplines.rs", PRETTY],
  // -Zui-testing
  ["expr.rs", [...JSON_, "-Zui-testing"]],
  ["multiline2.rs", [...JSON_, "-Zui-testing"]],
  ["tripleeq.rs", [...PRETTY, "-Zui-testing"]],
  // --json=...
  ["expr.rs", [...JSON_, "--json=diagnostic-short"]],
  ["multi.rs", [...JSON_, "--json=diagnostic-short"]],
  ["eqeq.rs", [...JSON_, "--json=diagnostic-rendered-ansi"]],
  ["multiline2.rs", [...JSON_, "--json=diagnostic-rendered-ansi"]],
  ["mismatch.rs", [...JSON_, "--json=diagnostic-unicode"]],
  ["structsemi.rs", [...JSON_, "--json=diagnostic-rendered-ansi,diagnostic-unicode"]],
  ["expr.rs", [...JSON_, "--json=artifacts,future-incompat,unused-externs"]],
  ["expr.rs", [...JSON_, "--json=unused-externs-silent"]],
  ["expr.rs", [...JSON_, "--color=always"]],
  ["expr.rs", [...JSON_, "--json=bogus"]],
  ["expr.rs", [...JSON_, "--json=timings"]],
  ["expr.rs", ["--json=diagnostic-short", "-Zparse-crate-root-only"]],
  // --diagnostic-width
  ["longline.rs", [...JSON_, "--diagnostic-width=40"]],
  ["longline.rs", [...JSON_, "--diagnostic-width=40", "-Zui-testing"]],
  ["longline.rs", [...PRETTY, "--diagnostic-width=60"]],
  // -Zunpretty=ast-tree (AST on stdout, diagnostics as JSON on stderr)
  ["noerr.rs", ["--edition=2021", "--error-format=json", "-Zunpretty=ast-tree"]],
  ["eqeq.rs", ["--edition=2021", "--error-format=json", "-Zunpretty=ast-tree"]],
  ["multi.rs", ["--edition=2015", "--error-format=pretty-json", "-Zunpretty=ast-tree"]],
  // early diagnostics (EarlyDiagCtxt -> `mk_emitter`)
  ["noerr.rs", [...JSON_, "-Zstaticlib-hide-internal-symbols"]],
  ["noerr.rs", [...PRETTY, "-Zstaticlib-hide-internal-symbols"]],
  ["noerr.rs", ["--error-format=json", "--crate-type=bogus"]],
  ["noerr.rs", ["--error-format=json", "--edition=2099"]],
  ["noerr.rs", ["--error-format=pretty-json", "--json=diagnostic-short", "-Zfoo"]],
  // other dcx-level flags
  ["expr.rs", [...JSON_, "-Zmacro-backtrace"]],
  ["expr.rs", [...JSON_, "-Zignore-directory-in-diagnostics-source-blocks=" + WORK]],
  ["skiplines.rs", [...JSON_, "-Awarnings"]],
  ["skiplines.rs", [...JSON_, "-Dwarnings"]],
  ["stray.rs", PRETTY],
  ["confusable.rs", [...PRETTY, "--json=diagnostic-unicode"]],
];

/** [case name, args, `unported(..)` text, reason] */
const EXPECTED_UNPORTED: [string, string[], string, string][] = [
  [
    "unterm_str.rs",
    JSON_,
    "rustc_errors::codes::DIAGNOSTICS long description text (E0765.md)",
    "error code with a long description: `explanation` needs the E<nnnn>.md text, not embedded yet (codes.ts)",
  ],
  [
    "blockcomment.rs",
    PRETTY,
    "rustc_errors::codes::DIAGNOSTICS long description text (E0758.md)",
    "error code with a long description: `explanation` needs the E<nnnn>.md text, not embedded yet (codes.ts)",
  ],
  [
    "doccomment.rs",
    JSON_,
    "rustc_errors::codes::DIAGNOSTICS long description text (E0585.md)",
    "error code with a long description: `explanation` needs the E<nnnn>.md text, not embedded yet (codes.ts)",
  ],
  [
    "expr.rs",
    [...JSON_, "-Ztrack-diagnostics"],
    "std::panic::Location::caller (DiagLocation Display)",
    "-Ztrack-diagnostics prints rustc's own source location of the diagnostic (diagnostic.ts)",
  ],
];
SRC["doccomment.rs"] = "fn main() {\n    let x = 1;\n    /// doc\n}\n";
SRC["unterm_str.rs"] = 'fn main() { let s = "abc\ndef; }\n';
SRC["blockcomment.rs"] = "/* unterminated\ncomment\n";

for (const [name, src] of Object.entries(SRC)) writeFileSync(join(WORK, name), src);

for (const [file, args] of CASES) {
  const full = [...args, file];
  test.skipIf(SKIP)(`rustc ${full.join(" ")}`, () => {
    requireRustc();
    const want = oracle(full);
    const got = ours(full);
    expect(got.stderr).toBe(want.stderr);
    expect(got.stdout).toBe(want.stdout);
    expect(got.code).toBe(want.code);
  });
}

for (const [file, args, what, reason] of EXPECTED_UNPORTED) {
  const full = [...args, file];
  test.skipIf(SKIP)(`rustc ${full.join(" ")} (expected unported: ${reason})`, () => {
    requireRustc();
    const want = oracle(full);
    const got = ours(full);
    const line = `rust-ts: unported: ${what}\n`;
    expect(got.code).toBe(70);
    expect(got.stderr.endsWith(line)).toBe(true);
    // Everything printed before the unported point is what rustc prints first.
    expect(want.stderr.startsWith(got.stderr.slice(0, -line.length))).toBe(true);
    expect(want.stdout.startsWith(got.stdout)).toBe(true);
  });
}
