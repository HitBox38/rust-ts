// MIR aliasing check (lane fix-ubchecks-alias): no MIR node (`Place`, `SourceInfo`, `Operand`, statement, terminator,
// local decl, constant operand, ...) may be reachable from two positions of a body, because MIR passes edit them in
// place (alias_check_oracle/alias_check.ts header). mt-opt1 found `CheckAlignment` / `CheckNull` storing one `Place` both as
// an assignment target and in later operands: once `SimplifyLocals` ran, the shared place was renamed twice (wrong MIR,
// or an ICE in simplify.ts `visit_local`) in every debug-build fn with an instrumented pointer dereference.
//
// 1. `find_shared_objects` on hand-built object graphs.
// 2. alias_check_oracle/run.ts compiles fixtures with the real driver (UB checks on: no `-O`), asks for every body's
//    `optimized_mir`, and checks each body at every point where `-Zdump-mir=all` would dump it (before / after every
//    pass of `mir_built`, `mir_promoted`, the analysis cleanup, runtime lowering and optimization lists, as far as each
//    body gets; then the completed bodies together). Fixtures: alias_check_oracle/ubchecks.rs (pointer dereferences for
//    CheckAlignment / CheckNull, enum transmutes for CheckEnums, promoteds, ADT constructor shims) and the existing
//    oracle fixtures elaborate_drops_oracle/drops.rs, known_panics_lint_oracle/cases/ub_checks.rs and
//    validate_oracle/ctors.rs. `STOP` lines (bodies that reach unported code) are allowed; `ALIAS` lines are not.
// Skips (visibly) if the pinned rustc's sysroot is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";
import { find_shared_mir_nodes, find_shared_objects } from "./alias_check_oracle/alias_check.ts";

describe("find_shared_objects", () => {
  class Place {
    constructor(
      public local: number,
      public projection: readonly unknown[],
    ) {}
  }
  class SourceInfo {
    constructor(
      public span: number,
      public scope: number,
    ) {}
  }
  const EMPTY = Object.freeze([]);

  test("reports a Place stored as an assignment target and in a later operand", () => {
    const p = new Place(3, EMPTY);
    const body = {
      statements: [
        { source_info: new SourceInfo(0, 0), kind: { $: "Assign", _0: [p, { $: "Use", _0: { $: "Copy", _0: new Place(1, EMPTY) } }] } },
        { source_info: new SourceInfo(0, 0), kind: { $: "Assign", _0: [new Place(4, EMPTY), { $: "Use", _0: { $: "Copy", _0: p } }] } },
      ],
    };
    const shared = find_shared_objects(body);
    expect(shared).toEqual([
      { what: "Place", first: "body.statements[0].kind._0[0]", second: "body.statements[1].kind._0[1]._0._0" },
    ]);
    expect(find_shared_mir_nodes(body).length).toBe(1);
  });

  test("reports a shared SourceInfo and a shared Operand; ignores frozen (interned) objects and copies", () => {
    const si = new SourceInfo(7, 0);
    const op = { $: "Copy", _0: new Place(2, EMPTY) };
    const body = {
      statements: [
        { source_info: si, ty: EMPTY, kind: { $: "Nop" } },
        { source_info: si, ty: EMPTY, kind: { $: "Nop" } },
      ],
      terminator: { source_info: new SourceInfo(7, 0), args: [op, op] },
    };
    const what = find_shared_objects(body).map((s) => s.what);
    expect(what).toEqual(["SourceInfo", "Operand::Copy"]);
  });

  test("immutable payloads are reported by find_shared_objects but are not MIR nodes", () => {
    const tail = { tail_result_is_ignored: false, span: 0 };
    const body = { local_decls: [{ local_info: { $: "BlockTailTemp", _0: tail } }, { local_info: { $: "BlockTailTemp", _0: tail } }] };
    expect(find_shared_objects(body).length).toBe(1);
    expect(find_shared_mir_nodes(body)).toEqual([]);
  });
});

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function sysrootOrUndefined(): string | undefined {
  try {
    if (!Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`)) return undefined;
    return Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
  } catch {
    return undefined;
  }
}
const SYSROOT = sysrootOrUndefined();
const SKIP = SYSROOT === undefined && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "mir-alias-check", process.env.RUST_TS_AGENT ?? "default");
const RUNNER = join(REPO, "src/rustc_mir_transform/alias_check_oracle/run.ts");
const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}

const FIXTURES: [string, string][] = [
  ["alias_check_oracle/ubchecks.rs", "2024"],
  ["elaborate_drops_oracle/drops.rs", "2021"],
  ["known_panics_lint_oracle/cases/ub_checks.rs", "2021"],
  ["validate_oracle/ctors.rs", "2021"],
];

describe("no MIR node is shared within or between bodies (UB checks on)", () => {
  for (const [fixture, edition] of FIXTURES) {
    test.skipIf(SKIP)(
      fixture,
      () => {
        mkdirSync(WORK, { recursive: true });
        const r = Bun.spawnSync(
          [
            process.execPath,
            RUNNER,
            "--sysroot",
            SYSROOT!,
            `--edition=${edition}`,
            "--crate-type=lib",
            "--target",
            "x86_64-unknown-linux-gnu",
            join(REPO, "src/rustc_mir_transform", fixture),
          ],
          { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" },
        );
        const stdout = r.stdout.toString();
        expect(r.stderr.toString()).not.toContain("rust-ts: ");
        expect(r.exitCode).toBe(0);
        expect(stdout.split("\n").filter((l) => l.startsWith("ALIAS "))).toEqual([]);
        const checked = stdout.split("\n").find((l) => l.startsWith("CHECKED "));
        expect(checked).toBeDefined();
        const [, dumps, ...passes] = checked!.split(" ");
        expect(Number(dumps)).toBeGreaterThan(100);
        // The bodies got as far as the UB-check passes and the first optimization passes.
        for (const p of ["PromoteTemps", "ElaborateDrops", "CheckAlignment", "CheckNull", "CheckEnums", "InstSimplify-before-inline"]) {
          expect(passes).toContain(p);
        }
      },
      120_000,
    );
  }
});
