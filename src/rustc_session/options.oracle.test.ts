// Oracle checks of the `-C`/`-Z` option tables (options.gen.ts) and parsers (options.ts) against the
// pinned nightly rustc:
//   1. `rustc -Z help` / `rustc -C help` list every option with its description; our tables printed
//      with the driver's format reproduce both listings byte for byte.
//   2. A sample of `-C`/`-Z` flags and values: rustc and `build_options` accept or reject the same
//      values, with the same error (and help) text.
//   3. The build-time `option_env!` defaults (config.ts): `Polonius::DEFAULT` (via the `-Z help` text)
//      and `NextSolverConfig::default()` (behavior).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PIN, UPSTREAM } from "../../scripts/lib/common.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { Unported } from "../std/panic.ts";
import { CG_OPTIONS, CodegenOptions, CollectedOptions, desc, type OptionDesc, OptionDesc as OptionDescC, UnstableOptions, Z_OPTIONS } from "./options.ts";
import type { EarlyDiagCtxt, Matches } from "./stand_ins.ts";
import { NextSolverConfig, Polonius } from "./config.ts";
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

const WORK = test_scratch_dir("session-options-oracle");

/** `rustc_driver_impl::print_flag_list` (compiler/rustc_driver_impl/src/lib.rs:1163):
 *  `"    {} {:>width$}=val -- {}"` with `width` = the longest option name in chars. */
function print_flag_list<T>(cmdline_opt: string, flag_list: readonly OptionDesc<T>[]): string {
  const max_len = Math.max(0, ...flag_list.map((o) => [...OptionDescC.name(o)].length));
  let out = "";
  for (const opt_desc of flag_list) {
    const name = OptionDescC.name(opt_desc).replaceAll("_", "-");
    out += `    ${cmdline_opt} ${" ".repeat(Math.max(0, max_len - [...name].length))}${name}=val -- ${OptionDescC.desc(opt_desc)}\n`;
  }
  return out;
}

test.skipIf(SKIP)("`-Z help` and `-C help` listings match rustc", () => {
  requireRustc();
  const z = Bun.spawnSync([...RUSTC, "-Z", "help"]);
  // describe_unstable_flags (rustc_driver_impl/src/lib.rs:1153)
  expect("\nAvailable unstable options:\n\n" + print_flag_list("-Z", Z_OPTIONS)).toBe(z.stdout.toString());
  const c = Bun.spawnSync([...RUSTC, "-C", "help"]);
  // describe_codegen_flags (rustc_driver_impl/src/lib.rs:1158)
  expect("\nAvailable codegen options:\n\n" + print_flag_list("-C", CG_OPTIONS)).toBe(c.stdout.toString());
});

class Fatal extends Error {}

/** `build_options` for one `-<prefix> <arg>`; the early error text (`error: ..` + `= help: ..` lines) or "ok". */
function ours(prefix: "C" | "Z", arg: string): string {
  const helps: string[] = [];
  const dcx: EarlyDiagCtxt = {
    early_warn(msg: string): void {
      helps.push(`warning: ${msg}`);
    },
    early_fatal(msg: string): never {
      throw new Fatal(`error: ${msg}`);
    },
    early_struct_fatal(msg: string): Diag {
      const d = {
        help(h: string) {
          helps.push(`= help: ${h}`);
          return d;
        },
        emit(): never {
          throw new Fatal([`error: ${msg}`, ...helps].join("\n"));
        },
      };
      return d as unknown as Diag;
    },
  };
  const matches: Matches = { opt_strs_pos: (nm: string) => (nm === prefix ? [[1, arg]] : []) };
  try {
    if (prefix === "C") CodegenOptions.build(dcx, matches, CollectedOptions.default());
    else UnstableOptions.build(dcx, matches, CollectedOptions.default());
    return "ok";
  } catch (e) {
    if (e instanceof Fatal) return e.message;
    throw e;
  }
}

