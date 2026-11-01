// UI-test command lines as compiletest builds them (src/tools/compiletest at the pin), for the
// `parse-ui` suites. Each `.rs` test (and each of its revisions) becomes one case whose argv is the
// one compiletest passes to rustc for a UI test (`TestCx::make_compile_args` for `run_ui_test`'s
// main compile), plus `-Zparse-crate-root-only` so both sides stop after parsing.
//
// Paths and names below refer to src/tools/compiletest/src at the pin:
// - test collection: lib.rs `collect_tests_from_dir`/`is_test` (skip `auxiliary` dirs, dot/#/~ files);
// - directive lines: directives/line.rs `line_directive`, directives/file.rs (lines trimmed);
// - revisions: directives.rs `parse_and_update_revisions` (EarlyProps: every line, any revision);
// - ignores: directives.rs `make_test_description` (cfg.rs `prepare_conditions`, needs.rs, backends);
// - props: directives.rs `TestProps::from_file`/`load_from` and directives/handlers.rs;
// - argv: runtest.rs `make_compile_args`, `set_revision_flags`, `compile_test_general`,
//   runtest/ui.rs `run_ui_test`; env: `compose_and_run_compiler` (`rustc_env`, `unset_rustc_env`).
//
// Not reproduced (the case is skipped with a recorded reason instead, never guessed):
// auxiliary crates (`aux-*`, `proc-macro`) unless the caller asks for `aux` (below), `add-minicore`,
// `incremental`, conditions that depend on
// compiletest configuration this harness does not have (stage, debug assertions, LLVM version, most
// `needs-*`), and anything compiletest itself would reject (it panics, so the test never runs).
//
// Bootstrap's `--target-rustcflags` for the ui suite (src/bootstrap/src/core/build_steps/test.rs at
// the pin: `-Crpath`, `-Cdebuginfo=<debuginfo-level-tests, default 0>`, `-Lnative=<test helpers>`)
// are included except `-Lnative=`: there is no built `rust_test_helpers` (a link-time search path).
// Bootstrap's default `rust.optimize-tests = true` (config.rs) passes `--optimize-tests`, so run-pass
// tests get `-O`.
//
// Host independence: compiletest evaluates `ignore-*`/`only-*`, `--target=` and the exe suffix
// against the machine it runs on. To make the case set (and argv shape) the same on every machine,
// this module runs compiletest as it runs on rust-lang CI's primary `x86_64-unknown-linux-gnu`
// host (host = target = COMPILETEST_TARGET, so not a cross-compile), per decision D1 for M2 suites
// (`docs/plan-m2.md`). The oracle and the subject still run on this machine: the parse-ui suites stop
// after parsing and need no target std; the M3 suites (tydump-ui, thirdump-ui, and the minicore corpus)
// type-check against the oracle sysroot's installed rust-std for COMPILETEST_TARGET (plan-m2 D1(1)).
// Only absolute paths in argv (sysroot, cargo home, upstream checkout, aux directory) vary.
//
// Paths: the input file is passed relative to the upstream checkout (the cwd of both sides), so
// diagnostics show `tests/ui/...` where compiletest would show an absolute path and then
// normalize it to `$DIR`. The output directory mirrors compiletest's layout relative to the cwd
// (`build/<target>/test/ui/<dir>/<stem>[.<rev>]`). Stopping after parsing (parse-ui) or in the M3 probes'
// prefix (before `write_dep_info`) writes nothing there, but a test that asks for more in its own
// compile-flags creates it: e.g. the thir-print cases' `-Zunpretty=thir-*` run rustc's own path, which
// writes dep-info. Test collection and the dependency scan (scripts/lib/deps.ts) never look under `build/`.
//
// Auxiliary crates (`uiCases(.., { aux: true })`, lane harness-w20, for the M3 suites; plan-m2 D5: aux
// crates are built by the oracle until rust-ts has a metadata encoder). `aux-build`, `aux-crate` and
// `aux-bin` are built as compiletest builds them (runtest.rs `compose_and_run_compiler`,
// `build_all_auxiliary`, `build_auxiliary`: the aux file's own directives for the same revision, its
// `make_compile_args` with `Emit::None`/`AllowUnused::No`/`LinkToAux::No`, `--crate-type`
// dylib/lib/bin, `-L <aux dir>`, nested aux crates into the same directory, paths resolved against the
// root test's `auxiliary/` directory), by the oracle rustc, with two differences:
// - `--emit=metadata` is appended to every aux build (the M2 D5 shape tydump-minicore uses): the
//   compilations under test stop after type checking and only read crate metadata, and there is no
//   linker for COMPILETEST_TARGET on most hosts (a dylib would need one);
// - so the main compile's `--extern <name>=<aux dir>/lib<name>.{so,rlib}` names `lib<name>.rmeta`.
// The aux directory is `$RUST_TS_DATA/aux/ui/<key>` (a directory unused for harness/library.ts `AUX_STALE_MS` is
// removed by the next new build, lane harness-w36) instead of `<output base>/auxiliary`, keyed by the
// oracle build, the case id and every aux command, environment, source file and file the source may pull
// in (`mod`, `#[path]`, `include!`: scripts/lib/deps.ts `caseDeps`), so the case argv (and so the oracle
// cache key) changes whenever any of them does. Aux builds run with a fixed environment (`auxEnv`: only
// what rustup needs is inherited, `PATH` is pinned) and the suite's oracle timeout, retried once as
// difftest's oracle processes. A failing aux build (compiletest: a fatal test failure) is never a skip:
// it prints an `ERROR:` line and stops the run (`buildAux`), whether the oracle reported an error, was
// killed or timed out twice. `proc-macro` aux crates (and aux crates that are proc-macro crates) are
// skipped before any build (plan-m2 D6) unless the caller asks for `procMacro` (below); `aux-codegen-backend`
// and `add-minicore` are not reproduced.
//
// Proc-macro aux crates (`uiFileCases(.., { aux: true, procMacro: true })`, lane harness-m6b, plan-m6 §4 item 3, D7):
// the `pm-ui`/`pm-expanded` case sets are the tests (and revisions) whose aux tree holds a proc-macro crate
// (`auxTreeHasProcMacro`); every other test is left out of those case sets without a skip entry. A `proc-macro:` crate
// is built as runtest.rs `build_auxiliary` builds it with `AuxType::ProcMacro` (`force_host`, `--crate-type
// proc-macro`, `--extern proc_macro`, `-L <aux dir>`; `--extern <crate>=<aux dir>/<DLL_PREFIX><crate>.<DLL_EXTENSION>`
// for the main compile, compiletest's `get_lib_name` with the consts of the machine it runs on), by the oracle rustc, as
// a real host dylib (no `--emit=metadata`): the compiler loads and runs it. Differences from compiletest, all forced by
// running compiletest "as on x86_64-unknown-linux-gnu" (host = target = COMPILETEST_TARGET, above) on another machine:
// - `force_host`'s `--target=<config.host>` is the oracle's real host tuple (`oracleHost()`), not COMPILETEST_TARGET:
//   the dylib must be loadable by this machine's rustc (and by the port, plan-m6 D7). bootstrap's `--host-rustcflags`
//   equal its `--target-rustcflags` here (`-Crpath -Cdebuginfo=<0>`, `-Lnative=` dropped as above), so only the
//   target differs;
// - an aux crate that is a proc-macro crate by its own `#![crate_type = "proc-macro"]` / `--crate-type proc-macro`
//   (compiletest: built for `config.target` unless it says `//@ force-host`; on CI that is the host) and every aux crate
//   in a proc-macro crate's own aux tree (its dependencies, which it links) are built for the real host too, also
//   without `--emit=metadata`, and so is an aux crate with its own `//@ force-host` (compiletest: `--target=<host>`;
//   a proc macro may `extern crate` a sibling force-host aux crate of the test); other aux crates of the test stay
//   COMPILETEST_TARGET rmetas as before. A host-built
//   `aux-crate` is named in `--extern` by compiletest's `get_lib_name` (rlib / dylib name), not the rmeta;
// - host builds link, so their `PATH` (`auxEnv`) is the pinned one plus the directory of the system C compiler driver
//   (`cc`, rustc's default linker on unix hosts); part of the aux key like the rest of the environment.
// A host build in the temp directory and its rename keep `-Crpath`'s `@loader_path`/`$ORIGIN`-relative paths valid
// (same parent directory). Existing callers (no `procMacro`) plan, key and build exactly as before.
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { DATA, PIN, UPSTREAM, hash } from "../scripts/lib/common.ts";
import { caseDeps } from "../scripts/lib/deps.ts";
import { getEnv } from "../scripts/lib/env.ts";
import { pruneStaleUiAux, touchAuxDir } from "./library.ts";
import { ORACLE_RETRY_FACTOR, oracleHost, oraclePinnedPathEnv, oracleRustcCmd, oracleSysroot, rustcDriverHash, verifyOracleToolchain } from "../scripts/lib/oracle.ts";

/** The host and target compiletest is run as (see "Host independence" above). */
export const COMPILETEST_TARGET = "x86_64-unknown-linux-gnu";

export interface UiCase {
  id: string;
  file: string;
  args: string[];
  env: Record<string, string | null>;
  /** `uiFileCases(.., { run: true })` only: the test's pass/fail mode (`run-pass`, `check-fail`, ...). */
  mode?: string;
  /** `uiFileCases(.., { run: true })` only: how compiletest runs the built program (`RunProps`). */
  run?: RunProps;
}

/**
 * How compiletest runs a run-mode test's program (runtest.rs `exec_compiled_test_general`): `run-flags` are its
 * arguments (`make_run_args`), `exec-env` its added environment and `unset-exec-env` the variables it removes
 * (directives/handlers.rs).
 */
export interface RunProps {
  flags: string[];
  env: [string, string][];
  unsetEnv: string[];
}

export interface Skip {
  id: string;
  reason: string;
}

/** `--error-format`: `json` is compiletest's default for UI tests; `human` drops `--error-format json --json future-incompat`. */
export type ErrorFormat = "json" | "human";

/** compiletest would panic on this test (so it never runs); the message says why. */
class Reject extends Error {}

// ---- directive lines (directives/line.rs) ----

interface DirectiveLine {
  revision: string | undefined;
  raw: string;
  name: string;
}

function lineDirective(original: string): DirectiveLine | undefined {
  const t = original.trimStart();
  if (!t.startsWith("//@")) return undefined;
  const after = t.slice(3).trimStart();
  let revision: string | undefined;
  let raw: string;
  if (after.startsWith("[")) {
    const close = after.indexOf("]");
    if (close < 0) throw new Reject(`malformed condition directive: ${original}`);
    revision = after.slice(1, close);
    raw = after.slice(close + 1).trimStart();
    if (revision.includes(",")) throw new Reject(`multiple revisions in one directive: ${original}`);
  } else raw = after;
  const name = raw.split(/[: ]/)[0]!;
  return { revision, raw, name };
}

