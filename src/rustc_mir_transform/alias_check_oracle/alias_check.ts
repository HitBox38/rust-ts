// MIR aliasing checker (lanes fix-ubchecks-alias, mir-alias; test helper, not a port).
//
// In rustc a `mir::Body` owns everything it holds: `Place`, `SourceInfo`, `Operand`, statements, terminators, constant
// operands, ... are `Copy` or uniquely owned, so no two positions of a body can hold the same value. MIR passes edit
// these in place (`MutVisitor`: `SimplifyLocals` / `RenameLocals` rename `place.local`, the inliner remaps
// `source_info.scope`, `replace_in_place` rewrites an operand), so a TS object reachable from two positions of a body
// is a bug: the edit is applied twice, or to a position it was not meant for (PORTING §8, decision 2026-10-22 "MIR build
// aliasing").
//
// `find_shared_objects(body)` walks the body's object graph (own data properties of any kind: enumerable or not, string or
// symbol; arrays; `Map` keys and values; `Set` members) and reports every object reached a second time. **Everything counts as
// mutable unless this file says why it is not** (the list used to name the mutable types, and a type nobody listed could not
// be reported). It cannot see accessors, which it does not call, or `#private` fields.
//
// - Interned values and lists are not walked: the type-system values (`Interned`) and `RawList`s, shared by design. Writing to
//   one throws (ES modules are strict). `Object.isFrozen` is shallow: the `PlaceElem`s inside a projection list are not frozen,
//   but `MutVisitor::process_projection_elem` builds new elements instead of writing to them.
// - Other frozen objects cannot be written, so sharing one is not reported, but what they hold can be, so it is walked: a
//   frozen wrapper reached twice reports its unfrozen children.
// - Unit variants (no own field but `$`) are not walked: no field to write. Only the dataflow state lattices write `.$`, and
//   `replace_in_place` targets only `Operand`, `Rvalue`, `Place` and `StmtDebugInfo`, none of which has a unit variant.
// - `IMMUTABLE`: value classes with no in-place writes.
// - `BasicBlocks.cache`: an `Arc` upstream, derived data.
// - `IMMUTABLE_POSITIONS`: `Copy` payloads that upstream does copy, at the positions below, which no pass writes into. The
//   check is by position as well as type because the same tag can be mutable elsewhere (`.msg._0` is also an `Operand`).

import { Interned } from "../../rustc_data_structures/intern.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";

/** Constructor names of value classes that no MIR pass edits in place. */
const IMMUTABLE: ReadonlySet<string> = new Set(["DefId", "LocalDefId", "HirId", "OwnerId", "Size", "Align", "ScalarInt", "ErrorGuaranteed"]);

/**
 * `[what, path]`: a hit is harmless when both of its paths match one row. Checked by reading every field write in
 * rustc_mir_transform and rustc_middle/mir (docs/handoff/mir-alias.md): each of these is replaced whole or never written.
 */