/** rustc's early option error for `-<prefix> <arg>` on an empty crate, or "ok". */
function theirs(prefix: "C" | "Z", arg: string): string {
  mkdirSync(WORK, { recursive: true });
  const r = Bun.spawnSync([...RUSTC, "--crate-type", "lib", "--emit", "metadata", "-o", join(WORK, "out.rmeta"), `-${prefix}`, arg, "-"], {
    stdin: new TextEncoder().encode(""),
    cwd: WORK,
  });
  const lines = r.stderr.toString().replaceAll("\r\n", "\n").split("\n");
  const first = lines.findIndex((l) => l.startsWith("error: "));
  if (first < 0) return "ok";
  const msg = lines[first]!;
  // Only the errors `build_options` emits (later CLI checks in config.rs are out of scope here).
  const fromBuildOptions = [
    /^error: incorrect value `.*` for (codegen|unstable) option `[^`]*` - .* was expected$/,
    /^error: (codegen|unstable) option `[^`]*` requires .* \(`-[CZ] [^`]*=<value>`\)$/,
    /^error: unknown (codegen|unstable) option: `/,
    /^error: `-[CZ] [^`]*`: /,
  ];
  if (!fromBuildOptions.some((re) => re.test(msg))) return "ok";
  const out = [msg];
  for (const l of lines.slice(first + 1)) {
    const m = /^\s+= (help: .*)$/.exec(l);
    if (m) out.push(`= ${m[1]}`);
    else if (l.trim() !== "|" && l.trim() !== "") break;
  }
  return out.join("\n");
}

// Flags whose parsers are fully ported (stand-in parsers that call `unported` are listed in the handoff).
const CASES: ["C" | "Z", string][] = [
  // -C
  ["C", "opt-level=3"],
  ["C", "opt-level"],
  ["C", "debuginfo=2"],
  ["C", "debuginfo=limited"],
  ["C", "debuginfo=3"],
  ["C", "lto"],
  ["C", "lto=thin"],
  ["C", "lto=maybe"],
  ["C", "linker-plugin-lto=off"],
  ["C", "strip=symbols"],
  ["C", "strip=all"],
  ["C", "control-flow-guard=nochecks"],
  ["C", "control-flow-guard=sometimes"],
  ["C", "instrument-coverage=all"],
  ["C", "instrument-coverage=2"],
  ["C", "symbol-mangling-version=v1"],
  ["C", "link-self-contained=n"],
  ["C", "linker-features=+lld"],
  ["C", "linker-features=lld"],
  ["C", "passes=a b  c"],
  ["C", "remark=all"],
  ["C", "codegen-units=16"],
  ["C", "codegen-units=-1"],
  ["C", "codegen-units=+4"],
  ["C", "codegen-units="],
  ["C", "dwarf-version=99999999999"],
  ["C", "embed-bitcode=maybe"],
  ["C", "no-redzone=yes"],
  ["C", "no-vectorize-loops=yes"],
  ["C", "panic=immediate-abort"],
  ["C", "panic=never"],
  ["C", "ar"],
  ["C", "soft-float=yes"],
  ["C", "target-feature=+sse2"],
  ["C", "unsafe-allow-abi-mismatch=b,a"],
  ["C", "opt_level=2"],
  ["C", "opt-levl=2"],
  ["C", "prefer-dynamc"],
  ["C", "bogus-option-name=1"],
  // -Z
  ["Z", "ui-testing"],
  ["Z", "ui-testing=yes"],
  ["Z", "ui-testing=maybe"],
  ["Z", "ui-testin"],
  ["Z", "parse-crate-root-only"],
  ["Z", "unpretty=ast-tree"],
  ["Z", "unpretty=a=b=c"],
  ["Z", "unpretty"],
  ["Z", "threads=8"],
  ["Z", "threads"],
  ["Z", "treat-err-as-bug"],
  ["Z", "treat-err-as-bug=0"],
  ["Z", "treat-err-as-bug=2"],
  ["Z", "treat-err-as-bug=x"],
  ["Z", "location-detail=file,line"],
  ["Z", "location-detail=none"],
  ["Z", "location-detail=path"],
  ["Z", "fmt-debug=shallow"],
  ["Z", "fmt-debug=deep"],
  ["Z", "polonius=next"],
  ["Z", "polonius=yes"],
  ["Z", "next-solver=coherence"],
  ["Z", "next-solver=always"],
  ["Z", "mir-include-spans=nll"],
  ["Z", "mir-include-spans=some"],
  ["Z", "terminal-urls=auto"],
  ["Z", "terminal-urls="],
  ["Z", "terminal-urls=always"],
  ["Z", "coverage-options=branch,discard-all-spans-in-codegen"],
  ["Z", "coverage-options=mcdc"],
  ["Z", "instrument-xray=always,ignore-loops,instruction-threshold=10"],
  ["Z", "instrument-xray=always,never"],
  ["Z", "instrument-xray=instruction-threshold"],
  ["Z", "autodiff=Enable,PrintTAFn=foo"],
  ["Z", "autodiff=PrintTAFn"],
  ["Z", "offload=Device,Host=/tmp/x"],
  ["Z", "offload=Test=1"],
  ["Z", "patchable-function-entry=4,2"],
  ["Z", "patchable-function-entry=2,4"],
  ["Z", "patchable-function-entry=256"],
  ["Z", "patchable-function-entry=1,1,"],
  ["Z", "llvm-module-flag=foo:u32:1:Max"],
  ["Z", "llvm-module-flag=foo:u64:1:max"],
  ["Z", "llvm-module-flag=foo:u32:1:maxi"],
  ["Z", "branch-protection=bti,pac-ret,leaf,b-key"],
  ["Z", "branch-protection=leaf"],
  ["Z", "branch-protection=pac-ret,pac-ret"],
  ["Z", "pointer-authentication=+calls,-elf-got,+calls"],
  ["Z", "pointer-authentication=calls"],
  ["Z", "annotate-moves=1234"],
  ["Z", "annotate-moves=off"],
  ["Z", "annotate-moves=-1"],
  ["Z", "cross-crate-inline-threshold=always"],
  ["Z", "cross-crate-inline-threshold=often"],
  ["Z", "dump-mono-stats-format=json"],
  ["Z", "dump-mono-stats-format=csv"],
  ["Z", "time-passes-format=xml"],
  ["Z", "split-dwarf-kind=single"],
  ["Z", "split-dwarf-kind=double"],
  ["Z", "wasm-c-abi=spec"],
  ["Z", "wasm-c-abi=legacy"],
  ["Z", "assert-incr-state=loaded"],
  ["Z", "assert-incr-state=maybe"],
  ["Z", "hint-msrv=1.70.0"],
  ["Z", "hint-msrv=1.70"],
  ["Z", "hint-msrv=1.70.0-nightly"],
  ["Z", "src-hash-algorithm=sha256"],
  ["Z", "src-hash-algorithm=blake3"],
  ["Z", "checksum-hash-algorithm=blake3"],
  ["Z", "allow-partial-mitigations=stack-protector,control-flow-guard"],
  ["Z", "deny-partial-mitigations=aslr"],
  ["Z", "allow-partial-mitigations"],
  ["Z", "sanitizer=address,leak"],
  ["Z", "sanitizer=undefined"],
  ["Z", "sanitizer-memory-track-origins=3"],
  ["Z", "self-profile-events=b,a"],
  ["Z", "codegen-emit-retag=no-precise-im"],
  ["Z", "codegen-emit-retag=precise"],
  ["Z", "instrument-mcount=fentry-record"],
  ["Z", "instrument-mcount=mcount"],
  ["Z", "cf-protection=full"],
  ["Z", "cf-protection=both"],
  ["Z", "debuginfo-compression=gzip"],
  ["Z", "mir-strip-debuginfo=all-locals"],
  ["Z", "proc-macro-execution-strategy=cross-thread"],
  ["Z", "proc-macro-execution-strategy=other-thread"],
  ["Z", "function-return=thunk-extern"],
  ["Z", "function-return=thunk"],
  ["Z", "uninit-const-chunk-threshold=18446744073709551615"],
  ["Z", "uninit-const-chunk-threshold=18446744073709551616"],
  ["Z", "layout-seed=18446744073709551616"],
  ["Z", "mir-enable-passes=+Inline,-GVN"],
  ["Z", "mir-enable-passes=Inline"],
  ["Z", "wasi-exec-model=reactor"],
  ["Z", "wasi-exec-model=library"],
  ["Z", "no-analysis=yes"],
  ["Z", "unstable-options"],
  ["Z", "panic-in-drop=abort"],
  ["Z", "panic-in-drop=crash"],
  ["Z", "on-broken-pipe=default"],
  ["Z", "box-noalias=no"],
  ["Z", "unpretty-ast"],
  ["Z", "ui_testing"],
];

test.skipIf(SKIP)("option values: accepted / rejected like rustc", () => {
  requireRustc();
  const mismatches: string[] = [];
  for (const [prefix, arg] of CASES) {
    let o: string;
    try {
      o = ours(prefix, arg);
    } catch (e) {
      if (e instanceof Unported) o = `UNPORTED ${e.what}`;
      else throw e;
    }
    const t = theirs(prefix, arg);
    if (o !== t) mismatches.push(`-${prefix} ${arg}\n  ours:   ${o}\n  rustc:  ${t}`);
  }
  expect(mismatches.join("\n")).toBe("");
}, 120_000); // runs rustc once per case; 5 s default is too tight under load

test.skipIf(SKIP)("desc.parse_linker_flavor (computed from linker_flavor_cli_impls!) matches rustc", () => {
  requireRustc();
  // `LinkerFlavorCli::from_str` is a stand-in (rustc_target), so check the description directly.
  expect(theirs("C", "linker-flavor=bogus")).toBe(`error: incorrect value \`bogus\` for codegen option \`linker-flavor\` - ${desc.parse_linker_flavor} was expected`);
});

