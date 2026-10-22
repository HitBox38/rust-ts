// Oracle scenarios for check_match.rs (lane mb-check-match) against the pinned nightly rustc.
//
// Subject: check_match_oracle/run.ts (the ported driver up to the global ctxt, then the `check_match` query on every
// free `fn`; one stdout line per fn). Oracle: `rustc <file> --crate-type lib --edition 2024 --emit=metadata` (stderr).
// Both sides compile the same `#![no_core]` file (lang items `pointee_sized`, `meta_sized`, `sized`, `copy`).
//
// rustc_pattern_analysis is not ported (lanes pat-a/b/c), so every pattern stops at `RustcPatCtxt::lower_pat`: the
// reachable diagnostics are those `lower_pattern` emits before it (`check_borrow_conflicts_in_at_patterns`: E0499 /
// E0502 / E0505 / E0382; `check_for_bindings_named_same_as_variants`: the E0170 lint). E0004 / E0005 (non-exhaustive /
// refutable patterns) need `analyze_match`; add them here when pat-c lands. Checks per case: the subject's stdout is
// the expected list, and every diagnostic block of the subject's stderr occurs, in order, in the oracle's stderr (the
// oracle goes on to MIR building and borrowck, which may add more).
//
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";

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

const WORK = test_scratch_dir("check-match-oracle");
const RUNNER = join(REPO, "src/rustc_mir_build/thir/pattern/check_match_oracle/run.ts");
const ARGS = ["--crate-type", "lib", "--edition", "2024"];

const PRELUDE = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  "pub enum Opt<T> { Nothing, Just(T) }",
  "pub struct NC;",
].join("\n");

const STOP = "UNPORTED rustc_pattern_analysis::rustc::RustcPatCtxt::lower_pat (pending pat-c)";

interface Case {
  name: string;
  body: string;
  /** The subject's stdout lines. */
  stdout: string[];
  /** The subject must print at least one diagnostic. */
  diags: boolean;
}

const CASES: Case[] = [
  {
    name: "no-patterns",
    body: "pub fn f() { g(); if true { g() } else { g() } loop { break; } }\nfn g() {}\npub fn h() -> u8 { 1 }",
    stdout: ["check_match(f) = Ok", "check_match(g) = Ok", "check_match(h) = Ok"],
    diags: false,
  },
  {
    name: "param",
    body: "pub fn f(x: u8) -> u8 { x }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: false,
  },
  {
    name: "multiple-mut-borrows",
    body: "pub fn f(o: Opt<u8>) { match o { ref mut a @ Opt::Just(ref mut b) => {} _ => {} } }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
  {
    name: "already-mut-borrowed",
    body: "pub fn f(o: Opt<u8>) { match o { ref mut a @ Opt::Just(ref b) => {} _ => {} } }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
  {
    name: "already-borrowed",
    body: "pub fn f(o: Opt<u8>) { match o { ref a @ Opt::Just(ref mut b) => {} _ => {} } }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
  {
    name: "moved-while-borrowed",
    body: "pub fn f(o: Opt<NC>) { match o { ref a @ Opt::Just(b) => {} _ => {} } }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
  {
    name: "borrow-of-moved-value",
    body: "pub fn f(o: Opt<NC>) { match o { a @ Opt::Just(ref b) => {} _ => {} } }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
  {
    name: "let-borrow-conflict",
    body: "pub fn f(o: Opt<u8>) { let ref mut a @ Opt::Just(ref mut b) = o else { return }; }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
  {
    name: "bindings-with-variant-name",
    body: "pub fn f(o: Opt<u8>) { match o { Nothing => {} } }",
    stdout: [`check_match(f) = ${STOP}`],
    diags: true,
  },
];

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

/** The diagnostic blocks of a stderr text, without the trailing summary (`aborting due to`, `--explain`). */
function blocks(stderr: string): string[] {
  return stderr
    .split(/\n\n+/)
    .map((b) => b.trimEnd())
    .filter((b) => b !== "" && !b.startsWith("error: aborting due to") && !b.startsWith("For more information about"));
}

for (const c of CASES) {
  test.skipIf(SKIP)(`check_match oracle: ${c.name}`, async () => {
    const file = `${c.name}.rs`;
    writeFileSync(join(WORK, file), `${PRELUDE}\n${c.body}\n`);
    const [oracle, subject] = await Promise.all([
      run([...RUSTC, file, ...ARGS, "--emit=metadata", "-o", "/dev/null"], WORK),
      run([process.execPath, RUNNER, file, ...ARGS], WORK),
    ]);
    expect(subject.stdout.split("\n").filter((l) => l !== "")).toEqual(c.stdout);
    const ours = blocks(subject.stderr);
    if (c.diags) expect(ours.length).toBeGreaterThan(0);
    else expect(ours).toEqual([]);
    const theirs = blocks(oracle.stderr);
    let j = 0;
    for (const b of ours) {
      while (j < theirs.length && theirs[j] !== b) j++;
      if (j === theirs.length) {
        expect({ block: b, oracle: theirs }).toEqual({ block: b, oracle: ["<the block, in order>"] });
      }
      j++;
    }
  });
}
