// MIR aliasing checker (lane fix-ubchecks-alias; test helper, not a port).
//
// In rustc a `mir::Body` owns everything it holds: `Place`, `SourceInfo`, `Operand`, statements, terminators, constant
// operands, ... are `Copy` or uniquely owned, so no two positions of a body can hold the same value. MIR passes edit
// these in place (`MutVisitor`: `SimplifyLocals` / `RenameLocals` rename `place.local`, the inliner remaps
// `source_info.scope`, `replace_in_place` rewrites an operand), so a TS object reachable from two positions of a body
// is a bug: the edit is applied twice, or to a position it was not meant for (PORTING §8, decision 2026-10-22 "MIR build
// aliasing").
//
// `find_shared_mir_objects(body)` walks the body's object graph (own enumerable properties, arrays and `Map` values)
// and reports every object reached a second time. Not walked: frozen objects (interned type-system values, shared unit
// variants, `RawList`s), `BasicBlocks.cache` (an `Arc` upstream, derived data) and the immutable value classes in
// `IMMUTABLE` (never edited in place by a visitor, so sharing them is harmless).

/** Constructor names of value classes that no MIR pass edits in place. */
const IMMUTABLE: ReadonlySet<string> = new Set(["DefId", "LocalDefId", "HirId", "OwnerId"]);

/** Property names that are skipped (derived data shared upstream through an `Arc`). */
const SKIP_FIELDS: ReadonlySet<string> = new Set(["cache"]);

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

function describe(o: object): string {
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

/**
 * The MIR nodes that passes edit in place (`MutVisitor`, `replace_in_place`, field writes): a shared one is always a
 * port bug. Other shared objects (e.g. a `BlockTailInfo` or `CoroutineKind` payload, an `Instance` in
 * `SourceScopeData::inlined`) are immutable values that rustc copies; sharing them cannot change any output.
 */
export const MIR_NODES: ReadonlySet<string> = new Set([
  "Place",
  "SourceInfo",
  "Statement",
  "Terminator",
  "BasicBlockData",
  "LocalDecl",
  "ConstOperand",
  "SourceScopeData",
  "Operand::Copy",
  "Operand::Move",
  "Operand::Constant",
]);

/** Every object of `root`'s graph that is reachable through two paths (up to `limit` reports). */
export function find_shared_objects(root: object, root_path = "body", limit = 50): SharedObject[] {
  const seen = new Map<object, string>();
  const out: SharedObject[] = [];
  const stack: [unknown, string][] = [[root, root_path]];
  while (stack.length > 0) {
    const [v, path] = stack.pop()!;
    if (v === null || typeof v !== "object") continue;
    if (Object.isFrozen(v)) continue;
    const name = describe(v);
    if (IMMUTABLE.has(name)) continue;
    const prev = seen.get(v);
    if (prev !== undefined) {
      out.push({ what: name, first: prev, second: path });
      if (out.length >= limit) break;
      continue;
    }
    seen.set(v, path);
    if (v instanceof Map) {
      for (const [k, x] of v) stack.push([x, `${path}{${String(k)}}`]);
      continue;
    }
    if (v instanceof Set) continue;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], `${path}[${i}]`]);
      continue;
    }
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i]!;
      if (SKIP_FIELDS.has(k)) continue;
      stack.push([(v as Record<string, unknown>)[k], `${path}.${k}`]);
    }
  }
  return out;
}

/** `find_shared_objects` on a MIR body. */
export function find_shared_mir_objects(body: object, limit = 50): SharedObject[] {
  return find_shared_objects(body, "body", limit);
}

/** The shared objects of `root` (a body, or an array of bodies) that are `MIR_NODES`. */
export function find_shared_mir_nodes(root: object, root_path = "body", limit = 50): SharedObject[] {
  return find_shared_objects(root, root_path, Number.MAX_SAFE_INTEGER)
    .filter((s) => MIR_NODES.has(s.what))
    .slice(0, limit);
}
