// Tests of lane mt-skeleton: the pass manager (pass_manager.rs), the pass registry (`PASS_NAMES`, lib.rs
// `declare_passes!`), `provide` / `mir_keys` (lib.rs), `MirPatch` (patch.rs), `RequiredConstsVisitor`
// (required_consts.rs), `trivial_const` (trivial_const.rs) and the stub-module contract of the crate.
//
// Oracle: simplify_oracle/pass_names.txt is the pinned nightly's note for unknown `-Zmir-enable-passes` names
//   rustc -Zmir-enable-passes=+NoSuchPass --emit=metadata simple.rs
// (`REGEN=1 bun test <this file>` rewrites it): `PASS_NAMES`, sorted, must list the same names.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Load order: rustc_session first (its config.ts is not a fresh entry point), as the driver loads it.
import "../rustc_session/lib.ts";
import "../rustc_middle/lib.ts";
import { PIN, UPSTREAM } from "../../scripts/lib/common.ts";
import { DefId, DefIndex, LOCAL_CRATE, type LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import {
  BasicBlock,
  BasicBlockData,
  BasicBlocks,
  Body,
  ConstOperand,
  Local,
  Location,
  MirPhase,
  MirSource,
  Place_from_Local,
  SourceInfo,
  SourceScope,
  SourceScopeData,
  type StatementKind,
  StmtDebugInfos,
  Terminator,
  type TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import { Statement } from "../rustc_middle/mir/statement.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { Unported } from "../std/panic.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner } from "../rustc_errors/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_messages } from "../rustc_errors/formatting.ts";

/** An emitter that records the emitted diagnostics. */
class RecordingEmitter extends Emitter {
  readonly out: DiagInner[] = [];
  emit_diagnostic(diag: DiagInner): void {
    this.out.push(diag);
  }
  source_map(): undefined {
    return undefined;
  }
}
import { PASS_NAMES, provide } from "./lib.ts";
import { Lint, MirLint, MirPass, PassCtx, PassPolicy, run_passes, should_run_pass, simplify_pass_type_name, WithMinOptLevel } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";
import { RequiredConstsVisitor } from "./required_consts.ts";
import { SanityCheck } from "./sanity_check.ts";
import { SimplifyCfg, SimplifyLocals } from "./simplify.ts";
import { trivial_const } from "./trivial_const.ts";
import { ForceInline, Inline } from "./inline.ts";

const DIR = join(import.meta.dir, "simplify_oracle");

if (process.env.REGEN === "1") {
  const tmp = mkdtempSync(join(tmpdir(), "mt-skeleton-pass-names-"));
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-Zmir-enable-passes=+NoSuchPass", "--emit=metadata", "-o", join(tmp, "x.rmeta"), "simple.rs"], {
    cwd: DIR,
    env: { ...process.env, RUSTC_ICE: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  rmSync(tmp, { recursive: true, force: true });
  if (r.exitCode !== 0) throw new Error(`ERROR: oracle rustc exit ${r.exitCode}`);
  const note = r.stderr
    .toString()
    .split("\n")
    .find((l) => l.startsWith("note: valid MIR pass names are: "));
  if (note === undefined) throw new Error("ERROR: oracle printed no pass-name note");
  writeFileSync(join(DIR, "pass_names.txt"), `${note}\n`);
}

// ---- a fake `TyCtxt`: only what the pass manager reads ----

interface FakeOpts {
  mir_enable_passes?: [string, boolean][];
  mir_opt_level?: number;
}
function fake_tcx(o: FakeOpts = {}): TyCtxt {
  return {
    sess: {
      opts: {
        unstable_opts: {
          mir_enable_passes: o.mir_enable_passes ?? [],
          validate_mir: false,
          lint_mir: false,
          mir_opt_bisect_limit: undefined,
          mir_preserve_ub: false,
          dump_mir: undefined,
        },
      },
      prof: { profiler: undefined },
      mir_opt_level: () => o.mir_opt_level ?? 1,
    },
    def_kind: () => ({ $: "Fn" }),
    codegen_fn_attrs: () => ({ optimize: "Default" }),
  } as unknown as TyCtxt;
}

const si = (): SourceInfo => new SourceInfo(DUMMY_SP, SourceScope.from_u32(0));
const stmt = (kind: StatementKind): Statement => new Statement(si(), kind, new StmtDebugInfos(undefined));
const live = (local: number): Statement => stmt({ $: "StorageLive", _0: Local.from_u32(local) });
const block = (statements: Statement[], kind: TerminatorKind, is_cleanup = false): BasicBlockData =>
  new BasicBlockData(statements, new StmtDebugInfos(undefined), new Terminator(si(), kind), is_cleanup);

function mk_body(blocks: BasicBlockData[], phase: MirPhase = MirPhase.Built, injection_phase?: MirPhase): Body {
  return new Body(
    BasicBlocks.new(blocks),
    phase,
    0,
    new MirSource({ $: "Item", _0: new DefId(DefIndex.from_u32(1), LOCAL_CRATE) }, undefined),
    [new SourceScopeData(DUMMY_SP, undefined, undefined, undefined, { $: "Clear" })],
    undefined,
    [],
    [],
    0,
    undefined,
    [],
    DUMMY_SP,
    undefined,
    undefined,
    false,
    injection_phase,
    undefined,
    undefined,
    undefined,
  );
}

/** A pass that records its runs; its policy is given. */
class Probe extends MirPass {
  readonly type_name: string;
  runs = 0;
  constructor(
    name: string,
    readonly pol: PassPolicy,
  ) {
    super();
    this.type_name = `rustc_mir_transform::test::${name}`;
  }
  policy(_ctx: PassCtx): PassPolicy {
    return this.pol;
  }
  run_pass(): void {
    this.runs += 1;
  }
}
class ProbeLint extends MirLint {
  readonly type_name = "rustc_mir_transform::test::ProbeLint<'_>";
  runs = 0;
  run_lint(): void {
    this.runs += 1;
  }
}

function unported_what(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Unported) return e.what;
    throw e;
  }
  throw new Error("ERROR: expected an unported stop");
}

