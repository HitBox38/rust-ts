// Port of compiler/rustc_middle/src/ty/significant_drop_order.rs (lane mt-built-lints).
//
// PORT: `SmallVec<[Ty; N]>` is `Ty[]`; `UnordSet<Ty>` / `FxHashSet<Ty>` are `Set<Ty>` (interned: identity). The slice
// patterns over the path segments are explicit length/element checks in arm order. ty/mod.rs's
// `pub mod significant_drop_order;` is not re-exported from ty/mod.ts (not this lane's file); users import this module.
import { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Symbol, type Symbol as SymbolT } from "../../rustc_span/symbol.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { TyCtxt } from "./context.ts";
import { GenericArg } from "./generic_args.ts";
import type { List } from "./list.ts";
import type { Destructor, Ty, TypingEnv } from "./mod.ts";
import { fold_Ty } from "./structural_impls.ts";

/// An additional filter to exclude well-known types from the ecosystem
/// because their drops are trivial.
/// This returns additional types to check if the drops are delegated to those.
/// A typical example is `hashbrown::HashMap<K, V>`, whose drop is delegated to `K` and `V`.
// rustc: compiler/rustc_middle/src/ty/significant_drop_order.rs:14 true_significant_drop_ty
function true_significant_drop_ty(tcx: TyCtxt, ty: Ty): Ty[] | undefined {
  const kind = ty.kind();
  if (kind.$ === "Adt") {
    const [def, args] = [kind._0, kind._1];
    let did = def.did();
    const name_rev: SymbolT[] = [];
    for (;;) {
      const key = tcx.def_key(did);

      const data = key.disambiguated_data.data;
      switch (data.$) {
        case "CrateRoot":
          name_rev.push(tcx.crate_name(did.krate));
          break;
        case "TypeNs":
          name_rev.push(data._0);
          break;
        default:
          return undefined;
      }
      if (key.parent !== undefined) {
        did = new DefId(key.parent, did.krate);
      } else {
        break;
      }
    }
    const name_str: string[] = name_rev
      .slice()
      .reverse()
      .map((x) => Symbol.as_str(x));
    // debug!(?name_str);
    const n = name_str;
    // These are the types from Rust core ecosystem
    if (
      (n.length >= 1 && (n[0] === "syn" || n[0] === "proc_macro2")) ||
      (n.length === 3 && (n[0] === "core" || n[0] === "std") && n[1] === "task" && (n[2] === "LocalWaker" || n[2] === "Waker")) ||
      (n.length === 4 &&
        (n[0] === "core" || n[0] === "std") &&
        n[1] === "task" &&
        n[2] === "wake" &&
        (n[3] === "LocalWaker" || n[3] === "Waker"))
    ) {
      return [];
    }
    // These are important types from Rust ecosystem
    if (
      (n.length === 3 && n[0] === "tracing" && n[1] === "instrument" && n[2] === "Instrumented") ||
      (n.length === 2 && n[0] === "bytes" && n[1] === "Bytes")
    ) {
      return [];
    }
    if (n.length === 3 && n[0] === "hashbrown" && n[1] === "raw" && (n[2] === "RawTable" || n[2] === "RawIntoIter")) {
      const ty_ = args.length >= 1 ? GenericArg.as_type(args[0]!) : undefined;
      if (ty_ !== undefined) {
        return [ty_];
      } else {
        return undefined;
      }
    }
    if (n.length === 3 && n[0] === "hashbrown" && n[1] === "raw" && n[2] === "RawDrain") {
      const ty_ = args.length >= 2 ? GenericArg.as_type(args[1]!) : undefined;
      if (ty_ !== undefined) {
        return [ty_];
      } else {
        return undefined;
      }
    }
    return undefined;
  } else {
    return undefined;
  }
}

/// Returns the list of types with a "potentially significant" that may be dropped
/// by dropping a value of type `ty`.
// #[instrument(level = "trace", skip(tcx, typing_env))]
// rustc: compiler/rustc_middle/src/ty/significant_drop_order.rs:76 extract_component_raw
export function extract_component_raw(tcx: TyCtxt, typing_env: TypingEnv, ty_: Ty, ty_seen: Set<Ty>): Ty[] {
  // Droppiness does not depend on regions, so let us erase them.
  const n = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty_), fold_Ty);
  const ty = n.$ === "Ok" ? n._0 : ty_;

  // PORT: the `list_significant_drop_tys` query value is `unknown` in queries.gen.ts.
  const tys = tcx.list_significant_drop_tys(typing_env.as_query_input(ty)) as List<Ty>;
  // debug!(?ty, "components");
  const out_tys: Ty[] = [];
  for (const ty of tys) {
    const tys = true_significant_drop_ty(tcx, ty);
    if (tys !== undefined) {
      // Some types can be further opened up because the drop is simply delegated
      for (const ty of tys) {
        if (set_insert(ty_seen, ty)) {
          out_tys.push(...extract_component_raw(tcx, typing_env, ty, ty_seen));
        }
      }
    } else {
      if (set_insert(ty_seen, ty)) {
        out_tys.push(ty);
      }
    }
  }
  return out_tys;
}

/** `HashSet::insert`: whether the value was newly inserted. */
function set_insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

// #[instrument(level = "trace", skip(tcx, typing_env))]
// rustc: compiler/rustc_middle/src/ty/significant_drop_order.rs:106 extract_component_with_significant_dtor
export function extract_component_with_significant_dtor(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): Ty[] {
  const tys = extract_component_raw(tcx, typing_env, ty, new Set());
  const deduplicate = new Set<Ty>();
  return tys.filter((oty) => set_insert(deduplicate, oty));
}

/// Extract the span of the custom destructor of a type
/// especially the span of the `impl Drop` header or its entire block
/// when we are working with current local crate.
// #[instrument(level = "trace", skip(tcx))]
// rustc: compiler/rustc_middle/src/ty/significant_drop_order.rs:121 ty_dtor_span
export function ty_dtor_span(tcx: TyCtxt, ty: Ty): Span | undefined {
  const kind = ty.kind();
  switch (kind.$) {
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Error":
    case "Str":
    case "Never":
    case "RawPtr":
    case "Ref":
    case "FnPtr":
    case "Tuple":
    case "Dynamic":
    case "Alias":
    case "Bound":
    case "Pat":
    case "Placeholder":
    case "Infer":
    case "Slice":
    case "Array":
    case "UnsafeBinder":
      return undefined;

    case "Adt": {
      const adt_def = kind._0;
      // PORT: the `adt_destructor` query value is `unknown` in queries.gen.ts.
      const dtor = tcx.adt_destructor(adt_def.did()) as Destructor | undefined;
      if (dtor !== undefined) {
        return tcx.def_span(tcx.parent(dtor.did));
      } else {
        return tcx.def_span(adt_def.did());
      }
    }
    case "Coroutine":
    case "CoroutineWitness":
    case "CoroutineClosure":
    case "Closure":
    case "FnDef":
    case "Foreign":
      return tcx.def_span(kind._0);
    case "Param":
      return undefined;
  }
}
