// The `cli` report suite (lane harness-cli; docs/handoff/scout-unported.md §5 "Lane 1", §7): driver requests that need no
// source file, or a fixed one. Report only: no baseline, so `gate.ts run` leaves it out by default (as `rlib-native`,
// `mir-heavy`); `--suites cli` runs it. One process per case and side: the oracle is the pinned rustc with the case's exact
// argv, the subject src/rust_ts/main.ts with the same argv (binary mode applies, `subjectCmd`). Both run from the upstream
// checkout with no tty (difftest pipes stdout and stderr) and the scrubbed environment (scripts/lib/env.ts: the colour
// variables `CLICOLOR*`, `NO_COLOR`, `FORCE_COLOR`, `TERM`, `COLORTERM` are unset), plus `RUSTC_ICE=0 RUST_BACKTRACE=0`.
// stdout, stderr and exit are compared.
//
// Every list is read from the pinned upstream sources, never typed in:
// - `explain <code>`: `--explain <code>` for every `EXXXX.md` in compiler/rustc_error_codes/src/error_codes/ (518 at the
//   pin; the same set as the `error_codes!` list in that crate's lib.rs).
// - `explain-color <code>`: the same with `--color always`, which `handle_explain` renders through the markdown terminal
//   renderer when stdout is no tty (`show_colored_md_content`). Measured when added: the oracle's output differs from the
//   plain one for all 518 codes, so every code gets one (none would be a duplicate of its plain case).
// - `explain <removed code>`: each code that lib.rs lists as removed (`//  EXXXX, // ...` after the macro) and that has no
//   description (130 at the pin; 5 listed there still have one): the oracle's "is not a valid error code". Plus the first code lowercased and without its `E` (`handle_explain` accepts both).
// - `W-help`: `-W help` with no input, and with the fixed trivial input `CLI_TRIVIAL_INPUT`.
// - `print <kind>`: `--print <kind>` for every `PrintKind` (compiler/rustc_session/src/config/print_request.rs: its
//   variants, `name`, `category` and `is_stable`; 27 at the pin), with `-Zunstable-options` for the unstable ones, each on
//   the host target (no `--target`) and on `--target <CLI target>` (x86_64-unknown-linux-gnu, as every other suite). Every
//   print case passes `--sysroot <oracle sysroot>`: the port cannot find a default sysroot (`filesearch::default_sysroot`
//   stays unported until root decides how, scout §2), and with it `sysroot` and `target-libdir` print the given path on
//   both sides by design (the path is in the argv, so in the oracle cache key). The `Crate` category (`crate-name`,
//   `file-names`, `crate-root-lint-levels`) needs an input: those kinds also run on `CLI_TRIVIAL_INPUT`. Also: the example
//   mnemonic of upstream's own `backend-has-mnemonic` message (`:RET`); the unknown requests `help` and each one
//   `emit_unknown_print_request_help` treats specially (`lints`); and `print-unstable <kind>`, each unstable kind without
//   `-Zunstable-options` (the stability error).
//   Left out, each for its reason:
//   - `target-cpus` on the host target: its `native` line names the host machine's CPU model ("currently apple-m4"),
//     which neither the oracle cache key (the rustc_driver build) nor the port can know. Kept for the CLI target.
//   - `link-args` and `native-static-libs` with an input: they print during linking, so the case would run codegen and the
//     host linker and write the binary into the upstream checkout. Kept with no input (the "no input filename" error).
//   - `sysroot` and `target-libdir` without `--sysroot`: the oracle prints where its toolchain is installed, which no
//     cache key covers and the port cannot know (above).
// - `crate-root-lint-levels <ui case>`: check-ui's cases (its 730 tests/ui auxiliary crates, their argv and env: target,
//   oracle sysroot, edition, `--crate-type lib --emit=metadata`) with `--print crate-root-lint-levels -Zunstable-options`
//   before the input. `print_crate_info` returns `Compilation::Stop`, so neither side writes the rmeta.
// - `ls=root <crate>`, `ls=all <crate>`: `-Zls=<what> --target <CLI target> <rmeta>` on the aux rmetas the M5 alloc/std
//   suites build with the oracle (harness/library.ts `oracleLibRmeta`: std's dependency closure without std, 19 crates).
//   Reproducible: each is built on demand into a directory named by a key of the oracle build, the crate's inputs, argv
//   and env, so its path (in the argv) names its content. Not check-ui's rmetas: those are by-products of that suite's
//   oracle runs (absent in a fresh data directory or when its oracle output came from the cache, and rewritten under a
//   concurrent run).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Case, Suite } from "./suites.ts";