describe("pass names", () => {
  test("simplify_pass_type_name (the doc comment's examples)", () => {
    for (const n of ["Baz", "Baz<'_>", "foo::bar::Baz", "foo::bar::Baz<'a, 'b>"]) expect(simplify_pass_type_name(n)).toBe("Baz");
  });

  test("name / profiler_name of plain passes, pass enums and adapters", () => {
    expect(new SanityCheck().name()).toBe("SanityCheck");
    expect(new Lint(new SanityCheck()).name()).toBe("SanityCheck");
    expect(new Lint(new ProbeLint()).name()).toBe("ProbeLint");
    expect(SimplifyCfg.Initial.name()).toBe("SimplifyCfg-initial");
    expect(new WithMinOptLevel(1, SimplifyCfg.Final).name()).toBe("SimplifyCfg-final");
    expect(SimplifyCfg.Initial.profiler_name()).toBe("mir_pass_simplify_cfg_initial");
    expect(SimplifyCfg.MakeShim.profiler_name()).toBe("mir_pass_simplify_cfg_make_shim");
    expect(new Lint(new SanityCheck()).profiler_name()).toBe("mir_pass_sanity_check");
    expect(SimplifyLocals.AfterGVN.name()).toBe("SimplifyLocals-after-value-numbering");
  });

  test("PASS_NAMES, sorted, is the oracle's list of valid -Zmir-enable-passes names", () => {
    const note = readFileSync(join(DIR, "pass_names.txt"), "utf8").trim();
    const oracle = [...note.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    expect(oracle.length).toBeGreaterThan(70);
    const ours = [...PASS_NAMES()].sort();
    expect(ours).toEqual(oracle);
  });
});

describe("should_run_pass", () => {
  test("optional passes follow their default unless -Zmir-enable-passes names them (last entry wins)", () => {
    const on = new Probe("On", PassPolicy.optional(true));
    const off = new Probe("Off", PassPolicy.optional(false));
    const req = new Probe("Req", PassPolicy.Required);
    const ctx = (o: FakeOpts) => {
      const tcx = fake_tcx(o);
      return { tcx, ctx: (require("./pass_manager.ts") as typeof import("./pass_manager.ts")).PassCtx.for_body(tcx, new DefId(DefIndex.from_u32(1), LOCAL_CRATE)) };
    };
    let c = ctx({}).ctx;
    expect([should_run_pass(on, c), should_run_pass(off, c), should_run_pass(req, c)]).toEqual([true, false, true]);
    c = ctx({ mir_enable_passes: [["On", false], ["Off", true], ["Req", false]] }).ctx;
    expect([should_run_pass(on, c), should_run_pass(off, c), should_run_pass(req, c)]).toEqual([false, true, true]);
    c = ctx({ mir_enable_passes: [["On", false], ["On", true]] }).ctx;
    expect(should_run_pass(on, c)).toBe(true);
  });

  test("WithMinOptLevel gates an optional pass on the body's opt level", () => {
    const { PassCtx } = require("./pass_manager.ts") as typeof import("./pass_manager.ts");
    const d = new DefId(DefIndex.from_u32(1), LOCAL_CRATE);
    const p = new WithMinOptLevel(1, new Probe("P", PassPolicy.optional(true)));
    expect(should_run_pass(p, PassCtx.for_body(fake_tcx({ mir_opt_level: 0 }), d))).toBe(false);
    expect(should_run_pass(p, PassCtx.for_body(fake_tcx({ mir_opt_level: 1 }), d))).toBe(true);
    // -Zmir-enable-passes still overrides the gated default
    expect(should_run_pass(p, PassCtx.for_body(fake_tcx({ mir_opt_level: 0, mir_enable_passes: [["P", true]] }), d))).toBe(true);
    // a required pass cannot be gated (bug!)
    expect(() => new WithMinOptLevel(1, new Probe("R", PassPolicy.Required)).policy(PassCtx.for_body(fake_tcx(), d))).toThrow();
  });

  test("SimplifyLocals is enabled from opt level 1", () => {
    const { PassCtx } = require("./pass_manager.ts") as typeof import("./pass_manager.ts");
    const d = new DefId(DefIndex.from_u32(1), LOCAL_CRATE);
    expect(should_run_pass(SimplifyLocals.Final, PassCtx.for_body(fake_tcx({ mir_opt_level: 0 }), d))).toBe(false);
    expect(should_run_pass(SimplifyLocals.Final, PassCtx.for_body(fake_tcx({ mir_opt_level: 1 }), d))).toBe(true);
  });
});

describe("run_passes", () => {
  test("runs the enabled passes in order, counts them, applies the phase change", () => {
    // (an override must name a declared pass, or the unknown-name diagnostics run: the test below)
    const tcx = fake_tcx({ mir_enable_passes: [["CopyProp", false]] });
    const order: string[] = [];
    class Rec extends Probe {
      override run_pass(): void {
        order.push(this.name());
      }
    }
    const lint = new ProbeLint();
    const body = mk_body([block([], { $: "Return" })]);
    run_passes(tcx, body, [new Rec("A", PassPolicy.optional(true)), new Rec("CopyProp", PassPolicy.optional(true)), new Lint(lint), new Rec("B", PassPolicy.Required)], undefined);
    expect(order).toEqual(["A", "B"]);
    expect(lint.runs).toBe(1);
    expect(body.pass_count).toBe(3);
    expect(body.phase).toEqual(MirPhase.Built);

    run_passes(tcx, body, [new Rec("C", PassPolicy.optional(true))], { $: "Analysis", _0: "Initial" });
    expect(order).toEqual(["A", "B", "C"]);
    expect(body.phase).toEqual({ $: "Analysis", _0: "Initial" });
    // `pass_count = 0` for the phase-change dump, then 1
    expect(body.pass_count).toBe(1);
  });

  test("an invalid phase transition panics with rustc's message", () => {
    const body = mk_body([block([], { $: "Return" })], { $: "Analysis", _0: "Initial" });
    expect(() => run_passes(fake_tcx(), body, [], { $: "Analysis", _0: "Initial" })).toThrow(
      'Invalid MIR phase transition from Analysis(Initial) to Analysis(Initial)',
    );
  });

  test("a body with a later injection phase skips the passes but still changes phase", () => {
    const p = new Probe("P", PassPolicy.Required);
    const body = mk_body([block([], { $: "Return" })], MirPhase.Built, { $: "Runtime", _0: "Initial" });
    run_passes(fake_tcx(), body, [p], { $: "Analysis", _0: "Initial" });
    expect(p.runs).toBe(0);
    expect(body.phase).toEqual({ $: "Analysis", _0: "Initial" });
  });

  test("unknown -Zmir-enable-passes names: the warning, then the oracle's note listing the valid names (lane mt-built-lints)", () => {
    const body = mk_body([block([], { $: "Return" })]);
    const em = new RecordingEmitter();
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    const tcx = fake_tcx({ mir_enable_passes: [["NoSuchPass", true]] });
    (tcx as unknown as { dcx: () => unknown }).dcx = () => dcx.handle();
    run_passes(tcx, body, [], undefined);
    const out = em.out.map((d) => `${d.level.$ === "Warning" ? "warning" : d.level.$ === "Note" ? "note" : d.level.$}: ${format_diag_messages(d.messages, d.args)}`);
    const oracle_note = readFileSync(join(DIR, "pass_names.txt"), "utf8").trimEnd();
    expect(out).toEqual(["warning: MIR pass `NoSuchPass` is unknown and will be ignored", oracle_note]);
  });
});

describe("MirPatch", () => {
  test("queued statements, blocks, terminators and the cached special blocks", () => {
    const bb = (n: number) => BasicBlock.from_u32(n);
    const body = mk_body([
      block([live(1), live(2)], { $: "Goto", target: bb(1), loop_hint_attrs: [] }),
      block([live(3)], { $: "Return" }),
      block([], { $: "UnwindResume" }, true),
    ]);
    const patch = MirPatch.new(body);
    expect(patch.resume_block_()).toBe(bb(2));
    const unreachable = patch.unreachable_no_cleanup_block_();
    expect(unreachable).toBe(bb(3));
    expect(patch.unreachable_no_cleanup_block_()).toBe(bb(3));
    expect(patch.is_term_patched(bb(0))).toBe(false);
    // the documented order: `s1, s2, s0` with `s1` at `loc`
    patch.add_statement(new Location(bb(0), 1), { $: "StorageLive", _0: Local.from_u32(11) });
    patch.add_statement(new Location(bb(0), 0), { $: "StorageLive", _0: Local.from_u32(10) });
    patch.add_statement(new Location(bb(0), 1), { $: "StorageLive", _0: Local.from_u32(12) });
    patch.nop_statement(new Location(bb(0), 0));
    patch.patch_terminator(bb(1), { $: "Unreachable" });
    expect(patch.is_term_patched(bb(1))).toBe(true);
    patch.apply(body);
    const stmts = (b: number) => body.basic_blocks.deref()[b]!.statements.map((s) => (s.kind.$ === "StorageLive" ? `live(${s.kind._0})` : s.kind.$));
    expect(stmts(0)).toEqual(["live(10)", "Nop", "live(11)", "live(12)", "live(2)"]);
    // patching a terminator to `Unreachable` drops the block's statements
    expect(stmts(1)).toEqual([]);
    expect(body.basic_blocks.deref()[1]!.terminator_().kind.$).toBe("Unreachable");
    expect(body.basic_blocks.deref().length).toBe(4);
    expect(body.basic_blocks.deref()[3]!.terminator_().kind.$).toBe("Unreachable");
    expect(body.basic_blocks.deref()[3]!.is_cleanup).toBe(false);
  });
});

describe("RequiredConstsVisitor", () => {
  test("collects the unevaluated constants of the reachable blocks (reverse postorder), not values", () => {
    const unit = {} as Ty;
    const uneval = (i: number) => new ConstOperand(DUMMY_SP, undefined, { $: "Unevaluated", _0: { def: new DefId(DefIndex.from_u32(i), LOCAL_CRATE), args: [], promoted: undefined } as never, _1: unit });
    const val = new ConstOperand(DUMMY_SP, undefined, { $: "Val", _0: { $: "ZeroSized" }, _1: unit });
    const assign = (c: ConstOperand) => stmt({ $: "Assign", _0: [Place_from_Local(Local.from_u32(0)), { $: "Use", _0: { $: "Constant", _0: c }, _1: "Yes" }] });
    const body = mk_body([
      block([assign(uneval(1)), assign(val)], { $: "Goto", target: BasicBlock.from_u32(2), loop_hint_attrs: [] }),
      block([assign(uneval(9))], { $: "Return" }), // unreachable
      block([assign(uneval(2))], { $: "Return" }),
    ]);
    RequiredConstsVisitor.compute_required_consts(body);
    expect(body.required_consts!.map((c) => (c.const_ as { _0: { def: DefId } })._0.def.index)).toEqual([DefIndex.from_u32(1), DefIndex.from_u32(2)]);
  });
});

describe("trivial_const", () => {
  test("not a const: `None` without building the body", () => {
    let built = false;
    const tcx = { def_kind: () => ({ $: "Fn" }) } as unknown as TyCtxt;
    expect(
      trivial_const(tcx, DefIndex.from_u32(1) as unknown as LocalDefId, () => {
        built = true;
        return mk_body([]);
      }),
    ).toBeUndefined();
    expect(built).toBe(false);
  });

  test("a const asks `has_impossible_clauses` (impossible_clauses.rs) before the body", () => {
    // the const's clauses (none, no parent), no `Sized` lang item, then the empty-environment check of
    // `traits::impossible_clauses` builds an inference context: stop there
    const asked: string[] = [];
    let built = false;
    const tcx = {
      def_kind: () => ({ $: "Const" }),
      clauses_of: (d: unknown) => (asked.push(`clauses_of ${String(d)}`), { parent: undefined, clauses: [] }),
      lang_items: () => ({ sized_trait: () => undefined }),
      infer_ctxt: () => {
        throw new Error("infer_ctxt");
      },
    } as unknown as TyCtxt;
    expect(() =>
      trivial_const(tcx, DefIndex.from_u32(1) as unknown as LocalDefId, () => {
        built = true;
        return mk_body([]);
      }),
    ).toThrow("infer_ctxt");
    expect(asked.length).toBe(1);
    expect(built).toBe(false);
  });
});

describe("provide / mir_keys", () => {
  test("provide installs the crate's providers; mir_keys: body owners minus global_asm, plus tuple ctors", () => {
    const queries: Record<string, unknown> = {};
    const hooks: Record<string, unknown> = {};
    provide({ queries, extern_queries: {}, hooks } as unknown as Providers);
    for (const q of ["mir_keys", "mir_built", "mir_const_qualif", "mir_promoted", "mir_drops_elaborated_and_const_checked", "mir_for_ctfe", "optimized_mir", "is_mir_available", "promoted_mir", "trivial_const"]) {
      expect(`${q}: ${typeof queries[q]}`).toBe(`${q}: function`);
    }
    expect(typeof hooks.find_noop_landing_pads_for_instance).toBe("function");

    const L = (i: number) => DefIndex.from_u32(i) as unknown as LocalDefId;
    const D = (i: number) => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);
    const kinds: Record<number, string> = { 1: "Fn", 2: "GlobalAsm", 3: "Struct", 4: "Const", 5: "Enum" };
    const idx = (d: unknown) => (d instanceof DefId ? (d.index as number) : typeof d === "object" ? ((d as { def_id: unknown }).def_id as number) : (d as number));
    const tcx = {
      hir_body_owners: () => [L(1), L(2), L(4)],
      def_kind: (d: unknown) => ({ $: kinds[idx(d)] ?? "Ctor" }),
      needs_coroutine_by_move_body_def_id: () => false,
      hir_crate_items: () => ({ free_items: () => [{ owner_id: { def_id: 3 } }, { owner_id: { def_id: 5 } }, { owner_id: { def_id: 1 } }] }),
      adt_def: (d: unknown) => ({
        variants: () =>
          idx(d) === 3
            ? [{ ctor: ["Fn", D(6)] }]
            : [{ ctor: ["Const", D(7)] }, { ctor: undefined }, { ctor: ["Fn", D(8)] }],
      }),
    } as unknown as TyCtxt;
    const keys = (queries.mir_keys as (tcx: TyCtxt, k: null) => Set<LocalDefId>)(tcx, null);
    expect([...keys].map((k) => k as unknown as number)).toEqual([1, 4, 6, 8]);
  });
});

