// Tests of lane mir-pretty: rustc_middle mir/pretty.rs (`MirWriter` / `write_mir_pretty`, `MirDumper`, the scope tree
// and local declarations, `ExtraComments`, allocation printing, `pretty_print_const_value`) on hand-built MIR bodies
// over a `TyCtxt` with fresh interners (types and their Display are real; def paths, def kinds, global allocations and
// spans come from the fake below).
//
// Oracle: pretty_oracle/basic.rs and pretty_oracle/allocs.rs are tiny no_core crates; the fixtures are the pinned
// nightly's output for them (`REGEN=1 bun test <this file>` rewrites them):
//   basic.mir          rustc -Zunpretty=mir basic.rs
//   basic.spans.mir    rustc -Zunpretty=mir -Zmir-include-spans=on basic.rs
//   basic.noalloc.mir  rustc -Zunpretty=mir -Zdump-mir-exclude-alloc-bytes basic.rs
//   allocs.mir         rustc -Zunpretty=mir -Zmir-opt-level=2 allocs.rs
//   built/             rustc -Zdump-mir=built -Zdump-mir-dir=.. basic.rs (the files of `f`, `S`, `C`)
// Each test rebuilds a body (or allocation) of a fixture by hand and compares the printed text with the oracle's, byte
// for byte (whole items, or for the intro tests the item up to the blank line before `bb0`).
//
// PORT(test): mir-pretty is filled in parallel with lanes mir-body-a/b, mir-visit and mir-interp-a/b (wave 21). Their
// stubs are bridged three ways: (1) methods of the test's own objects are overridden by small subclasses (`TestBody`,
// `TestAllocation`, ...); (2) companion / prototype stubs the printer calls (`BasicBlock::start_location`, `Const::ty`,
// `ConstValue::*`, `CtfeProvenance::alloc_id`, `Pointer::new`, `GlobalAlloc::unwrap_memory`, `MirPhase::index`,
// `Visitor::visit_body`) get a stand-in that runs only when the real fn stops UNPORTED (`fallback`, restored after the
// file); (3) module-level stubs of the interpreter (`alloc_range`, `read_target_uint`, the `Debug` of `Pointer` /
// `CtfeProvenance`) are bridged the same way through `mock.module` (`bridge`, the original exports put back after the
// file); (4) tests whose output needs mir-body-a/b's `Debug` / `Display` impls of statements, terminators, places and
// `mir::Const` are skipped while those stubs are unported (`blocked`, probed once below) and run as soon as they land.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib.ts";
import { PIN } from "../../../scripts/lib/common.ts";
import { Align, Size, TargetDataLayout } from "../../rustc_abi/lib.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import { CrateNum, DefId, DefIndex, LOCAL_CRATE, type LocalDefId } from "../../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Limit } from "../../rustc_structures/limit.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { Panic, Unported, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { VecU8 } from "../../vendor/anstream/stream.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../ty/context.ts";
import * as tls from "../ty/context/tls.ts";
import { ScalarInt } from "../ty/consts/int.ts";
import { ValTree } from "../ty/consts/valtree.ts";
import { Const as TyConst } from "../../rustc_type_ir/sty/consts.ts";
import "../ty/consts.ts";
import type { Ty } from "../ty/decls.ts";
import { Ty as TyCompanion } from "../ty/mod.ts";
import { Const, ConstValue, display_Const, UnevaluatedConst } from "./consts.ts";
import { Allocation, AllocRange, ConstAllocation } from "./interpret/allocation.ts";
import { InitMask } from "./interpret/allocation/init_mask.gen.ts";
import { ProvenanceMap } from "./interpret/allocation/provenance_map.gen.ts";
import { type AllocId, debug_AllocId, GlobalAlloc } from "./interpret/mod.ts";
import * as interpret_mod from "./interpret/mod.ts";
import * as interpret_allocation from "./interpret/allocation.ts";
import * as interpret_pointer from "./interpret/pointer.ts";
import { type CtfeProvenance, CtfeProvenance as CtfeProvenanceC, Pointer } from "./interpret/pointer.ts";
import { SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import {
  BasicBlock,
  BasicBlockData,
  BasicBlocks,
  Body,
  debug_VarDebugInfoContents,
  Local,
  LocalDecl,
  Location,
  MirPhase,
  MirSource,
  OUTERMOST_SOURCE_SCOPE,
  Promoted,
  RETURN_PLACE,
  SourceInfo,
  SourceScope,
  SourceScopeData,
  type VarDebugInfo,
} from "./mod.ts";
import { debug_Place, debug_Statement, debug_TerminatorKind, hex_number_length, MirDumper, MirWriter, PrettyPrintMirOptions, pretty_print_const_value_tcx, write_allocations, write_extra, write_mir_intro, write_mir_pretty } from "./pretty.ts";
import { Statement, StmtDebugInfos } from "./statement.ts";
import { ConstOperand, Place, ProjectionElem, type Rvalue, type StatementKind, TerminatorKind } from "./syntax.ts";
import { Terminator } from "./terminator.ts";
import { Visitor } from "./visit.ts";

const DIR = join(import.meta.dir, "pretty_oracle");
const REGEN = process.env.REGEN === "1";

if (REGEN) {
  const rustc = (args: string[]): string => {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...args], { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`ERROR: oracle rustc ${args.join(" ")} exit ${r.exitCode}`);
    return r.stdout.toString();
  };
  writeFileSync(join(DIR, "basic.mir"), rustc(["-Zunpretty=mir", "basic.rs"]));
  writeFileSync(join(DIR, "basic.spans.mir"), rustc(["-Zunpretty=mir", "-Zmir-include-spans=on", "basic.rs"]));
  writeFileSync(join(DIR, "basic.noalloc.mir"), rustc(["-Zunpretty=mir", "-Zdump-mir-exclude-alloc-bytes", "basic.rs"]));
  writeFileSync(join(DIR, "allocs.mir"), rustc(["-Zunpretty=mir", "-Zmir-opt-level=2", "allocs.rs"]));
  const tmp = mkdtempSync(join(tmpdir(), "mir-pretty-built-"));
  rustc(["-Zdump-mir=built", `-Zdump-mir-dir=${tmp}`, "--emit=metadata", "-o", join(tmp, "x.rmeta"), "basic.rs"]);
  mkdirSync(join(DIR, "built"), { recursive: true });
  for (const item of ["f", "S", "C"]) {
    const name = `basic.${item}.1-1-000.built.after.mir`;
    writeFileSync(join(DIR, "built", name), readFileSync(join(tmp, name)));
  }
  rmSync(tmp, { recursive: true, force: true });
}