const IMMUTABLE_POSITIONS: readonly [RegExp, RegExp, string][] = [
  // `const_operand.const_ = ..` replaces the `Const`; nothing writes inside `ConstValue` / `Scalar`.
  [/./, /\.const_\._0(\.|\[|$)/, "payload of `mir::Const`: replaced whole, never written"],
  // `body.source.instance = ..` and `scope_data.inlined = ..` replace the `Instance`. `super_source_scope` does take `&mut` of its
  // `args` and shim types, but a write needs a `visit_ty` / `visit_args` override, and the overrides that write run before any
  // inlining (`PostAnalysisNormalize`, and `RegionRenumberer` on borrowck's copy). One row: a share can span both positions.
  [/./, /\.(source\.instance|inlined\[\d+\])(\.|\[|$)/, "`Instance` in `MirSource` / `SourceScopeData::inlined`: replaced whole"],
  // `**info = ..` writes the `ClearCrossCrate::Set`'s `_0` (patch.ts), so `.local_info` and `.local_info._0` stay checked.
  [/./, /\.local_info\._0\._0(\.|\[|$)/, "payload of a `LocalInfo`: never written"],
  [/./, /\.user_type_annotations\[\d+\]\.user_ty(\.|\[|$)/, "canonical user type: dropped whole by CleanupPostBorrowck"],
  // `rv._0 = CastKind::IntToInt` replaces the `CastKind`; `PointerCoercion` has `Safety` or `CoercionSource` in it, never written.
  [/^\{\$: (PointerCoercion|ReifyFnPointer|ClosureFnPointer|UnsafeFnPointer)\}$/, /\.kind\._0\[1\]\._0(\._0)?$/, "payload of a `CastKind`: never written"],
  // `InlineAsm { template: &'tcx [..], line_spans: &'tcx [..], .. }`: interned upstream, so one value there too.
  [/./, /\.kind\.(template|line_spans)(\[\d+\])?$/, "`&'tcx` slices of `InlineAsm`: shared upstream"],
  // No visitor reaches the register of an `InlineAsmOperand`.
  [/^\{\$: (Reg|RegClass)\}$/, /\.operands\[\d+\]\.reg$/, "`InlineAsmRegOrRegClass`: never written"],
  // `AssertKind::ResumedAfter*(CoroutineKind)`; the same position holds an `Operand` for `OverflowNeg` / `DivisionByZero`.
  [/^\{\$: (Desugared|Coroutine)\}$/, /\.(msg\._0|coroutine_kind)$/, "`CoroutineKind`: never written"],
];

/** Whether a share at these two positions is harmless (see `IMMUTABLE_POSITIONS`). */
export function is_immutable_hit(what: string, first: string, second: string): boolean {
  return IMMUTABLE_POSITIONS.some(([w, p]) => w.test(what) && p.test(first) && p.test(second));
}

export interface SharedObject {
  /** The class name, or the `$` tag of a tagged plain object. */
  what: string;
  /** The first path at which the object was reached (`basic_blocks.basic_blocks[0].statements[1].kind._0[0]`). */
  first: string;
  /** The path at which it was reached again. */
  second: string;
}

function ctor_name(o: unknown): string | undefined {
  if (o === null || typeof o !== "object") return undefined;
  return (o as { constructor?: { name?: string } }).constructor?.name;
}

export function describe_object(o: object): string {
  const ctor = ctor_name(o);
  if (ctor !== undefined && ctor !== "Object" && ctor !== "Array") return ctor;
  const tag = (o as { $?: unknown }).$;
  if (typeof tag === "string") {
    // `mir::Operand` (`Copy(Place)` / `Move(Place)` / `Constant(Box<ConstOperand>)`).
    const inner = ctor_name((o as { _0?: unknown })._0);
    if (((tag === "Copy" || tag === "Move") && inner === "Place") || (tag === "Constant" && inner === "ConstOperand")) {
      return `Operand::${tag}`;
    }
    return `{$: ${tag}}`;
  }
  return ctor ?? "object";
}

/** A unit enum variant that is not a frozen singleton: `{ $: "Tag" }`. */
function is_unit_variant(o: object): boolean {
  if (typeof (o as { $?: unknown }).$ !== "string") return false;
  const keys = Object.keys(o);
  return keys.length === 1;
}

/** What `v` holds, for `find_shared_objects`' stack: last pushed is walked first, so the first path is the lowest index. */
function push_children(stack: [unknown, string][], v: object, name: string, path: string): void {
  if (v instanceof Map) {
    for (const [k, x] of v) {
      stack.push([k, `${path}{key ${String(k)}}`]);
      stack.push([x, `${path}{${String(k)}}`]);
    }
    return;
  }
  if (v instanceof Set) {
    let i = 0;
    for (const x of v) stack.push([x, `${path}{member ${i++}}`]);
    return;
  }
  if (ArrayBuffer.isView(v)) return;
  const is_array = Array.isArray(v);
  const keys = Reflect.ownKeys(v);
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i]!;
    if (is_array && typeof k === "string" && (k === "length" || /^\d+$/.test(k))) continue;
    // `BasicBlocks.cache`: an `Arc` upstream, derived data.
    if (k === "cache" && name === "BasicBlocks") continue;
    const d = Object.getOwnPropertyDescriptor(v, k)!;
    if ("value" in d) stack.push([d.value, typeof k === "string" ? `${path}.${k}` : `${path}[${String(k)}]`]);
  }
  if (is_array) {
    const a = v as unknown[];
    for (let i = a.length - 1; i >= 0; i--) stack.push([a[i], `${path}[${i}]`]);
  }
}

/**
 * Every object of `root`'s graph that is reachable through two paths (up to `limit` reports). `on_object` is called once
 * per walked object with its first path (the cross-body check in hooks.ts).
 */
export function find_shared_objects(root: object, root_path = "body", limit = 50, on_object?: (o: object, path: string) => void): SharedObject[] {
  const seen = new Map<object, string>();
  const frozen_walks = new Map<object, number>();
  const out: SharedObject[] = [];
  const stack: [unknown, string][] = [[root, root_path]];
  while (stack.length > 0) {
    const [v, path] = stack.pop()!;
    if (v === null || typeof v !== "object") continue;
    if (v instanceof Interned || v instanceof RawList) continue;
    const name = describe_object(v);
    if (IMMUTABLE.has(name)) continue;
    if (Object.isFrozen(v)) {
      // Twice at most: the second reach is the one that reports a child, and it keeps a frozen cycle from looping.
      const walks = frozen_walks.get(v) ?? 0;
      if (walks < 2) {
        frozen_walks.set(v, walks + 1);
        push_children(stack, v, name, path);
      }
      continue;
    }
    if (is_unit_variant(v)) continue;
    const prev = seen.get(v);
    if (prev !== undefined) {
      out.push({ what: name, first: prev, second: path });
      if (out.length >= limit) break;
      continue;
    }
    seen.set(v, path);
    on_object?.(v, path);
    push_children(stack, v, name, path);
  }
  return out;
}

/** `find_shared_objects` on a MIR body. */
export function find_shared_mir_objects(body: object, limit = 50): SharedObject[] {
  return find_shared_objects(body, "body", limit);
}

/** The shared objects of `root` (a body, or an array of bodies) that can be edited in place. */
export function find_shared_mir_nodes(root: object, root_path = "body", limit = 50): SharedObject[] {
  return find_shared_objects(root, root_path, Number.MAX_SAFE_INTEGER)
    .filter((s) => !is_immutable_hit(s.what, s.first, s.second))
    .slice(0, limit);
}