describe("module layout", () => {
  test("every module lib.rs / pass_manager.rs reference exists; stubs name their lane and stop with the upstream path", () => {
    const src = import.meta.dir;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        // `<name>_oracle/` directories hold test fixtures and test drivers, not ports
        if (statSync(p).isDirectory()) {
          if (!e.endsWith("_oracle")) walk(p);
        }
        // generated `<module>.gen.ts` files belong to their hand module (`<module>.ts`)
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".gen.ts")) files.push(p);
      }
    };
    walk(src);
    let stubs = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const rel = f.slice(src.length + 1).replace(/\.ts$/, ".rs");
      // the mirrored upstream file exists
      expect(`${rel}: ${statSync(join(UPSTREAM, "compiler/rustc_mir_transform/src", rel), { throwIfNoEntry: false })?.isFile() ?? false}`).toBe(`${rel}: true`);
      if (!text.startsWith("// Stub module (lane ")) continue;
      stubs += 1;
      // every `// stub:` marker names this file and a lane
      for (const m of text.matchAll(/^\/\/ stub: (\S+):(\d+) (\S+) \(lane ([a-z0-9-]+)\)$/gm)) {
        expect(m[1]).toBe(`compiler/rustc_mir_transform/src/${rel}`);
      }
    }
    expect(stubs).toBe(30);
  });
});

