// Differential test suites. Each case runs on the oracle and on rust-ts with the same
// inputs; outputs (stdout, stderr, exit code) must be byte-identical.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../scripts/lib/common.ts";
import { oracleRustcCmd } from "../scripts/lib/oracle.ts";
import { probePath } from "../scripts/probes.ts";

export interface Case {
  /** Stable id; the protected set (harness/baseline) is a list of these. */
  id: string;
  /** Input file, relative to the upstream checkout (the cwd of every command). */
  file: string;
  args: string[];
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
    cases: () =>
      corpus("tests/ui").map((f) => {
        const ed = edition(f);
        return { id: f, file: f, args: [`--edition=${ed}`, "-Zunpretty=ast-tree", f] };
      }),
    oracle: ([c]) => oracleRustcCmd(c!.args),
    subject: ([c]) => [...bunCmd("src/rust_ts/main.ts"), ...c!.args],
  },
];

export function suite(name: string): Suite {
  const s = SUITES.find((s) => s.name === name);
  if (!s) throw new Error(`unknown suite '${name}' (have: ${SUITES.map((s) => s.name).join(", ")})`);
  return s;
}

export function fileSize(file: string): number {
  return statSync(join(UPSTREAM, file)).size;
}