const fixture = (name: string): string => readFileSync(join(DIR, name), "utf8");

/** The lines of `text` from the one starting with `header` to the first line that is exactly `end` (inclusive). */
function lines_from(text: string, header: string, end: (line: string) => boolean): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0) throw new Error(`ERROR: fixture has no line starting with ${JSON.stringify(header)}`);
  let j = i;
  while (!end(lines[j]!)) j++;
  return `${lines.slice(i, j + 1).join("\n")}\n`;
}
/** A whole item (`fn f(..) {` .. `}`). */
const item = (text: string, header: string): string => lines_from(text, header, (l) => l === "}");
/** An item's intro: its header through the blank line before `bb0`. */
const intro = (text: string, header: string): string => lines_from(text, header, (l) => l === "");
/** An allocation (`allocN (..) {` .. `}`, or a one-line allocation), as `write_allocations` prints it (`\n` first). */
const alloc = (text: string, header: string): string => `\n${lines_from(text, header, (l) => l === "}" || l.endsWith("{}") || l.endsWith("{ .. }") || l.endsWith(")"))}`;

// ---- stand-ins (PORT(test), see the header) ----

const restores: (() => void)[] = [];
/** Replaces `obj[key]` by a wrapper running the real fn and, only if it stops UNPORTED, `standin`. */
function fallback<O extends object>(obj: O, key: string, standin: (...args: never[]) => unknown): void {
  const o = obj as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = o[key]!;
  restores.push(() => {
    o[key] = real;
  });
  o[key] = function (this: unknown, ...args: unknown[]): unknown {
    try {
      return real.apply(this, args);
    } catch (e) {
      if (e instanceof Unported) return (standin as (...a: unknown[]) => unknown).apply(this, args);
      throw e;
    }
  };
}

const ALLOC_ID_MASK = ((1n << 64n) - 1n) & ~(1n << 63n) & ~(1n << 62n);
/** A `CtfeProvenance` of `alloc_id` (immutable, shared: `<imm>`). */
const prov = (alloc_id: number): CtfeProvenance => (BigInt(alloc_id) | (1n << 63n) | (1n << 62n)) as CtfeProvenance;

/** (3) `mock.module(path)` with `standins` as fallbacks of the module's own exports (see `fallback`). */
function bridge(path: string, ns: object, standins: Record<string, (...args: never[]) => unknown>): void {
  const orig = { ...(ns as Record<string, unknown>) };
  const patched: Record<string, unknown> = { ...orig };
  for (const [k, s] of Object.entries(standins)) {
    const real = orig[k] as (...args: unknown[]) => unknown;
    patched[k] = (...args: unknown[]): unknown => {
      try {
        return real(...args);
      } catch (e) {
        if (e instanceof Unported) return (s as (...a: unknown[]) => unknown)(...args);
        throw e;
      }
    };
  }
  mock.module(path, () => patched);
  restores.push(() => {
    mock.module(path, () => orig);
  });
}

/** pointer.rs `impl Provenance for CtfeProvenance`'s `fmt` (the `Debug` of a `Pointer`) and `Debug for CtfeProvenance`. */
function debug_ctfe_prov(p: CtfeProvenance, f: Fmt): string {
  return `${debug_AllocId(Number(p & ALLOC_ID_MASK) as AllocId, f)}${p & (1n << 63n) ? "<imm>" : ""}`;
}

function install_standins(): void {
  // allocation.rs:347 `alloc_range`
  bridge("./interpret/allocation.ts", interpret_allocation, { alloc_range: (start: Size, size: Size) => new AllocRange(start, size) });
  // interpret/mod.rs:586 `read_target_uint`
  bridge("./interpret/mod.ts", interpret_mod, {
    read_target_uint: (endian: "Little" | "Big", source: Uint8Array) => {
      let v = 0n;
      const b = endian === "Little" ? [...source].reverse() : [...source];
      for (const x of b) v = (v << 8n) | BigInt(x);
      return Ok(v);
    },
  });
  bridge("./interpret/pointer.ts", interpret_pointer, {
    debug_CtfeProvenance: debug_ctfe_prov,
    // pointer.rs:174 `<CtfeProvenance as Provenance>::fmt`: the `AllocId`, a non-zero offset, `<imm>`
    debug_Pointer: (ptr: Pointer<CtfeProvenance>, f: Fmt) =>
      `${debug_AllocId(Number(ptr.provenance & ALLOC_ID_MASK) as AllocId, f)}${ptr.offset.bytes() > 0 ? `+0x${ptr.offset.bytes().toString(16)}` : ""}${ptr.provenance & (1n << 63n) ? "<imm>" : ""}`,
  });

  fallback(BasicBlock, "start_location", (bb: BasicBlock) => new Location(bb, 0));
  // mod.rs:106 `MirPhase::index`
  fallback(MirPhase, "index", (p: MirPhase) => {
    const dialect = p.$ === "Built" ? 1 : p.$ === "Analysis" ? 2 : 3;
    const phase = p.$ === "Built" ? 1 : p.$ === "Analysis" ? (p._0 === "Initial" ? 1 : 2) : p._0 === "Initial" ? 1 : p._0 === "PostCleanup" ? 2 : 3;
    return [dialect, phase];
  });
  // consts.rs:258 `Const::ty`
  fallback(Const, "ty", (c: Const) => (c.$ === "Ty" ? (c._1.kind().$ === "Value" ? (c._1.kind() as { _0: { ty: Ty } })._0.ty : c._0) : c._1));
  // consts.rs:187 `ConstValue::all_bytes_uninit` (as upstream, through the fake `global_alloc`)
  fallback(ConstValue, "all_bytes_uninit", function (ct: ConstValue, tcx: TyCtxt): boolean {
    if (ct.$ !== "Indirect") return false;
    const ga = tcx.global_alloc(ct.alloc_id);
    if (ga.$ !== "Memory") return false;
    const a = ga._0.inner();
    const r = a.init_mask_().is_range_initialized(new AllocRange(Size.ZERO, a.size()));
    return r.$ === "Err" && r._0.size.raw === a.size().raw;
  });
  // consts.rs:133 `ConstValue::try_get_slice_bytes_for_diagnostics` (the `Slice` arm; the fixtures need no other)
  fallback(ConstValue, "try_get_slice_bytes_for_diagnostics", function (ct: ConstValue, tcx: TyCtxt): readonly number[] | undefined {
    if (ct.$ !== "Slice") throw new Error("ERROR: test stand-in: only ConstValue::Slice");
    const data = GlobalAlloc.unwrap_memory(tcx.global_alloc(ct.alloc_id));
    return [...data.inner().inspect_with_uninit_and_ptr_outside_interpreter({ start: 0, end: ct.meta } as never)];
  });
  fallback(CtfeProvenanceC, "alloc_id", (p: CtfeProvenance) => Number(p & ALLOC_ID_MASK) as AllocId);
  fallback(Pointer, "new", (provenance: unknown, offset: Size) => new Pointer(offset, provenance));
  fallback(GlobalAlloc, "unwrap_memory", (g: GlobalAlloc) => {
    if (g.$ !== "Memory") throw new Panic("expected memory, got ..");
    return g._0;
  });
  // visit.rs `super_body`, the part these bodies need: the `ConstOperand`s of `x = const ..` statements.
  fallback(Visitor.prototype, "visit_body", function (this: Visitor, body: Body): void {
    body.basic_blocks.deref().forEach((data, bb) => {
      data.statements.forEach((st, i) => {
        if (st.kind.$ !== "Assign") return;
        const rv = st.kind._0[1];
        if (rv.$ === "Use" && rv._0.$ === "Constant") this.visit_const_operand(rv._0._0, new Location(BasicBlock.from_usize(bb), i));
      });
    });
  });
}

