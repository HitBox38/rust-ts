// Differential test suites. Each case runs on the oracle and on rust-ts with the same
// inputs; outputs (stdout, stderr, exit code) must be byte-identical.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO, UPSTREAM, hash } from "../scripts/lib/common.ts";
import { caseDeps } from "../scripts/lib/deps.ts";
import { caseEnv, mergeEnv } from "../scripts/lib/env.ts";
import { oraclePinnedPathEnv, oracleRustcCmd, oracleSysroot, rustcDriverHash } from "../scripts/lib/oracle.ts";
import { probePath } from "../scripts/probes.ts";
import { COMPILETEST_TARGET, collectUiTests, uiBlessed, uiCases, uiFileCases, type Blessed, type ErrorFormat } from "./compiletest.ts";

export interface Case {
  /** Stable id; the protected set (harness/baseline) is a list of these. */
  id: string;
  /**
   * Input file, relative to the suite's cwd (the upstream checkout unless `Suite.cwd` says
   * otherwise). `""` for a synthetic case with no input file (its oracle cache key then depends
   * only on the suite, id, args and oracle binary).
   */
  file: string;
  args: string[];
  /**
   * Environment of both sides' processes, over the inherited one (`null` removes a variable). Part
   * of the oracle cache key when present.
   */
  env?: Record<string, string | null>;
}

/** A test a suite does not run, with the reason (written next to each run's results). */
export interface SkippedCase {
  id: string;
  reason: string;
}

/** A case whose oracle output is not reproducible, with the reason (`Suite.unstable`). */
export interface UnstableCase {
  id: string;
  reason: string;
}

export interface Suite {
  name: string;
  milestone: string;
  description: string;
  cases(): Case[];
  /**
   * batch: both sides take many files in one process and print a `file: <path>` header
   * before each file's output. single: one process per case.
   */
  mode: "batch" | "single";
  oracle(cases: Case[]): string[];
  subject(cases: Case[]): string[];
  timeoutMs: number;
  /**
   * Timeout of an oracle process, if not `timeoutMs`. An oracle process that times out is retried
   * once with `ORACLE_RETRY_FACTOR` times the timeout; if it times out again the case is
   * ORACLE_TIMEOUT (never cached, never MATCH).
   */
  oracleTimeoutMs?: number;
  /** Tests this suite leaves out, with reasons (e.g. compiletest would ignore them on this host). */
  skipped?(): SkippedCase[];
  /** Working directory of every command and base of `Case.file`; default: the upstream checkout. */
  cwd?: string;
  /** Probes (tools/probes/<name>) the oracle command runs; the gate checks they are built. */
  probes?: string[];
  /**
   * The suite's tools read no file but the case files (a lexer, an escaper, a token-tree dump, ...: no
   * module loading, no include macros), so the oracle cache key hashes only those. Unset: the key also
   * covers every other file a case may make rustc read (scripts/lib/deps.ts).
   */
  readsOnlyCaseFile?: boolean;
  /**
   * Named subsets of the cases (e.g. the parts a milestone gate is defined on); difftest reports their
   * counts besides the suite's.
   */
  subsets?: Record<string, (c: Case) => boolean>;
  /**
   * The case's blessed compiletest output and normalization, for difftest's report-only `--report blessed`
   * (UI-test suites; never part of a case's status).
   */
  blessed?(c: Case): Blessed;
  /**
   * Cases whose oracle output differs between two runs of the same oracle binary on the same input and environment
   * (lane harness-w20c), each with the reason. Only truly nondeterministic oracle output belongs here; a difference
   * the harness causes (a run-specific path, env or temp dir) is fixed in the case definition instead. difftest
   * reports these cases as UNSTABLE (never MATCH), never reads or writes their oracle cache entry, and the gate
   * refuses to protect them and fails if a baseline lists one. difftest also reports a case outside the list as
   * UNSTABLE when its oracle stderr shows a known nondeterministic pattern (difftest `UNSTABLE_ORACLE_PATTERNS`).
   */
  unstable?(): UnstableCase[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(UPSTREAM, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith(".rs")) out.push(rel);
  }
  return out;
}

const corpusCache = new Map<string, string[]>();
function corpus(...dirs: string[]): string[] {
  const key = dirs.join("|");
  let files = corpusCache.get(key);
  if (!files) {
    files = dirs.flatMap((d) => walk(d)).sort();
    corpusCache.set(key, files);
  }
  return files;
}

/** Edition from compiletest directives (`//@ edition: 2021`); library/compiler sources are 2024. */
function edition(file: string): string {
  if (!file.startsWith("tests/")) return "2024";
  const src = readFileSync(join(UPSTREAM, file), "utf8");
  const m = /^\s*\/\/@\s*edition\s*:\s*(\d{4}|future)/m.exec(src);
  return m ? m[1]! : "2015";
}

const bunCmd = (script: string) => [process.execPath, join(REPO, script)];

export const SUITES: Suite[] = [
  {
    name: "lex",
    milestone: "M1",
    description: "rustc_lexer token stream (probe built from upstream rustc_lexer) on every .rs in tests/ui, library, compiler",
    mode: "batch",
    timeoutMs: 120_000,
    probes: ["lexdump"],
    readsOnlyCaseFile: true,
    cases: () => corpus("tests/ui", "library", "compiler").map((f) => ({ id: f, file: f, args: [] })),
    oracle: (cs) => [probePath("lexdump"), ...cs.map((c) => c.file)],
    subject: (cs) => [...bunCmd("src/rust_ts/lexdump.ts"), ...cs.map((c) => c.file)],
  },
  {
    name: "parse",
    milestone: "M1",
    description: "rustc -Zunpretty=ast-tree (pre-expansion AST + parser diagnostics) on every .rs in tests/ui",
    mode: "single",
    timeoutMs: 60_000,
    // The oracle needs ~200 s of CPU on tests/ui/try-trait/deep-try-chain-issue-153583.rs (its
    // `{:#?}` dump nests ~1300 levels); 60 s could never finish it. Success is cached once per
    // oracle build, so the longer limit costs nothing afterwards.
    oracleTimeoutMs: 300_000,
    cases: () =>
      corpus("tests/ui").map((f) => {
        const ed = edition(f);
        return { id: f, file: f, args: [`--edition=${ed}`, "-Zunpretty=ast-tree", f] };
      }),
    oracle: ([c]) => oracleRustcCmd(c!.args),
    subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
  },
  {
    name: "escape",
    milestone: "M1",
    description:
      "rustc-literal-escaper results (probe built from the locked crate + upstream rustc_lexer) for every quoted literal in every .rs in tests/ui, library, compiler",
    mode: "batch",
    timeoutMs: 120_000,
    probes: ["escapes"],
    readsOnlyCaseFile: true,
    cases: () => corpus("tests/ui", "library", "compiler").map((f) => ({ id: f, file: f, args: [] })),
    oracle: (cs) => [probePath("escapes"), ...cs.map((c) => c.file)],
    subject: (cs) => [...bunCmd("src/rust_ts/escapedump.ts"), ...cs.map((c) => c.file)],
  },
];

/** Every .rs under a repo-relative dir, as repo-relative paths (for suites with `cwd: REPO`). */
function repoCorpus(dir: string): string[] {
  return readdirSync(join(REPO, dir))
    .filter((f) => f.endsWith(".rs"))
    .sort()
    .map((f) => `${dir}/${f}`);
}

/** Sections of the `symbols` suite, one case each (see tools/probes/symdump/main.rs for formats). */
const SYMBOL_SECTIONS = ["count", "kw", "sym", "letters", "predicates", "predefined", "integer", "character", "editions", "ident"];

SUITES.push(
  {
    name: "symbols",
    milestone: "M1",
    description: "rustc_span symbol table (probe linking upstream rustc_span): predefined symbols, kw/sym constants, sym:: helpers, predicates",
    mode: "single",
    timeoutMs: 60_000,
    probes: ["symdump"],
    readsOnlyCaseFile: true,
    cases: () => SYMBOL_SECTIONS.map((sec) => ({ id: `symbols/${sec}`, file: "", args: [sec] })),
    oracle: ([c]) => [probePath("symdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/symdump.ts"), ...c!.args],
  },
  {
    name: "escape-synthetic",
    milestone: "M1",
    description:
      "escape suite (same probe/subject) over harness/corpus/escape-synthetic: every Mode and every lexable EscapeError variant (generated by harness/corpus/gen-escape.ts)",
    mode: "batch",
    timeoutMs: 120_000,
    cwd: REPO,
    probes: ["escapes"],
    readsOnlyCaseFile: true,
    cases: () => repoCorpus("harness/corpus/escape-synthetic").map((f) => ({ id: f, file: f, args: [] })),
    oracle: (cs) => [probePath("escapes"), ...cs.map((c) => c.file)],
    subject: (cs) => [...bunCmd("src/rust_ts/escapedump.ts"), ...cs.map((c) => c.file)],
  },
);

/** Every `ext` file under a repo-relative dir, recursively, as sorted repo-relative paths. */
function repoCorpusDeep(dir: string, ext: string): string[] {
  const out: string[] = [];
  const rec = (d: string) => {
    for (const e of readdirSync(join(REPO, d), { withFileTypes: true })) {
      if (e.isDirectory()) rec(`${d}/${e.name}`);
      else if (e.name.endsWith(ext)) out.push(`${d}/${e.name}`);
    }
  };
  rec(dir);
  return out.sort();
}