describe("inline.rs policies (asked by mir_drops_elaborated_and_const_checked)", () => {
  const ctx = (level: number, optimize: string, incremental: string | undefined, inline_mir: boolean | undefined) =>
    new PassCtx({ opts: { optimize, incremental, unstable_opts: { inline_mir } } } as never, level);
  test("Inline::policy: -Zinline-mir wins; else off at mir-opt-level 0/1, at 2 only for -Copt-level=2/3 without incremental, on above", () => {
    const on = (c: PassCtx) => new Inline().policy(c);
    expect(on(ctx(0, "Aggressive", undefined, true))).toEqual(PassPolicy.optional(true));
    expect(on(ctx(3, "Aggressive", undefined, false))).toEqual(PassPolicy.optional(false));
    expect(on(ctx(1, "Aggressive", undefined, undefined))).toEqual(PassPolicy.optional(false));
    expect(on(ctx(2, "More", undefined, undefined))).toEqual(PassPolicy.optional(true));
    expect(on(ctx(2, "Aggressive", undefined, undefined))).toEqual(PassPolicy.optional(true));
    expect(on(ctx(2, "Size", undefined, undefined))).toEqual(PassPolicy.optional(false));
    expect(on(ctx(2, "More", "inc", undefined))).toEqual(PassPolicy.optional(false));
    expect(on(ctx(4, "No", "inc", undefined))).toEqual(PassPolicy.optional(true));
  });
  test("ForceInline: Required; should_run_pass_for_callee iff #[rustc_force_inline]", () => {
    expect(new ForceInline().policy(ctx(0, "No", undefined, undefined))).toBe(PassPolicy.Required);
    const tcx = (inline: unknown) => ({ codegen_fn_attrs: () => ({ inline }) }) as unknown as TyCtxt;
    expect(ForceInline.should_run_pass_for_callee(tcx({ $: "Force", attr_span: DUMMY_SP, reason: undefined }), undefined as never)).toBe(true);
    expect(ForceInline.should_run_pass_for_callee(tcx({ $: "Always" }), undefined as never)).toBe(false);
  });
});