/** The fixed trivial input (a lib crate's source with no crate attribute and no directive: `pub trait Trait {}`). */
export const CLI_TRIVIAL_INPUT = "tests/ui/traits/auxiliary/trivial3.rs";
export const ERROR_CODES_DIR = "compiler/rustc_error_codes/src/error_codes";
export const ERROR_CODES_LIB = "compiler/rustc_error_codes/src/lib.rs";
export const PRINT_REQUEST_RS = "compiler/rustc_session/src/config/print_request.rs";
/** The environment of every synthetic case (as the suites' `NOCORE_ENV`): no ICE file in the checkout, no backtrace. */
export const CLI_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** The error codes with a long description: `EXXXX` for each `EXXXX.md` of the directory listing `names`, sorted. */
export function explainCodes(names: readonly string[]): string[] {
  return names
    .map((n) => /^(E\d{4})\.md$/.exec(n)?.[1])
    .filter((c): c is string => c !== undefined)
    .sort();
}

/** The codes rustc_error_codes' lib.rs lists as removed: its `//  EXXXX, // <why>` lines, in order. */
export function removedCodes(libRs: string): string[] {
  return [...libRs.matchAll(/^\/\/\s+(E\d{4}),/gm)].map((m) => m[1]!);
}

export interface PrintKindInfo {
  /** The `PrintKind` variant. */
  variant: string;
  /** What `--print` takes (`PrintKind::name`). */
  name: string;
  /** `PrintKind::category`: `Target`, `Codegen`, `Linker` or `Crate`. */
  category: string;
  /** `PrintKind::is_stable`: an unstable kind needs `-Zunstable-options`. */
  stable: boolean;
}

/** The body of `fn <name>` in `src`: from its line to the next `fn ` (comments dropped). */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`fn ${name}(`);
  if (start < 0) throw new Error(`ERROR: no fn ${name} in ${PRINT_REQUEST_RS}`);
  const end = src.indexOf("\n    fn ", start + 1);
  return src.slice(start, end < 0 ? undefined : end).replace(/\/\/[^\n]*/g, "");
}

/** The arms `A | B => <value>` of a match body: each variant with its value. */
function matchArms(body: string, value: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(String.raw`([\w\s|]+?)=>\s*(${value.source})`, "g");
  for (const m of body.matchAll(re)) for (const v of m[1]!.split("|").map((s) => s.trim())) if (v !== "") out.set(v, m[2]!);
  return out;
}

/** Every `PrintKind` of print_request.rs (`src`), in declaration order, with its name, category and stability. */
export function printKinds(src: string): PrintKindInfo[] {
  const decl = /pub enum PrintKind \{([\s\S]*?)\n\}/.exec(src);
  if (!decl) throw new Error(`ERROR: no enum PrintKind in ${PRINT_REQUEST_RS}`);
  const variants = [...decl[1]!.replace(/\/\/[^\n]*/g, "").matchAll(/^\s*(\w+),/gm)].map((m) => m[1]!);
  const names = matchArms(fnBody(src, "name"), /"[^"]+"/);
  const cats = matchArms(fnBody(src, "category"), /PrintCategory::\w+/);
  const stable = matchArms(fnBody(src, "is_stable"), /true|false/);
  return variants.map((variant) => {
    const name = names.get(variant);
    const category = cats.get(variant);
    const st = stable.get(variant);
    if (name === undefined || category === undefined || st === undefined) throw new Error(`ERROR: PrintKind::${variant} has no name, category or stability in ${PRINT_REQUEST_RS}`);
    return { variant, name: name.slice(1, -1), category: category.slice("PrintCategory::".length), stable: st === "true" };
  });
}

/** The example mnemonic of upstream's "expected mnemonic name" message (`--print=backend-has-mnemonic:RET`). */
export function mnemonicExample(src: string): string {
  const m = /--print=backend-has-mnemonic:(\w+)/.exec(src);
  if (!m) throw new Error(`ERROR: no backend-has-mnemonic example in ${PRINT_REQUEST_RS}`);
  return m[1]!;
}

/** The unknown requests `emit_unknown_print_request_help` gives an extra help line (`req == "lints"`). */
export function specialUnknownRequests(src: string): string[] {
  return [...fnBody(src, "emit_unknown_print_request_help").matchAll(/req == "([^"]+)"/g)].map((m) => m[1]!);
}

/** Everything `cliCases` makes the cases from. */
export interface CliInputs {
  /** `explainCodes` of the error-codes directory. */
  codes: string[];
  /** `removedCodes` of rustc_error_codes' lib.rs. */
  removed: string[];
  /** print_request.rs's text (`printKinds`, `mnemonicExample`, `specialUnknownRequests`). */
  printRequest: string;
  /** The `--target` of the target-pinned cases. */
  target: string;
  /** The oracle sysroot, passed to every print case. */
  sysroot: string;
  /** check-ui's cases (the input is their last argument). */
  checkUi: Case[];
  /** The aux rmetas for `-Zls`, each crate with its absolute path. */
  lsRmetas: { crate: string; path: string }[];
}

/** The request kind of a case: the first word of its id (`explain`, `print`, `ls=all`, ...). */
export const cliKind = (id: string): string => id.split(" ", 1)[0]!;