// Inline Fluent messages (one case per unique message), generated by harness/corpus/gen-fluent.ts
// from every `#[diag]`/`#[label]`/`#[note]`/... and `msg!` literal in upstream compiler/, plus
// hand-written messages for paths upstream messages never reach (harness/corpus/fluent/synthetic).
const fluentCases = (): Case[] => repoCorpusDeep("harness/corpus/fluent", ".msgs").map((f) => ({ id: f, file: f, args: [] }));

SUITES.push(
  {
    name: "fluent-parse",
    milestone: "M1",
    description:
      "fluent-syntax 0.12.0 `parser::parse_runtime` (what rustc's FluentResource::try_new runs) and `parser::parse` ({:#?} of each) of `generated_msg = <msg>\\n` for every inline Fluent message in upstream compiler/ plus synthetic ones (probe: tools/probes/fluentdump)",
    mode: "batch",
    timeoutMs: 120_000,
    cwd: REPO,
    probes: ["fluentdump"],
    readsOnlyCaseFile: true,
    cases: fluentCases,
    oracle: (cs) => [probePath("fluentdump"), "parse", ...cs.map((c) => c.file)],
    subject: (cs) => [...bunCmd("src/rust_ts/fluentdump.ts"), "parse", ...cs.map((c) => c.file)],
  },
  {
    name: "fluent-format",
    milestone: "M1",
    description:
      "rustc_errors `format_fluent_str` (fluent-bundle 0.16.0, en-US, no isolation, STREQ, ICU list data) of every inline Fluent message over a fixed synthetic argument matrix (probe: tools/probes/fluentdump); ~60% of cases reference no variable and format to their own text",
    mode: "batch",
    timeoutMs: 120_000,
    cwd: REPO,
    probes: ["fluentdump"],
    readsOnlyCaseFile: true,
    cases: fluentCases,
    oracle: (cs) => [probePath("fluentdump"), "format", ...cs.map((c) => c.file)],
    subject: (cs) => [...bunCmd("src/rust_ts/fluentdump.ts"), "format", ...cs.map((c) => c.file)],
  },
);

// Diagnostic scripts (JSON; format in tools/probes/emitdump/main.rs) run through rustc_errors'
// DiagCtxt + AnnotateSnippetEmitter: generated by harness/corpus/gen-emit.ts (emit/gen) plus
// hand-written ones (emit/hand).
SUITES.push({
  name: "emit",
  milestone: "M1",
  description:
    "rustc_errors DiagCtxt + AnnotateSnippetEmitter output (probe linking upstream rustc_errors/rustc_span: tools/probes/emitdump) for scripted diagnostics: labels, multi-line spans, children, every suggestion API/style/applicability, emitter options, error-count summaries, stashing",
  mode: "batch",
  timeoutMs: 120_000,
  cwd: REPO,
  probes: ["emitdump"],
  readsOnlyCaseFile: true,
  cases: () => repoCorpusDeep("harness/corpus/emit", ".json").map((f) => ({ id: f, file: f, args: [] })),
  oracle: (cs) => [probePath("emitdump"), ...cs.map((c) => c.file)],
  subject: (cs) => [...bunCmd("src/rust_ts/emitdump.ts"), ...cs.map((c) => c.file)],
});

// Token trees (`rustc_parse::lexer::lex_token_trees`) with the pinned nightly's own rustc_parse
// (rustc-dev probe tools/probes/tokdump; its header documents the setup, the two entry points and
// the output format). Each file is lexed in its own session with its compiletest edition
// (`edition()`); edition and entry point are `--edition=`/`--strip=` arguments before the file (so
// they are also part of the oracle cache key).
const tokdumpArgs = (cs: Case[]): string[] => cs.flatMap((c) => [...c.args, c.file]);
SUITES.push(
  {
    name: "tokens",
    milestone: "M1",
    description:
      "rustc_parse token trees as rustc lexes a crate root (new_parser_from_source_str(.., ShebangAndFrontmatter) + parse_tokens: {:?} of the TokenStream, buffered lints, gated and raw-identifier spans) plus the -Zui-testing diagnostics they emit (rustc-dev probe: tools/probes/tokdump) on every .rs in tests/ui, library, compiler, each with its edition",
    mode: "batch",
    timeoutMs: 120_000,
    probes: ["tokdump"],
    readsOnlyCaseFile: true,
    cases: () => corpus("tests/ui", "library", "compiler").map((f) => ({ id: f, file: f, args: [`--edition=${edition(f)}`, "--strip=crate"] })),
    oracle: (cs) => [probePath("tokdump"), ...tokdumpArgs(cs)],
    subject: (cs) => [...bunCmd("src/rust_ts/tokdump.ts"), ...tokdumpArgs(cs)],
  },
  {
    name: "tokens-str",
    milestone: "M1",
    description:
      "tokens suite (same probe/subject) through rustc_parse::source_str_to_stream (StripTokens::Shebang: frontmatter lexed as ordinary tokens) on every tests/ui .rs whose path mentions frontmatter (which includes all 34 corpus files where the two entry points differ at the pin)",
    mode: "batch",
    timeoutMs: 120_000,
    probes: ["tokdump"],
    readsOnlyCaseFile: true,
    cases: () => corpus("tests/ui").filter((f) => f.includes("frontmatter")).map((f) => ({ id: f, file: f, args: [`--edition=${edition(f)}`, "--strip=str"] })),
    oracle: (cs) => [probePath("tokdump"), ...tokdumpArgs(cs)],
    subject: (cs) => [...bunCmd("src/rust_ts/tokdump.ts"), ...tokdumpArgs(cs)],
  },
);

// UI tests of the lexer and parser, run the way compiletest runs a UI test (harness/compiletest.ts:
// its directives, revisions, ignores, env and full rustc argv) plus `-Zparse-crate-root-only`, so both
// sides stop after parsing. One case per test and revision (`<file>#<revision>`). tests/ui/unicode
// does not exist at the pin; unicode lexing tests live under tests/ui/lexer and tests/ui/parser.
const UI_PARSE_DIRS = ["tests/ui/parser", "tests/ui/lexer", "tests/ui/frontmatter", "tests/ui/unicode"];
const uiParseSuite = (name: string, format: ErrorFormat, description: string): Suite => ({
  name,
  milestone: "M1",
  description,
  mode: "single",
  timeoutMs: 60_000,
  cases: () => uiCases(UI_PARSE_DIRS, format).cases,
  skipped: () => uiCases(UI_PARSE_DIRS, format).skipped,
  oracle: ([c]) => oracleRustcCmd(c!.args),
  subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
});
SUITES.push(
  uiParseSuite(
    "parse-ui",
    "human",
    "rustc diagnostics (stderr, stdout, exit code) after parsing, on tests/ui/{parser,lexer,frontmatter} with compiletest's UI-test argv, env, directives and revisions, human-readable (compiletest's argv minus `--error-format json --json future-incompat`: the text its .stderr files hold) + -Zparse-crate-root-only",
  ),
  uiParseSuite(
    "parse-ui-json",
    "json",
    "parse-ui with compiletest's exact UI-test argv, including its default `--error-format json --json future-incompat` (raw JSON diagnostics), + -Zparse-crate-root-only",
  ),
);

// M2a (plan-m2 §2 D, decision D7): expansion + name resolution without metadata. Every tests/ui file
// is compiled as a `#![no_core]` crate (`-Zcrate-attr`), so neither std nor core is injected or in the
// extern prelude, and crate metadata is only loaded when the file itself asks for it (an `extern crate`
// item; a 2018+ `std::..`/`core::..` path is just an unresolved-path error). Target and sysroot as
// decision D1 (the subject cannot derive the oracle's sysroot from its own location); edition from the
// file's directives, as `parse`.
// One rustc (or probe) process per file. Both sides run with `RUSTC_ICE=0` (no `rustc-ice-*.txt` report
// written into the upstream checkout, whose name and the note pointing at it hold a timestamp and pid)
// and `RUST_BACKTRACE=0` (an ICE prints no backtrace, whose frames/addresses vary). Timeouts as `parse`:
// the oracle's `{:#?}` of very deep ASTs (tests/ui/try-trait/deep-try-chain-issue-153583.rs) needs minutes.
const NOCORE_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