class TestMirSource extends MirSource {
  override def_id(): DefId {
    if (this.instance.$ !== "Item") throw new Error("ERROR: test: Item sources only");
    return this.instance._0;
  }
}
class TestBlock extends BasicBlockData {
  override terminator_(): Terminator {
    return this.terminator!;
  }
}
class TestStmtDebugInfos extends StmtDebugInfos {
  override deref(): readonly never[] {
    return [];
  }
}
class TestBody extends Body {
  override args_iter(): readonly Local[] {
    return Array.from({ length: this.arg_count }, (_, i) => Local.from_usize(i + 1));
  }
  override return_ty(): Ty {
    return this.local_decls[0]!.ty;
  }
  override yield_ty(): Ty | undefined {
    return undefined;
  }
  override coroutine_layout_raw(): undefined {
    return undefined;
  }
  override index(bb: BasicBlock): BasicBlockData {
    return this.basic_blocks.deref()[BasicBlock.index(bb)]!;
  }
}
class TestInitMask extends InitMask {
  override is_range_initialized(range: AllocRange): Result<undefined, AllocRange> {
    if (this.blocks.$ !== "Lazy") throw new Error("ERROR: test: lazy init masks only");
    return this.blocks.state ? Ok(undefined) : Err(range);
  }
}
class TestProvenanceMap extends ProvenanceMap<CtfeProvenance> {
  override ptrs_(): SortedMap<Size, CtfeProvenance> {
    return this.ptrs;
  }
  override get_ptr(offset: Size): CtfeProvenance | undefined {
    return this.ptrs.get(offset);
  }
  override get_byte(): undefined {
    return undefined;
  }
}
class TestAllocation extends Allocation {
  override size(): Size {
    return Size.from_bytes(this.bytes.length);
  }
  override len(): number {
    return this.bytes.length;
  }
  override init_mask_(): InitMask {
    return this.init_mask;
  }
  override provenance_(): ProvenanceMap<CtfeProvenance> {
    return this.provenance;
  }
  override inspect_with_uninit_and_ptr_outside_interpreter(range: { start: number; end: number }): Uint8Array {
    return this.bytes.subarray(range.start, range.end);
  }
}
/** An allocation of `bytes` (all init, or all uninit), with pointers `[offset, alloc_id]` (64-bit little endian). */
function mk_alloc(bytes: number[], align: number, opts: { uninit?: boolean; ptrs?: [number, number][] } = {}): ConstAllocation {
  const b = Uint8Array.from(bytes);
  const ptrs = new SortedMap<Size, CtfeProvenance>(
    (opts.ptrs ?? []).map(([off, id]) => [Size.from_bytes(off), prov(id)]),
    (a, c) => a.raw - c.raw,
  );
  const a = new TestAllocation(
    b,
    new TestProvenanceMap(ptrs, undefined),
    new TestInitMask({ $: "Lazy", state: !opts.uninit }, Size.from_bytes(b.length)),
    unwrap_ok(Align.from_bytes(align)),
    "Not",
    null,
  );
  return new ConstAllocation(a as Allocation);
}
function unwrap_ok<T, E>(r: Result<T, E>): T {
  if (r.$ === "Err") throw new Error("ERROR: unexpected Err");
  return r._0;
}
const bytes_of = (s: string): number[] => [...new TextEncoder().encode(s)];

// ---- the fake `TyCtxt` ----

interface Item {
  name: string;
  kind: DefKind;
  body?: (tcx: TyCtxt) => Body;
  promoted?: (tcx: TyCtxt) => Body[];
  trivial?: (tcx: TyCtxt) => [ConstValue, Ty];
  const_context?: boolean;
}
interface Fake {
  items: Item[];
  allocs: Map<number, (tcx: TyCtxt) => GlobalAlloc>;
  spans: Map<Span, string>;
  unstable: Record<string, unknown>;
  crate_name: string;
}