const restAfter = (ln: DirectiveLine, sep: string): string | undefined => (ln.raw[ln.name.length] === sep ? ln.raw.slice(ln.name.length + 1) : undefined);
const valueAfterColon = (ln: DirectiveLine) => restAfter(ln, ":");
const remarkAfterSpace = (ln: DirectiveLine) => restAfter(ln, " ");
const appliesTo = (ln: DirectiveLine, rev: string | undefined) => ln.revision === undefined || ln.revision === rev;

/** Rust `str::lines` + `trim` (directives/file.rs), dropping the `#![no_std]`/`#![no_core]` lines it skips. */
function fileDirectives(src: string): DirectiveLine[] {
  const out: DirectiveLine[] = [];
  for (let ln of src.split("\n")) {
    if (ln.endsWith("\r")) ln = ln.slice(0, -1);
    ln = ln.trim();
    if (ln.startsWith("#![no_std]") || ln.startsWith("#![no_core]")) continue;
    const d = lineDirective(ln);
    if (d) out.push(d);
  }
  return out;
}

// ---- Config::parse_name_directive / parse_name_value_directive ----

function nameDirective(ln: DirectiveLine, directive: string): boolean {
  if (ln.name !== directive) return false;
  if (valueAfterColon(ln) !== undefined) throw new Reject(`directive \`${directive}\` must not be followed by a colon`);
  return true;
}

function nameValueDirective(ln: DirectiveLine, directive: string): string | undefined {
  if (ln.name !== directive) return undefined;
  const v = valueAfterColon(ln);
  if (v === undefined) throw new Reject(`directive \`${directive}\` must be followed by a colon and value`);
  const value = expandVariables(v);
  if (value === "") throw new Reject(`empty value for directive \`${directive}\``);
  return value;
}

/** directives.rs `expand_variables`; `{{build-base}}` has no equivalent here. */
function expandVariables(value: string): string {
  const h = host();
  if (value.includes("{{cwd}}")) value = value.replaceAll("{{cwd}}", UPSTREAM);
  if (value.includes("{{src-base}}")) value = value.replaceAll("{{src-base}}", join(UPSTREAM, "tests", "ui"));
  if (value.includes("{{build-base}}")) throw new Reject("`{{build-base}}` (compiletest's build directory) is not reproduced");
  if (value.includes("{{sysroot-base}}")) value = value.replaceAll("{{sysroot-base}}", h.sysroot);
  if (value.includes("{{target-linker}}")) value = value.replaceAll("{{target-linker}}", "");
  if (value.includes("{{target}}")) value = value.replaceAll("{{target}}", h.target);
  if (value.includes("{{rust-src-base}}")) {
    // `try_exists().expect(..)` only panics on an IO error; `read_link_utf8().unwrap_or(src_base)`.
    let src = join(h.sysroot, "lib", "rustlib", "src", "rust");
    try {
      src = readlinkSync(src);
    } catch {}
    value = value.replaceAll("{{rust-src-base}}", src);
  }
  return value;
}

/** directives.rs `split_flags`: single quotes keep spaces. */
function splitFlags(flags: string): string[] {
  return flags.split("'").flatMap((f, i) => (i % 2 === 1 ? [f] : f.split(/\s+/).filter(Boolean)));
}

// ---- editions (edition.rs, directives.rs `parse_edition_range`) ----

/** Ordered: years compare by number, `future` is above every year. */
type Edition = number;
const FUTURE = Number.MAX_SAFE_INTEGER;
const parseEdition = (s: string): Edition => {
  s = s.trim();
  if (s === "future") return FUTURE;
  if (!/^\d+$/.test(s)) throw new Reject(`\`${s}\` doesn't look like an edition`);
  return Number(s);
};
const showEdition = (e: Edition) => (e === FUTURE ? "future" : String(e));

/** `EditionRange::edition_to_test(config.edition = None)`: the requested edition is 2015. */
function editionToTest(raw: string): Edition {
  const requested = 2015;
  const dots = raw.indexOf("..");
  if (dots < 0) {
    if (raw.trim() === "") throw new Reject("empty value for `//@ edition`");
    return parseEdition(raw);
  }
  const lo = raw.slice(0, dots).trim();
  const hi = raw.slice(dots + 2).trim();
  if (lo === "") throw new Reject("`..edition` / `..` is not a supported range in `//@ edition`");
  const lower = parseEdition(lo);
  if (hi === "") return requested >= lower ? requested : lower;
  const upper = parseEdition(hi);
  if (upper <= lower) throw new Reject("the left side of `//@ edition` cannot be greater than or equal to the right side");
  return requested >= lower && requested < upper ? requested : lower;
}

// ---- host configuration (common.rs `TargetCfgs`, cfg.rs `prepare_conditions`) ----

interface TargetCfg {
  arch: string;
  os: string;
  env: string;
  abi: string;
  families: string[];
  pointerWidth: number;
  endian: string;
  binaryFormat: string;
  dynamicLinking: boolean;
  rustcAbi: string | undefined;
  /** `supported-sanitizers` (needs.rs; only read by `needsDecision`). */
  sanitizers: string[];
  /** `supports-xray`. */
  xray: boolean;
  /** `relocation-model` (default `pic`, common.rs `default_reloc_model`). */
  relocationModel: string;
  /** `panic-strategy` (default `unwind`); `get_current_target_config` overrides it from `--print=cfg`. */
  panic: string;
}

interface Host {
  target: string;
  sysroot: string;
  cargoHome: string;
}

let hostMemo: Host | undefined;
function host(): Host {
  if (hostMemo) return hostMemo;
  // `home::cargo_home()`: $CARGO_HOME (relative to the cwd if relative), else ~/.cargo.
  const ch = process.env.CARGO_HOME;
  const cargoHome = ch ? (isAbsolute(ch) ? ch : resolve(UPSTREAM, ch)) : join(homedir(), ".cargo");
  return (hostMemo = { target: COMPILETEST_TARGET, sysroot: oracleSysroot(), cargoHome });
}

function rustcPrint(args: string[]): string {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...args]);
  if (r.exitCode !== 0) throw new Error(`rustc ${args.join(" ")} failed: ${r.stderr.toString().slice(0, 500)}`);
  return r.stdout.toString();
}

function targetCfg(spec: Record<string, unknown>): TargetCfg {
  return {
    arch: String(spec.arch),
    os: typeof spec.os === "string" ? spec.os : "none",
    env: typeof spec.env === "string" ? spec.env : "",
    abi: typeof spec.abi === "string" ? spec.abi : "",
    families: Array.isArray(spec["target-family"]) ? (spec["target-family"] as string[]) : [],
    pointerWidth: Number(spec["target-pointer-width"]),
    endian: typeof spec["target-endian"] === "string" ? spec["target-endian"] : "little",
    binaryFormat: typeof spec["binary-format"] === "string" ? spec["binary-format"] : "elf",
    dynamicLinking: spec["dynamic-linking"] === true,
    rustcAbi: typeof spec["rustc-abi"] === "string" ? spec["rustc-abi"] : undefined,
    sanitizers: Array.isArray(spec["supported-sanitizers"]) ? (spec["supported-sanitizers"] as string[]) : [],
    xray: spec["supports-xray"] === true,
    relocationModel: typeof spec["relocation-model"] === "string" ? spec["relocation-model"] : "pic",
    panic: typeof spec["panic-strategy"] === "string" ? spec["panic-strategy"] : "unwind",
  };
}

/** A condition's value, or `undefined` when it depends on compiletest configuration we do not have. */
interface Cond {
  value: boolean | undefined;
  message: string;
}

let condsMemo: Map<string, Cond> | undefined;
let currentMemo: TargetCfg | undefined;

function current(): TargetCfg {
  conditions();
  return currentMemo!;
}

/** cfg.rs `prepare_conditions` for the host target (the first registration of a name wins). */
function conditions(): Map<string, Cond> {
  if (condsMemo) return condsMemo;
  const { target } = host();
  const specs = JSON.parse(rustcPrint(["--print=all-target-specs-json", "-Zunstable-options"])) as Record<string, Record<string, unknown>>;
  const all = Object.entries(specs).map(([t, s]) => [t, targetCfg(s)] as const);
  if (!specs[target]) throw new Error(`host target ${target} missing from --print=all-target-specs-json`);
  const cur = targetCfg(specs[target]);
  // `get_current_target_config`: `--print=cfg` only overrides `panic` and `target_has_atomic`,
  // neither of which is a condition below.
  currentMemo = cur;
  const conds = new Map<string, Cond>();
  const cond = (name: string, value: boolean | undefined, message: string) => {
    if (!conds.has(name)) conds.set(name, { value, message });
  };
  const uniq = (xs: string[]) => [...new Set(xs)];
  cond("test", true, "always");
  cond("auxiliary", true, "used by another main test file");
  for (const [t] of all) cond(t, t === target, `when the target is ${t}`);
  for (const os of uniq(all.map(([, c]) => c.os))) cond(os, os === cur.os, `when the operating system is ${os}`);
  for (const env of uniq(all.map(([, c]) => c.env))) cond(env, env === cur.env, `when the target environment is ${env}`);
  for (const oe of uniq(all.map(([, c]) => `${c.os}-${c.env}`))) cond(oe, oe === `${cur.os}-${cur.env}`, `when the operating system and target environment are ${oe}`);
  for (const abi of uniq(all.map(([, c]) => c.abi))) cond(abi, abi === cur.abi, `when the ABI is ${abi}`);
  for (const arch of [...uniq(all.map(([, c]) => c.arch)), "spirv"]) cond(arch, arch === cur.arch, `when the architecture is ${arch}`);
  for (const w of uniq(all.map(([, c]) => `${c.pointerWidth}bit`))) cond(w, w === `${cur.pointerWidth}bit`, `when the pointer width is ${w}`);
  for (const f of uniq(all.flatMap(([, c]) => c.families))) cond(f, cur.families.includes(f), `when the target family is ${f}`);
  cond("thumb", target.startsWith("thumb"), "when the architecture is part of the Thumb family");
  cond("i586", cur.arch === "i586" || target.startsWith("i586-"), "when the subarchitecture is i586");
  cond("apple", target.includes("apple"), "when the target vendor is Apple");
  cond("elf", cur.binaryFormat === "elf", "when the target binary format is ELF");
  cond("enzyme", undefined, "when rustc is built with LLVM Enzyme");
  cond("offload", undefined, "when rustc is built with LLVM Offload");
  // The oracle is a nightly toolchain.
  for (const ch of ["stable", "beta", "nightly"]) cond(ch, ch === "nightly", `when the release channel is ${ch}`);
  cond("cross-compile", false, "when cross-compiling"); // host = target = COMPILETEST_TARGET
  cond("endian-big", cur.endian === "big", "on big-endian targets");
  for (const st of ["stage0", "stage1", "stage2"]) cond(st, undefined, `when the bootstrapping stage is ${st}`);
  cond("remote", false, "when running tests remotely");
  cond("rustc-debug-assertions", undefined, "when rustc is built with debug assertions");
  cond("std-debug-assertions", undefined, "when std is built with debug assertions");
  cond("std-remap-debuginfo", undefined, "when std is built with remapping of debuginfo");
  for (const m of ["polonius", "next-solver", "split-dwarf", "split-dwarf-single"]) cond(`compare-mode-${m}`, false, `when comparing with compare-mode-${m}`);
  cond("wasm-proc-macros", undefined, "when wasm-proc-macros is enabled in bootstrap.toml");
  for (const m of ["coverage-map", "coverage-run"]) cond(m, false, `when the test mode is ${m}`);
  for (const ra of uniq(all.flatMap(([, c]) => (c.rustcAbi ? [c.rustcAbi] : [])))) cond(`rustc_abi-${ra}`, ra === cur.rustcAbi, `when the target \`rustc_abi\` is rustc_abi-${ra}`);
  cond("dist", process.env.COMPILETEST_ENABLE_DIST_TESTS === "1", "when performing tests on dist toolchain");
  return (condsMemo = conds);
}

