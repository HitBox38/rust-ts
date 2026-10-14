// Oracle tests of lane lower-lib-a (rustc_ast_lowering lib.rs:1..1756).
//
// The subject (lib_oracle/run.ts) runs the ported driver to the end of name resolution, then the ported `index_ast`
// query (lib.rs:587, with its `Indexer` `MutVisitor`), and prints the HIR owners it indexes. For the fns named in
// `LOWER_TYS` it also builds a `LoweringContext` (lib.rs:350) for the fn's owner and lowers the parameter and return
// types with `lower_ty` (lib.rs:1534), starting the `ItemLocalId` counter at the oracle's id of the first one, and
// prints each `hir::Ty` with `{:#?}`.
//
// Checks against the pinned rustc's `-Zunpretty=hir-tree` (fixture `lib_oracle/<case>.hir-tree.stdout`):
// - the indexed owners are exactly the oracle's owners (the case creates no owners during lowering), and each
//   `AstOwner` variant matches the owner's HIR node kind;
// - every lowered `Ty` prints exactly as the oracle's `Ty` node at that place (ids, spans, kinds, nesting order).
//
// `REGEN=1 bun test src/rustc_ast_lowering/lib.oracle.test.ts` rewrites the fixture (needs the pinned toolchain; with
// it present the fixture is re-checked on every run).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "lib_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASE = "items";
const LOWER_TYS = "f=14,ext=1";

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

const args = (sysroot: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--crate-type",
  "lib",
  "--edition=2021",
  `${CASE}.rs`,
];

function run(cmd: string[], env: Record<string, string | undefined> = ENV): { exit: number; stdout: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString() };
}

const fixture_path = join(DIR, `${CASE}.hir-tree.stdout`);

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  const r = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir-tree", ...args(s)]);
  if (r.exit !== 0) throw new Error(`ERROR: oracle exit ${r.exit} on ${CASE}.rs`);
  writeFileSync(fixture_path, r.stdout);
}

test("lib_oracle fixture is the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  const r = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir-tree", ...args(s)]);
  expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: readFileSync(fixture_path, "utf8") });
}, 120_000);

/** `{owner:?} => {HIR node kind of the owner}` from the oracle's hir-tree, in its order. */
function oracle_owners(tree: string): Map<string, string> {
  const owners = new Map<string, string>();
  const lines = tree.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(DefId\(.*\)) => OwnerNodes \{$/.exec(lines[i]!);
    if (m === null) continue;
    // The owner's node 0: `    node: ParentedNode {` / `        parent: ..,` / `        node: <Kind>(`.
    let kind: string | undefined;
    for (let j = i + 1; j < lines.length && kind === undefined; j++) {
      const k = /^ {8}node: (\w+)\($/.exec(lines[j]!);
      if (k !== null) kind = k[1];
    }
    owners.set(m[1]!, kind ?? "?");
  }
  return owners;
}

const strip = (s: string): string[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

test("index_ast indexes exactly the oracle's HIR owners, and lower_ty lowers types as the oracle does", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const r = run(["bun", join(DIR, "run.ts"), ...args(s)], { ...ENV, LOWER_TYS });
  expect(r.exit).toBe(0);
  const [index_part, ...ty_parts] = r.stdout.split(/^--- /m);

  // Owners.
  const tree = readFileSync(fixture_path, "utf8");
  const expected = oracle_owners(tree);
  expect(expected.size).toBe(27);
  const got = new Map<string, string>();
  for (const line of strip(index_part!)) {
    const m = /^(DefId\(.*\)) => (\w+)$/.exec(line);
    expect(m).not.toBeNull();
    got.set(m![1]!, m![2]!);
  }
  expect([...got.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [owner, kind] of got) expect({ owner, kind }).toEqual({ owner, kind: expected.get(owner)! });

  // Lowered types: each `Ty` block is a contiguous run of the oracle's lines (indentation aside).
  const oracle_lines = strip(tree).join("\n");
  expect(ty_parts.map((p) => p.split("\n")[0])).toEqual(["f", "ext"]);
  let blocks = 0;
  for (const part of ty_parts) {
    const body = part.split("\n").slice(1).join("\n");
    for (const block of body.split(/^(?=Ty \{$)/m)) {
      if (block.trim() === "") continue;
      blocks++;
      // `{:#?}` at top level ends with `}`; nested in the oracle it is `},`.
      const lines = strip(block);
      const needle = [...lines.slice(0, -1), "},"].join("\n");
      expect({ block: lines[1], found: oracle_lines.includes(needle) }).toEqual({ block: lines[1], found: true });
    }
  }
  expect(blocks).toBe(4);
}, 120_000);
