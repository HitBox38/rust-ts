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
// auxiliary crates (`aux-*`, `proc-macro`), `add-minicore`, `incremental`, conditions that depend on
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
// (`docs/plan-m2.md`). The oracle and the subject still run on this machine (stopping after parsing
// needs no target std). Only absolute paths in argv (sysroot, cargo home, upstream checkout) vary.
//
// Paths: the input file is passed relative to the upstream checkout (the cwd of both sides), so
// diagnostics show `tests/ui/...` where compiletest would show an absolute path and then
// normalize it to `$DIR`. The output directory mirrors compiletest's layout relative to the cwd
// (`build/<target>/test/ui/<dir>/<stem>[.<rev>]`); nothing is written there when stopping after parsing.
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PIN, UPSTREAM } from "../scripts/lib/common.ts";
import { oracleSysroot } from "../scripts/lib/oracle.ts";

/** The host and target compiletest is run as (see "Host independence" above). */
export const COMPILETEST_TARGET = "x86_64-unknown-linux-gnu";

export interface UiCase {
  id: string;
  file: string;
  args: string[];
  env: Record<string, string | null>;
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
  rustcAbi: string | undefined;
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
    rustcAbi: typeof spec["rustc-abi"] === "string" ? spec["rustc-abi"] : undefined,
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

/** Ignore decision of one directive line (`make_test_description`'s `decision!` chain), or undefined to continue. */
function ignoreDecision(ln: DirectiveLine): string | undefined {
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
}

/** `Config::parse_env`. */
function parseEnv(nv: string): [string, string] {
  const eq = nv.indexOf("=");
  return eq < 0 ? [nv.trim(), ""] : [nv.slice(0, eq).trim(), nv.slice(eq + 1)];
}

/** `TestProps::from_file(testfile, revision)` for a UI test. */
function testProps(lines: DirectiveLine[], revision: string | undefined): Props {
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
    if (ln.name === "add-minicore") throw new Reject("`add-minicore` (builds minicore) is not reproduced");
    if (ln.name === "incremental") throw new Reject("`incremental` (incremental directory) is not reproduced");
    if (ln.name === "aux-codegen-backend") throw new Reject("`aux-codegen-backend` is not reproduced");
  }
  // `load_from`: the edition goes first, so `compile-flags` come last.
  p.compileFlags.unshift(`--edition=${showEdition(p.edition ?? 2015)}`);
  // UI tests default to `//@ check-fail`.
  p.passFailMode ??= "check-fail";
  return p;
}