let builtinCfgMemo: Set<string> | undefined;
/** common.rs `builtin_cfg_names`. */
function builtinCfgNames(): Set<string> {
  if (builtinCfgMemo) return builtinCfgMemo;
  const names = new Set(["test"]);
  for (const l of rustcPrint(["--print=check-cfg", "-Zunstable-options", "--check-cfg=cfg()"]).split("\n")) {
    const m = /^cfg\(([^,]*),/.exec(l.trim());
    if (m) names.add(m[1]!.trim());
  }
  return (builtinCfgMemo = names);
}

/**
 * Ignore decision of one directive line (`make_test_description`'s `decision!` chain), or undefined to continue.
 * `needs`: evaluate every `needs-*` directive as needs.rs does (`needsDecision`); otherwise only `needs-subprocess`
 * is, and every other `needs-*` rejects the test (the case sets of the suites built before lane harness-w36).
 */
function ignoreDecision(ln: DirectiveLine, needs = false): string | undefined {
  const EXTERNAL_IGNORES = new Set(["ignore-backends", "ignore-cdb", "ignore-gdb", "ignore-gdb-version", "ignore-lldb", "ignore-llvm-version", "ignore-parallel-frontend"]);
  const EXTERNAL_ONLY = new Set(["only-cdb", "only-gdb", "only-lldb"]);
  for (const prefix of ["ignore-", "only-"] as const) {
    if (!ln.name.startsWith(prefix)) continue;
    if ((prefix === "ignore-" ? EXTERNAL_IGNORES : EXTERNAL_ONLY).has(ln.name)) continue;
    const c = conditions().get(ln.name.slice(prefix.length));
    if (!c) throw new Reject(`invalid line: ${ln.raw}`);
    if (c.value === undefined) throw new Reject(`\`${ln.name}\` depends on compiletest configuration this harness does not reproduce (${c.message})`);
    if (prefix === "ignore-" && c.value) return `ignored ${c.message}`;
    if (prefix === "only-" && !c.value) return `only executed ${c.message}`;
  }
  if (ln.name.startsWith("needs-") && ln.name !== "needs-llvm-components" && ln.name !== "needs-backends") {
    // `needs`: needs.rs `handle_needs` in full for COMPILETEST_TARGET (`needsDecision`; the M6 run and pm suites).
    if (needs) return needsDecision(ln);
    // needs.rs `handle_needs`: only `needs-subprocess` is evaluated (`Config::has_subprocess_support`).
    if (ln.name === "needs-subprocess") {
      const c = current();
      if (!(c.env === "sgx" || c.arch === "wasm32" || c.arch === "wasm64" || c.os === "emscripten")) return undefined;
      const remark = remarkAfterSpace(ln);
      return `ignored on targets without subprocess support${remark !== undefined ? ` (${remark.trim()})` : ""}`;
    }
    throw new Reject(`\`${ln.name}\` is not evaluated by this harness`);
  }
  if (["needs-llvm-components", "min-llvm-version", "max-llvm-major-version", "min-system-llvm-version", "ignore-llvm-version", "exact-llvm-major-version"].includes(ln.name)) {
    throw new Reject(`\`${ln.name}\` (LLVM version/components) is not evaluated by this harness`);
  }
  // `ignore_backends`/`needs_backends`: the default codegen backend is llvm.
  const ib = nameValueDirective(ln, "ignore-backends");
  if (ib !== undefined && ib.split(/\s+/).includes("llvm")) return "llvm backend is marked as ignore";
  const nb = nameValueDirective(ln, "needs-backends");
  if (nb !== undefined && !nb.split(/\s+/).includes("llvm")) return "llvm backend is not part of required backends";
  // ignore_cdb/gdb/lldb: a UI test has no debugger variant.
  if (ln.name === "only-cdb" || ln.name === "only-gdb" || ln.name === "only-lldb") return `debugger is not ${ln.name.slice(5)}`;
  // ignore_parallel_frontend: the parallel frontend is off.
  return undefined;
}

// ---- needs-* (needs.rs, lane harness-w36) ----
//
// `uiFileCases(.., { needs: true })` (the M6 run-mode and proc-macro suites) evaluates every `needs-*` directive as
// needs.rs `handle_needs` / `prepare_needs_conditions` does for COMPILETEST_TARGET (x86_64-unknown-linux-gnu, host =
// target as everywhere in this module), from the oracle's target spec (`--print=all-target-specs-json`) enriched by
// `--print=cfg --target <target>` (common.rs `get_current_target_config`: `panic`, `target_has_atomic`), its
// `--print=supported-crate-types` (`needs-crate-type`) and `--print=backend-has-mnemonic:ret` (`needs-asm-ret`).
// A need that depends on bootstrap/CI configuration this harness does not have (sanitizer runtimes built, profiler
// runtime, Enzyme/Offload, randomized layouts, rust-lld in the stage sysroot, git hash, debug assertions, a clang or
// wasmtime runner, LLVM zstd) is not evaluated: the test is skipped with that reason, as for `ignore-<stage>`.
// Configuration that is the default when bootstrap passes nothing is used: `--run` unset (`run_enabled`: auto, true
// off Fuchsia). compiletest runs on the (non-Windows) target host, so `has_symlinks()` is true and `find_dlltool`'s
// windows-gnu condition is false. An `IgnoreDecision::Error` (compiletest poisons the run) rejects the test.
// Callers without `needs` (every suite built before harness-w36, protected ones included) keep the old rule: only
// `needs-subprocess` is evaluated and any other `needs-*` rejects the test, so their case sets do not change.

/** common.rs `KNOWN_TARGET_HAS_ATOMIC_WIDTHS`, `KNOWN_CRATE_TYPES`. */
const KNOWN_TARGET_HAS_ATOMIC_WIDTHS = ["8", "16", "32", "64", "128", "ptr"];
const KNOWN_CRATE_TYPES = ["bin", "cdylib", "dylib", "lib", "proc-macro", "rlib", "staticlib"];
/** Rust's `{:?}` of a `Vec<String>` / `&[&str]`. */
const debugStrs = (xs: readonly string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;

interface NeedsCfg {
  /** `target_has_atomic` from `--print=cfg` (`get_current_target_config`). */
  targetHasAtomic: Set<string>;
  supportedCrateTypes: Set<string>;
  /** needs.rs `prepare_needs_conditions`: name -> condition (undefined: not reproduced, with why) and ignore reason. */
  simple: Map<string, { condition: boolean | undefined; why?: string; reason: string }>;
}
let needsMemo: NeedsCfg | undefined;
function needsCfg(): NeedsCfg {
  if (needsMemo) return needsMemo;
  const { target } = host();
  const cur = current();
  let panic = cur.panic;
  const targetHasAtomic = new Set<string>();
  for (const line of rustcPrint(["-Zunstable-options", "--print=cfg", "--target", target]).trim().split("\n")) {
    const eq = line.indexOf('="');
    const [name, value] = eq < 0 ? [line, undefined] : [line.slice(0, eq), line.slice(eq + 2, line.endsWith('"') ? -1 : undefined)];
    if (name === "panic") {
      if (value !== "abort" && value !== "unwind") throw new Error(`unexpected value for panic cfg: ${value}`);
      panic = value;
    } else if (name === "target_has_atomic" && value !== undefined) {
      if (!KNOWN_TARGET_HAS_ATOMIC_WIDTHS.includes(value)) throw new Error(`unexpected value for \`target_has_atomic\` cfg: ${value}`);
      targetHasAtomic.add(value);
    }
  }
  const supportedCrateTypes = new Set(rustcPrint(["--target", target, "--print=supported-crate-types", "-Zunstable-options"]).split("\n").filter(Boolean));
  for (const t of supportedCrateTypes) if (!KNOWN_CRATE_TYPES.includes(t)) throw new Error(`unexpected crate type \`${t}\``);
  // `has_mnemonic`: the default codegen backend is llvm.
  const mnemonic = rustcPrint([`--target=${target}`, "-Zunstable-options", "--print=backend-has-mnemonic:ret"]).trim();
  if (mnemonic !== "true" && mnemonic !== "false") throw new Error(`unexpected output from \`--print=backend-has-mnemonic:ret\`: ${mnemonic}`);
  const san = (s: string) => cur.sanitizers.includes(s);
  const CONFIG = "bootstrap/CI configuration this harness does not reproduce";
  const simple = new Map<string, { condition: boolean | undefined; why?: string; reason: string }>();
  const need = (name: string, condition: boolean | undefined, reason: string, why?: string) => simple.set(name, { condition, why, reason });
  need("needs-asm-ret", mnemonic === "true", "ignored on targets without a `ret` assembly instruction");
  need("needs-asm-support", ["x86", "x86_64", "arm", "aarch64", "arm64ec", "riscv32", "riscv64", "loongarch32", "loongarch64", "s390x"].includes(cur.arch), "ignored on targets without inline assembly support");
  need("needs-sanitizer-support", undefined, "ignored on targets without sanitizers support", `RUSTC_SANITIZER_SUPPORT: whether bootstrap built the sanitizer runtimes, ${CONFIG}`);
  need("needs-sanitizer-address", san("address"), "ignored on targets without address sanitizer");
  need("needs-sanitizer-cfi", san("cfi"), "ignored on targets without CFI sanitizer");
  need("needs-sanitizer-dataflow", san("dataflow"), "ignored on targets without dataflow sanitizer");
  need("needs-sanitizer-kcfi", san("kcfi"), "ignored on targets without kernel CFI sanitizer");
  need("needs-sanitizer-kasan", san("kernel-address"), "ignored on targets without kernel address sanitizer");
  need("needs-sanitizer-khwasan", san("kernel-hwaddress"), "ignored on targets without kernel hardware-assisted address sanitizer");
  need("needs-sanitizer-leak", san("leak"), "ignored on targets without leak sanitizer");
  need("needs-sanitizer-memory", san("memory"), "ignored on targets without memory sanitizer");
  need("needs-sanitizer-thread", san("thread"), "ignored on targets without thread sanitizer");
  need("needs-sanitizer-hwaddress", san("hwaddress"), "ignored on targets without hardware-assisted address sanitizer");
  need("needs-sanitizer-memtag", san("memtag"), "ignored on targets without memory tagging sanitizer");
  need("needs-sanitizer-realtime", san("realtime"), "ignored on targets without realtime sanitizer");
  need("needs-sanitizer-shadow-call-stack", san("shadow-call-stack"), "ignored on targets without shadow call stacks");
  need("needs-sanitizer-safestack", san("safestack"), "ignored on targets without SafeStack support");
  need("needs-enzyme", undefined, "ignored when LLVM Enzyme is disabled or LLVM is not the default codegen backend", `--has-enzyme (llvm.enzyme), ${CONFIG}`);
  need("needs-offload", undefined, "ignored when LLVM Offload is disabled or LLVM is not the default codegen backend", `--has-offload (llvm.offload), ${CONFIG}`);
  need("needs-run-enabled", !target.endsWith("-fuchsia"), "ignored when running the resulting test binaries is disabled");
  need("needs-threads", target.startsWith("wasm") ? target.includes("threads") : true, "ignored on targets without threading support");
  need("needs-subprocess", !(cur.env === "sgx" || cur.arch === "wasm32" || cur.arch === "wasm64" || cur.os === "emscripten"), "ignored on targets without subprocess support");
  need("needs-unwind", panic === "unwind", "ignored on targets without unwinding support");
  need("needs-profiler-runtime", undefined, "ignored when the profiler runtime is not available", `--profiler-runtime (build.profiler), ${CONFIG}`);
  need("needs-force-clang-based-tests", undefined, "ignored when RUSTBUILD_FORCE_CLANG_BASED_TESTS is not set", `RUSTBUILD_FORCE_CLANG_BASED_TESTS, ${CONFIG}`);
  need("needs-xray", cur.xray, "ignored on targets without xray tracing");
  need("needs-rust-lld", undefined, "ignored on targets without Rust's LLD", `rust-lld in the stage sysroot under test, ${CONFIG}`);
  need("needs-dlltool", false, "ignored when dlltool for the current architecture is not present");
  need("needs-git-hash", undefined, "ignored when git hashes have been omitted for building", `--git-hash (rust.omit-git-hash), ${CONFIG}`);
  need("needs-dynamic-linking", cur.dynamicLinking, "ignored on targets without dynamic linking");
  need("needs-relocation-model-pic", cur.relocationModel === "pic", "ignored on targets without PIC relocation model");
  need("needs-deterministic-layouts", undefined, "ignored when randomizing layouts", `--rust-randomized-layout (rust.randomize-layout), ${CONFIG}`);
  need("needs-wasmtime", undefined, "ignored when wasmtime runner is not available", `the target runner, ${CONFIG}`);
  need("needs-symlink", true, "ignored if symlinks are unavailable");
  need("needs-llvm-zstd", undefined, "ignored if LLVM wasn't build with zstd for ELF section compression or LLVM is not the default codegen backend", `LLVM built with zstd (llvm.libzstd), ${CONFIG}`);
  need("needs-rustc-debug-assertions", undefined, "ignored if rustc wasn't built with debug assertions", `rust.debug-assertions, ${CONFIG}`);
  need("needs-std-debug-assertions", undefined, "ignored if std wasn't built with debug assertions", `rust.debug-assertions-std, ${CONFIG}`);
  need("needs-std-remap-debuginfo", undefined, "ignored if std wasn't built with remapping of debuginfo", `rust.remap-debuginfo, ${CONFIG}`);
  need("needs-target-std", !(target.includes("-none") || target.includes("nvptx") || target.includes("switch")), "ignored if target does not support std");
  return (needsMemo = { targetHasAtomic, supportedCrateTypes, simple });
}

/** needs.rs `handle_needs` for a `needs-*` line (not `needs-llvm-components` / `needs-backends`): see above. */
function needsDecision(ln: DirectiveLine): string | undefined {
  const cfg = needsCfg();
  if (ln.name === "needs-target-has-atomic") {
    const rest = valueAfterColon(ln);
    if (rest === undefined) throw new Reject("expected `needs-target-has-atomic` to have a comma-separated list of atomic widths");
    const widths = rest.split(",").map((w) => w.trim());
    for (const w of widths) if (!KNOWN_TARGET_HAS_ATOMIC_WIDTHS.includes(w)) throw new Reject(`unknown width specified in \`needs-target-has-atomic\`: \`${w}\` is not a known \`target_has_atomic_width\`, known values are \`${debugStrs(KNOWN_TARGET_HAS_ATOMIC_WIDTHS)}\``);
    if (widths.every((w) => cfg.targetHasAtomic.has(w))) return undefined;
    return `skipping test as target does not support all of the required \`target_has_atomic\` widths \`${debugStrs(widths)}\``;
  }
  if (ln.name === "needs-crate-type") {
    const rest = valueAfterColon(ln);
    if (rest === undefined) throw new Reject("expected `needs-crate-type` to have a comma-separated list of crate types");
    const types = rest.split(",").map((t) => t.trim());
    for (const t of types) if (!KNOWN_CRATE_TYPES.includes(t)) throw new Reject(`unknown crate type specified in \`needs-crate-type\`: \`${t}\` is not a known crate type, known values are \`${debugStrs(KNOWN_CRATE_TYPES)}\``);
    if (types.every((t) => cfg.supportedCrateTypes.has(t))) return undefined;
    return `skipping test as target does not support all of the crate types \`${debugStrs(types)}\``;
  }
  const need = cfg.simple.get(ln.name);
  if (!need) throw new Reject(`invalid needs directive: ${ln.name}`);
  if (need.condition === undefined) throw new Reject(`\`${ln.name}\` depends on compiletest configuration this harness does not reproduce (${need.why})`);
  if (need.condition) return undefined;
  const remark = remarkAfterSpace(ln);
  return remark !== undefined ? `${need.reason} (${remark.trim()})` : need.reason;
}

// ---- TestProps (the subset that shapes the compile command) ----

const PASS_FAIL_MODES = ["check-fail", "check-pass", "build-fail", "build-pass", "run-fail", "run-crash", "run-fail-or-crash", "run-pass"];

interface Props {
  edition: Edition | undefined;
  compileFlags: string[];
  revisions: string[];
  rustcEnv: [string, string][];
  unsetRustcEnv: string[];
  passFailMode: string | undefined;
  noPreferDynamic: boolean;
  remapSrcBase: boolean;
  noAutoCheckCfg: boolean;
  forceHost: boolean;
  aux: AuxProps;
  /** `normalize-stderr` (+ `-64bit`/`-32bit` for the target's pointer width) rules, in order. */
  normalizeStderr: [string, string][];
  stderrPerBitwidth: boolean;
  dontCheckCompilerStderr: boolean;
  /** `run-flags`, `exec-env`, `unset-exec-env` (read only for `uiFileCases(.., { run })`). */
  run: RunProps;
}

/** directives/auxiliary.rs `AuxProps`. */
interface AuxProps {
  builds: string[];
  bins: string[];
  crates: { modifiers: string | undefined; name: string; path: string }[];
  procMacros: { modifiers: string | undefined; path: string }[];
  codegenBackend: string | undefined;
}

/** directives/auxiliary.rs `parse_aux_crate`. */
function parseAuxCrate(r: string): AuxProps["crates"][number] {
  const m = /^(?:(?<modifiers>[^=]*?):)?(?<name>[^=]*)=(?<path>.*)$/s.exec(r.trim());
  if (!m) throw new Reject(`couldn't parse aux-crate value \`${r.trim()}\` (should be e.g. \`log=log.rs\`)`);
  return { modifiers: m.groups!.modifiers, name: m.groups!.name!, path: m.groups!.path! };
}

/** directives/auxiliary.rs `parse_proc_macro`. */
function parseProcMacro(r: string): AuxProps["procMacros"][number] {
  const m = /^(?:(?<modifiers>[^=]*?):)?(?<path>.*)$/s.exec(r.trim())!;
  return { modifiers: m.groups!.modifiers, path: m.groups!.path! };
}

/** directives.rs `parse_normalize_rule`. */
function parseNormalizeRule(raw: string): [string, string] | undefined {
  const m = /^\s*"(?<regex>[^"]*)"\s+->\s+"(?<replacement>[^"]*)"$/.exec(raw);
  if (!m) return undefined;
  return [m.groups!.regex!, m.groups!.replacement!.replaceAll("\\n", "\n")];
}

/** `Config::parse_env`. */
function parseEnv(nv: string): [string, string] {
  const eq = nv.indexOf("=");
  return eq < 0 ? [nv.trim(), ""] : [nv.slice(0, eq).trim(), nv.slice(eq + 1)];
}

/**
 * `TestProps::from_file(testfile, revision)` for a UI test, or (`aux`) `TestProps::from_aux_file`
 * (no pass/fail default: aux crates have no pass/fail mode).
 */
function testProps(lines: DirectiveLine[], revision: string | undefined, opts: { auxFile?: boolean; extra?: boolean; run?: boolean } = {}): Props {
  const p: Props = {
    edition: undefined,
    compileFlags: [],
    revisions: [],
    rustcEnv: [
      ["RUSTC_ICE", "0"],
      ["RUST_BACKTRACE", "short"],
    ],
    unsetRustcEnv: ["RUSTC_LOG_COLOR"],
    passFailMode: undefined,
    noPreferDynamic: false,
    remapSrcBase: false,
    noAutoCheckCfg: false,
    forceHost: false,
    aux: { builds: [], bins: [], crates: [], procMacros: [], codegenBackend: undefined },
    normalizeStderr: [],
    stderrPerBitwidth: false,
    dontCheckCompilerStderr: false,
    run: { flags: [], env: [], unsetEnv: [] },
  };
  for (const ln of lines) {
    if (!appliesTo(ln, revision)) continue;
    const cf = nameValueDirective(ln, "compile-flags");
    if (cf !== undefined) {
      const flags = splitFlags(cf);
      for (let i = 0; i < flags.length; i++) {
        const f = flags[i]!;
        if (f === "--edition" || f.startsWith("--edition=")) throw new Reject("you must use `//@ edition` to configure the edition");
        if ((f === "-C" && flags[i + 1]?.startsWith("incremental=")) || f.startsWith("-Cincremental=")) throw new Reject("you must use `//@ incremental`");
      }
      p.compileFlags.push(...flags);
    }
    const ed = nameValueDirective(ln, "edition");
    if (ed !== undefined) p.edition = editionToTest(ed);
    const revs = nameValueDirective(ln, "revisions");
    if (revs !== undefined) p.revisions.push(...revs.split(/\s+/).filter(Boolean));
    const re = nameValueDirective(ln, "rustc-env");
    if (re !== undefined) p.rustcEnv.push(parseEnv(re));
    const ue = nameValueDirective(ln, "unset-rustc-env");
    if (ue !== undefined) p.unsetRustcEnv.push(ue.trim());
    if (PASS_FAIL_MODES.includes(ln.name)) {
      if (p.passFailMode !== undefined) throw new Reject("multiple `*-fail` or `*-pass` directives in a single test");
      p.passFailMode = ln.name;
    }
    p.noPreferDynamic ||= nameDirective(ln, "no-prefer-dynamic");
    p.remapSrcBase ||= nameDirective(ln, "remap-src-base");
    p.noAutoCheckCfg ||= nameDirective(ln, "no-auto-check-cfg");
    p.forceHost ||= nameDirective(ln, "force-host");
    // handlers.rs RUN_FLAGS / EXEC_ENV / UNSET_EXEC_ENV: only for the run-mode callers (`opts.run`), so no other
    // case set can change (a malformed value rejects the test).
    if (opts.run) {
      const rf = nameValueDirective(ln, "run-flags");
      if (rf !== undefined) p.run.flags.push(...splitFlags(rf));
      const ee = nameValueDirective(ln, "exec-env");
      if (ee !== undefined) p.run.env.push(parseEnv(ee));
      const ue = nameValueDirective(ln, "unset-exec-env");
      if (ue !== undefined) p.run.unsetEnv.push(ue.trim());
    }
    if (ln.name === "add-minicore") throw new Reject("`add-minicore` (builds minicore) is not reproduced");
    if (ln.name === "incremental") throw new Reject("`incremental` (incremental directory) is not reproduced");
    if (ln.name === "aux-codegen-backend") throw new Reject("`aux-codegen-backend` is not reproduced");
    // Directives only the aux-aware callers read (`opts.extra`), so the parse-ui/minicore case sets
    // (which skip every aux test before this) are unchanged.
    if (!opts.extra) continue;
    p.stderrPerBitwidth ||= nameDirective(ln, "stderr-per-bitwidth");
    p.dontCheckCompilerStderr ||= nameDirective(ln, "dont-check-compiler-stderr");
    // directives/auxiliary.rs `parse_and_update_aux`
    if (ln.name.startsWith("aux-") || ln.name === "proc-macro") {
      const b = nameValueDirective(ln, "aux-build");
      if (b !== undefined) p.aux.builds.push(b.trim());
      const bin = nameValueDirective(ln, "aux-bin");
      if (bin !== undefined) p.aux.bins.push(bin.trim());
      const c = nameValueDirective(ln, "aux-crate");
      if (c !== undefined) p.aux.crates.push(parseAuxCrate(c));
      const pm = nameValueDirective(ln, "proc-macro");
      if (pm !== undefined) p.aux.procMacros.push(parseProcMacro(pm));
    }
    // handlers.rs: normalize-stderr[-32bit|-64bit], for the target's pointer width
    if (ln.name === "normalize-stderr" || ln.name === "normalize-stderr-32bit" || ln.name === "normalize-stderr-64bit") {
      const v = valueAfterColon(ln);
      const rule = v === undefined ? undefined : parseNormalizeRule(v);
      if (!rule) throw new Reject(`couldn't parse custom normalization rule: \`${ln.raw}\``);
      const width = current().pointerWidth;
      if (ln.name === "normalize-stderr" || (ln.name === "normalize-stderr-64bit" && width === 64) || (ln.name === "normalize-stderr-32bit" && width === 32)) p.normalizeStderr.push(rule);
    }
  }
  // `load_from`: the edition goes first, so `compile-flags` come last.
  p.compileFlags.unshift(`--edition=${showEdition(p.edition ?? 2015)}`);
  // UI tests default to `//@ check-fail`.
  if (!opts.auxFile) p.passFailMode ??= "check-fail";
  return p;
}

/**
 * What `make_compile_args` builds: the test's main compile (`compile_test`: `Emit` from the pass/fail
 * mode, `AllowUnused::Yes` unless run-pass, output under `build/`, `LinkToAux::Yes`, with `-L <linkAuxDir>`
 * when the test has an aux dir), or (`auxOutDir`) one of its aux crates (`build_auxiliary`: `Emit::None`,
 * `AllowUnused::No`, `LinkToAux::No`, `TargetLocation::ThisDirectory(auxOutDir)`).
 */
interface CompileKind {
  auxOutDir?: string;
  linkAuxDir?: string;
  /** `force_host`'s `--target=<config.host>` for a host-built aux crate (the header's proc-macro section). */
  hostTarget?: string;
}

/** runtest.rs `make_compile_args` (UI mode, rustc), without the harness's `-Zparse-crate-root-only`. */
function compileArgs(file: string, relDir: string, stem: string, revision: string | undefined, p: Props, format: ErrorFormat, kind: CompileKind = {}): string[] {
  const h = host();
  const a: string[] = [file];
  a.push("-Zsimulate-remapped-rust-src-base=/rustc/FAKE_PREFIX", "-Ztranslate-remapped-path-to-local-path=no");
  a.push("-Z", `ignore-directory-in-diagnostics-source-blocks=${h.cargoHome}`);
  a.push("-Z", `ignore-directory-in-diagnostics-source-blocks=${join(UPSTREAM, "vendor")}`);
  if (!p.compileFlags.some((f) => f.startsWith("--sysroot"))) a.push("--sysroot", h.sysroot);
  if (!p.compileFlags.some((f) => f.startsWith("--target"))) a.push(`--target=${kind.hostTarget ?? h.target}`);
  // set_revision_flags
  const norm = (r: string) => r.toLowerCase().replaceAll("-", "_");
  if (revision !== undefined) {
    const r = norm(revision);
    if (p.compileFlags.some((f, i) => f === `--cfg=${r}` || (f === "--cfg" && p.compileFlags[i + 1] === r))) throw new Reject(`redundant cfg argument \`${r}\``);
    if (builtinCfgNames().has(r)) throw new Reject(`revision \`${r}\` collides with a built-in cfg`);
    a.push("--cfg", r);
  }
  if (!p.noAutoCheckCfg) a.push("--check-cfg", `cfg(test,FALSE${p.revisions.map((r) => "," + norm(r)).join("")})`);
  // config.optimize_tests (bootstrap default) + TestMode::Ui: optimize run-pass tests that set no
  // optimization level (no `--pass` override, so the effective mode is the declared one). Aux crates
  // have no pass/fail mode.
  if (p.passFailMode === "run-pass" && !p.compileFlags.some((f) => f === "-O" || f.includes("opt-level"))) a.push("-O");
  // TestMode::Ui
  if (format === "json" && !p.compileFlags.some((f) => f.startsWith("--error-format"))) a.push("--error-format", "json", "--json", "future-incompat");
  a.push("-Ccodegen-units=1", "-Zui-testing", "-Zdeduplicate-diagnostics=no", "-Zwrite-long-types-to-disk=no", "-Cstrip=debuginfo");
  // `--remap-path-prefix=<src_test_suite_root>=fake-test-src-base` remaps an absolute input path; ours is
  // relative, so the prefix would never match.
  if (p.remapSrcBase) throw new Reject("`remap-src-base` needs compiletest's absolute input path");
  // run_ui_test: check modes emit metadata; build/run modes do a full build (a build-fail test's
  // preceding metadata-only compile is not a case). Aux builds: `Emit::None`.
  const mode = p.passFailMode;
  if (kind.auxOutDir === undefined && mode!.startsWith("check-")) a.push("--emit", "metadata");
  if (!p.noPreferDynamic) a.push("-C", "prefer-dynamic");
  if (!p.compileFlags.includes("-o")) {
    if (kind.auxOutDir !== undefined) a.push("--out-dir", kind.auxOutDir);
    else {
      const outDir = `build/${h.target}/test/ui/${relDir}/${stem}${revision !== undefined ? "." + revision : ""}`;
      // `run_if_enabled`: running is enabled for every non-fuchsia target.
      // make_exe_name: the (linux) host's EXE_SUFFIX is empty.
      if (mode!.startsWith("run-")) a.push("-o", `${outDir}/a`);
      else a.push("--out-dir", outDir);
    }
  }
  a.push("-Znext-solver=coherence");
  if (kind.auxOutDir === undefined && mode !== "run-pass") a.push("-A", "unused", "-W", "unused_attributes");
  a.push("-A", "internal_features", "-A", "incomplete_features", "-A", "unused_parens", "-A", "unused_braces");
  // maybe_add_external_args(target_rustcflags): `-Crpath -Cdebuginfo=0` (debug flags dropped if the test sets its own).
  a.push("-Crpath");
  if (!p.compileFlags.some((f) => ["-g", "-Cdebuginfo=", "debuginfo="].some((d) => f.startsWith(d)))) a.push("-Cdebuginfo=0");
  // LinkToAux::Yes + has_aux_dir
  if (kind.linkAuxDir !== undefined) a.push("-L", kind.linkAuxDir);
  a.push(...p.compileFlags);
  return a;
}

/** `compose_and_run_compiler`: `rustc_env` set, then `unset_rustc_env` removed. */
function compileEnv(p: Props): Record<string, string | null> {
  const env: Record<string, string | null> = {};
  for (const [k, v] of p.rustcEnv) env[k] = v;
  for (const k of p.unsetRustcEnv) env[k] = null;
  return env;
}

// ---- auxiliary crates (see the header) ----

/** Stands for the case's aux directory in argv until it is known (it is keyed by the commands). */
const AUX_DIR = "@RUST_TS_AUX_DIR@";

export interface AuxStep {
  file: string;
  args: string[];
  env: Record<string, string | null>;
  /** Built for the oracle's real host and linked (the header's proc-macro section); else a COMPILETEST_TARGET rmeta. */
  host?: boolean;
  /** A proc-macro crate (`proc-macro:`, or a proc-macro crate by its own crate type). */
  procMacro?: boolean;
}

/**
 * How the aux crates of one tree are planned: `procMacro` = proc-macro aux crates are built (else the test is
 * rejected, plan-m2 D6); `host` = this tree belongs to a proc-macro crate, so it is built for the real host.
 */
interface AuxCtx {
  procMacro: boolean;
  host: boolean;
}
const NO_PROC_MACRO: AuxCtx = { procMacro: false, host: false };

/** runtest.rs `has_aux_dir` (aux bins alone do not give the main compile `-L`). */
const hasAuxDir = (p: Props): boolean => p.aux.builds.length > 0 || p.aux.crates.length > 0 || p.aux.procMacros.length > 0;

/** runtest.rs `build_all_auxiliary`'s `path_to_crate_name`. */
function pathToCrateName(path: string): string {
  let n = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  while (n.endsWith(".rs")) n = n.slice(0, -3);
  return n.replaceAll("-", "_");
}

/** runtest.rs `dylib_name`: `std::env::consts::DLL_PREFIX` / `DLL_EXTENSION` of the machine compiletest runs on. */
export function dylibName(name: string, platform: string = process.platform): string {
  if (platform === "win32") return `${name}.dll`;
  return `lib${name}.${platform === "darwin" ? "dylib" : "so"}`;
}

/** runtest.rs `get_lib_name` (no wasm proc macros: `wasm-proc-macros` is off). */
function getLibName(name: string, auxType: "bin" | "lib" | "dylib" | "proc-macro"): string | undefined {
  if (auxType === "bin") return undefined;
  if (auxType === "lib") return `lib${name}.rlib`;
  return dylibName(name);
}

/** An aux source that is a proc-macro crate by its own compile-flags or `#![crate_type]` attribute. */
function isProcMacroCrate(src: string, ap: Props): boolean {
  const crateTypeFlag = ap.compileFlags.some((f, i) => f === "--crate-type=proc-macro" || (f === "--crate-type" && ap.compileFlags[i + 1] === "proc-macro"));
  return crateTypeFlag || /^\s*#!\[\s*crate_type\s*=\s*"proc-macro"\s*\]/m.test(src);
}

/**
 * runtest.rs `build_all_auxiliary` for `props` (the root test's, or an aux crate's), planning the aux builds
 * into `steps` (dependencies first) and appending `--extern`s to `cmd`. `root` is the root test: every aux
 * path is resolved against its `auxiliary/` directory, also for nested aux crates.
 */
function planAllAux(root: string, rev: string | undefined, props: Props, auxDir: string, cmd: string[], steps: AuxStep[], format: ErrorFormat, ctx: AuxCtx = NO_PROC_MACRO): void {
  // (compiletest builds proc-macros last; without `ctx.procMacro` none is reproduced, so the test is skipped before any build.)
  if (props.aux.procMacros.length > 0 && !ctx.procMacro) throw new Reject(`needs a proc-macro auxiliary crate (\`proc-macro: ${props.aux.procMacros[0]!.path}\`): deferred to M6 (plan-m2 D6)`);
  for (const b of props.aux.builds) planAux(root, rev, b, auxDir, undefined, steps, format, ctx);
  for (const b of props.aux.bins) planAux(root, rev, b, auxDir, "bin", steps, format, ctx);
  for (const c of props.aux.crates) {
    const t = planAux(root, rev, c.path, auxDir, undefined, steps, format, ctx);
    // add_extern: `lib<name>.rlib` / the dylib name, here the rmeta the harness builds instead (header); a host-built
    // crate (the header's proc-macro section) by compiletest's own `get_lib_name`.
    const lib = t.host ? getLibName(pathToCrateName(c.path), t.auxType) : `lib${pathToCrateName(c.path)}.rmeta`;
    if (lib !== undefined) cmd.push("--extern", `${c.modifiers !== undefined ? `${c.modifiers}:` : ""}${c.name}=${auxDir}/${lib}`);
  }
  for (const pm of props.aux.procMacros) {
    planAux(root, rev, pm.path, auxDir, "proc-macro", steps, format, ctx);
    const crateName = pathToCrateName(pm.path);
    cmd.push("--extern", `${pm.modifiers !== undefined ? `${pm.modifiers}:` : ""}${crateName}=${auxDir}/${getLibName(crateName, "proc-macro")}`);
  }
}

/**
 * runtest.rs `build_auxiliary` (aux type `None` = lib/dylib, `bin`, or `proc-macro`), planned into `steps`; returns the
 * aux type and whether the crate is host-built.
 */
function planAux(
  root: string,
  rev: string | undefined,
  source: string,
  auxDir: string,
  type: "bin" | "proc-macro" | undefined,
  steps: AuxStep[],
  format: ErrorFormat,
  ctx: AuxCtx,
): { auxType: "bin" | "lib" | "dylib" | "proc-macro"; host: boolean } {
  // resolve_aux_path
  const auxPath = `${root.slice(0, root.lastIndexOf("/"))}/auxiliary/${source}`;
  if (!existsSync(join(UPSTREAM, auxPath))) throw new Reject(`compiletest fails the test: auxiliary source file \`${source}\` not found at \`${auxPath}\``);
  const src = readFileSync(join(UPSTREAM, auxPath), "utf8");
  const ap = testProps(fileDirectives(src), rev, { auxFile: true, extra: true });
  const pmCrate = type === "proc-macro" || isProcMacroCrate(src, ap);
  if (pmCrate && !ctx.procMacro) throw new Reject(`auxiliary crate \`${auxPath}\` is a proc-macro crate: deferred to M6 (plan-m2 D6)`);
  if (ap.compileFlags.includes("-o")) throw new Reject(`auxiliary crate \`${auxPath}\` sets \`-o\`, which this harness does not reproduce`);
  // `AuxType::ProcMacro` (not wasm): `force_host`. Host-built here (header): proc-macro crates and their aux trees.
  if (type === "proc-macro") ap.forceHost = true;
  // `procMacro` only: an aux crate's own `//@ force-host` builds it for the real host too (a proc macro's
  // `extern crate` of a sibling `force-host` aux crate needs it; existing callers keep COMPILETEST_TARGET).
  const host = ctx.host || pmCrate || (ctx.procMacro && ap.forceHost);
  // On unix, bins go to a `bin` subfolder.
  const dir = type === "bin" ? `${auxDir}/bin` : auxDir;
  const args = compileArgs(auxPath, "", "", rev, ap, format, { auxOutDir: dir, hostTarget: host ? oracleHost() : undefined });
  planAllAux(root, rev, ap, dir, args, steps, format, { procMacro: ctx.procMacro, host });
  // COMPILETEST_TARGET is not emscripten/musl/wasm32/nvptx/vxworks/bpf and the mode is not coverage, so
  // dylib unless the target cannot link dynamically.
  const [auxType, crateType] =
    type === "bin"
      ? (["bin", "bin"] as const)
      : type === "proc-macro"
        ? (["proc-macro", "proc-macro"] as const)
        : ap.noPreferDynamic
          ? (["lib", undefined] as const)
          : current().dynamicLinking
            ? (["dylib", "dylib"] as const)
            : (["lib", "lib"] as const);
  if (crateType !== undefined) args.push("--crate-type", crateType);
  // For convenience, but this only works on 2018.
  if (auxType === "proc-macro") args.push("--extern", "proc_macro");
  args.push("-L", dir);
  if (!host) args.push("--emit=metadata"); // harness: metadata only (header)
  steps.push(host ? { file: auxPath, args, env: compileEnv(ap), host, procMacro: pmCrate } : { file: auxPath, args, env: compileEnv(ap) });
  return { auxType, host };
}

/**
 * Whether the aux tree of a test (its `props`, `root` the test file) holds a proc-macro crate: a `proc-macro:` crate,
 * or an `aux-build`/`aux-crate`/`aux-bin` crate that is a proc-macro crate or has one in its own tree (the
 * `procMacro` case sets, see the header). Directives only; never builds. An aux file compiletest would reject counts
 * by its `proc-macro` directives alone; a missing one counts as nothing (planning rejects the test later).
 */
function auxTreeHasProcMacro(root: string, rev: string | undefined, props: Props, depth = 0): boolean {
  if (props.aux.procMacros.length > 0) return true;
  if (depth > 16) return false;
  for (const source of [...props.aux.builds, ...props.aux.bins, ...props.aux.crates.map((c) => c.path)]) {
    const auxPath = `${root.slice(0, root.lastIndexOf("/"))}/auxiliary/${source}`;
    if (!existsSync(join(UPSTREAM, auxPath))) continue;
    const src = readFileSync(join(UPSTREAM, auxPath), "utf8");
    const lines = fileDirectives(src);
    let ap: Props;
    try {
      ap = testProps(lines, rev, { auxFile: true, extra: true });
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      if (lines.some((ln) => appliesTo(ln, rev) && ln.name === "proc-macro")) return true;
      continue;
    }
    if (isProcMacroCrate(src, ap) || auxTreeHasProcMacro(root, rev, ap, depth + 1)) return true;
  }
  return false;
}

/**
 * The system C compiler driver's directory (rustc's default linker on unix hosts: `cc`), added to the `PATH` of
 * host-built aux crates (the header's proc-macro section). On Windows rustc finds the MSVC linker itself.
 */
let linkerDirMemo: string | undefined;
function linkerDir(): string | undefined {
  if (process.platform === "win32") return undefined;
  if (linkerDirMemo !== undefined) return linkerDirMemo;
  const cc = Bun.which("cc");
  if (!cc) {
    const line = "ERROR: no `cc` on PATH: proc-macro aux crates are linked by the oracle rustc, whose default linker it is";
    console.log(line);
    throw new Error(line);
  }
  return (linkerDirMemo = dirname(cc));
}

/**
 * Inherited variables the oracle's rustup proxy needs to find its toolchain. They are the only inherited part of
 * an aux build's environment, and part of the aux key (see `auxEnv`).
 */
const AUX_INHERITED_ENV = ["HOME", "USERPROFILE", "SYSTEMROOT", "RUSTUP_HOME", "CARGO_HOME"];

/**
 * The whole environment of an aux build: `AUX_INHERITED_ENV` from the harness's own environment, the fixed
 * `PATH` (`oraclePinnedPathEnv`: on Windows also `RUSTUP_WINDOWS_PATH_ADD_BIN=0`), `RUSTC_ICE=0` and `RUST_BACKTRACE=0` as every M2/M3 case gets them (harness/suites.ts
 * `NOCORE_ENV`: no ICE report file in the upstream checkout, no backtrace), then the aux file's own `rustc-env` /
 * `unset-rustc-env` (`compose_and_run_compiler`). Nothing else from the caller's environment reaches it.
 */
function auxEnv(step: AuxStep): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of AUX_INHERITED_ENV) {
    const v = getEnv(process.env, k);
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, oraclePinnedPathEnv());
  // Host builds link (the header's proc-macro section): the pinned PATH plus the linker driver's directory.
  const ld = step.host ? linkerDir() : undefined;
  if (ld !== undefined) env.PATH = `${env.PATH}${delimiter}${ld}`;
  env.RUSTC_ICE = "0";
  env.RUST_BACKTRACE = "0";
  for (const [k, v] of Object.entries(step.env)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** The aux root holds temp dirs of builds in progress (`<key>.tmp-<pid>`); those of dead processes are removed once per process. */
let staleTmpsCleaned = false;
function cleanStaleAuxTmps(root: string): void {
  if (staleTmpsCleaned) return;
  staleTmpsCleaned = true;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const n of names) {
    const m = /\.tmp-(\d+)$/.exec(n);
    if (!m) continue;
    const pid = Number(m[1]);
    let alive = pid === process.pid;
    if (!alive) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (e) {
        // EPERM: the process exists (another user's).
        alive = (e as NodeJS.ErrnoException).code === "EPERM";
      }
    }
    if (!alive) rmSync(join(root, n), { recursive: true, force: true });
  }
}