const did = (i: number): DefId => new DefId(DefIndex.from_u32(i + 1), LOCAL_CRATE);

function mk_tcx(fake: Fake): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const source_map = {
    span_to_diagnostic_string: (sp: Span): string => {
      const s = fake.spans.get(sp);
      if (s === undefined) throw new Error("ERROR: test: span without location text");
      return s;
    },
  };
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
    sess: {
      opts: {
        trimmed_def_paths: false,
        unstable_opts: {
          trim_diagnostic_paths: true,
          mir_include_spans: "Nll",
          dump_mir: undefined,
          dump_mir_dir: "mir_dump",
          dump_mir_exclude_pass_number: false,
          dump_mir_graphviz: false,
          dump_mir_exclude_alloc_bytes: false,
          verbose_internals: false,
          ...fake.unstable,
        },
      },
      verbose_internals: () => false,
      source_map: () => source_map,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  const dl = TargetDataLayout.default();
  dl.endian = "Little";
  const by_def = (d: DefId): Item => {
    const it = fake.items[(d.index as number) - 1];
    if (it === undefined || d.krate !== LOCAL_CRATE) throw new Error("ERROR: test: unknown DefId");
    return it;
  };
  const bodies = new Map<string, Body>();
  const body_of = (d: DefId): Body => {
    const it = by_def(d);
    let b = bodies.get(it.name);
    if (b === undefined) bodies.set(it.name, (b = it.body!(tcx)));
    return b;
  };
  const ga = (id: AllocId): GlobalAlloc | undefined => fake.allocs.get(id as number)?.(tcx);
  // PORT(test): `FmtPrinter::new` reads the `limits` query (no query system here); 1048576 is rustc's default.
  Object.assign(tcx, {
    type_length_limit: () => Limit.new(1048576),
    data_layout: () => dl,
    def_kind: (d: DefId) => by_def(d).kind,
    def_path_str: (d: DefId | LocalDefId) => by_def(d instanceof DefId ? d : new DefId(d as unknown as DefIndex, LOCAL_CRATE)).name,
    def_path_str_with_args: (d: DefId) => by_def(d).name,
    is_closure_like: () => false,
    crate_name: (_: CrateNum) => Symbol.intern(fake.crate_name),
    def_path: (d: DefId) => ({ to_filename_friendly_no_crate: () => by_def(d).name.replaceAll("::", "-") }),
    try_get_global_alloc: ga,
    global_alloc: (id: AllocId) => ga(id) ?? unported("test: dangling AllocId"),
    is_foreign_item: () => false,
    hir_body_const_context: (l: LocalDefId) => (by_def(new DefId(l as unknown as DefIndex, LOCAL_CRATE)).const_context ? "Static" : undefined),
    eval_static_initializer: (d: DefId) => {
      const g = fake.allocs.get(fake.items.findIndex((it) => it.name === by_def(d).name) + 1000 + 1);
      return g === undefined ? Err("test") : Ok((g(tcx) as { _0: ConstAllocation })._0);
    },
    mir_keys: () => new Set(fake.items.map((_, i) => did(i).index as unknown as LocalDefId)),
    is_const_fn: () => false,
    trivial_const: (d: DefIndex | DefId) => by_def(d instanceof DefId ? d : new DefId(d, LOCAL_CRATE)).trivial?.(tcx),
    instance_mir: (k: { _0: DefId }) => body_of(k._0),
    promoted_mir: (d: DefIndex | DefId) => by_def(d instanceof DefId ? d : new DefId(d, LOCAL_CRATE)).promoted?.(tcx) ?? [],
    mir_pretty_extra_data: () => undefined,
  });
  return tcx;
}

/** Session globals plus the `ImplicitCtxt` of the fake `tcx` (`ty::tls::with`: Display of `Ty` / `Const` reads it). */
function with_tcx<R>(fake: Fake, f: (tcx: TyCtxt) => R): R {
  let out: R | undefined;
  create_default_session_globals_then(() => {
    const tcx = mk_tcx(fake);
    out = tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx));
  });
  return out!;
}

// ---- body builders ----

/** A span standing for the location text `loc` (the fake source map prints it). */
function sp(fake: Fake, loc: string): Span {
  const s = Span.new(BytePos(fake.spans.size + 1), BytePos(fake.spans.size + 1), SyntaxContext.root(), undefined);
  fake.spans.set(s, loc);
  return s;
}
const si = (span: Span, scope = 0): SourceInfo => new SourceInfo(span, SourceScope.from_u32(scope));
const local_decl = (mutable: boolean, ty: Ty, info: SourceInfo): LocalDecl => new LocalDecl(mutable ? "Mut" : "Not", { $: "Clear" }, ty, undefined, info);
const place = (tcx: TyCtxt, local: number, deref = false): Place => new Place(Local.from_u32(local), tcx.mk_place_elems(deref ? [ProjectionElem.Deref] : []));
const stmt = (info: SourceInfo, kind: StatementKind): Statement => new Statement(info, kind, new TestStmtDebugInfos(undefined));
const assign = (info: SourceInfo, p: Place, rv: Rvalue): Statement => stmt(info, { $: "Assign", _0: [p, rv] });
const use_const = (span: Span, c: Const): Rvalue => ({ $: "Use", _0: { $: "Constant", _0: new ConstOperand(span, undefined, c) }, _1: "Yes" });
const block = (statements: Statement[], terminator_info: SourceInfo): BasicBlockData =>
  new TestBlock(statements, new TestStmtDebugInfos(undefined), new Terminator(terminator_info, TerminatorKind.Return), false);
const scope_data = (parent: number | undefined): SourceScopeData => new SourceScopeData(DUMMY_SP, parent === undefined ? undefined : SourceScope.from_u32(parent), undefined, undefined, { $: "Clear" });

