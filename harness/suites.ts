// Differential test suites. Each case runs on the oracle and on rust-ts with the same
// inputs; outputs (stdout, stderr, exit code) must be byte-identical.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../scripts/lib/common.ts";
import { oracleRustcCmd, oracleSysroot } from "../scripts/lib/oracle.ts";
import { probePath } from "../scripts/probes.ts";
import { COMPILETEST_TARGET, uiCases, type ErrorFormat } from "./compiletest.ts";

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
const nocoreArgs = (f: string): string[] => [
  "--target",
  COMPILETEST_TARGET,
  "--sysroot",
  oracleSysroot(),
  `--edition=${edition(f)}`,
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
];
const nocoreSuite = (name: string, unpretty: string, description: string): Suite => ({
  name,
  milestone: "M2",
  description,
  mode: "single",
  timeoutMs: 60_000,
  oracleTimeoutMs: 300_000,
  cases: () => corpus("tests/ui").map((f) => ({ id: f, file: f, args: [...nocoreArgs(f), `-Zunpretty=${unpretty}`, f], env: NOCORE_ENV })),
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
    cases: () => corpus("tests/ui").map((f) => ({ id: f, file: f, args: [...nocoreArgs(f), f], env: NOCORE_ENV })),
    oracle: ([c]) => [probePath("resdump"), ...c!.args],
    subject: ([c]) => [...bunCmd("src/rust_ts/resdump.ts"), ...c!.args],
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