/** A failed aux build: one `ERROR:` line, then the harness stops (never a skip, see the header). */
function auxBuildError(id: string, msg: string): never {
  const line = `ERROR: ${id}: the oracle's build of an auxiliary crate failed: ${msg}`;
  console.log(line);
  throw new Error(line);
}

/**
 * The aux directory's key for case `id`'s planned `steps`: the oracle build, the case id and, per step, its source path,
 * command, whole environment (`auxEnv`), source hash and every file the source may pull in (scripts/lib/deps.ts).
 */
export function auxKey(id: string, steps: readonly AuxStep[]): string {
  return hash(
    JSON.stringify([
      rustcDriverHash(),
      id,
      steps.map((s) => [s.file, s.args, auxEnv(s), hash(readFileSync(join(UPSTREAM, s.file))), caseDeps(UPSTREAM, s.file, s.env)]),
    ]),
  ).slice(0, 16);
}

/**
 * Runs the planned aux builds of case `id` with the oracle (once: the directory is keyed by the oracle build,
 * the case id and every command, environment (`auxEnv`), source and file the source may pull in) and returns
 * the aux directory. Each build gets `timeoutMs` and, if it times out, one retry with `ORACLE_RETRY_FACTOR` times
 * that, as difftest's oracle processes. Any failure (a timeout of the retry, a signal, any non-zero exit) prints
 * an `ERROR:` line and throws: the case list cannot be made, so the run stops instead of skipping the case.
 */
