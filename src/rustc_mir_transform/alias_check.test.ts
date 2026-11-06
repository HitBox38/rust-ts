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
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";
import { Interned } from "../rustc_data_structures/intern.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { find_shared_mir_nodes, find_shared_objects, is_immutable_hit } from "./alias_check_oracle/alias_check.ts";
import { classify_run } from "./alias_check_oracle/sweep_outcome.ts";

describe("sweep.ts's outcomes (docs/reviews/mir-alias.md F4)", () => {
  const side = (code: number, err = "", out = "") => ({ out, err, code });
  // Both texts as printed for tests/ui/abi/sysv64-zst.rs on aarch64-apple-darwin, the oracle's with RUST_BACKTRACE=0.
  const ORACLE_ICE = "error[E0570]: x\n\nthread 'rustc' (30084032) panicked at /rustc-dev/6f5da406/compiler/rustc_ty_utils/src/abi.rs:556:31:\ncalled `Option::unwrap()` on a `None` value\nnote: run with\n";
  const PORT_ICE = "error[E0570]: x\nrust-ts: internal compiler error: called `Option::unwrap()` on a `None` value\n    at f (a.ts:1:1)\n";

  test("mono: CHECKED only on exit 0, whatever the driver's CHECKED line says", () => {
    expect(classify_run(true, false, undefined, side(0), undefined)).toBe("CHECKED");
    expect(classify_run(true, false, undefined, side(1), undefined)).toBe("FAILED");
    expect(classify_run(true, false, undefined, side(101), undefined)).toBe("ICE");
    expect(classify_run(true, false, undefined, side(70), undefined)).toBe("UNPORTED");
  });

  test("BOTH_ICE compares the messages", () => {
    expect(classify_run(false, false, side(101, ORACLE_ICE), side(101, PORT_ICE), undefined)).toBe("BOTH_ICE");
    expect(classify_run(false, false, side(101, ORACLE_ICE), side(101, "rust-ts: internal compiler error: another\n"), undefined)).toBe("DIFF");
    expect(classify_run(false, false, side(101, ORACLE_ICE), side(101, "no message\n"), undefined)).toBe("DIFF");
  });

  test("the rest keeps its meaning", () => {
    expect(classify_run(false, true, side(0), side(0), undefined)).toBe("TIMEOUT");
    expect(classify_run(false, false, side(0, "e", "o"), side(0, "e", "o"), undefined)).toBe("MATCH");
    expect(classify_run(false, false, side(0, "e", "o"), side(0, "e", "o"), "pass.mir: line 1")).toBe("DIFF");
    expect(classify_run(false, false, side(0), side(101, PORT_ICE), undefined)).toBe("ICE");
    expect(classify_run(false, false, side(0, "a"), side(0, "b"), undefined)).toBe("DIFF");
  });
});

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
    const info = () => ({ $: "Set", _0: { $: "BlockTailTemp", _0: tail } });
    const body = { local_decls: [{ local_info: info() }, { local_info: info() }] };
    expect(find_shared_objects(body).length).toBe(1);
    expect(find_shared_mir_nodes(body)).toEqual([]);
  });

  test("a type no one listed is reported: the default is mutable", () => {
    const targets = { $: "Cleanup", _0: 3 };
    const body = { a: { unwind: targets }, b: { unwind: targets } };
    expect(find_shared_mir_nodes(body).map((s) => s.what)).toEqual(["{$: Cleanup}"]);
    const list = [1, 2];
    expect(find_shared_mir_nodes({ a: list, b: list }).map((s) => s.what)).toEqual(["Array"]);
  });

  // docs/reviews/mir-alias.md F2: each of these was walked past and reported nothing.
  describe("a Place held twice is reported wherever it is held", () => {
    const p = () => new Place(3, EMPTY);
    const reported = (make: (p: Place) => object, what = "Place") => {
      const hits = find_shared_mir_nodes(make(p()));
      expect(hits.map((s) => s.what)).toEqual([what]);
      return hits[0]!;
    };
    test("a Map key", () => {
      expect(reported((p) => ({ a: p, m: new Map([[p, 1]]) })).second).toBe("body.m{key [object Object]}");
    });
    test("a Map value", () => {
      expect(reported((p) => ({ a: p, m: new Map([["k", p]]) })).second).toBe("body.m{k}");
    });
    test("a Set member", () => {
      expect(reported((p) => ({ a: p, s: new Set([p]) })).second).toBe("body.s{member 0}");
    });
    test("a frozen object's field, and a frozen array's element", () => {
      expect(reported((p) => ({ a: p, f: Object.freeze({ inner: p }) })).second).toBe("body.f.inner");
      expect(reported((p) => ({ a: p, f: Object.freeze([p]) })).second).toBe("body.f[0]");
    });
    test("one frozen wrapper in two places, with an unfrozen child", () => {
      const w = Object.freeze({ inner: new Place(3, EMPTY) });
      expect(find_shared_mir_nodes({ a: w, b: w }).map((s) => [s.what, s.first, s.second])).toEqual([["Place", "body.a.inner", "body.b.inner"]]);
      // The wrapper itself cannot be written, so a child with nothing to write reports nothing.
      const leaf = Object.freeze({ inner: 1 });
      expect(find_shared_mir_nodes({ a: leaf, b: leaf })).toEqual([]);
    });
    test("a field named cache on anything but BasicBlocks", () => {
      expect(reported((p) => ({ a: p, s: { cache: p } })).second).toBe("body.s.cache");
    });
    test("a symbol prop and a non-enumerable prop, on an object and on an array", () => {
      const sym = globalThis.Symbol("hidden");
      expect(reported((p) => ({ a: p, s: { [sym]: p } })).second).toBe("body.s[Symbol(hidden)]");
      expect(reported((p) => ({ a: p, s: Object.defineProperty({}, "h", { value: p }) })).second).toBe("body.s.h");
      expect(reported((p) => ({ a: p, s: Object.defineProperty([], "h", { value: p }) })).second).toBe("body.s.h");
    });
  });

  test("what stays out of the walk: BasicBlocks.cache, interned values and their lists, accessors", () => {
    class BasicBlocks {
      constructor(public cache: object) {}
    }
    const c = { predecessors: [] };
    expect(find_shared_objects({ a: new BasicBlocks(c), b: new BasicBlocks(c) })).toEqual([]);
    class Ty extends Interned {
      constructor(public kind_: object) {
        super();
        Object.freeze(this);
      }
    }
    const kind = { $: "Adt", _0: 1 };
    expect(find_shared_objects({ a: new Ty(kind), b: new Ty(kind) })).toEqual([]);
    const elem = { $: "Field", _0: 1 };
    const list = RawList.of_slice(undefined, [elem]);
    expect(find_shared_objects({ a: list, b: list })).toEqual([]);
    const p = new Place(3, EMPTY);
    expect(find_shared_objects({ a: p, get b() { return p; } })).toEqual([]);
  });

  test("unit variants have no field to write, so sharing one is not reported", () => {
    const unit = { $: "Continue" };
    expect(find_shared_objects({ a: unit, b: unit })).toEqual([]);
  });

  test("an immutable position needs both paths and the right type: `.msg._0` is also an Operand", () => {
    expect(is_immutable_hit("{$: Desugared}", "body.a.msg._0", "body.coroutine.coroutine_kind")).toBe(true);
    expect(is_immutable_hit("Operand::Copy", "body.a.msg._0", "body.b.msg._0")).toBe(false);
    expect(is_immutable_hit("{$: Int}", "body.a.const_._0._0", "body.b.const_._0._0")).toBe(true);
    expect(is_immutable_hit("{$: Int}", "body.a.const_._0._0", "body.b.kind._0")).toBe(false);
    // `ClearCrossCrate::Set` and the `LocalInfo` itself are written in place (patch.ts), only the payload is not.
    expect(is_immutable_hit("{$: Set}", "body.local_decls[1].local_info", "body.local_decls[2].local_info")).toBe(false);
    expect(is_immutable_hit("{$: User}", "body.local_decls[1].local_info._0", "body.local_decls[2].local_info._0")).toBe(false);
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

// Fixed bugs, through the real driver (driver.ts, hooks.ts). The whole sweep is sweep.ts; see docs/handoff/mir-alias.md.
function run_driver(args: string[], mono: boolean): { stdout: string; stderr: string; code: number; hits: string[]; checked: boolean } {
  mkdirSync(WORK, { recursive: true });
  const out = join(WORK, `driver-${process.pid}-${mono ? "mono" : "mir"}.jsonl`);
  rmSync(out, { force: true });
  const r = Bun.spawnSync([process.execPath, join(REPO, "src/rustc_mir_transform/alias_check_oracle/driver.ts"), ...args], {
    cwd: WORK,
    env: { ...ENV, RUST_TS_ALIAS_OUT: out, ...(mono ? { RUST_TS_ALIAS_MONO: "1" } : {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines = readFileSync(out, "utf8").split("\n").filter((l) => l !== "");
  rmSync(out, { force: true });
  return {
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    code: r.exitCode ?? -1,
    hits: lines.filter((l) => !l.startsWith('{"kind":"CHECKED"')),
    checked: lines.some((l) => l.startsWith('{"kind":"CHECKED"')),
  };
}
const fixture = (f: string): string => join(REPO, "src/rustc_mir_transform/alias_check_oracle", f);

describe("fixed aliasing bugs", () => {
  test.skipIf(SKIP)(
    "oracle_programs.rs at -O: the MIR and the dump after borrowck are byte-identical to the oracle",
    () => {
      mkdirSync(WORK, { recursive: true });
      const dirs = [join(WORK, `dump-oracle-${process.pid}`), join(WORK, `dump-port-${process.pid}`)] as const;
      const args = (dir: string): string[] => [
        fixture("oracle_programs.rs"),
        "--edition=2021",
        "--target=x86_64-unknown-linux-gnu",
        "--sysroot",
        SYSROOT!,
        "-Awarnings",
        "-Zwrite-long-types-to-disk=no",
        "-Zunpretty=mir",
        "-O",
        "-Zverbose-internals",
        "-Zdump-mir=f & CleanupPostBorrowck",
        `-Zdump-mir-dir=${dir}`,
      ];
      const oracle = Bun.spawnSync([...RUSTC, ...args(dirs[0])], { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
      const port = Bun.spawnSync([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args(dirs[1])], { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
      expect(oracle.exitCode).toBe(0);
      expect(port.stderr.toString()).toBe(oracle.stderr.toString());
      // The programs do reach both paths: `MatchBranchSimplification` merged an or-pattern's arm, `f` has annotations.
      expect(oracle.stdout.toString()).toContain("_10 = Eq(copy _1, ");
      expect(port.stdout.toString() === oracle.stdout.toString()).toBe(true);
      expect(port.exitCode).toBe(0);
      const file = "oracle_programs.f.2-1-002.CleanupPostBorrowck.before.mir";
      const dump = readFileSync(join(dirs[0], file), "utf8");
      expect(dump).toContain("inferred_ty: &'{erased} i32");
      expect(readFileSync(join(dirs[1], file), "utf8")).toBe(dump);
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    },
    120_000,
  );
  test.skipIf(SKIP)(
    "shims: FnPtr::addr and the AsyncDrop future's poll shim share nothing once the collector has built them",
    () => {
      const r = run_driver([fixture("shims.rs"), "--edition=2024", "--target=x86_64-unknown-linux-gnu", "--sysroot", SYSROOT!, "-Awarnings", "-Copt-level=3"], true);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(r.hits).toEqual([]);
      expect(r.checked).toBe(true);
    },
    120_000,
  );
});
