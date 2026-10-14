// Port of compiler/rustc_middle/src/ty/opaque_types.rs (lane assoc-opaque).
//
// PORT: `#[instrument]` / `debug!` / `trace!` (tracing) produce no output in the oracle and are left out.
// PORT (D4): `ReverseMapper` implements the `TypeFolder` interface (rustc_type_ir/fold.ts); the provided methods it
// does not override forward to `TypeFolder_provided`. `kind.fold_with(self)` is `fold_GenericArg.fold_with(kind, this)`.
// Init order: the class body reads its imports inside methods only, so ty/mod.ts may import this module.
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Binder } from "../../rustc_type_ir/binder.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { debug_GenericArgKind } from "../../rustc_type_ir/generic_arg.gen.ts";
import { display_Const, display_Region } from "../../rustc_type_ir/ir_print.ts";
import type { OpaqueTypeKey as OpaqueTypeKeyIr } from "../../rustc_type_ir/opaque_ty.ts";
import { Const, debug_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, panic } from "../../std/panic.ts";
import { ConstNotUsedTraitAlias_diagnostic } from "../diagnostics.gen.ts";
import type { TyCtxt } from "./context.ts";
import { fold_GenericArg, GenericArg, type GenericArgs } from "./generic_args.ts";
import type { Clauses } from "./list.ts";
import { Ty } from "./mod.ts";
import { display_Ty } from "./print/pretty.ts";
import { fold_Ty } from "./structural_impls.ts";

export type OpaqueTypeKey = OpaqueTypeKeyIr;