let uiPruned = false;
function buildAux(id: string, steps: AuxStep[], timeoutMs: number): string {
  const key = auxKey(id, steps);
  const root = join(DATA, "aux", "ui");
  cleanStaleAuxTmps(root);
  const dir = join(root, key);
  if (existsSync(join(dir, ".ok"))) {
    // In use: keeps it from `pruneStaleUiAux` (lane harness-w36).
    touchAuxDir(dir);
    return dir;
  }
  verifyOracleToolchain();
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    for (const s of steps) {
      // Built in `tmp` and renamed: nothing in an rmeta refers to its output directory.
      const cmd = oracleRustcCmd(s.args.map((a) => a.replaceAll(AUX_DIR, tmp)));
      const spawn = (ms: number) => Bun.spawnSync(cmd, { cwd: UPSTREAM, env: auxEnv(s), timeout: ms });
      let r = spawn(timeoutMs);
      if (r.exitedDueToTimeout) r = spawn(timeoutMs * ORACLE_RETRY_FACTOR);
      if (r.exitedDueToTimeout) auxBuildError(id, `\`${s.file}\` timed out (${timeoutMs} ms, then ${timeoutMs * ORACLE_RETRY_FACTOR} ms)`);
      if (r.exitCode !== 0) {
        const how = r.exitCode === null ? `signal ${r.signalCode}` : `exit ${r.exitCode}`;
        const first = r.stderr.toString().split("\n").find((l) => l.startsWith("error")) ?? "";
        auxBuildError(id, `\`${s.file}\` (${how})${first ? `: ${first.slice(0, 300)}` : ""}`);
      }
    }
    writeFileSync(join(tmp, ".ok"), "");
    try {
      renameSync(tmp, dir);
    } catch {
      // Another process built the same directory first.
      if (!existsSync(join(dir, ".ok"))) throw new Error(`ERROR: cannot create aux directory ${dir}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // A new build (a new case or a changed key): once per process, remove the case directories unused for AUX_STALE_MS.
  if (!uiPruned) {
    uiPruned = true;
    pruneStaleUiAux(root, key);
  }
  return dir;
}

/** lib.rs `collect_tests_from_dir` + `is_test`, relative to the upstream checkout, sorted. */
export function collectUiTests(dir: string, out: string[] = []): string[] {
  const abs = join(UPSTREAM, dir);
  if (existsSync(join(abs, "compiletest-ignore-dir"))) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "auxiliary") collectUiTests(rel, out);
    } else if (e.name.endsWith(".rs") && !/^[.#~]/.test(e.name)) out.push(rel);
  }
  return out;
}

const memo = new Map<string, { cases: UiCase[]; skipped: Skip[] }>();

/**
 * Every UI test under `dirs` (repo paths under `tests/ui`), one case per revision (id
 * `<file>#<revision>`), with the compile command compiletest would run and `-Zparse-crate-root-only`.
 */
export function uiCases(dirs: string[], format: ErrorFormat): { cases: UiCase[]; skipped: Skip[] } {
  const key = `${format}|${dirs.join("|")}`;
  const m = memo.get(key);
  if (m) return m;
  const files = dirs.filter((d) => existsSync(join(UPSTREAM, d))).flatMap((d) => collectUiTests(d)).sort();
  const r = uiFileCases(files, format, {});
  memo.set(key, r);
  return r;
}

/**
 * `uiCases` for an explicit list of test files (as `collectUiTests` finds them). With `aux`, tests with
 * `aux-build`/`aux-crate`/`aux-bin` crates are cases too (their aux crates built by the oracle, see the
 * header, each build with `auxTimeoutMs`, the suite's oracle timeout) instead of being skipped, the
 * directives the blessed-output report needs are read, and `auxFiles` lists the cases' aux sources.
 * With `run` (the run-mode suites of M6, lane harness-m6a), each case is the test's main compile as compiletest runs
 * it, without `-Zparse-crate-root-only`, and carries its pass/fail `mode` and `run` props.
 * With `procMacro` (needs `aux`; the pm suites of M6, lane harness-m6b), proc-macro aux crates are built too (host
 * dylibs, see the header) and only the tests whose aux tree holds one are cases (or skips); `auxSteps` lists each
 * case's aux builds (source, argv with the aux directory filled in, host-built or not), in build order.
 * With `needs` (the M6 run and pm suites, lane harness-w36), every `needs-*` directive is evaluated as compiletest does
 * for COMPILETEST_TARGET (see "needs-*" above) instead of rejecting the test.
 */
export function uiFileCases(
  files: string[],
  format: ErrorFormat,
  opts: { aux?: boolean; auxTimeoutMs?: number; run?: boolean; procMacro?: boolean; needs?: boolean },
): { cases: UiCase[]; skipped: Skip[]; auxFiles: Map<string, string[]>; auxSteps: Map<string, AuxStep[]> } {
  if (opts.aux && opts.auxTimeoutMs === undefined) throw new Error("ERROR: uiFileCases: `aux` needs `auxTimeoutMs`");
  if (opts.procMacro && !opts.aux) throw new Error("ERROR: uiFileCases: `procMacro` needs `aux`");
  const ctx: AuxCtx = opts.procMacro ? { procMacro: true, host: false } : NO_PROC_MACRO;
  const auxFiles = new Map<string, string[]>();
  const auxSteps = new Map<string, AuxStep[]>();
  const cases: UiCase[] = [];
  const skipped: Skip[] = [];
  for (const file of files) {
    const relDir = file.slice("tests/ui/".length, file.lastIndexOf("/")) || ".";
    const stem = file.slice(file.lastIndexOf("/") + 1, -3);
    let lines: DirectiveLine[] = [];
    let revisions: string[];
    try {
      lines = fileDirectives(readFileSync(join(UPSTREAM, file), "utf8"));
      revisions = [];
      for (const ln of lines) {
        const v = nameValueDirective(ln, "revisions");
        if (v === undefined) continue;
        for (const r of v.split(/\s+/).filter(Boolean)) {
          if (revisions.includes(r)) throw new Reject(`duplicate revision: \`${r}\``);
          if (r === "true" || r === "false") throw new Reject(`revision name \`${r}\` is not permitted`);
          revisions.push(r);
        }
      }
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      // (`procMacro`: only a file that names a proc-macro aux crate is listed.)
      if (!opts.procMacro || lines.some((ln) => ln.name === "proc-macro")) skipped.push({ id: file, reason: `compiletest rejects the file: ${e.message}` });
      continue;
    }
    for (const rev of revisions.length ? revisions : [undefined]) {
      const id = rev === undefined ? file : `${file}#${rev}`;
      // `procMacro`: tests without a proc-macro crate in their aux tree are not part of the case set (no skip entry).
      if (opts.procMacro) {
        if (!lines.some((ln) => appliesTo(ln, rev) && (ln.name.startsWith("aux-") || ln.name === "proc-macro"))) continue;
        let member: boolean;
        try {
          member = auxTreeHasProcMacro(file, rev, testProps(lines, rev, { extra: true }));
        } catch (e) {
          if (!(e instanceof Reject)) throw e;
          member = lines.some((ln) => appliesTo(ln, rev) && ln.name === "proc-macro");
        }
        if (!member) continue;
      }
      try {
        let ignore: string | undefined;
        let aux: string | undefined;
        for (const ln of lines) {
          if (!appliesTo(ln, rev)) continue;
          if ((ln.name.startsWith("aux-") || ln.name === "proc-macro") && valueAfterColon(ln) !== undefined) aux ??= ln.raw;
          ignore = ignoreDecision(ln, opts.needs) ?? ignore;
        }
        if (ignore !== undefined) {
          skipped.push({ id, reason: `ignored by compiletest on ${host().target}: ${ignore}` });
          continue;
        }
        if (aux !== undefined && !opts.aux) {
          skipped.push({ id, reason: `needs an auxiliary crate (\`${aux}\`), which this harness does not build` });
          continue;
        }
        const p = testProps(lines, rev, { extra: opts.aux, run: opts.run });
        let args = compileArgs(file, relDir, stem, rev, p, format, { linkAuxDir: opts.aux && hasAuxDir(p) ? AUX_DIR : undefined });
        if (opts.aux) {
          const steps: AuxStep[] = [];
          planAllAux(file, rev, p, AUX_DIR, args, steps, format, ctx);
          if (steps.length > 0) {
            const dir = buildAux(id, steps, opts.auxTimeoutMs!);
            args = args.map((a) => a.replaceAll(AUX_DIR, dir));
            auxFiles.set(id, [...new Set(steps.map((s) => s.file))]);
            auxSteps.set(id, steps.map((s) => ({ ...s, args: s.args.map((a) => a.replaceAll(AUX_DIR, dir)) })));
          }
        }
        if (opts.run) cases.push({ id, file, args, env: compileEnv(p), mode: p.passFailMode, run: p.run });
        else {
          args.push("-Zparse-crate-root-only");
          cases.push({ id, file, args, env: compileEnv(p) });
        }
      } catch (e) {
        if (!(e instanceof Reject)) throw e;
        skipped.push({ id, reason: e.message });
      }
    }
  }
  return { cases, skipped, auxFiles, auxSteps };
}

/**
 * runtest.rs `output_base_dir` of UI case `id` (`<file>[#<rev>]`), relative to the upstream checkout (the harness's
 * layout, see the header): `build/<target>/test/ui/<dir>/<stem>[.<rev>]`. compiletest's `run` creates it before any
 * compile (runtest.rs:147); a `-o <dir>/a` compile (build and run modes) needs it to exist.
 */
export function uiOutputBaseDir(id: string): string {
  const hashAt = id.indexOf("#");
  const file = hashAt < 0 ? id : id.slice(0, hashAt);
  const rev = hashAt < 0 ? undefined : id.slice(hashAt + 1);
  const relDir = file.slice("tests/ui/".length, file.lastIndexOf("/")) || ".";
  return `build/${host().target}/test/ui/${relDir}/${file.slice(file.lastIndexOf("/") + 1, -3)}${rev !== undefined ? "." + rev : ""}`;
}

// ---- expected output (the blessed-output report of the M3 suites) ----

/** One case's blessed `.stderr` and compiletest's normalization of a compile's stderr, or why there is none. */
export type Blessed = { path: string; expected: string; normalize: (stderr: string) => string } | { na: string };

/** A Rust `regex` pattern as a JS RegExp (global), or undefined when it does not translate. */
function rustRegex(src: string): RegExp | undefined {
  let flags = "g";
  const m = /^\(\?([imsx]+)\)/.exec(src);
  if (m) {
    if (m[1]!.includes("x")) return undefined;
    flags += m[1];
    src = src.slice(m[0].length);
  }
  if (/\(\?[a-zA-Z-]+[:)]/.test(src) || src.includes("\\A") || src.includes("\\z")) return undefined;
  src = src.replaceAll("(?P<", "(?<");
  for (const f of [flags, flags + "u"]) {
    try {
      return new RegExp(src, f);
    } catch {}
  }
  return undefined;
}

/** `Regex::replace_all` with a Rust replacement string (`$n`, `$name`, `${..}`, `$$`). */
function rustReplaceAll(text: string, re: RegExp, rep: string): string {
  return text.replace(re, (...args: unknown[]) => {
    const last = args[args.length - 1];
    const groups = (typeof last === "object" && last !== null ? last : {}) as Record<string, string | undefined>;
    const nums = args.slice(0, typeof last === "object" && last !== null ? -3 : -2) as (string | undefined)[];
    const group = (name: string) => (/^\d+$/.test(name) ? nums[Number(name)] : groups[name]) ?? "";
    let out = "";
    for (let i = 0; i < rep.length; i++) {
      const c = rep[i]!;
      if (c !== "$") {
        out += c;
        continue;
      }
      if (rep[i + 1] === "$") {
        out += "$";
        i++;
        continue;
      }
      if (rep[i + 1] === "{") {
        const close = rep.indexOf("}", i + 2);
        if (close >= 0) {
          out += group(rep.slice(i + 2, close));
          i = close;
          continue;
        }
      }
      const n = /^[_0-9A-Za-z]+/.exec(rep.slice(i + 1));
      if (!n) {
        out += "$";
        continue;
      }
      out += group(n[0]);
      i += n[0].length;
    }
    return out;
  });
}

/**
 * The blessed stderr of UI case `id` (`<file>[#<rev>]`, args `args`) and runtest.rs `normalize_output` for
 * it, as `load_compare_outputs` uses them for a compile's stderr: `expected_output_path` (no fallback from
 * `<stem>.<rev>.stderr` to `<stem>.stderr`; a missing file means empty), `stderr-per-bitwidth`. Paths are
 * the harness's: the test's directory relative to the upstream checkout (as the case passes the file),
 * the output directory under `build/` and the harness's aux directory are `$DIR`/`$TEST_BUILD_DIR`.
 * Not reproduced: `$BUILD_DIR` (an absolute build root; the harness has none) and the canonicalized
 * output directory (identical here). Added: the dist oracle's `/rustc/<commit>/library` is `$SRC_DIR` too.
 */
export function uiBlessed(id: string, args: string[]): Blessed {
  const hashAt = id.indexOf("#");
  const file = hashAt < 0 ? id : id.slice(0, hashAt);
  const rev = hashAt < 0 ? undefined : id.slice(hashAt + 1);
  let p: Props;
  try {
    p = testProps(fileDirectives(readFileSync(join(UPSTREAM, file), "utf8")), rev, { extra: true });
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    return { na: e.message };
  }
  if (p.dontCheckCompilerStderr) return { na: "dont-check-compiler-stderr" };
  const rules: [RegExp, string][] = [];
  for (const [re, rep] of p.normalizeStderr) {
    const r = rustRegex(re);
    if (!r) return { na: `normalize-stderr regex does not translate to JS: ${re}` };
    rules.push([r, rep]);
  }
  const kind = p.stderrPerBitwidth ? `${current().pointerWidth}bit.stderr` : "stderr";
  const path = `${file.slice(0, -3)}.${rev !== undefined ? `${rev}.` : ""}${kind}`;
  const expected = existsSync(join(UPSTREAM, path)) ? readFileSync(join(UPSTREAM, path), "utf8") : "";
  const parentDir = file.slice(0, file.lastIndexOf("/"));
  const relDir = file.slice("tests/ui/".length, file.lastIndexOf("/")) || ".";
  const outputBase = `build/${host().target}/test/ui/${relDir}/${file.slice(file.lastIndexOf("/") + 1, -3)}${rev !== undefined ? "." + rev : ""}`;
  const auxDir = args.find((a, i) => args[i - 1] === "-L" && a.startsWith(join(DATA, "aux", "ui")));
  const cflags = p.compileFlags.join(" ");
  const json = ["--error-format json", "--error-format pretty-json", "--error-format=json", "--error-format=pretty-json", "--output-format json", "--output-format=json"].some((f) => cflags.includes(f));
  const realDir = (sub: string) => {
    const d = join(host().sysroot, "lib", "rustlib", sub, "rust");
    try {
      return readlinkSync(d);
    } catch {
      return d;
    }
  };
  const normalize = (output: string): string => {
    let n = output;
    const path = (from: string, to: string) => {
      n = n.replaceAll(json ? from.replaceAll("\\", "\\\\") : from, to);
    };
    path(parentDir, "$DIR");
    path("/rustc/FAKE_PREFIX/library", "$SRC_DIR");
    // Harness: the oracle is a dist toolchain whose std was built with remapped paths, so (without its
    // rust-src) diagnostics show the virtual `/rustc/<commit>/library/..` path where compiletest's locally
    // built std, remapped by -Zsimulate-remapped-rust-src-base, shows `/rustc/FAKE_PREFIX/library/..`.
    path(`/rustc/${PIN.commit}/library`, "$SRC_DIR");
    path("/rustc/FAKE_PREFIX/compiler", "$COMPILER_DIR");
    path(join(realDir("src"), "library"), "$SRC_DIR_REAL");
    path(join(realDir("rustc-src"), "compiler"), "$COMPILER_DIR_REAL");
    if (auxDir !== undefined) path(auxDir, "$TEST_BUILD_DIR/auxiliary");
    path(outputBase, "$TEST_BUILD_DIR");
    if (json) n = n.replaceAll("\\n", "\n");
    n = n.replace(/SRC_DIR(.+):\d+:\d+(: \d+:\d+)?/g, "SRC_DIR$1:LL:COL");
    // normalize_platform_differences
    n = n.replaceAll("\\\\", "\\");
    n = n.replace(/(?:\\[\p{L}\p{N}.\-_']+)+\.\p{L}+|\$(?:DIR|SRC_DIR|TEST_BUILD_DIR|BUILD_DIR|LIB_DIR)(?:\\[\p{L}\p{N}.\-_' ]+)+/gu, (m) => m.replaceAll("\\", "/"));
    n = n.replaceAll("\r\n", "\n");
    n = n.replace(/\$TEST_BUILD_DIR\/(?<filename>[^.]+).long-type-(?<hash>\d+).txt/g, (_m, f: string) => `$TEST_BUILD_DIR/${f}.long-type-$LONG_TYPE_HASH.txt`);
    n = n.replace(/thread '(?<name>.*?)' \((rtid )?\d+\) panicked/g, (_m, name: string) => `thread '${name}' ($TID) panicked`);
    n = n.replaceAll("\t", "\\t");
    n = n.replace(/\s*\/\/(\[.*\])?~.*/g, "");
    if (/_R.*?Cs[0-9a-zA-Z]+_/.test(n)) n = n.replace(/Cs[0-9a-zA-Z]+_/g, "CsCRATE_HASH_");
    if (/\(_R.*?B[0-9a-zA-Z]_/.test(n)) n = n.replace(/B[0-9a-zA-Z]_/g, "B<REF>_");
    n = n.replace(/╾─*(a(lloc)?|A(LLOC)?)\d+(\+0x[0-9a-f]+)?(<imm>)?( ?\(\d+ ptr bytes\))?─*╼/g, () => "╾ALLOC$ID╼");
    n = n.replace(/\b(alloc|ALLOC)\d+\b/g, () => "ALLOC$ID");
    for (const [re, rep] of rules) n = rustReplaceAll(n, re, rep);
    return n;
  };
  return { path, expected, normalize };
}