// Session variables (lane harness-w20b, gate determinism). `env!`/`option_env!` expand to the value of a
// variable in rustc's own environment, so a test that reads e.g. `PATH` puts the caller's PATH into the
// expanded / HIR / resolver / typeck output of both sides, while the oracle cache key covers only `Case.env`
// (scripts/difftest.ts `cachePath`): a cached oracle output from another session then differs from the subject.
// So every case that may read a variable of `SESSION_ENV_VARS` (variables a login session or shell sets, whose
// values differ between sessions) gets a fixed value for it in its `Case.env`, the same on both sides and part
// of its oracle cache key: `PATH` is `oraclePathEnv()` (`$CARGO_HOME/bin`: the oracle's `rustc +<toolchain>` is
// found there, and rustup, which prepends that directory to its rustc's PATH when it is missing, leaves it
// alone; the subject and the probes are run by absolute path; on Windows also `RUSTUP_WINDOWS_PATH_ADD_BIN=0`, so that
// rustup does not add the toolchain's `bin` directory either: scripts/lib/env.ts `pinnedPathEnv`), every other one is
// unset. A case's own env (compiletest's `rustc-env` / `unset-rustc-env`) wins. Other cases are untouched.
// "May read" is a static scan of the case file, every file it may pull in (scripts/lib/deps.ts `caseDeps`) and
// its aux crates' sources (with theirs): a variable is read if its name is the string-literal first argument of
// any macro call (`env!("PATH")`, `option_env!("PATH")`, and aliases: `use env as env_imported;` ..
// `env_imported!("PATH")`), or if a macro whose name contains `env` is called with a non-literal first
// argument (`env!(env_name!())`) and the name occurs as a string literal.
// It over-approximates (a call in a `#[cfg(test)]` fn, in a macro that is never expanded, ...); checked against
// the oracle's `--emit=dep-info` `# env-dep:` lines over every `resdump` case (docs/handoff/harness-w20b.md).
// Applied in every suite whose tools expand macros on tests/ui files (not lex/parse/tokens/parse-ui).
const SESSION_ENV_VARS = ["PATH", "HOME", "USER", "LOGNAME", "PWD", "OLDPWD", "TMPDIR", "TMP", "TEMP", "SHELL", "TERM", "LANG", "LC_ALL", "USERPROFILE"];
const MACRO_LIT_ARG = /\b\w+!\s*[(\[{]\s*"([^"\\]*)"/g;
const ENV_MACRO_DYN = /\b\w*env\w*!\s*[(\[{]\s*[^"\s)\]}]/;
const sessionReadsMemo = new Map<string, string[]>();
/** The `SESSION_ENV_VARS` that `file` (relative to `cwd`) and the files it may pull in may read (see above). */
function sessionVarsRead(cwd: string, file: string, env: Case["env"]): string[] {
  const key = `${cwd}\0${file}\0${JSON.stringify(env ?? {})}`;
  let r = sessionReadsMemo.get(key);
  if (r) return r;
  const texts = [readFileSync(join(cwd, file), "utf8")];
  for (const [p, st] of caseDeps(cwd, file, env)) if (st !== "-" && st !== "dir" && st !== "other" && !st.startsWith("ls:")) texts.push(readFileSync(join(cwd, p), "utf8"));
  const read = new Set<string>();
  const dyn = texts.some((t) => ENV_MACRO_DYN.test(t));
  for (const t of texts) {
    for (const m of t.matchAll(MACRO_LIT_ARG)) if (SESSION_ENV_VARS.includes(m[1]!)) read.add(m[1]!);
    if (dyn) for (const v of SESSION_ENV_VARS) if (t.includes(`"${v}"`)) read.add(v);
  }
  r = SESSION_ENV_VARS.filter((v) => read.has(v));
  sessionReadsMemo.set(key, r);
  return r;
}
/** `c` with fixed values for the session variables its sources may read (see above), or `c` itself if none. */
function pinSessionEnv(c: Case, auxFiles: readonly string[] = []): Case {
  const read = new Set([c.file, ...auxFiles].flatMap((f) => sessionVarsRead(UPSTREAM, f, c.env)));
  if (read.size === 0) return c;
  const env: Record<string, string | null> = { ...c.env };
  for (const v of SESSION_ENV_VARS) {
    if (!read.has(v) || Object.hasOwn(env, v)) continue;
    if (v !== "PATH") env[v] = null;
    // `{ PATH }`, and on Windows also `RUSTUP_WINDOWS_PATH_ADD_BIN=0` (scripts/lib/env.ts `pinnedPathEnv`), unless the
    // case sets that itself.
    else for (const [k, x] of Object.entries(oraclePinnedPathEnv())) if (k === "PATH" || !Object.hasOwn(env, k)) env[k] = x;
  }
  return { ...c, env };
}
const nocoreArgs = (f: string): string[] => [
  "--target",
  COMPILETEST_TARGET,
  "--sysroot",
  oracleSysroot(),
  `--edition=${edition(f)}`,
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
];
// Left out of all three nocore suites (decision, review harness-w8 M1): the oracle's `{:#?}` of the
// expanded AST for these does not finish within the 300 s + 4 x 300 s retry (2 min of CPU without
// output, measured), and an ORACLE_TIMEOUT is never cached, so every run would pay up to 25 min per
// file. `-Zunpretty=expanded` and resdump finish on them; they are left out there too so that the
// three suites keep one case list.
const NOCORE_SKIPPED: SkippedCase[] = [
  { id: "tests/ui/associated-consts/issue-93775.rs", reason: "oracle -Zunpretty=ast-tree,expanded ({:#?} of a deeply nested expanded AST) does not finish in 1500 s" },
  { id: "tests/ui/expr/if/expr-stack-overflow.rs", reason: "oracle -Zunpretty=ast-tree,expanded does not finish in 1500 s (the pre-expansion ast-tree is ~13 GB)" },
  { id: "tests/ui/parser/survive-peano-lesson-queue.rs", reason: "oracle -Zunpretty=ast-tree,expanded ({:#?} of a deeply nested expanded AST) does not finish in 1500 s" },
];
const nocoreCorpus = (): string[] => {
  const skip = new Set(NOCORE_SKIPPED.map((k) => k.id));
  return corpus("tests/ui").filter((f) => !skip.has(f));
};
const nocoreSuite = (name: string, unpretty: string, description: string): Suite => ({
  name,
  milestone: "M2",
  description,
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: 300_000,
  cases: () => nocoreCorpus().map((f) => pinSessionEnv({ id: f, file: f, args: [...nocoreArgs(f), `-Zunpretty=${unpretty}`, f], env: NOCORE_ENV })),
  skipped: () => NOCORE_SKIPPED,
  oracle: ([c]) => oracleRustcCmd(c!.args),
  subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
});
SUITES.push(
  nocoreSuite(
    "expanded-nocore",
    "ast-tree,expanded",
    "rustc -Zunpretty=ast-tree,expanded ({:#?} of the expanded AST after name resolution + expansion/resolution/early-lint diagnostics) on every .rs in tests/ui as a #![no_core] crate (-Zcrate-attr), --target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>, edition from directives",
  ),
  nocoreSuite(
    "unpretty-expanded-nocore",
    "expanded",
    "expanded-nocore with -Zunpretty=expanded (the pretty-printed expanded source instead of the AST tree)",
  ),
  {
    // tools/probes/resdump: the same compilation (expanded-nocore's argv without -Zunpretty) through
    // rustc_driver callbacks, stopped right after `resolver_for_lowering`; prints the resolver outputs
    // (ResolverGlobalCtxt, ResolverAstLowering, the definitions table) sorted, see its header.
    name: "resdump-nocore",
    milestone: "M2",
    description:
      "name resolution results (rustc-dev probe tools/probes/resdump: ResolverGlobalCtxt + ResolverAstLowering + definitions, sorted, plus the diagnostics up to resolution) on every .rs in tests/ui as a #![no_core] crate, args as expanded-nocore",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    probes: ["resdump"],
    cases: () => nocoreCorpus().map((f) => pinSessionEnv({ id: f, file: f, args: [...nocoreArgs(f), f], env: NOCORE_ENV })),
    skipped: () => NOCORE_SKIPPED,
    oracle: ([c]) => [probePath("resdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/resdump.ts"), ...c!.args],
  },
);

// M2b (plan-m2 wave 11, gate M2b): the three nocore suites' compilations with std, i.e. the same argv
// without `-Zcrate-attr=feature(no_core) -Zcrate-attr=no_core`. Every crate then gets the standard
// library injection (`extern crate std;` + the edition's `std::prelude` glob import; `#![no_std]` files get
// `core` instead), so its metadata, and that of the crates it reaches (core, alloc, ...), is loaded from
// the `lib/rustlib/x86_64-unknown-linux-gnu/lib` crates of the oracle sysroot given by `--sysroot` (the
// subject decodes those same files). Target, sysroot, edition, env (`NOCORE_ENV`: RUSTC_ICE=0,
// RUST_BACKTRACE=0) and timeouts as the nocore suites, one process per file. The same 3 files are left out,
// for the same reason (see `STD_SKIPPED`).
const stdArgs = (f: string): string[] => ["--target", COMPILETEST_TARGET, "--sysroot", oracleSysroot(), `--edition=${edition(f)}`];
// Left out of all three std suites, as in the nocore ones (measured with std, lane harness-w12): the
// oracle's -Zunpretty=ast-tree,expanded printed nothing in 1560 s on any of the 3 and was killed;
// -Zunpretty=expanded and resdump finish on them in < 0.2 s, but they are left out there too so that the
// three suites keep one case list. tests/ui/try-trait/deep-try-chain-issue-153583.rs stays in: 353 s with
// std (350 s without), within the oracle's retry, and cached once per oracle build.
const STD_SKIPPED: SkippedCase[] = NOCORE_SKIPPED.map((k) => ({ id: k.id, reason: `${k.reason} (with std too)` }));
const stdCorpus = (): string[] => {
  const skip = new Set(STD_SKIPPED.map((k) => k.id));
  return corpus("tests/ui").filter((f) => !skip.has(f));
};
const stdSuite = (name: string, unpretty: string, description: string): Suite => ({
  name,
  milestone: "M2",
  description,
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: 300_000,
  cases: () => stdCorpus().map((f) => pinSessionEnv({ id: f, file: f, args: [...stdArgs(f), `-Zunpretty=${unpretty}`, f], env: NOCORE_ENV })),
  skipped: () => STD_SKIPPED,
  oracle: ([c]) => oracleRustcCmd(c!.args),
  subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
});
SUITES.push(
  stdSuite(
    "expanded",
    "ast-tree,expanded",
    "rustc -Zunpretty=ast-tree,expanded ({:#?} of the expanded AST after name resolution + expansion/resolution/early-lint diagnostics) on every .rs in tests/ui with std injected (metadata of std/core/alloc/... loaded from the oracle sysroot's target libs), --target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>, edition from directives",
  ),
  stdSuite("unpretty-expanded", "expanded", "expanded with -Zunpretty=expanded (the pretty-printed expanded source instead of the AST tree)"),
  {
    // tools/probes/resdump, as resdump-nocore: expanded's argv without -Zunpretty.
    name: "resdump",
    milestone: "M2",
    description:
      "name resolution results (rustc-dev probe tools/probes/resdump: ResolverGlobalCtxt + ResolverAstLowering + definitions, sorted, plus the diagnostics up to resolution) on every .rs in tests/ui with std injected, args as expanded",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    probes: ["resdump"],
    cases: () => stdCorpus().map((f) => pinSessionEnv({ id: f, file: f, args: [...stdArgs(f), f], env: NOCORE_ENV })),
    skipped: () => STD_SKIPPED,
    oracle: ([c]) => [probePath("resdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/resdump.ts"), ...c!.args],
  },
);

// M3 (plan-m3 D1/D1a, D11, §4): type checking through the rustc-dev probes tools/probes/tydump (per-item
// type facts + typeck results) and tools/probes/thirdump (`{:#?}` of every body's THIR). Both stop the
// compilation after `rustc_hir_analysis::check_crate` (run_required_analyses up to definitions.freeze(),
// without check_crate's const-eval arm, D1a; tools/probes/tydump/prefix.rs). Unprotected until root
// accepts a run. Env, timeouts and one process per case as the M2 nocore suites.

// `tydump-nocore`: resdump-nocore's cases (every tests/ui file as a `#![no_core]` crate, same argv and
// skips) through tydump. A smoke test (D11): most cases stop at the first fatal `requires `sized`
// lang_item`, so stdout is empty and only the diagnostics are compared.
SUITES.push({
  name: "tydump-nocore",
  milestone: "M3",
  description:
    "type checking results (rustc-dev probe tools/probes/tydump: run_required_analyses up to typeck without const eval, then per-DefId generics_of/clauses_of/type_of/fn_sig/variances_of/explicit_item_bounds/impl_trait_header and every body's TypeckResults, sorted, plus the diagnostics) on every .rs in tests/ui as a #![no_core] crate, args as resdump-nocore",
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: 300_000,
  probes: ["tydump"],
  cases: () => nocoreCorpus().map((f) => pinSessionEnv({ id: f, file: f, args: [...nocoreArgs(f), f], env: NOCORE_ENV })),
  skipped: () => NOCORE_SKIPPED,
  oracle: ([c]) => [probePath("tydump"), ...c!.args],
  subject: ([c]) => [...bunCmd("src/rust_ts/tydump.ts"), ...c!.args],
});

// The minicore corpus (D11), shared by `tydump-minicore` and `thirdump-minicore`:
// (a) cg_clif's `example/mini_core.rs` as a lib crate, and `example/mini_core_hello_world.rs` (a bin)
//     against it. Flags: cg_clif's `rustc_command` (compiler/rustc_codegen_cranelift/build_system/tests.rs
//     at the pin: `-Cdebuginfo=2 --target <t> -Cpanic=abort --check-cfg=cfg(jit)
//     --check-cfg=cfg(target_has_reliable_f128) --edition=2024 -Zforce-unstable-if-unmarked`, then the
//     source; `--crate-type lib` for mini_core, which cg_clif builds as `lib,dylib`), with target and
//     sysroot per M2 D1. cg_clif's `-L crate=<out dir>` + `--out-dir` become `--extern
//     mini_core=<rmeta>`: the aux crate is built by the oracle (M2 D5) with `--emit=metadata` into
//     `$RUST_TS_DATA/aux/mini_core-<key>/`, key = hash of the oracle build (rustcDriverHash), the
//     source and the flags, so the path in the case args (and so the oracle cache key) changes with
//     any of them. Built on first use, when the case list is made.
// (b) every tests/ui test that is natively `#![no_core]` or has an `add-minicore` directive, with
//     compiletest's UI-test argv (harness/compiletest.ts, `human` format, revisions, directives, env)
//     minus the `-Zparse-crate-root-only` it appends for the parse-ui suites. Tests compiletest.ts does not
//     reproduce are skipped with its reason: today every `add-minicore` test (minicore is not built yet:
//     tests/auxiliary is outside the sparse checkout, plan-m3 D11) and every test with an aux crate.
const CG_CLIF_EXAMPLE = "compiler/rustc_codegen_cranelift/example";
const cgClifArgs = (): string[] => [
  "-Cdebuginfo=2",
  "--target",
  COMPILETEST_TARGET,
  "--sysroot",
  oracleSysroot(),
  "-Cpanic=abort",
  "--check-cfg=cfg(jit)",
  "--check-cfg=cfg(target_has_reliable_f128)",
  "--edition=2024",
  "-Zforce-unstable-if-unmarked",
];
/** `lib<crate>.rmeta` of `file` (a lib crate) built by the oracle with `args`, cached by content (see above). */
function oracleAuxRmeta(file: string, crate: string, args: string[]): string {
  const key = hash([rustcDriverHash(), hash(readFileSync(join(UPSTREAM, file))), file, ...args].join("\0")).slice(0, 16);
  const dir = join(DATA, "aux", `${crate}-${key}`);
  const out = join(dir, `lib${crate}.rmeta`);
  if (!existsSync(out)) {
    mkdirSync(dir, { recursive: true });
    const r = Bun.spawnSync(oracleRustcCmd([...args, file, "--crate-type", "lib", "--emit=metadata", "--out-dir", dir]), {
      cwd: UPSTREAM,
      env: mergeEnv(process.env, caseEnv(NOCORE_ENV)),
    });
    if (r.exitCode !== 0 || !existsSync(out)) throw new Error(`ERROR: oracle build of aux crate ${file} failed: ${r.stderr.toString().trim()}`);
  }
  return out;
}
const minicoreUiFile = (f: string): boolean => {
  const src = readFileSync(join(UPSTREAM, f), "utf8");
  return /^\s*#!\[no_core\]/m.test(src) || /^\s*\/\/@\s*add-minicore\b/m.test(src);
};
let minicoreMemo: { cases: Case[]; skipped: SkippedCase[] } | undefined;
function minicoreCorpus(): { cases: Case[]; skipped: SkippedCase[] } {
  if (minicoreMemo) return minicoreMemo;
  const mc = `${CG_CLIF_EXAMPLE}/mini_core.rs`;
  const hw = `${CG_CLIF_EXAMPLE}/mini_core_hello_world.rs`;
  const cases: Case[] = [
    pinSessionEnv({ id: mc, file: mc, args: [...cgClifArgs(), mc, "--crate-type", "lib"], env: NOCORE_ENV }),
    pinSessionEnv({ id: hw, file: hw, args: ["--extern", `mini_core=${oracleAuxRmeta(mc, "mini_core", cgClifArgs())}`, ...cgClifArgs(), hw], env: NOCORE_ENV }, [mc]),
  ];
  const files = corpus("tests/ui").filter((f) => !f.includes("/auxiliary/") && minicoreUiFile(f));
  const want = new Set(files);
  // uiCases takes directories (recursively): the files' directories, without those under another one.
  const dirs = [...new Set(files.map((f) => f.slice(0, f.lastIndexOf("/"))))].sort();
  const roots = dirs.filter((d) => !dirs.some((p) => p !== d && d.startsWith(p + "/")));
  const ui = uiCases(roots, "human");
  const fileOf = (id: string) => id.split("#")[0]!;
  for (const c of ui.cases) {
    if (!want.has(c.file)) continue;
    cases.push(pinSessionEnv({ id: c.id, file: c.file, args: c.args.filter((a) => a !== "-Zparse-crate-root-only"), env: { ...NOCORE_ENV, ...c.env } }));
  }
  const skipped = ui.skipped.filter((k) => want.has(fileOf(k.id)));
  return (minicoreMemo = { cases, skipped });
}
SUITES.push(
  {
    name: "tydump-minicore",
    milestone: "M3",
    description:
      "tools/probes/tydump (as tydump-nocore) on cg_clif's mini_core.rs (lib) and mini_core_hello_world.rs (--extern mini_core=<oracle-built rmeta>) with cg_clif's flags, and the natively #![no_core] / add-minicore tests of tests/ui with compiletest's UI-test argv (human diagnostics)",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    probes: ["tydump"],
    cases: () => minicoreCorpus().cases,
    skipped: () => minicoreCorpus().skipped,
    oracle: ([c]) => [probePath("tydump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/tydump.ts"), ...c!.args],
  },
  {
    name: "thirdump-minicore",
    milestone: "M3",
    description:
      "THIR of every body (rustc-dev probe tools/probes/thirdump: the tydump prefix, abort_if_errors, then `{did:?}:\\n{thir_flat}\\n` per hir_body_owner, as -Zunpretty=thir-flat prints) on the tydump-minicore cases",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    probes: ["thirdump"],
    cases: () => minicoreCorpus().cases,
    skipped: () => minicoreCorpus().skipped,
    oracle: ([c]) => [probePath("thirdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/thirdump.ts"), ...c!.args],
  },
);

// M3a (plan-m3 §1a and §4, lane harness-w13): HIR. `-Zunpretty=hir-tree` and `-Zunpretty=hir` lower the
// expanded crate to HIR (rustc_ast_lowering) and print it. They run no analysis: `needs_analysis()` is false
// for both (rustc_session/src/config.rs:3334), so there is no typeck.
// - hir-tree prints `{owner:#?} => {hir_owner_nodes(owner):#?}\n` for every owner of `hir_crate_items`
//   (rustc_driver_impl/src/pretty.rs:298).
// - hir prints `rustc_hir_pretty::print_crate` (pretty.rs:271, `PpHirMode::Normal`).
// Both first run expansion, name resolution and the early lints, as the M2 suites do. Their diagnostics are
// therefore the expanded suites' diagnostics, plus whatever AST lowering reports.
// The setups mirror the M2 suites; only the -Zunpretty mode changes:
// - hir-tree-nocore uses expanded-nocore's argv (`nocoreArgs`);
// - hir-tree and unpretty-hir use expanded's argv (`stdArgs`, std injected);
// - env is NOCORE_ENV, one process per file, subject timeout 60 s, oracle 300 s (plus the 4x retry).
// Each suite has its own measured skip list (below); no file is left out only to share a case list.
//
// Skips, measured on the oracle by harness-w13 (stdout counted and discarded; the host was heavily loaded
// during most runs, so wall times are upper bounds and CPU times are given where they decide):
// - The 3 `NOCORE_SKIPPED` files: -Zunpretty=hir-tree was killed at 1560 s with 0 bytes of stdout, both
//   without and with std. 1560 s exceeds the oracle's 300 s + 4 x 300 s, so each would be ORACLE_TIMEOUT
//   on every run (never cached), at up to 25 min per file per run.
// - tests/ui/try-trait/deep-try-chain-issue-153583.rs, with std only: -Zunpretty=hir-tree used 1754 s of
//   CPU (the last ~20 min on an idle host) without printing anything, and was then stopped. Without std it
//   fails in 0.1 s (no `Result`; lowering `?` reports "requires `branch` lang_item"), so hir-tree-nocore
//   keeps it.
// - Kept: tests/ui/suggestions/fn-to-method-deeply-nested.rs with std takes 182 s of CPU (641 s wall under
//   load) and prints 164 MB; that is within the oracle's retry, and the result is cached once per oracle
//   build. Without std it fails the same way as the previous file, in 0.05 s.
// - unpretty-hir skips nothing: all 4 files above take < 0.2 s with -Zunpretty=hir (with and without std).
// - 231 other heavy candidates (as harness-w12: top files by size, bracket depth, std macro count and
//   recursion_limit, plus paths mentioning deep/stack-overflow/blowup/slow/hang/huge/...) all finish:
//   hir-tree-nocore at most 9.7 s (mir/issue-29227.rs, 22 MB), hir-tree at most 9.2 s apart from the
//   two files above, unpretty-hir at most 0.23 s. None exits with an ICE.
const HIR_TREE_NOCORE_SKIPPED: SkippedCase[] = NOCORE_SKIPPED.map((k) => ({
  id: k.id,
  reason: "oracle -Zunpretty=hir-tree (no_core) was killed at 1560 s without output; the oracle allows 300 s + 4 x 300 s",
}));
const HIR_TREE_SKIPPED: SkippedCase[] = [
  ...NOCORE_SKIPPED.map((k) => ({
    id: k.id,
    reason: "oracle -Zunpretty=hir-tree (with std) was killed at 1560 s without output; the oracle allows 300 s + 4 x 300 s",
  })),
  {
    id: "tests/ui/try-trait/deep-try-chain-issue-153583.rs",
    reason: "oracle -Zunpretty=hir-tree (with std) used 1754 s of CPU without output; the oracle allows 300 s + 4 x 300 s",
  },
].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const hirSuite = (name: string, args: (f: string) => string[], unpretty: string, skipped: SkippedCase[], description: string): Suite => ({
  name,
  milestone: "M3a",
  description,
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: 300_000,
  cases: () => {
    const skip = new Set(skipped.map((k) => k.id));
    return corpus("tests/ui")
      .filter((f) => !skip.has(f))
      .map((f) => pinSessionEnv({ id: f, file: f, args: [...args(f), `-Zunpretty=${unpretty}`, f], env: NOCORE_ENV }));
  },
  skipped: () => skipped,
  oracle: ([c]) => oracleRustcCmd(c!.args),
  subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
});
SUITES.push(
  hirSuite(
    "hir-tree-nocore",
    nocoreArgs,
    "hir-tree",
    HIR_TREE_NOCORE_SKIPPED,
    "rustc -Zunpretty=hir-tree ({:#?} of every HIR owner's OwnerNodes after AST lowering, no analysis, plus the expansion/resolution/early-lint/lowering diagnostics) on every .rs in tests/ui as a #![no_core] crate, args as expanded-nocore",
  ),
  hirSuite(
    "hir-tree",
    stdArgs,
    "hir-tree",
    HIR_TREE_SKIPPED,
    "hir-tree-nocore with std injected (metadata of std/core/alloc/... loaded from the oracle sysroot's target libs), args as expanded",
  ),
  hirSuite(
    "unpretty-hir",
    stdArgs,
    "hir",
    [],
    "hir-tree with -Zunpretty=hir (rustc_hir_pretty::print_crate, the pretty-printed HIR, instead of the HIR tree); no skips",
  ),
);

// M3 (plan-m3 §4, lane harness-w20): the M3 gate suites, type checking of whole UI-test directories with
// compiletest's own argv. Cases: every UI test (and revision) of tests/ui/typeck and tests/ui/traits,
// plus every tests/ui test with a `#[rustc_dump_*]` attribute (`UI_DUMP_ATTR`; the dumps of
// rustc_hir_analysis check_crate and typeck writeback run in the probes' prefix, the others, e.g.
// rustc_dump_layout or rustc_dump_symbol_name, belong to later phases and leave just a type-checked test),
// for thirdump-ui also tests/ui/thir-print. Argv, env, directives, revisions, ignores and skips are
// harness/compiletest.ts's (`human` format, as tydump-minicore; `-Zparse-crate-root-only` dropped), so
// `-Znext-solver=coherence` (decision 2026-10-15: the old solver in typeck, the new one in coherence;
// `//@[next] compile-flags: -Znext-solver` revisions switch to the new solver everywhere), with
// `aux-build`/`aux-crate`/`aux-bin` crates built by the oracle as rmeta (compiletest.ts header; plan-m2
// D5). compiletest is run as on x86_64-unknown-linux-gnu (decision D1 of plan-m2, as every ui suite),
// so the case set does not depend on the machine. Env, timeouts and one process per case as
// tydump-minicore. Subsets (difftest prints their counts): the M3 gate is on `typeck+traits` and
// `rustc_dump`. Report only (`difftest --report blessed`): the blessed `.stderr` comparison (plan-m3 §4).
// Unprotected until root accepts a run.
const UI_DUMP_ATTR = /#!?\[[^\]\n]*\brustc_dump_\w+/;
let uiDumpMemo: Set<string> | undefined;
/** Every UI test (as compiletest collects them) with a `#[rustc_dump_*]` attribute. */
function uiDumpTests(): Set<string> {
  return (uiDumpMemo ??= new Set(collectUiTests("tests/ui").filter((f) => UI_DUMP_ATTR.test(readFileSync(join(UPSTREAM, f), "utf8")))));
}
const M3_UI_DIRS = ["tests/ui/typeck", "tests/ui/traits"];
/** The M3 ui suites' oracle timeout, also that of their aux builds (harness/compiletest.ts `buildAux`). */
const M3_UI_ORACLE_TIMEOUT_MS = 300_000;
const inDirs = (dirs: string[]) => (c: Case) => dirs.some((d) => c.file.startsWith(d + "/"));
const m3UiMemo = new Map<string, { cases: Case[]; skipped: SkippedCase[] }>();
/** The UI tests (and revisions) of `dirs`, plus (`dumpTests`, the M3 suites) every `#[rustc_dump_*]` test. */
function m3UiCorpus(dirs: string[], dumpTests = true): { cases: Case[]; skipped: SkippedCase[] } {
  const key = `${dirs.join("|")}${dumpTests ? "" : "\0nodump"}`;
  const m = m3UiMemo.get(key);
  if (m) return m;
  const files = [...new Set([...dirs.flatMap((d) => collectUiTests(d)), ...(dumpTests ? uiDumpTests() : [])])].sort();
  const ui = uiFileCases(files, "human", { aux: true, auxTimeoutMs: M3_UI_ORACLE_TIMEOUT_MS });
  // Only the harness's own trailing `-Zparse-crate-root-only` is dropped: a test may pass it in its compile-flags
  // (tests/ui/traits/const-traits/parse-const-unsafe-trait.rs). (The minicore corpus filters every occurrence.)
  const cases = ui.cases.map((c) => {
    if (c.args.at(-1) !== "-Zparse-crate-root-only") throw new Error(`ERROR: ${c.id}: argv does not end with -Zparse-crate-root-only`);
    return pinSessionEnv({ id: c.id, file: c.file, args: c.args.slice(0, -1), env: { ...NOCORE_ENV, ...c.env } }, ui.auxFiles.get(c.id));
  });
  const r = { cases, skipped: ui.skipped };
  m3UiMemo.set(key, r);
  return r;
}
// Unstable cases of tydump-ui and thirdump-ui (lane harness-w20c; review harness-w20b §5): each oracle output differed
// between two runs of the same probe binary with the same argv, env and cwd (both probes, measured twice), and the
// difference is not caused by the harness:
// - an ICE under compiletest's `RUST_BACKTRACE=short`: std's panic message names the OS thread id,
//   `thread 'rustc' (<tid>) panicked at ...` (compiletest normalizes it to `$TID`). For five of the six, the port ICEs
//   at the same point too (root decision, lane ui-diffs-20), so they could only ever differ in the ICE report;
//   old-solver-caching-bug-151069.rs#old is listed for the thread id alone;
// - `-Zwrite-long-types-to-disk=yes` (the test's own compile-flags, after compiletest's `=no`): the note
//   `the full name for the type has been written to '<out dir>/<stem>.long-type-<hash>.txt'` names a hash of the type
//   (rustc_middle ty/error.rs `short_string_namespace`: `DefaultHasher` over `Hash` of an interned value, which hashes
//   its address). The note is printed whether or not the out dir exists, and the address varies from run to run
//   (ASLR), so no out dir or temp dir makes it reproducible (compiletest normalizes it to `$LONG_TYPE_HASH`).
const M3_UI_TID = "ICE: the panic message names the oracle's OS thread id (`thread 'rustc' (<tid>) panicked`)";
// Root decision (lane ui-diffs-20): the port reaches the same assert!/bug! as rustc, after identical earlier errors.
const M3_UI_SAME_ICE = "both sides ICE at the same point; rustc's ICE report (thread id, backtrace) is not reproducible";
const M3_UI_LONG_TYPE = "the long-type note names `<stem>.long-type-<hash>.txt`, a hash of an interned type's address";
const M3_UI_UNSTABLE: UnstableCase[] = [
  { id: "tests/ui/traits/error-reporting/conditionally-implemented-trait-long-type.rs", reason: M3_UI_LONG_TYPE },
  { id: "tests/ui/traits/next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old", reason: M3_UI_SAME_ICE },
  { id: "tests/ui/traits/next-solver/normalize/old-solver-caching-bug-151069.rs#old", reason: M3_UI_TID },
  { id: "tests/ui/traits/next-solver/normalize/success-results-in-unconstrained-infer.rs#old", reason: M3_UI_SAME_ICE },
  { id: "tests/ui/traits/next-solver/overflow/incorrect-old-solver-caching-ice-148095.rs#old", reason: M3_UI_SAME_ICE },
  { id: "tests/ui/traits/on_unimplemented_long_types.rs", reason: M3_UI_LONG_TYPE },
  { id: "tests/ui/traits/projection-cache-rematch-impl-122529.rs#old", reason: M3_UI_SAME_ICE },
  { id: "tests/ui/traits/projection-cache-rematch-impl-141124.rs#old", reason: M3_UI_SAME_ICE },
];
const m3UiSuite = (name: string, probe: string, subject: string, dirs: string[], subsets: Suite["subsets"], description: string): Suite => ({
  name,
  milestone: "M3",
  description,
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: M3_UI_ORACLE_TIMEOUT_MS,
  probes: [probe],
  cases: () => m3UiCorpus(dirs).cases,
  skipped: () => m3UiCorpus(dirs).skipped,
  oracle: ([c]) => [probePath(probe), ...c!.args],
  subject: ([c]) => [...bunCmd(subject), ...c!.args],
  subsets,
  blessed: (c) => uiBlessed(c.id, c.args),
  unstable: () => M3_UI_UNSTABLE,
});
SUITES.push(
  m3UiSuite(
    "tydump-ui",
    "tydump",
    "src/rust_ts/tydump.ts",
    M3_UI_DIRS,
    { "typeck+traits": inDirs(M3_UI_DIRS), rustc_dump: (c) => uiDumpTests().has(c.file) },
    "tools/probes/tydump (as tydump-nocore) on tests/ui/typeck, tests/ui/traits and every tests/ui test with a #[rustc_dump_*] attribute, with compiletest's UI-test argv (human diagnostics, -Znext-solver=coherence, revisions, aux crates built by the oracle as rmeta)",
  ),
  m3UiSuite(
    "thirdump-ui",
    "thirdump",
    "src/rust_ts/thirdump.ts",
    [...M3_UI_DIRS, "tests/ui/thir-print"],
    { "typeck+traits": inDirs(M3_UI_DIRS), rustc_dump: (c) => uiDumpTests().has(c.file), "thir-print": inDirs(["tests/ui/thir-print"]) },
    "tools/probes/thirdump (as thirdump-minicore) on the tydump-ui cases plus tests/ui/thir-print",
  ),
);

// M4a (plan-m4 D2, §4; lane harness-w21): MIR building through the rustc-dev probe tools/probes/mirdump. It runs the
// tydump prefix (tools/probes/tydump/prefix.rs), then the `MIR_borrow_checking` loop of run_required_analyses without
// mir_borrowck, check_transmutes, mir_drops_elaborated_and_const_checked and the coroutine layout_of, then prints, with
// rustc's own `MirWriter::write_mir_fn`, every `mir_keys` item: `mir_built` (as computed, before any steal) and
// `mir_promoted` with its promoted fragments; trivial consts as `write_mir_pretty`'s one-liner, constructors'
// `mir_for_ctfe` (the probe's header has the details and the output layout). Diagnostics are those of MIR building
// (check_match, unsafety, MIR lints, liveness, ...) on top of the tydump prefix's. AllocIds are compared as printed
// (D13). Unprotected until root accepts a run.
// - `mirdump-minicore`: the tydump-minicore cases (`minicoreCorpus`), same argv, env and skips.
// - `mirdump-ui`: the UI tests (and revisions) of `M4A_UI_DIRS` (plan-m4 §4), with compiletest's argv, env, aux
//   crates, directives and skips exactly as tydump-ui (`m3UiCorpus`, without the rustc_dump tests). Timeouts as the M3
//   ui suites. Subsets per directory. Report only: `--report blessed`.
const M4A_UI_DIRS = [
  "tests/ui/borrowck",
  "tests/ui/nll",
  "tests/ui/mir",
  "tests/ui/mir-dataflow",
  "tests/ui/liveness",
  "tests/ui/unsafe",
  "tests/ui/pattern/usefulness",
];
// Unstable cases of mirdump-ui (lane harness-w21): the oracle (the same probe binary, argv, env and cwd) was run twice on
// every case; these 4 differed, all in `thread 'rustc' (<tid>) panicked`. They are tests that ICE by design
// (`failure-status: 101`: `-Zlint-mir` / `-Zvalidate-mir` reporting broken MIR, `-Ztreat-err-as-bug`), so the panic
// message names the oracle's OS thread id (compiletest normalizes it to `$TID`). Every other case's two outputs were
// identical; mirdump-minicore had none. difftest's detection (scripts/lib/unstable.ts) still applies.
const M4A_UI_ICE_TID =
  "ICE by design (`failure-status: 101`, broken-MIR lint/validation): the panic message names the oracle's OS thread id (`thread 'rustc' (<tid>) panicked`)";
const M4A_UI_UNSTABLE: UnstableCase[] = [
  { id: "tests/ui/mir/lint/no-storage.rs", reason: M4A_UI_ICE_TID },
  { id: "tests/ui/mir/lint/storage-live.rs", reason: M4A_UI_ICE_TID },
  { id: "tests/ui/mir/lint/storage-return.rs", reason: M4A_UI_ICE_TID },
  { id: "tests/ui/mir/validate/call-move-arg.rs", reason: M4A_UI_ICE_TID },
];
SUITES.push(
  {
    name: "mirdump-minicore",
    milestone: "M4a",
    description:
      "MIR building (rustc-dev probe tools/probes/mirdump: the tydump prefix, the MIR_borrow_checking loop without borrowck/drop elaboration, then mir_built and mir_promoted (+ promoteds) of every mir_keys item via MirWriter::write_mir_fn) on the tydump-minicore cases",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    probes: ["mirdump"],
    cases: () => minicoreCorpus().cases,
    skipped: () => minicoreCorpus().skipped,
    oracle: ([c]) => [probePath("mirdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/mirdump.ts"), ...c!.args],
  },
  {
    name: "mirdump-ui",
    milestone: "M4a",
    description:
      "tools/probes/mirdump (as mirdump-minicore) on tests/ui/{borrowck,nll,mir,mir-dataflow,liveness,unsafe,pattern/usefulness}, with compiletest's UI-test argv as tydump-ui (human diagnostics, -Znext-solver=coherence, revisions, aux crates built by the oracle as rmeta)",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: M3_UI_ORACLE_TIMEOUT_MS,
    probes: ["mirdump"],
    cases: () => m3UiCorpus(M4A_UI_DIRS, false).cases,
    skipped: () => m3UiCorpus(M4A_UI_DIRS, false).skipped,
    oracle: ([c]) => [probePath("mirdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/mirdump.ts"), ...c!.args],
    subsets: Object.fromEntries(M4A_UI_DIRS.map((d) => [d.slice("tests/ui/".length), inDirs([d])])),
    blessed: (c) => uiBlessed(c.id, c.args),
    unstable: () => M4A_UI_UNSTABLE,
  },
);

// M4b (plan-m4 D2, D14, §4; lane harness-w23): the real `analysis` through the rustc-dev probe tools/probes/ckdump:
// rustc's own `compiler_entrypoint` with `TimePassesCallbacks::config`'s `trimmed_def_paths` and an `after_analysis`
// that returns `Compilation::Stop`, so everything up to the end of `analysis` runs as in rustc (check_crate with CTFE,
// MIR_borrow_checking with mir_borrowck and, for build/run tests or const contexts, drop elaboration, layout/abi tests,
// the error abort, misc_checking_3) and nothing after it (no metadata encoding, codegen or link; the probe's header has
// the list). stdout is empty, stderr is every analysis diagnostic. Subject: src/rust_ts/ckdump.ts, main.ts with the
// same stop. Cases, argv, env, aux crates, directives and skips exactly as tydump-ui (`m3UiCorpus`, without the
// rustc_dump tests), so compiletest's argv with `-Znext-solver=coherence` and revisions (D14; `-o` / `--out-dir` stay:
// nothing is written after the stop, and no test of these directories asks for `-Zunpretty`, `-Zdump-mir` or
// `--emit`). Timeouts as the M3 ui suites. Report only: `--report blessed`. Unprotected until root accepts a run.
// - `borrowck-ui`: tests/ui/borrowck + tests/ui/nll, the M4b gate population (§4: >= 85%); subsets per directory.
// - `borrowck-ui-report`: §4's report directories (ui/lifetimes, closures, moves, coroutine, async-await), kept out of
//   the gate suite so its population stays the gate's; report only, subsets per directory.
const M4B_UI_DIRS = ["tests/ui/borrowck", "tests/ui/nll"];
const M4B_REPORT_DIRS = ["tests/ui/lifetimes", "tests/ui/closures", "tests/ui/moves", "tests/ui/coroutine", "tests/ui/async-await"];
// Unstable cases (lane harness-w23): the oracle (the same probe binary, argv, env and cwd) was run twice on every case of
// both M4b suites, and all 2236 pairs of outputs were identical (none of these tests ICEs by design), so neither suite
// has an `unstable` list. difftest's pattern detection (scripts/lib/unstable.ts) still applies.
const m4bUiSuite = (name: string, dirs: string[], description: string): Suite => ({
  name,
  milestone: "M4b",
  description,
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: M3_UI_ORACLE_TIMEOUT_MS,
  probes: ["ckdump"],
  cases: () => m3UiCorpus(dirs, false).cases,
  skipped: () => m3UiCorpus(dirs, false).skipped,
  oracle: ([c]) => [probePath("ckdump"), ...c!.args],
  subject: ([c]) => [...bunCmd("src/rust_ts/ckdump.ts"), ...c!.args],
  subsets: Object.fromEntries(dirs.map((d) => [d.slice("tests/ui/".length), inDirs([d])])),
  blessed: (c) => uiBlessed(c.id, c.args),
});
SUITES.push(
  m4bUiSuite(
    "borrowck-ui",
    M4B_UI_DIRS,
    "the real `analysis` (rustc-dev probe tools/probes/ckdump: rustc's compiler_entrypoint stopped by after_analysis; stderr = every analysis diagnostic, incl. borrowck and late lints) on tests/ui/{borrowck,nll}, with compiletest's UI-test argv as tydump-ui (human diagnostics, -Znext-solver=coherence, revisions, aux crates built by the oracle as rmeta)",
  ),
  m4bUiSuite(
    "borrowck-ui-report",
    M4B_REPORT_DIRS,
    "borrowck-ui (probe ckdump) on plan-m4 §4's report directories tests/ui/{lifetimes,closures,moves,coroutine,async-await}; report only",
  ),
);

// M4c (plan-m4 §4, D13, D14; lane harness-w25): the real `-Zunpretty=mir` and `-Zunpretty=thir-tree`, rustc against
// src/rust_ts/main.ts through the CLI. Both modes `needs_analysis()` (rustc_session/src/config.rs:3334), so
// `pretty::print` (rustc_driver_impl/src/pretty.rs:232) runs the whole `analysis` first (with errors it prints nothing on
// stdout: only the diagnostics are compared), then `write_mir_pretty` (optimized MIR / `mir_for_ctfe` of every
// `mir_keys` item, promoteds, allocations with their global AllocIds, compared as printed: D13) or `thir_tree` of every
// body owner. The driver then runs `write_dep_info` and returns (lib.rs:281): no codegen, metadata or link.
// - D14: where a case uses compiletest's argv (the minicore corpus's UI tests, the thirdump-ui cases), the argv is kept
//   as the M3 ui suites have it (`-Znext-solver=coherence`, revisions, aux crates built by the oracle as rmeta, env),
//   except the harness's own `-o build/<target>/test/ui/<dir>/<stem>[.<rev>]/a` (run-* tests: compiletest's
//   `make_compile_args`), which is dropped (`dropHarnessOutFile`): with `-o`, `write_or_print` (pretty.rs:202) writes
//   the dump into that file instead of stdout. `--out-dir` stays (`write_dep_info` only creates the empty directory,
//   under `build/`, which the upstream-checkout check ignores). No case of these corpora passes its own `-o`,
//   `--emit=dep-info` or `-Zdump-mir` (checked when the case list is made: `assertNoOwnOutput`; 3 cases pass
//   `--emit=link` / `--emit=mir`, which the `-Zunpretty` path never produces), so nothing is written into the upstream
//   checkout. Own `-Zunpretty` flags: the thir-print tests (kept, see `thir-tree`) and 4 minicore tests
//   (tests/ui/hygiene/unpretty-debug*.rs, `-Zunpretty=expanded,hygiene`), where the appended `-Zunpretty=mir` comes last
//   and wins (options.rs `parse_unpretty` overwrites the slot), so their argv stays compiletest's and they are MIR cases
//   like the rest of the corpus.
// - Env NOCORE_ENV (+ the case's own), session variables pinned (`pinSessionEnv`), one process per case, subject 60 s,
//   oracle 300 s (+ the 4x retry), as the suites each corpus comes from.
// Suites:
// - `mir-minicore`: the tydump-minicore corpus (`minicoreCorpus`, same skips) + `-Zunpretty=mir`. Subset `cg_clif`:
//   mini_core.rs and mini_core_hello_world.rs, which the M4c gate names.
// - `mir-o0`: mir-minicore + `-Zmir-opt-level=0` (after the test's own flags, so it wins; report only, M4c-1).
// - `mir`: every tests/ui file with `stdArgs` (std injected, no compiletest flags) + `-Zunpretty=mir`, as hir-tree, plus
//   compiletest's `-Zwrite-long-types-to-disk=no`. Unlike hir-tree, this mode type-checks, and with the default (`yes`)
//   every type error naming a long type writes `<stem>.long-type-<hash>.txt` into the cwd, i.e. the upstream checkout
//   (measured: 242 files from 74 cases in two oracle passes), and its note names a hash of an interned type's address
//   (UNSTABLE). With `no`, rustc prints the full type instead, as in every compiletest-argv suite. Skips re-measured for
//   this mode (`MIR_SKIPPED`).
// - `thir-tree`: thirdump-ui's cases (`m3UiCorpus([...M3_UI_DIRS, "tests/ui/thir-print"])`: tests/ui/typeck,
//   tests/ui/traits, every `#[rustc_dump_*]` test and tests/ui/thir-print) + `-Zunpretty=thir-tree`, except that a case
//   whose own compile-flags already ask for `-Zunpretty` (the thir-print tests, 3 of them `thir-flat`) keeps its own
//   mode, so it is exactly compiletest's run of the test. Subsets and `--report blessed` as thirdump-ui (report only).
// Unprotected until root accepts a run.
/** Whether `args` asks for `-Zunpretty` (`-Zunpretty=x` or `-Z unpretty=x`). */
const hasUnpretty = (args: string[]): boolean => args.some((a, i) => /^-Zunpretty=/.test(a) || (args[i - 1] === "-Z" && a.startsWith("unpretty=")));
/**
 * `c` without the `-o <path>` harness/compiletest.ts adds for a run-* test (D14, see above). That `-o` is compiletest's,
 * pushed before `-Znext-solver=coherence` and only when the test's compile-flags have no `-o`; the cg_clif cases have
 * neither. Anything else is an `ERROR:`.
 */
function dropHarnessOutFile(c: Case): Case {
  const end = c.args.indexOf("-Znext-solver=coherence");
  const at = c.args.indexOf("-o");
  if (at < 0) return c;
  const out = c.args[at + 1] ?? "";
  if (end < 0 || at > end || !out.startsWith(`build/${COMPILETEST_TARGET}/test/ui/`) || !out.endsWith("/a")) {
    throw new Error(`ERROR: ${c.id}: unexpected \`-o ${out}\` in a real-CLI -Zunpretty case`);
  }
  return { ...c, args: [...c.args.slice(0, at), ...c.args.slice(at + 2)] };
}
/**
 * Throws (`ERROR:`) if a case could make rustc write a file other than compiletest's `--out-dir` (see above). On the
 * `-Zunpretty` path rustc writes only the dump (stdout, or the `-o` file) and, in `write_dep_info`, the dep-info file
 * if `--emit` asks for `dep-info` (into the out dir, or an explicit `dep-info=<path>`); other `--emit` kinds (`link`,
 * `mir`, `metadata`) are never produced (lib.rs:281 returns before `emit_mir` / codegen). Flags that write files during
 * `analysis` (`-Zdump-mir`, `-Zself-profile`, ...) are rejected too.
 */
const WRITES_FILES = /^(?:dump-mir|self-profile|dump-dep-graph|temps-dir|dump-mono-stats|llvm-time-trace|metrics-dir|nll-facts|dump-proof-tree)/;
function assertNoOwnOutput(c: Case): void {
  const bad = c.args.find((a, i) => {
    const prev = c.args[i - 1];
    if (a.startsWith("-o")) return true;
    const emit = a.startsWith("--emit=") ? a.slice("--emit=".length) : prev === "--emit" ? a : undefined;
    if (emit !== undefined && (emit.includes("dep-info") || emit.includes("="))) return true;
    return (a.startsWith("-Z") && WRITES_FILES.test(a.slice(2).trimStart())) || (prev === "-Z" && WRITES_FILES.test(a));
  });
  if (bad !== undefined) throw new Error(`ERROR: ${c.id}: argv has \`${bad}\`, which would write outside stdout/--out-dir in a real-CLI -Zunpretty case`);
}
const mirMinicoreCases = (extra: string[]): Case[] =>
  minicoreCorpus().cases.map((c0) => {
    const c = dropHarnessOutFile(c0);
    // The 4 tests/ui/hygiene/unpretty-debug*.rs cases pass their own `-Zunpretty=expanded,hygiene`; ours comes after it
    // and wins (rustc_session options.rs `parse_unpretty` overwrites the slot), see above.
    assertNoOwnOutput(c);
    return { ...c, args: [...c.args, "-Zunpretty=mir", ...extra] };
  });
const MINICORE_CG_CLIF = (c: Case) => c.file.startsWith(`${CG_CLIF_EXAMPLE}/`);
// Skips of `mir`, re-measured on the oracle with this suite's argv (lane harness-w25; every case run, see
// docs/handoff/harness-w25.md): none. hir-tree's 4 skips (`HIR_TREE_SKIPPED`), and suggestions/fn-to-method-deeply-nested.rs
// (182 s for hir-tree), print no `{:#?}` tree here and finish in < 2 s (issue-93775.rs, expr-stack-overflow.rs and
// survive-peano-lesson-queue.rs print MIR; deep-try-chain-issue-153583.rs and fn-to-method-deeply-nested.rs exit 1 with
// diagnostics). The slowest case, tests/ui/closures/supertrait-hint-cycle.rs (E0275 overflow), takes ~120 s of CPU
// (90-100 s wall with 4 jobs; 323 s wall alone at load average 67; one pass at load average 125-144 hit 300 s): within the
// oracle's 300 s + 4 x 300 s, cached once per oracle build, so it stays (as fn-to-method-deeply-nested.rs in hir-tree).
// Every other case took < 6 s wall at load average ~10 (< 15 s at ~100).
const MIR_SKIPPED: SkippedCase[] = [];
// Unstable cases of `mir` (lane harness-w25): the oracle was run twice on every case (and these a third and fourth time);
// these 14 differed, each only in `thread 'rustc' (<tid>) panicked`: rustc ICEs on them with this argv (no compiletest
// flags: broken-MIR validation in the simd and mir/validate tests, elaborate_box_derefs, CTFE of `do_not_const_check`, a
// typeck `bug!` in move-expr/name-resolution.rs, track-diagnostics' deliberate ICE), and the panic message names the OS
// thread id. difftest's pattern detection
// (scripts/lib/unstable.ts) finds all 14 too; the list documents them. Every other case's outputs were identical.
const MIR_ICE_TID = "the oracle ICEs with this argv; the panic message names its OS thread id (`thread 'rustc' (<tid>) panicked`)";
const MIR_UNSTABLE: UnstableCase[] = [
  "tests/ui/borrowck/borrowck-describe-field-generic-param-owned-box.rs",
  "tests/ui/consts/const-eval/do_not_const_check.rs",
  "tests/ui/mir/validate/noncleanup-cleanup.rs",
  "tests/ui/mir/validate/noncleanup-resume.rs",
  "tests/ui/mir/validate/noncleanup-terminate.rs",
  "tests/ui/move-expr/name-resolution.rs",
  "tests/ui/simd/intrinsic/generic-arithmetic-saturating-2.rs",
  "tests/ui/simd/intrinsic/generic-gather-scatter.rs",
  "tests/ui/simd/intrinsic/generic-select.rs",
  "tests/ui/simd/intrinsic/generic-shuffle.rs",
  "tests/ui/simd/intrinsic/inlining-issue67557-ice.rs",
  "tests/ui/simd/masked-load-store-build-fail.rs",
  "tests/ui/simd/shuffle.rs",
  "tests/ui/track-diagnostics/track.rs",
].map((id) => ({ id, reason: MIR_ICE_TID }));
const mirCorpus = (): string[] => {
  const skip = new Set(MIR_SKIPPED.map((k) => k.id));
  return corpus("tests/ui").filter((f) => !skip.has(f));
};
const M4C_THIR_DIRS = [...M3_UI_DIRS, "tests/ui/thir-print"];
// Unstable cases of `thir-tree` (lane harness-w25): the oracle was run twice on every case; these 9 differed. 8 are
// thirdump-ui's (`M3_UI_UNSTABLE`): the two `-Zwrite-long-types-to-disk=yes` tests and six `#old` revisions that ICE
// (thread id); the ninth, trait-bound-holds-for-ty-error-140303.rs#old, ICEs only on this path (the probe stops before).
// Every other case's two outputs were identical. difftest's pattern detection finds all 9 too.
const THIR_TREE_ICE_TID = "the oracle ICEs; the panic message names its OS thread id (`thread 'rustc' (<tid>) panicked`)";
const THIR_TREE_UNSTABLE: UnstableCase[] = [
  ...M3_UI_UNSTABLE.map((k) => (k.reason === M3_UI_LONG_TYPE ? k : { id: k.id, reason: THIR_TREE_ICE_TID })),
  { id: "tests/ui/traits/error-reporting/trait-bound-holds-for-ty-error-140303.rs#old", reason: THIR_TREE_ICE_TID },
].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
let thirTreeMemo: Case[] | undefined;
function thirTreeCases(): Case[] {
  return (thirTreeMemo ??= m3UiCorpus(M4C_THIR_DIRS).cases.map((c0) => {
    const c = dropHarnessOutFile(c0);
    const own = hasUnpretty(c.args);
    if (own && !c.file.startsWith("tests/ui/thir-print/")) throw new Error(`ERROR: ${c.id}: own -Zunpretty outside tests/ui/thir-print`);
    assertNoOwnOutput(c);
    return own ? c : { ...c, args: [...c.args, "-Zunpretty=thir-tree"] };
  }));
}
SUITES.push(
  {
    name: "mir-minicore",
    milestone: "M4c",
    description:
      "rustc -Zunpretty=mir (the whole analysis, then optimized MIR / mir_for_ctfe + promoteds of every mir_keys item, allocations with their AllocIds) on the tydump-minicore cases, argv as tydump-minicore minus compiletest's `-o` (D14)",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    cases: () => mirMinicoreCases([]),
    skipped: () => minicoreCorpus().skipped,
    oracle: ([c]) => oracleRustcCmd(c!.args),
    subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
    subsets: { cg_clif: MINICORE_CG_CLIF },
  },
  {
    name: "mir-o0",
    milestone: "M4c",
    description: "mir-minicore with -Zmir-opt-level=0 (no level-1 MIR passes; UB checks stay on); report only",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    cases: () => mirMinicoreCases(["-Zmir-opt-level=0"]),
    skipped: () => minicoreCorpus().skipped,
    oracle: ([c]) => oracleRustcCmd(c!.args),
    subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
    subsets: { cg_clif: MINICORE_CG_CLIF },
  },
  {
    name: "mir",
    milestone: "M4c",
    description:
      "rustc -Zunpretty=mir (as mir-minicore) on every .rs in tests/ui with std injected, args as hir-tree (--target x86_64-unknown-linux-gnu --sysroot <oracle sysroot>, edition from directives) plus -Zwrite-long-types-to-disk=no",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: 300_000,
    cases: () => mirCorpus().map((f) => pinSessionEnv({ id: f, file: f, args: [...stdArgs(f), "-Zwrite-long-types-to-disk=no", "-Zunpretty=mir", f], env: NOCORE_ENV })),
    skipped: () => MIR_SKIPPED,
    unstable: () => MIR_UNSTABLE,
    oracle: ([c]) => oracleRustcCmd(c!.args),
    subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
  },
  {
    name: "thir-tree",
    milestone: "M4c",
    description:
      "rustc -Zunpretty=thir-tree (the whole analysis, then the THIR tree of every body owner) on the thirdump-ui cases (tests/ui/typeck, tests/ui/traits, #[rustc_dump_*] tests, tests/ui/thir-print with their own -Zunpretty) with compiletest's UI-test argv minus its `-o` (D14); report only",
    mode: "single",
    timeoutMs: 60_000,
    oracleTimeoutMs: M3_UI_ORACLE_TIMEOUT_MS,
    cases: thirTreeCases,
    skipped: () => m3UiCorpus(M4C_THIR_DIRS).skipped,
    oracle: ([c]) => oracleRustcCmd(c!.args),
    subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
    subsets: { "typeck+traits": inDirs(M3_UI_DIRS), rustc_dump: (c) => uiDumpTests().has(c.file), "thir-print": inDirs(["tests/ui/thir-print"]) },
    blessed: (c) => uiBlessed(c.id, c.args),
    unstable: () => THIR_TREE_UNSTABLE,
  },
);

export function suite(name: string): Suite {
  const s = SUITES.find((s) => s.name === name);
  if (!s) throw new Error(`unknown suite '${name}' (have: ${SUITES.map((s) => s.name).join(", ")})`);
  return s;
}

export function fileSize(file: string): number {
  return statSync(join(UPSTREAM, file)).size;
}