/** runtest.rs `make_compile_args` for `run_ui_test`'s main compile (`compile_test`). */
function compileArgs(file: string, relDir: string, stem: string, revision: string | undefined, p: Props, format: ErrorFormat): string[] {
  const h = host();
  const a: string[] = [file];
  a.push("-Zsimulate-remapped-rust-src-base=/rustc/FAKE_PREFIX", "-Ztranslate-remapped-path-to-local-path=no");
  a.push("-Z", `ignore-directory-in-diagnostics-source-blocks=${h.cargoHome}`);
  a.push("-Z", `ignore-directory-in-diagnostics-source-blocks=${join(UPSTREAM, "vendor")}`);
  if (!p.compileFlags.some((f) => f.startsWith("--sysroot"))) a.push("--sysroot", h.sysroot);
  if (!p.compileFlags.some((f) => f.startsWith("--target"))) a.push(`--target=${h.target}`);
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
  // optimization level (no `--pass` override, so the effective mode is the declared one).
  if (p.passFailMode === "run-pass" && !p.compileFlags.some((f) => f === "-O" || f.includes("opt-level"))) a.push("-O");
  // TestMode::Ui
  if (format === "json" && !p.compileFlags.some((f) => f.startsWith("--error-format"))) a.push("--error-format", "json", "--json", "future-incompat");
  a.push("-Ccodegen-units=1", "-Zui-testing", "-Zdeduplicate-diagnostics=no", "-Zwrite-long-types-to-disk=no", "-Cstrip=debuginfo");
  // `--remap-path-prefix=<src_test_suite_root>=fake-test-src-base` remaps an absolute input path; ours is
  // relative, so the prefix would never match.
  if (p.remapSrcBase) throw new Reject("`remap-src-base` needs compiletest's absolute input path");
  // run_ui_test: check modes emit metadata; build/run modes do a full build (a build-fail test's
  // preceding metadata-only compile is not a case).
  const mode = p.passFailMode!;
  if (mode.startsWith("check-")) a.push("--emit", "metadata");
  if (!p.noPreferDynamic) a.push("-C", "prefer-dynamic");
  const outDir = `build/${h.target}/test/ui/${relDir}/${stem}${revision !== undefined ? "." + revision : ""}`;
  if (!p.compileFlags.includes("-o")) {
    // `run_if_enabled`: running is enabled for every non-fuchsia target.
    // make_exe_name: the (linux) host's EXE_SUFFIX is empty.
    if (mode.startsWith("run-")) a.push("-o", `${outDir}/a`);
    else a.push("--out-dir", outDir);
  }
  a.push("-Znext-solver=coherence");
  if (mode !== "run-pass") a.push("-A", "unused", "-W", "unused_attributes");
  a.push("-A", "internal_features", "-A", "incomplete_features", "-A", "unused_parens", "-A", "unused_braces");
  // maybe_add_external_args(target_rustcflags): `-Crpath -Cdebuginfo=0` (debug flags dropped if the test sets its own).
  a.push("-Crpath");
  if (!p.compileFlags.some((f) => ["-g", "-Cdebuginfo=", "debuginfo="].some((d) => f.startsWith(d)))) a.push("-Cdebuginfo=0");
  a.push(...p.compileFlags);
  a.push("-Zparse-crate-root-only");
  return a;
}

/** `compose_and_run_compiler`: `rustc_env` set, then `unset_rustc_env` removed. */
function compileEnv(p: Props): Record<string, string | null> {
  const env: Record<string, string | null> = {};
  for (const [k, v] of p.rustcEnv) env[k] = v;
  for (const k of p.unsetRustcEnv) env[k] = null;
  return env;
}

/** lib.rs `collect_tests_from_dir` + `is_test`, relative to the upstream checkout, sorted. */
function collect(dir: string, out: string[] = []): string[] {
  const abs = join(UPSTREAM, dir);
  if (existsSync(join(abs, "compiletest-ignore-dir"))) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "auxiliary") collect(rel, out);
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
  const cases: UiCase[] = [];
  const skipped: Skip[] = [];
  const files = dirs.filter((d) => existsSync(join(UPSTREAM, d))).flatMap((d) => collect(d)).sort();
  for (const file of files) {
    const relDir = file.slice("tests/ui/".length, file.lastIndexOf("/")) || ".";
    const stem = file.slice(file.lastIndexOf("/") + 1, -3);
    let lines: DirectiveLine[];
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
      skipped.push({ id: file, reason: `compiletest rejects the file: ${e.message}` });
      continue;
    }
    for (const rev of revisions.length ? revisions : [undefined]) {
      const id = rev === undefined ? file : `${file}#${rev}`;
      try {
        let ignore: string | undefined;
        let aux: string | undefined;
        for (const ln of lines) {
          if (!appliesTo(ln, rev)) continue;
          if ((ln.name.startsWith("aux-") || ln.name === "proc-macro") && valueAfterColon(ln) !== undefined) aux ??= ln.raw;
          ignore = ignoreDecision(ln) ?? ignore;
        }
        if (ignore !== undefined) {
          skipped.push({ id, reason: `ignored by compiletest on ${host().target}: ${ignore}` });
          continue;
        }
        if (aux !== undefined) {
          skipped.push({ id, reason: `needs an auxiliary crate (\`${aux}\`), which this harness does not build` });
          continue;
        }
        const p = testProps(lines, rev);
        cases.push({ id, file, args: compileArgs(file, relDir, stem, rev, p, format), env: compileEnv(p) });
      } catch (e) {
        if (!(e instanceof Reject)) throw e;
        skipped.push({ id, reason: e.message });
      }
    }
  }
  const r = { cases, skipped };
  memo.set(key, r);
  return r;
}