/** The cases of the `cli` suite (see the header), ids unique. */
export function cliCases(i: CliInputs): Case[] {
  const out: Case[] = [];
  const synth = (id: string, args: string[], file = ""): void => {
    out.push({ id, file, args, env: CLI_ENV });
  };
  // --explain
  for (const c of i.codes) synth(`explain ${c}`, ["--explain", c]);
  for (const c of i.codes) synth(`explain-color ${c}`, ["--explain", c, "--color", "always"]);
  // lib.rs's removed list also names a few codes that still have a description (E0722, ...): those are plain cases already.
  for (const c of new Set(i.removed)) if (!i.codes.includes(c)) synth(`explain ${c}`, ["--explain", c]);
  if (i.codes.length > 0) for (const form of [i.codes[0]!.toLowerCase(), i.codes[0]!.slice(1)]) synth(`explain ${form}`, ["--explain", form]);
  // -W help
  synth("W-help", ["-W", "help"]);
  synth(`W-help ${CLI_TRIVIAL_INPUT}`, ["-W", "help", CLI_TRIVIAL_INPUT], CLI_TRIVIAL_INPUT);
  // --print
  const kinds = printKinds(i.printRequest);
  const sysroot = ["--sysroot", i.sysroot];
  const print = (req: string, extra: string[], input?: string): void => {
    const target = extra.includes("--target") ? ` --target ${i.target}` : "";
    synth(`print ${req}${target}${input === undefined ? "" : ` ${input}`}`, ["--print", req, ...extra, ...sysroot, ...(input === undefined ? [] : [input])], input ?? "");
  };
  for (const k of kinds) {
    const unstable = k.stable ? [] : ["-Zunstable-options"];
    for (const t of [[], ["--target", i.target]]) {
      // The host's `target-cpus` names the host machine's CPU (header).
      if (k.name === "target-cpus" && t.length === 0) continue;
      print(k.name, [...unstable, ...t]);
      // Only the Crate kinds need an input; the Linker ones would run codegen and the linker with one (header).
      if (k.category === "Crate") print(k.name, [...unstable, ...t], CLI_TRIVIAL_INPUT);
    }
  }
  const mnemonic = kinds.find((k) => k.name === "backend-has-mnemonic");
  if (mnemonic) print(`backend-has-mnemonic:${mnemonicExample(i.printRequest)}`, mnemonic.stable ? [] : ["-Zunstable-options"]);
  for (const req of ["help", ...specialUnknownRequests(i.printRequest)]) print(req, []);
  for (const k of kinds.filter((k) => !k.stable)) synth(`print-unstable ${k.name}`, ["--print", k.name, ...sysroot]);
  // --print crate-root-lint-levels on check-ui's crates
  for (const c of i.checkUi) {
    const args = [...c.args.slice(0, -1), "--print", "crate-root-lint-levels", "-Zunstable-options", c.args.at(-1)!];
    out.push({ id: `crate-root-lint-levels ${c.id}`, file: c.file, args, ...(c.env === undefined ? {} : { env: c.env }) });
  }
  // -Zls
  for (const what of ["root", "all"]) for (const r of i.lsRmetas) synth(`ls=${what} ${r.crate}`, [`-Zls=${what}`, "--target", i.target, r.path]);
  return out;
}

/** What the `cli` suite takes from harness/suites.ts (which loads scripts/lib/common.ts, so this module does not). */
export interface CliSuiteDeps {
  /** The upstream checkout. */
  upstream: string;
  target: string;
  sysroot: () => string;
  /** The oracle command of an argv (`oracleRustcCmd`). */
  oracle: (args: string[]) => string[];
  /** The subject command of an argv (`subjectCmd("src/rust_ts/main.ts")` + it). */
  subject: (args: string[]) => string[];
  checkUi: () => Case[];
  lsRmetas: () => { crate: string; path: string }[];
}

/** The `cli` suite (see the header). */
export function cliSuite(d: CliSuiteDeps): Suite {
  let memo: Case[] | undefined;
  const kinds = ["explain", "explain-color", "W-help", "print", "print-unstable", "crate-root-lint-levels", "ls=root", "ls=all"];
  return {
    name: "cli",
    milestone: "M6",
    description:
      "report only: driver requests that need no source file or a fixed one (harness/cli.ts): --explain of every error code (plain and --color always), -W help, --print of every print kind (host and x86_64-unknown-linux-gnu), --print crate-root-lint-levels on check-ui's crates, -Zls on the M5 aux rmetas: stdout + stderr + exit",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 60_000,
    cases: () =>
      (memo ??= cliCases({
        codes: explainCodes(readdirSync(join(d.upstream, ERROR_CODES_DIR))),
        removed: removedCodes(readFileSync(join(d.upstream, ERROR_CODES_LIB), "utf8")),
        printRequest: readFileSync(join(d.upstream, PRINT_REQUEST_RS), "utf8"),
        target: d.target,
        sysroot: d.sysroot(),
        checkUi: d.checkUi(),
        lsRmetas: d.lsRmetas(),
      })),
    subsets: Object.fromEntries(kinds.map((k) => [k, (c: Case) => cliKind(c.id) === k])),
    oracle: ([c]) => d.oracle(c!.args),
    subject: ([c]) => d.subject(c!.args),
  };
}