test.skipIf(SKIP)("build-time defaults: Polonius::DEFAULT and NextSolverConfig::default()", () => {
  requireRustc();
  // `POLONIUS_HELP` prints the default; the listing test compares it, this names the dependency.
  const z = Bun.spawnSync([...RUSTC, "-Z", "help"]).stdout.toString();
  expect(z.includes(`polonius=val -- enable polonius-based borrow-checker (default: ${Polonius.DEFAULT === "Next" ? "next" : "no"})`)).toBe(true);

  // A program the two solvers type-check differently: the default must behave like ours.
  const file = join(UPSTREAM, "tests/ui/type-alias-impl-trait/type_of_a_let.rs");
  if (!existsSync(file)) throw new Error(`ERROR: upstream test file missing: ${file}`);
  mkdirSync(WORK, { recursive: true });
  const run = (extra: string[]) =>
    Bun.spawnSync([...RUSTC, "--edition", "2021", "--crate-type", "lib", "--emit", "metadata", "-o", join(WORK, "solver.rmeta"), ...extra, file], { cwd: WORK }).stderr.toString();
  const dflt = run([]);
  const globally = run(["-Znext-solver=globally"]);
  const coherence = run(["-Znext-solver=coherence"]);
  expect(globally === coherence).toBe(false);
  const expected = NextSolverConfig.default() === "Globally" ? globally : coherence;
  expect(dflt).toBe(expected);
});