function mk_body(
  def: DefId,
  o: { promoted?: number; phase?: MirPhase; arg_count?: number; locals: LocalDecl[]; blocks: BasicBlockData[]; scopes?: SourceScopeData[]; debug?: VarDebugInfo[] },
): Body {
  return new TestBody(
    BasicBlocks.new(o.blocks),
    o.phase ?? { $: "Runtime", _0: "Optimized" },
    0,
    new TestMirSource({ $: "Item", _0: def }, o.promoted === undefined ? undefined : Promoted.from_u32(o.promoted)),
    o.scopes ?? [scope_data(undefined)],
    undefined,
    o.locals,
    [],
    o.arg_count ?? 0,
    undefined,
    o.debug ?? [],
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

const ref = (tcx: TyCtxt, ty: Ty): Ty => TyCompanion.new_imm_ref(tcx, tcx.lifetimes.re_erased, ty);
const ref_str = (tcx: TyCtxt): Ty => ref(tcx, tcx.types.str_);
const str_val = (alloc_id: number, len: number): ConstValue => ({ $: "Slice", alloc_id: alloc_id as AllocId, meta: len });
const ptr_val = (alloc_id: number): ConstValue => ({ $: "Scalar", _0: { $: "Ptr", _0: new Pointer(Size.ZERO, prov(alloc_id)), _1: 8 } });
const memory = (a: ConstAllocation) => (): GlobalAlloc => ({ $: "Memory", _0: a });

/** The `basic.rs` crate: its items in `mir_keys` order, with the spans of basic.spans.mir. */
function basic(unstable: Record<string, unknown> = {}): Fake {
  const fake: Fake = { items: [], allocs: new Map(), spans: new Map(), unstable, crate_name: "basic" };
  const F = 0,
    S = 1,
    P = 2,
    L = 3,
    C = 5,
    G = 6;
  const span = (loc: string) => sp(fake, `basic.rs:${loc}`);
  fake.items = [
    {
      name: "f",
      kind: { $: "Fn" },
      body: (tcx) => {
        const i32 = tcx.types.i32;
        return mk_body(did(F), {
          arg_count: 1,
          locals: [local_decl(true, i32, si(span("19:21: 19:24"))), local_decl(false, i32, si(span("19:10: 19:11")))],
          scopes: [scope_data(undefined), scope_data(0)],
          debug: [
            { name: Symbol.intern("x"), source_info: si(span("19:10: 19:11")), composite: undefined, value: { $: "Place", _0: place(tcx, 1) }, argument_index: 1 },
            { name: Symbol.intern("y"), source_info: si(span("19:31: 19:32"), 1), composite: undefined, value: { $: "Place", _0: place(tcx, 1) }, argument_index: undefined },
          ],
          blocks: [block([assign(si(span("19:38: 19:39"), 1), place(tcx, 0), { $: "Use", _0: { $: "Copy", _0: place(tcx, 1) }, _1: "Yes" })], si(span("19:41: 19:41")))],
        });
      },
    },
    {
      name: "S",
      kind: { $: "Static", safety: "Safe", mutability: "Not", nested: false },
      body: (tcx) =>
        mk_body(did(S), {
          locals: [local_decl(true, ref_str(tcx), si(span("20:15: 20:19")))],
          blocks: [block([assign(si(span("20:22: 20:29")), place(tcx, 0), use_const(span("20:22: 20:29"), { $: "Val", _0: str_val(1, 5), _1: ref_str(tcx) }))], si(span("20:1: 20:30")))],
        }),
    },
    {
      name: "P",
      kind: { $: "Static", safety: "Safe", mutability: "Not", nested: false },
      body: (tcx) => {
        const i32 = tcx.types.i32;
        const r = ref(tcx, i32);
        const s = (loc: string) => si(span(loc));
        const borrow = (local: number): Rvalue => ({ $: "Ref", _0: tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(tcx, local, true) });
        return mk_body(did(P), {
          locals: [local_decl(true, r, s("21:15: 21:19")), local_decl(false, r, s("21:22: 21:24")), local_decl(false, i32, s("21:23: 21:24")), local_decl(true, r, s("21:22: 21:24"))],
          blocks: [
            block(
              [
                stmt(s("21:22: 21:24"), { $: "StorageLive", _0: Local.from_u32(1) }),
                assign(s("21:22: 21:24"), place(tcx, 3), use_const(span("21:22: 21:24"), { $: "Unevaluated", _0: new UnevaluatedConst(did(P), tcx.mk_args([]), Promoted.from_u32(0)), _1: r })),
                assign(s("21:22: 21:24"), place(tcx, 1), borrow(3)),
                assign(s("21:22: 21:24"), place(tcx, 0), borrow(1)),
                stmt(s("21:23: 21:24"), { $: "StorageDead", _0: Local.from_u32(1) }),
              ],
              s("21:1: 21:25"),
            ),
          ],
        });
      },
      promoted: (tcx) => {
        const i32 = tcx.types.i32;
        const s = (loc: string) => si(span(loc));
        return [
          mk_body(did(P), {
            promoted: 0,
            locals: [local_decl(true, ref(tcx, i32), s("21:22: 21:24")), local_decl(true, i32, s("21:23: 21:24"))],
            blocks: [
              block(
                [
                  assign(s("21:23: 21:24"), place(tcx, 1), use_const(span("21:23: 21:24"), { $: "Val", _0: { $: "Scalar", _0: { $: "Int", _0: ScalarInt.raw(5n, Size.from_bytes(4)) } }, _1: i32 })),
                  assign(s("21:22: 21:24"), place(tcx, 0), { $: "Ref", _0: tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(tcx, 1) }),
                ],
                s("21:22: 21:24"),
              ),
            ],
          }),
        ];
      },
    },
    {
      name: "L",
      kind: { $: "Static", safety: "Safe", mutability: "Not", nested: false },
      body: (tcx) => {
        // PORT(test): `Ty::new_array` evaluates the length with `layout_of` (no query system here): the same `ty::Const` by hand.
        const len = TyConst.new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.raw(20n, Size.from_bytes(8))), tcx.types.usize);
        const ty = ref(tcx, TyCompanion.new_array_with_const_len(tcx, tcx.types.u8, len));
        return mk_body(did(L), {
          locals: [local_decl(true, ty, si(span("22:15: 22:24")))],
          blocks: [block([assign(si(span("22:27: 22:50")), place(tcx, 0), use_const(span("22:27: 22:50"), { $: "Val", _0: ptr_val(6), _1: ty }))], si(span("22:1: 22:51")))],
        });
      },
    },
    { name: "L::{constant#0}", kind: { $: "AnonConst" }, trivial: (tcx) => [{ $: "Scalar", _0: { $: "Int", _0: ScalarInt.raw(20n, Size.from_bytes(8)) } }, tcx.types.usize] },
    { name: "C", kind: { $: "Const" }, trivial: (tcx) => [{ $: "Scalar", _0: { $: "Int", _0: ScalarInt.raw(7n, Size.from_bytes(4)) } }, tcx.types.i32] },
    {
      name: "g",
      kind: { $: "Fn" },
      body: (tcx) =>
        mk_body(did(G), {
          locals: [local_decl(true, ref_str(tcx), si(span("24:15: 24:27")))],
          blocks: [block([assign(si(span("24:30: 24:34")), place(tcx, 0), use_const(span("24:30: 24:34"), { $: "Val", _0: str_val(8, 2), _1: ref_str(tcx) }))], si(span("24:36: 24:36")))],
        }),
    },
  ];
  void C;
  fake.allocs.set(1, memory(mk_alloc(bytes_of("hello"), 1)));
  fake.allocs.set(6, memory(mk_alloc(bytes_of("0123456789abcdefghij"), 1)));
  fake.allocs.set(8, memory(mk_alloc(bytes_of("hi"), 1)));
  return fake;
}

