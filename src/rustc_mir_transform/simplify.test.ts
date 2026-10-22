// Tests of lane mt-skeleton: `SimplifyCfg` (simplify.rs) run through the pass manager (pass_manager.rs `run_passes`
// with its `-Zdump-mir` hooks) on hand-built bodies, against the oracle's dumps.
//
// Oracle: simplify_oracle/simple.rs is a tiny no_core crate; simplify_oracle/dump/ holds the pinned nightly's
//   rustc -Zdump-mir=SimplifyCfg-initial -Zdump-mir-dir=<dir> --emit=metadata simple.rs
// files (`REGEN=1 bun test <this file>` rewrites them). In `mir_built` the pass list is LintAndRemoveUninhabited, six
// `Lint(..)`s, `SimplifyCfg::Initial`, `Lint(SanityCheck)`: `SimplifyCfg-initial` is the eighth pass, so its dumps carry
// the pass count 007 (`simple.f.1-1-007.SimplifyCfg-initial.before.mir`).
//
// Each test builds the body `SimplifyCfg-initial` sees (the `before` dump), runs `run_passes` with seven no-op passes
// standing for the first seven of `mir_built` (the real ones are stubs of later lanes), `SimplifyCfg::Initial` and one
// no-op lint, and compares the files the pass manager wrote (names and text) with the oracle's, byte for byte. The
// `before` file checks the hand-built body; the `after` file checks `simplify_cfg` (goto chains, block merging, dead
// blocks, a cleanup block, a loop).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Load order: rustc_session first (its config.ts is not a fresh entry point), as the driver loads it.
import "../rustc_session/lib.ts";
import "../rustc_middle/lib.ts";
import "./lib.ts";
import { PIN } from "../../scripts/lib/common.ts";
import { Size, TargetDataLayout } from "../rustc_abi/lib.ts";
import type { DefKind } from "../rustc_hir/def.ts";
import { CrateNum, DefId, DefIndex, LOCAL_CRATE, type LocalDefId } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Limit } from "../rustc_structures/limit.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import * as tls from "../rustc_middle/ty/context/tls.ts";
import { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import {
  BasicBlock,
  BasicBlockData,
  BasicBlocks,
  Body,
  type Const,
  ConstOperand,
  Local,
  LocalDecl,
  MirPhase,
  MirSource,
  Place,
  type Rvalue,
  SourceInfo,
  SourceScope,
  SourceScopeData,
  type StatementKind,
  StmtDebugInfos,
  SwitchTargets,
  Terminator,
  type TerminatorKind,
  type VarDebugInfo,
} from "../rustc_middle/mir/mod.ts";
import { Statement } from "../rustc_middle/mir/statement.ts";
import { Lint, type MirLint, MirLint as MirLintBase, MirPass, type PassCtx, PassPolicy, run_passes } from "./pass_manager.ts";
import { SimplifyCfg } from "./simplify.ts";

const DIR = join(import.meta.dir, "simplify_oracle");
const DUMP = join(DIR, "dump");

if (process.env.REGEN === "1") {
  const tmp = mkdtempSync(join(tmpdir(), "mt-skeleton-simplify-"));
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-Zdump-mir=SimplifyCfg-initial", `-Zdump-mir-dir=${tmp}`, "--emit=metadata", "-o", join(tmp, "x.rmeta"), "simple.rs"], {
    cwd: DIR,
    env: { ...process.env, RUSTC_ICE: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`ERROR: oracle rustc exit ${r.exitCode}`);
  rmSync(DUMP, { recursive: true, force: true });
  mkdirSync(DUMP, { recursive: true });
  for (const f of readdirSync(tmp)) if (f.endsWith(".mir")) writeFileSync(join(DUMP, f), readFileSync(join(tmp, f)));
  rmSync(tmp, { recursive: true, force: true });
}

// ---- the fake `TyCtxt` (as rustc_middle/mir/pretty.test.ts's: real interners and types, fake def paths) ----

interface Item {
  name: string;
  kind: DefKind;
}
const ITEMS: Item[] = [
  { name: "f", kind: { $: "Fn" } },
  { name: "g", kind: { $: "Fn" } },
  { name: "h", kind: { $: "Fn" } },
];
const did = (i: number): DefId => new DefId(DefIndex.from_u32(i + 1), LOCAL_CRATE);

function mk_tcx(dump_dir: string): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const dl = TargetDataLayout.default();
  dl.endian = "Little";
  const gcx = {
    interners,
    data_layout: dl,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
    sess: {
      opts: {
        trimmed_def_paths: false,
        optimize: "No",
        unstable_opts: {
          trim_diagnostic_paths: true,
          mir_include_spans: "Nll",
          dump_mir: "SimplifyCfg-initial",
          dump_mir_dir: dump_dir,
          dump_mir_exclude_pass_number: false,
          dump_mir_graphviz: false,
          dump_mir_exclude_alloc_bytes: false,
          verbose_internals: false,
          mir_enable_passes: [],
          validate_mir: false,
          lint_mir: false,
          mir_opt_bisect_limit: undefined,
          mir_preserve_ub: false,
          mir_opt_level: undefined,
        },
      },
      prof: { profiler: undefined },
      mir_opt_level: () => 1,
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  const by_def = (d: DefId | LocalDefId): Item => {
    const index = d instanceof DefId ? d.index : (d as unknown as DefIndex);
    const it = ITEMS[(index as number) - 1];
    if (it === undefined) throw new Error("ERROR: test: unknown DefId");
    return it;
  };
  Object.assign(tcx, {
    type_length_limit: () => Limit.new(1048576),
    data_layout: () => dl,
    def_kind: (d: DefId) => by_def(d).kind,
    codegen_fn_attrs: () => ({ optimize: "Default" }),
    def_path_str: (d: DefId | LocalDefId) => by_def(d).name,
    def_path_str_with_args: (d: DefId) => by_def(d).name,
    is_closure_like: () => false,
    crate_name: (_: CrateNum) => Symbol.intern("simple"),
    def_path: (d: DefId) => ({ to_filename_friendly_no_crate: () => by_def(d).name }),
    is_foreign_item: () => false,
    hir_body_const_context: () => undefined,
    is_const_fn: () => false,
    mir_pretty_extra_data: () => undefined,
    // PORT(test): the hook (rustc_const_eval, not ported) for the one aggregate constant here, `const ()` in `h`: a
    // ZST tuple destructures into no fields (`DestructuredConstant { variant: None, fields: &[] }`).
    try_destructure_mir_constant_for_user_output: () => ({ variant: undefined, fields: [] }),
  });
  return tcx;
}

function with_tcx<R>(dump_dir: string, f: (tcx: TyCtxt) => R): R {
  let out: R | undefined;
  create_default_session_globals_then(() => {
    const tcx = mk_tcx(dump_dir);
    out = tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });
  return out!;
}

// ---- body builders ----

const si = (scope = 0): SourceInfo => new SourceInfo(DUMMY_SP, SourceScope.from_u32(scope));
const decl = (mutable: boolean, ty: Ty): LocalDecl => new LocalDecl(mutable ? "Mut" : "Not", { $: "Clear" }, ty, undefined, si());
const place = (tcx: TyCtxt, local: number): Place => new Place(Local.from_u32(local), tcx.mk_place_elems([]));
const stmt = (kind: StatementKind): Statement => new Statement(si(), kind, new StmtDebugInfos(undefined));
const assign = (tcx: TyCtxt, local: number, rv: Rvalue): Statement => stmt({ $: "Assign", _0: [place(tcx, local), rv] });
const copy = (tcx: TyCtxt, local: number): Rvalue => ({ $: "Use", _0: { $: "Copy", _0: place(tcx, local) }, _1: "Yes" });
const constant = (c: Const): Rvalue => ({ $: "Use", _0: { $: "Constant", _0: new ConstOperand(DUMMY_SP, undefined, c) }, _1: "Yes" });
const live = (local: number): Statement => stmt({ $: "StorageLive", _0: Local.from_u32(local) });
const dead = (local: number): Statement => stmt({ $: "StorageDead", _0: Local.from_u32(local) });
const bb = (n: number): BasicBlock => BasicBlock.from_u32(n);
const goto_ = (n: number): TerminatorKind => ({ $: "Goto", target: bb(n), loop_hint_attrs: [] });
const block = (statements: Statement[], kind: TerminatorKind, is_cleanup = false): BasicBlockData =>
  new BasicBlockData(statements, new StmtDebugInfos(undefined), new Terminator(si(), kind), is_cleanup);
const switch_ = (tcx: TyCtxt, local: number, zero: number, otherwise: number): TerminatorKind => ({
  $: "SwitchInt",
  discr: { $: "Move", _0: place(tcx, local) },
  targets: SwitchTargets.new([[0n, bb(zero)]], bb(otherwise)),
});
const debug = (tcx: TyCtxt, name: string, local: number, argument_index: number | undefined, scope = 0): VarDebugInfo => ({
  name: Symbol.intern(name),
  source_info: si(scope),
  composite: undefined,
  value: { $: "Place", _0: place(tcx, local) },
  argument_index,
});
const scope_data = (parent: number | undefined): SourceScopeData =>
  new SourceScopeData(DUMMY_SP, parent === undefined ? undefined : SourceScope.from_u32(parent), undefined, undefined, { $: "Clear" });

/** A `mir_built` body (phase `Built`, pass count 0) of the item `index`. */
function mk_body(index: number, o: { arg_count: number; locals: LocalDecl[]; blocks: BasicBlockData[]; scopes?: SourceScopeData[]; debug: VarDebugInfo[] }): Body {
  return new Body(
    BasicBlocks.new(o.blocks),
    MirPhase.Built,
    0,
    new MirSource({ $: "Item", _0: did(index) }, undefined),
    o.scopes ?? [scope_data(undefined)],
    undefined,
    o.locals,
    [],
    o.arg_count,
    undefined,
    o.debug,
    DUMMY_SP,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

const i32_const = (tcx: TyCtxt, v: bigint): Const => ({ $: "Val", _0: { $: "Scalar", _0: { $: "Int", _0: ScalarInt.raw(v, Size.from_bytes(4)) } }, _1: tcx.types.i32 });

/** The bodies `SimplifyCfg-initial` sees (the oracle's `before` dumps). */
const BODIES: Record<string, (tcx: TyCtxt) => Body> = {
  // pub fn f(c: bool, x: i32) -> i32 { if c { x } else { 0 } }
  f: (tcx) =>
    mk_body(0, {
      arg_count: 2,
      locals: [decl(true, tcx.types.i32), decl(false, tcx.types.bool), decl(false, tcx.types.i32), decl(true, tcx.types.bool)],
      debug: [debug(tcx, "c", 1, 1), debug(tcx, "x", 2, 2)],
      blocks: [
        block([live(3), assign(tcx, 3, copy(tcx, 1))], switch_(tcx, 3, 2, 1)),
        block([assign(tcx, 0, copy(tcx, 2))], goto_(4)),
        block([], goto_(3)),
        block([assign(tcx, 0, constant(i32_const(tcx, 0n)))], goto_(4)),
        block([dead(3)], { $: "Return" }),
      ],
    }),
  // pub fn g(x: i32) -> i32 { let _a = { return x; }; }
  g: (tcx) =>
    mk_body(1, {
      arg_count: 1,
      locals: [decl(true, tcx.types.i32), decl(false, tcx.types.i32), decl(true, tcx.types.never), decl(false, tcx.types.never)],
      scopes: [scope_data(undefined), scope_data(0)],
      debug: [debug(tcx, "x", 1, 1), debug(tcx, "_a", 3, undefined, 1)],
      blocks: [
        block([live(3), assign(tcx, 0, copy(tcx, 1))], goto_(3)),
        block([stmt({ $: "FakeRead", _0: [{ $: "ForLet", _0: undefined }, place(tcx, 3)] }), dead(3)], { $: "Unreachable" }),
        block([], goto_(4)),
        block([dead(3)], goto_(4)),
        block([], { $: "Return" }),
      ],
    }),
  // pub fn h(c: bool, x: i32) -> i32 { loop { if c { break x; } } }
  h: (tcx) =>
    mk_body(2, {
      arg_count: 2,
      locals: [decl(true, tcx.types.i32), decl(false, tcx.types.bool), decl(false, tcx.types.i32), decl(true, tcx.types.unit), decl(true, tcx.types.bool), decl(true, tcx.types.never)],
      debug: [debug(tcx, "c", 1, 1), debug(tcx, "x", 2, 2)],
      blocks: [
        block([], goto_(1)),
        block([], { $: "FalseUnwind", real_target: bb(2), unwind: { $: "Cleanup", _0: bb(10) } }),
        block([live(4), assign(tcx, 4, copy(tcx, 1))], switch_(tcx, 4, 4, 3)),
        block([assign(tcx, 0, copy(tcx, 2))], goto_(9)),
        block([], goto_(7)),
        block([], { $: "Unreachable" }),
        block([], goto_(8)),
        block([assign(tcx, 3, constant({ $: "Val", _0: { $: "ZeroSized" }, _1: tcx.types.unit }))], goto_(8)),
        block([dead(4)], goto_(1)),
        block([dead(4)], { $: "Return" }),
        block([], { $: "UnwindResume" }, true),
      ],
    }),
};

/** A no-op pass standing for one of `mir_built`'s first seven passes. */
class NoopPass extends MirPass {
  readonly type_name = "rustc_mir_transform::test::NoopPass";
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(true);
  }
  run_pass(): void {}
}
/** A no-op lint standing for `SanityCheck`. */
class NoopLint extends MirLintBase {
  readonly type_name = "rustc_mir_transform::test::NoopLint";
  run_lint(): void {}
}

describe("SimplifyCfg-initial through run_passes (-Zdump-mir=SimplifyCfg-initial)", () => {
  for (const item of ["f", "g", "h"]) {
    test(`fn ${item}: the dump files' names and text are the oracle's`, () => {
      const dir = mkdtempSync(join(tmpdir(), "mt-skeleton-dump-"));
      try {
        with_tcx(dir, (tcx) => {
          const body = BODIES[item]!(tcx);
          const lint: MirLint = new NoopLint();
          run_passes(tcx, body, [new NoopPass(), ...Array.from({ length: 6 }, () => new Lint(lint)), SimplifyCfg.Initial, new Lint(lint)], undefined);
          expect(body.pass_count).toBe(9);
        });
        const expected = readdirSync(DUMP).filter((f) => f.startsWith(`simple.${item}.`)).sort();
        expect(expected.length).toBe(2);
        expect(readdirSync(dir).sort()).toEqual(expected);
        for (const f of expected) {
          expect(`${f}\n${readFileSync(join(dir, f), "utf8")}`).toBe(`${f}\n${readFileSync(join(DUMP, f), "utf8")}`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
