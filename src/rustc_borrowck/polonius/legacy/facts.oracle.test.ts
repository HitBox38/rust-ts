// Oracle tests for the legacy Polonius fact generation (polonius/legacy/*: `emit_facts`, the loan kills / invalidations /
// accesses generators, `emit_drop_facts`, the typeck `loan_issued_at` facts) and `PoloniusFactsExt::write_to_dir`
// (lane bck-polonius-legacy): `-Znll-facts` writes one `<fact>.facts` file per `AllFacts` field into
// `<nll-facts-dir>/<def path>/` for every borrow-checked body. The oracle is the `ckdump` rustc-dev probe (rustc's
// `analysis`, as the borrowck-ui suite runs it), the subject src/rust_ts/ckdump.ts with the same argv. Every facts file
// must be byte-identical, and so must stderr (with the scratch directory removed) and the exit code: with
// `-Zpolonius=legacy` the borrowck errors come from `Output::compute` (vendor polonius-engine).
// Without the probe the tests are a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DATA, REPO } from "../../../../scripts/lib/common.ts";
import { oracleSysroot } from "../../../../scripts/lib/oracle.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "ckdump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: ckdump probe not built (bun scripts/probes.ts build ckdump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = test_scratch_dir("bck-polonius-legacy-facts");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "POLONIUS_ALGORITHM"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
  facts: Map<string, string>;
}

function read_tree(dir: string, out: Map<string, string>, root = dir): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) read_tree(p, out, root);
    else out.set(relative(root, p), readFileSync(p, "utf8"));
  }
}

async function run(cmd: string[], dir: string, src: string, args: string[]): Promise<Out> {
  mkdirSync(dir, { recursive: true });
  const facts = join(dir, "facts");
  const p = Bun.spawn(
    [...cmd, src, "--sysroot", oracleSysroot(), "--target=x86_64-unknown-linux-gnu", "--emit", "metadata", "--edition=2021", "--out-dir", join(dir, "out"), "-Znll-facts", `-Znll-facts-dir=${facts}`, ...args],
    { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  const out = new Map<string, string>();
  read_tree(facts, out);
  return { stderr: stderr.replaceAll(`${dir}/`, ""), code, facts: out };
}

const LIB = `pub struct S { a: Vec<u8>, b: String }
impl Drop for S { fn drop(&mut self) {} }

pub fn borrow_mut(v: &mut Vec<u32>, x: u32) -> &u32 {
    v.push(x);
    let r = &v[0];
    r
}

pub fn moves(s: S) -> usize {
    let t = s;
    let n = t.a.len();
    drop(t);
    n
}

pub fn loopy<'a>(mut xs: &'a mut [u32], k: u32) -> Option<&'a mut u32> {
    loop {
        match xs.split_first_mut() {
            Some((h, rest)) => {
                if *h == k { return Some(h); }
                xs = rest;
            }
            None => return None,
        }
    }
}

pub fn outlives<'a, 'b: 'a>(x: &'a u8, y: &'b u8) -> &'a u8 { if *x > 0 { x } else { y } }

pub fn closure(v: &mut Vec<i32>) -> i32 {
    let mut c = |a: i32| { v.push(a); a + 1 };
    let r = c(1) + c(2);
    let p: *const Vec<i32> = v;
    let _ = p;
    r
}

pub fn twophase(v: &mut Vec<usize>) { v.push(v.len()); }

pub fn partial(mut s: (String, String)) -> String {
    let a = s.0;
    s.0 = String::new();
    a + &s.1
}

pub fn idx(v: &mut [u8], i: usize) -> u8 { v[i] += 1; v[i] }

pub fn shallow(o: &mut Option<String>) -> usize { match o { Some(s) if s.len() > 2 => s.len(), _ => 0 } }
`;

const CONFLICT = `fn main() {
    let mut x = 22;
    let y = &mut x;
    let z = &x;
    *y += 1;
    println!("{}", z);
}
`;

const CASES: { name: string; src: string; args: string[] }[] = [
  // `-Znll-facts` alone: NLL borrowck, facts dumped
  { name: "lib_nll", src: LIB, args: ["--crate-type", "lib"] },
  // the same with the legacy Polonius analysis (`Output::compute`, Hybrid)
  { name: "lib_legacy", src: LIB, args: ["--crate-type", "lib", "-Zpolonius=legacy"] },
  // a borrowck error found by legacy Polonius (`errors_at`)
  { name: "conflict_legacy", src: CONFLICT, args: ["-Zpolonius=legacy"] },
];

for (const c of CASES) {
  test.skipIf(SKIP)(`-Znll-facts: ${c.name}`, async () => {
    const src = join(WORK, `${c.name}.rs`);
    writeFileSync(src, c.src);
    const oracle = await run([PROBE], join(WORK, `${c.name}-oracle`), src, c.args);
    const subject = await run(["bun", join(REPO, "src/rust_ts/ckdump.ts")], join(WORK, `${c.name}-subject`), src, c.args);
    expect(oracle.facts.size).toBeGreaterThan(0);
    expect([...subject.facts.keys()]).toEqual([...oracle.facts.keys()]);
    for (const [k, v] of oracle.facts) expect(`${k}:\n${subject.facts.get(k)}`).toBe(`${k}:\n${v}`);
    expect(subject.stderr).toBe(oracle.stderr);
    expect(subject.code).toBe(oracle.code);
  }, 120_000);
}