/** `write_*(.., w)` into a string. */
function out(f: (w: VecU8) => Result<undefined | void, unknown>): string {
  const w = new VecU8();
  const r = f(w);
  if (r.$ === "Err") throw new Error("ERROR: io error");
  return new TextDecoder().decode(w.bytes());
}
const body_named = (tcx: TyCtxt, fake: Fake, name: string): Body => tcx.instance_mir({ $: "Item", _0: did(fake.items.findIndex((it) => it.name === name)) });

// ---- which module-level stubs of the parallel lanes are still unported (header (3)) ----

/** `true` if `f` stops UNPORTED (any other outcome: the stub has landed). */
function stops(f: () => unknown): boolean {
  try {
    f();
    return false;
  } catch (e) {
    return e instanceof Unported;
  }
}
const blocked = with_tcx(basic(), (tcx) => {
  const p = place(tcx, 0);
  return {
    // mir-body-b: the `Debug` of statements / terminators / places, `Display` of `mir::Const`; mir-body-a: `debug x => _1`
    body: [
      stops(() => debug_TerminatorKind(TerminatorKind.Return, PLAIN)),
      stops(() => debug_Statement(stmt(si(DUMMY_SP), { $: "StorageLive", _0: Local.from_u32(1) }), PLAIN)),
      stops(() => debug_Place(p, PLAIN)),
      stops(() => debug_VarDebugInfoContents({ $: "Place", _0: p }, PLAIN)),
      stops(() => display_Const({ $: "Val", _0: ConstValue.ZeroSized, _1: tcx.types.unit })),
    ].some((b) => b),
  };
});

beforeAll(install_standins);
afterAll(() => {
  for (const r of restores.reverse()) r();
});

// ---- tests ----

test("hex_number_length (the doc examples)", () => {
  expect([hex_number_length(0), hex_number_length(1), hex_number_length(16), hex_number_length(255), hex_number_length(256)]).toEqual([1, 1, 2, 2, 3]);
});