/// Converts generic params of a TypeFoldable from one
/// item's generics to another. Usually from a function's generics
/// list to the opaque type's own generics.
// rustc-type: compiler/rustc_middle/src/ty/opaque_types.rs:16 ReverseMapper
export class ReverseMapper implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public map: Map<GenericArg, GenericArg>,
    /// see call sites to fold_kind_no_missing_regions_error
    /// for an explanation of this field.
    public do_not_error: boolean,

    /// Span of function being checked.
    public span: Span,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:28 new
  static new(tcx: TyCtxt, map: Map<GenericArg, GenericArg>, span: Span): ReverseMapper {
    return new ReverseMapper(tcx, map, false, span);
  }

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:36 fold_kind_no_missing_regions_error
  fold_kind_no_missing_regions_error(kind: GenericArg): GenericArg {
    assert(!this.do_not_error, "assertion failed: !self.do_not_error");
    this.do_not_error = true;
    const kind_ = fold_GenericArg.fold_with(kind, this);
    this.do_not_error = false;
    return kind_;
  }

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:44 fold_kind_normally
  fold_kind_normally(kind: GenericArg): GenericArg {
    assert(!this.do_not_error, "assertion failed: !self.do_not_error");
    return fold_GenericArg.fold_with(kind, this);
  }

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:49 fold_closure_args
  fold_closure_args(def_id: DefId, args: GenericArgs): GenericArgs {
    // I am a horrible monster and I pray for death. When
    // we encounter a closure here, it is always a closure
    // from within the function that we are currently
    // type-checking -- one that is now being encapsulated
    // in an opaque type. Ideally, we would
    // go through the types/lifetimes that it references
    // and treat them just like we would any other type,
    // which means we would error out if we find any
    // reference to a type/region that is not in the
    // "reverse map".
    //
    // **However,** in the case of closures, there is a
    // somewhat subtle (read: hacky) consideration. The
    // problem is that our closure types currently include
    // all the lifetime parameters declared on the
    // enclosing function, even if they are unused by the
    // closure itself. We can't readily filter them out,
    // so here we replace those values with `'empty`. This
    // can't really make a difference to the rest of the
    // compiler; those regions are ignored for the
    // outlives relation, and hence don't affect trait
    // selection or auto traits, and they are erased
    // during codegen.

    // PORT: `generics_of` has an `unknown` value in queries.gen.ts; `parent_count` is the only field read.
    const generics = this.tcx.generics_of(def_id) as { parent_count: number };
    const self = this;
    function* folded(): Generator<GenericArg> {
      let index = 0;
      for (const kind of args) {
        if (index < generics.parent_count) {
          // Accommodate missing regions in the parent kinds...
          yield self.fold_kind_no_missing_regions_error(kind);
        } else {
          // ...but not elsewhere.
          yield self.fold_kind_normally(kind);
        }
        index++;
      }
    }
    return this.tcx.mk_args_from_iter(folded());
  }

  // ---- impl TypeFolder<TyCtxt<'tcx>> for ReverseMapper<'tcx> ----

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:92 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  /** (provided) `TypeFolder::fold_binder` */
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:97 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    switch (k.$) {
      // Ignore bound regions and `'static` regions that appear in the
      // type, we only need to remap regions that reference lifetimes
      // from the function declaration.
      //
      // E.g. We ignore `'r` in a type like `for<'r> fn(&'r u32)`.
      case "ReBound":
      case "ReStatic":
        return r;

      // If regions have been erased (by writeback), don't try to unerase
      // them.
      case "ReErased":
        return r;

      case "ReError":
        return r;

      // The regions that we expect from borrow checking.
      case "ReEarlyParam":
      case "ReLateParam":
        break;

      case "RePlaceholder":
      case "ReVar": {
        // All of the regions in the type should either have been
        // erased by writeback, or mapped back to named regions by
        // borrow checking.
        return bug(`unexpected region kind in opaque type: ${debug_Region(r, PLAIN)}`);
      }
    }

    const arg = this.map.get(GenericArg.from_Region(r));
    const u = arg === undefined ? undefined : GenericArg.kind(arg);
    if (u !== undefined && u.$ === "Lifetime") {
      return u._0;
    } else if (u !== undefined) {
      return panic(`region mapped to unexpected kind: ${debug_GenericArgKind(u, PLAIN)}`);
    } else if (this.do_not_error) {
      return this.tcx.lifetimes.re_static;
    } else {
      const guar = this.tcx
        .dcx()
        .struct_span_err(this.span, "non-defining opaque type use in defining scope")
        .with_span_label(
          this.span,
          `lifetime \`${display_Region(r)}\` is part of concrete type but not used in parameter list of the \`impl Trait\` type alias`,
        )
        .emit_err();

      return Region.new_error(this.cx(), guar);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:146 fold_ty
  fold_ty(ty: Ty): Ty {
    const k = ty.kind();
    switch (k.$) {
      case "Closure": {
        const def_id = k._0;
        const args = this.fold_closure_args(def_id, k._1);
        return Ty.new_closure(this.tcx, def_id, args);
      }

      case "Coroutine": {
        const def_id = k._0;
        const args = this.fold_closure_args(def_id, k._1);
        return Ty.new_coroutine(this.tcx, def_id, args);
      }

      case "CoroutineWitness": {
        const def_id = k._0;
        const args = this.fold_closure_args(def_id, k._1);
        return Ty.new_coroutine_witness(this.tcx, def_id, args);
      }

      case "Param": {
        // Look it up in the generic parameters list.
        const arg = this.map.get(GenericArg.from_Ty(ty));
        const u = arg === undefined ? undefined : GenericArg.kind(arg);
        // Found it in the generic parameters list; replace with the parameter from the
        // opaque type.
        if (u !== undefined && u.$ === "Type") {
          return u._0;
        } else if (u !== undefined) {
          return panic(`type mapped to unexpected kind: ${debug_GenericArgKind(u, PLAIN)}`);
        } else {
          // debug!(?param, ?self.map);
          const guar = this.tcx
            .dcx()
            .struct_span_err(
              this.span,
              `type parameter \`${display_Ty(ty)}\` is part of concrete type but not used in parameter list for the \`impl Trait\` type alias`,
            )
            .emit_err();
          return Ty.new_error(this.tcx, guar);
        }
      }

      default:
        return fold_Ty.super_fold_with(ty, this);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/opaque_types.rs:192 fold_const
  fold_const(ct: Const): Const {
    // trace!("checking const {:?}", ct);
    // Find a const parameter
    const k = ct.kind();
    switch (k.$) {
      case "Param": {
        // Look it up in the generic parameters list.
        const arg = this.map.get(GenericArg.from_Const(ct));
        const u = arg === undefined ? undefined : GenericArg.kind(arg);
        // Found it in the generic parameters list, replace with the parameter from the
        // opaque type.
        if (u !== undefined && u.$ === "Const") {
          return u._0;
        } else if (u !== undefined) {
          return panic(`const mapped to unexpected kind: ${debug_GenericArgKind(u, PLAIN)}`);
        } else {
          const guar = this.tcx.dcx().emit_err(ConstNotUsedTraitAlias_diagnostic({ ct: display_Const(ct), span: this.span }));
          return Const.new_error(this.tcx, guar);
        }
      }

      default:
        return ct;
    }
  }

  /** (provided) `TypeFolder::fold_predicate` */
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  /** (provided) `TypeFolder::fold_clauses` */
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