describe("allocations (write_allocations / display_allocation)", () => {
  const basic_mir = fixture("basic.mir");
  const allocs_mir = fixture("allocs.mir");

  test("Memory allocations: one line, two lines with addresses (basic.mir alloc1 / alloc6 / alloc8)", () => {
    const fake = basic();
    with_tcx(fake, (tcx) => {
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "S"), w))).toBe(alloc(basic_mir, "alloc1 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "L"), w))).toBe(alloc(basic_mir, "alloc6 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "g"), w))).toBe(alloc(basic_mir, "alloc8 ("));
    });
  });

  test("-Zdump-mir-exclude-alloc-bytes (basic.noalloc.mir)", () => {
    const fake = basic({ dump_mir_exclude_alloc_bytes: true });
    with_tcx(fake, (tcx) => {
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "S"), w))).toBe(alloc(fixture("basic.noalloc.mir"), "alloc1 ("));
    });
  });

  /** allocs.rs's items as a fake crate: `S` (alloc1), `Q` (alloc2), `T` (alloc3), `WS` (alloc5), `WS2` (alloc9), `U`'s
   *  uninit bytes (alloc12), `Z` (alloc14); one body per printed function, whose `_0 = const {allocN: ..}`. */
  function allocs(): Fake {
    const fake: Fake = { items: [], allocs: new Map(), spans: new Map(), unstable: {}, crate_name: "allocs" };
    const stat = (name: string): Item => ({ name, kind: { $: "Static", safety: "Safe", mutability: "Not", nested: false } });
    const fn_returning = (name: string, alloc_id: number, phase: MirPhase = { $: "Runtime", _0: "Optimized" }, kind: DefKind = { $: "Fn" }, const_context = false): Item => ({
      name,
      kind,
      const_context,
      body: (tcx) => {
        const ty = ref(tcx, tcx.types.i32);
        return mk_body(did(fake.items.findIndex((it) => it.name === name)), {
          phase,
          locals: [local_decl(true, ty, si(DUMMY_SP))],
          blocks: [block([assign(si(DUMMY_SP), place(tcx, 0), use_const(DUMMY_SP, { $: "Val", _0: ptr_val(alloc_id), _1: ty }))], si(DUMMY_SP))],
        });
      },
    });
    fake.items = [
      stat("S"),
      stat("Q"),
      stat("T"),
      stat("WS"),
      stat("WS2"),
      stat("Z"),
      fn_returning("q", 2),
      fn_returning("t", 3),
      fn_returning("w", 5),
      fn_returning("w2", 9),
      fn_returning("z", 14),
      // WS2's own MIR (phase `PostCleanup`, a const context): the static it points to is not evaluated.
      fn_returning("WS2_body", 1, { $: "Runtime", _0: "PostCleanup" }, { $: "Static", safety: "Safe", mutability: "Not", nested: false }, true),
      {
        name: "u",
        kind: { $: "Fn" },
        body: (tcx) => mk_body(did(12), { locals: [local_decl(true, tcx.types.u32, si(DUMMY_SP))], blocks: [block([assign(si(DUMMY_SP), place(tcx, 0), use_const(DUMMY_SP, { $: "Val", _0: { $: "Indirect", alloc_id: 12 as AllocId, offset: Size.ZERO }, _1: tcx.types.u32 }))], si(DUMMY_SP))] }),
      },
    ];
    const statics: [string, number, ConstAllocation][] = [
      ["S", 1, mk_alloc([5, 0, 0, 0], 4)],
      ["Q", 2, mk_alloc([0, 0, 0, 0, 0, 0, 0, 0], 8, { ptrs: [[0, 1]] })],
      ["T", 3, mk_alloc(new Array(24).fill(0), 8, { ptrs: [[0, 1], [8, 1], [16, 1]] })],
      ["WS", 5, mk_alloc([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0, 0, 0, 0, 0, 13, 14], 1, { ptrs: [[12, 1]] })],
      ["WS2", 9, mk_alloc([...new Array(14).fill(0x41), 0, 0, 0, 0, 0, 0, 0, 0], 1, { ptrs: [[14, 1]] })],
      ["Z", 14, mk_alloc([], 1)],
    ];
    for (const [name, id, a] of statics) {
      const i = fake.items.findIndex((it) => it.name === name);
      fake.allocs.set(id, () => ({ $: "Static", _0: did(i) }));
      // the static's initializer (`eval_static_initializer`), keyed `1000 + item index + 1` by the fake
      fake.allocs.set(1000 + i + 1, memory(a));
    }
    fake.allocs.set(12, memory(mk_alloc([0, 0, 0, 0], 4, { uninit: true })));
    return fake;
  }

  test("uninit bytes, a zero-sized static, a static in a const context (allocs.mir alloc12 / alloc14 / `alloc1 (static: S)`)", () => {
    const fake = allocs();
    with_tcx(fake, (tcx) => {
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "u"), w))).toBe(alloc(allocs_mir, "alloc12 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "z"), w))).toBe(alloc(allocs_mir, "alloc14 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "WS2_body"), w))).toBe("\nalloc1 (static: S)\n");
      expect(allocs_mir).toContain("\nalloc1 (static: S)\n");
    });
  });

  test("provenance: a pointer, three pointers over two lines, a pointer across the line end (both layouts), relocations followed (allocs.mir)", () => {
    const fake = allocs();
    with_tcx(fake, (tcx) => {
      const chain = (first: string): string => alloc(allocs_mir, first) + alloc(allocs_mir, "alloc1 (static: S, size");
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "q"), w))).toBe(chain("alloc2 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "t"), w))).toBe(chain("alloc3 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "w"), w))).toBe(chain("alloc5 ("));
      expect(out((w) => write_allocations(tcx, body_named(tcx, fake, "w2"), w))).toBe(chain("alloc9 ("));
    });
  });
});

describe("pretty_print_const_value", () => {
  test("string slices, all-uninit memory, scalar ints (basic.mir / allocs.mir `const ..` operands)", () => {
    const fake = basic();
    fake.allocs.set(12, memory(mk_alloc([0, 0, 0, 0], 4, { uninit: true })));
    with_tcx(fake, (tcx) => {
      const ppcv = (ct: ConstValue, ty: Ty): string => pretty_print_const_value_tcx(tcx, ct, ty, PLAIN);
      const basic_mir = fixture("basic.mir");
      expect(basic_mir).toContain(`_0 = const ${ppcv(str_val(1, 5), ref_str(tcx))};`);
      expect(basic_mir).toContain(`_0 = const ${ppcv(str_val(8, 2), ref_str(tcx))};`);
      expect(fixture("allocs.mir")).toContain(`_0 = const ${ppcv({ $: "Indirect", alloc_id: 12 as AllocId, offset: Size.ZERO }, tcx.types.u32)};`);
      expect(ppcv(str_val(1, 5), ref_str(tcx))).toBe('"hello"');
      expect(ppcv({ $: "Indirect", alloc_id: 12 as AllocId, offset: Size.ZERO }, tcx.types.u32)).toBe("<uninit>");
      expect(basic_mir).toContain(`const C: i32 = const ${ppcv({ $: "Scalar", _0: { $: "Int", _0: ScalarInt.raw(7n, Size.from_bytes(4)) } }, tcx.types.i32)};`);
    });
  });
});

describe("intro: signature and local declarations (write_mir_intro)", () => {
  for (const spans of [false, true]) {
    const name = spans ? "basic.spans.mir" : "basic.mir";
    test(`${name}: S, P, P::promoted[0], g`, () => {
      const fake = basic(spans ? { mir_include_spans: "On" } : {});
      const expected = fixture(name);
      with_tcx(fake, (tcx) => {
        const options = PrettyPrintMirOptions.from_cli(tcx);
        expect(options.include_extra_comments).toBe(spans);
        const P = body_named(tcx, fake, "P");
        const promoted = tcx.promoted_mir(P.source.def_id())[0]!;
        for (const [body, header] of [
          [body_named(tcx, fake, "S"), "static S: "],
          [P, "static P: "],
          [promoted, "const P::promoted[0]: "],
          [body_named(tcx, fake, "g"), "fn g() "],
        ] as const) {
          expect(out((w) => write_mir_intro(tcx, body, w, options))).toBe(intro(expected, header));
        }
      });
    });
  }
});

describe("extra comments (ExtraComments::visit_const_operand / write_extra)", () => {
  test("basic.spans.mir: `const \"hello\"`, `const P::promoted[0]`, `const \"hi\"`", () => {
    const fake = basic({ mir_include_spans: "On" });
    const expected = fixture("basic.spans.mir");
    with_tcx(fake, (tcx) => {
      const options = PrettyPrintMirOptions.from_cli(tcx);
      for (const [name, stmt_index, stmt_text] of [
        ["S", 0, '_0 = const "hello";'],
        ["P", 1, "_3 = const P::promoted[0];"],
        ["g", 0, '_0 = const "hi";'],
      ] as const) {
        const st = body_named(tcx, fake, name).basic_blocks.deref()[0]!.statements[stmt_index]!;
        const rv = (st.kind as { _0: [Place, Rvalue] })._0[1] as { _0: { _0: ConstOperand } };
        const text = out((w) => write_extra(tcx, w, (v) => v.visit_const_operand(rv._0._0, new Location(BasicBlock.from_u32(0), stmt_index)), options));
        expect(text.split("\n").length).toBe(4);
        // the comment lines follow the statement's own line in the oracle's output
        const line = expected.split("\n").find((l) => l.startsWith(`        ${stmt_text}`));
        expect(line).toBeDefined();
        expect(expected).toContain(`${line}\n${text}`);
      }
      // `const 5_i32` (an `i32`) prints no comment (`use_verbose`)
      const promoted = tcx.promoted_mir(did(2))[0]!;
      const st = promoted.basic_blocks.deref()[0]!.statements[0]!;
      const rv = (st.kind as { _0: [Place, Rvalue] })._0[1] as { _0: { _0: ConstOperand } };
      expect(out((w) => write_extra(tcx, w, (v) => v.visit_const_operand(rv._0._0, Location.START), options))).toBe("");
    });
  });
});

describe("MirDumper", () => {
  test("-Zdump-mir filters (`all`, substrings of the pass or the item, `&` / `|`)", () => {
    for (const [filter, enabled] of [
      [undefined, false],
      ["all", true],
      ["built", true],
      ["f & built", true],
      ["g & built", false],
      ["nll | f", true],
      ["nll | g & built", false],
      [" f &built ", true],
    ] as const) {
      const fake = basic({ dump_mir: filter });
      with_tcx(fake, (tcx) => {
        expect(`${filter}: ${MirDumper.new(tcx, "built", body_named(tcx, fake, "f")) !== undefined}`).toBe(`${filter}: ${enabled}`);
      });
    }
  });

  test("dump file names (the oracle's -Zdump-mir=built files; -Zdump-mir-exclude-pass-number; no pass number)", () => {
    const names = readdirSync(join(DIR, "built")).sort();
    for (const [unstable, show_pass_num, expected] of [
      [{}, true, names],
      [{ dump_mir_exclude_pass_number: true }, true, ["basic.C.built.after.mir", "basic.S.built.after.mir", "basic.f.built.after.mir"]],
      [{}, false, ["basic.C.-------.built.after.mir", "basic.S.-------.built.after.mir", "basic.f.-------.built.after.mir"]],
    ] as const) {
      const fake = basic({ dump_mir: "all", dump_mir_dir: "/d", ...unstable });
      fake.items[5]!.body = (tcx) => mk_body(did(5), { phase: MirPhase.Built, locals: [local_decl(true, tcx.types.i32, si(DUMMY_SP))], blocks: [] });
      with_tcx(fake, (tcx) => {
        const got = ["C", "S", "f"].map((name) => {
          let d = MirDumper.new(tcx, "built", body_named(tcx, fake, name))!.set_disambiguator("after");
          if (show_pass_num) d = d.set_show_pass_num();
          const body = body_named(tcx, fake, name);
          body.phase = MirPhase.Built;
          return d.dump_path("mir", body);
        });
        expect(got).toEqual(expected.map((n) => `/d/${n}`));
      });
    }
  });
});

describe.skipIf(blocked.body)("whole bodies (needs mir-body-a/b's Debug impls)", () => {
  test("write_mir_pretty: basic.mir, basic.spans.mir, basic.noalloc.mir", () => {
    for (const [name, unstable] of [
      ["basic.mir", {}],
      ["basic.spans.mir", { mir_include_spans: "On" }],
      ["basic.noalloc.mir", { dump_mir_exclude_alloc_bytes: true }],
    ] as const) {
      const fake = basic(unstable);
      with_tcx(fake, (tcx) => {
        expect(out((w) => write_mir_pretty(tcx, w))).toBe(fixture(name));
      });
    }
  });

  test("MirWriter::write_mir_fn: fn f (debug lines, a scope, a block)", () => {
    const fake = basic();
    with_tcx(fake, (tcx) => {
      expect(out((w) => MirWriter.new(tcx).write_mir_fn(body_named(tcx, fake, "f"), w))).toBe(item(fixture("basic.mir"), "fn f("));
    });
  });

  test("MirDumper::dump_mir writes the -Zdump-mir=built files (S, C)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mir-pretty-dump-"));
    try {
      const fake = basic({ dump_mir: "all", dump_mir_dir: dir });
      // C's built MIR (the trivial const has a body before `trivial_const` reads it)
      fake.items[5]!.body = (tcx) =>
        mk_body(did(5), {
          phase: MirPhase.Built,
          locals: [local_decl(true, tcx.types.i32, si(DUMMY_SP))],
          blocks: [block([assign(si(DUMMY_SP), place(tcx, 0), use_const(DUMMY_SP, { $: "Val", _0: { $: "Scalar", _0: { $: "Int", _0: ScalarInt.raw(7n, Size.from_bytes(4)) } }, _1: tcx.types.i32 }))], si(DUMMY_SP))],
        });
      with_tcx(fake, (tcx) => {
        for (const name of ["S", "C"]) {
          const body = body_named(tcx, fake, name);
          body.phase = MirPhase.Built;
          MirDumper.new(tcx, "built", body)!.set_show_pass_num().set_disambiguator("after").dump_mir(body);
          const file = `basic.${name}.1-1-000.built.after.mir`;
          expect(existsSync(join(dir, file))).toBe(true);
          expect(readFileSync(join(dir, file), "utf8")).toBe(fixture(join("built", file)));
        }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("the stand-ins are only fallbacks (restored after the file)", () => {
  expect(restores.length).toBeGreaterThan(0);
  expect(typeof (RETURN_PLACE as number)).toBe("number");
  expect(OUTERMOST_SOURCE_SCOPE as number).toBe(0);
});
