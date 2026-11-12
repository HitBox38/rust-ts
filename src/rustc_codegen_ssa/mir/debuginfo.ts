// Port of compiler/rustc_codegen_ssa/src/mir/debuginfo.rs (lane ssa-debuginfo, plan-m7 wave 40o).
//
// Conventions (ssa-contract, mod.ts's header):
// - `FunctionCx<'a, 'tcx, Bx>` is `FunctionCx<B, Cx, Bx>`; `Bx::DIScope` is `B["DIScope"]`, and so on.
// - PORT (ssa-debuginfo): the `impl FunctionCx` block is in `install_FunctionCx_debuginfo(FunctionCx)`, which root calls
//   from mod.ts right after the class (constant.ts's header: a top-level prototype write would be a TDZ cycle with mod.ts).
//   This file imports mod.ts for types only.
// - PORT (ssa-debuginfo): `Range<Size>` is `readonly [Size, Size]` (`[start, end)`), as traits/debuginfo.ts's
//   `dbg_var_addr` takes it.
// - PORT (ssa-debuginfo): mod.ts declares `FunctionDebugContext`, `PerLocalVarDebugInfo` and `ConstDebugInfo` as opaque
//   placeholders until this lane lands (ssa-mir-core PORT 7). The types below have the same type parameters, so root
//   replaces the placeholders with `export type { ... } from "./debuginfo.ts"`. Until then the `debug_context` and
//   `per_local_var_debug_info` fields are read and written through `dctx`/`per_local` below, which cast.
// - `debug_assert!`/`debug_assert_eq!` stay comments (PORTING §3).
import { type FieldIdx, FieldsShape, Size, Size_eq, type VariantIdx } from "../../rustc_abi/lib.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { CodegenFnAttrFlags, TyCtxt_codegen_instance_attrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { debug_Local, Local, type Place, type PlaceElem, ProjectionElem, type SourceInfo, type SourceScope } from "../../rustc_middle/mir/mod.ts";
import type { StmtDebugInfo } from "../../rustc_middle/mir/statement.gen.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_with_Instance, type Instance, try_fold_with_Instance, visit_with_Instance } from "../../rustc_middle/ty/instance.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import type { List } from "../../rustc_middle/ty/list.ts";
import { Ty as TyC } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DebugInfo } from "../../rustc_session/config.ts";
import { walk_chain_collapsed } from "../../rustc_span/hygiene.ts";
import { type BytePos, DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { debug_vec, format_debug, PLAIN } from "../../std/fmt.ts";
import { assert, unwrap } from "../../std/panic.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx, LocalRef } from "./mod.ts";
import { type OperandRef, OperandValue } from "./operand.ts";
import { PlaceRef } from "./place.ts";
import { debug_ProjectionElem } from "../../rustc_middle/mir/syntax.ts";
import { debug_Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_TyAndLayout_Ty } from "../../rustc_middle/ty/layout.ts";

const d_Instance: TypeFoldable<Instance> = { visit_with: visit_with_Instance, try_fold_with: try_fold_with_Instance, fold_with: fold_with_Instance };

// rustc-type: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:21 FunctionDebugContext
export interface FunctionDebugContext<S, L> {
  /// Maps from source code to the corresponding debug info scope.
  scopes: DebugScope<S, L>[];

  /// Maps from an inlined function to its debug info declaration.
  inlined_function_scopes: KeyedMap<Instance, S>;
}

// #[derive(Copy, Clone)]
export type VariableKind =
  | { readonly $: "ArgumentVariable"; _0: number /*index*/ }
  | { readonly $: "LocalVariable" };
export const VariableKind = {
  /** Shared frozen singleton of the unit variant. */
  LocalVariable: Object.freeze({ $: "LocalVariable" }) as { readonly $: "LocalVariable" },
} as const;

/// Like `mir::VarDebugInfo`, but within a `mir::Local`.
// #[derive(Clone)]
export interface PerLocalVarDebugInfo<D> {
  readonly name: Symbol;
  readonly source_info: SourceInfo;

  /// `DIVariable` returned by `create_dbg_var`.
  readonly dbg_var: D | undefined;

  /// Byte range in the `dbg_var` covered by this fragment,
  /// if this is a fragment of a composite `VarDebugInfo`.
  readonly fragment: readonly [Size, Size] | undefined;

  /// `.place.projection` from `mir::VarDebugInfo`.
  readonly projection: List<PlaceElem>;
}

/// Information needed to emit a constant.
export interface ConstDebugInfo<B extends BackendTypes> {
  readonly name: string;
  readonly source_info: SourceInfo;
  readonly operand: OperandRef<B["Value"]>;
  readonly dbg_var: B["DIVariable"];
  readonly dbg_loc: B["DILocation"];
  readonly fragment: readonly [Size, Size] | undefined;
  // pub _phantom: PhantomData<&'a ()>,
}

// #[derive(Clone, Copy, Debug)]
export class DebugScope<S, L> {
  constructor(
    readonly dbg_scope: S,

    /// Call site location, if this scope was inlined from another function.
    readonly inlined_at: L | undefined,

    // Start and end offsets of the file to which this DIScope belongs.
    // These are used to quickly determine whether some span refers to the same file.
    readonly file_start_pos: BytePos,
    readonly file_end_pos: BytePos,
  ) {}

  /// DILocations inherit source file name from the parent DIScope. Due to macro expansions
  /// it may so happen that the current span belongs to a different file than the DIScope
  /// corresponding to span's containing source scope. If so, we need to create a DIScope
  /// "extension" into that file.
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:81 adjust_dbg_scope_for_span
  adjust_dbg_scope_for_span<B extends BackendTypes & { DIScope: S; DILocation: L }>(bx: BuilderMethods<B>, span: Span): S {
    const pos = Span.lo(span);
    if (pos < this.file_start_pos || pos >= this.file_end_pos) {
      const sm = bx.sess().source_map();
      return bx.extend_scope_to_file(this.dbg_scope, sm.lookup_char_pos(pos).file);
    } else {
      return this.dbg_scope;
    }
  }
}

// rustc-trait: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:99 DebugInfoOffsetLocation
// PORT (ssa-debuginfo): the trait is implemented by `PlaceRef<Bx::Value>` and by `TyAndLayout`; generic code takes the
// impl's function table (PORTING §5, "generic code over the trait takes the needed functions as parameters").
interface DebugInfoOffsetLocation<L, B extends BackendTypes> {
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:100 deref
  deref(self: L, bx: BuilderMethods<B>): L;
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:101 layout
  layout(self: L): TyAndLayout;
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:102 project_field
  project_field(self: L, bx: BuilderMethods<B>, field: FieldIdx): L;
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:103 project_constant_index
  project_constant_index(self: L, bx: BuilderMethods<B>, offset: bigint): L;
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:104 downcast
  downcast(self: L, bx: BuilderMethods<B>, variant: VariantIdx): L;
}

/** `impl DebugInfoOffsetLocation for PlaceRef<'tcx, Bx::Value>` (debuginfo.rs:107). */
function DebugInfoOffsetLocation_PlaceRef<B extends BackendTypes>(): DebugInfoOffsetLocation<PlaceRef<B["Value"]>, B> {
  return {
    // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:110 deref
    deref(self: PlaceRef<B["Value"]>, bx: BuilderMethods<B>): PlaceRef<B["Value"]> {
      return bx.load_operand(self).deref(bx.cx());
    },

    // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:114 layout
    layout(self: PlaceRef<B["Value"]>): TyAndLayout {
      return self.layout;
    },

    // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:118 project_field
    project_field(self: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, field: FieldIdx): PlaceRef<B["Value"]> {
      return self.project_field(bx, field);
    },

    // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:122 project_constant_index
    project_constant_index(self: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, offset: bigint): PlaceRef<B["Value"]> {
      const lloffset = bx.cx().const_usize(offset);
      return self.project_index(bx, lloffset);
    },

    // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:127 downcast
    downcast(self: PlaceRef<B["Value"]>, bx: BuilderMethods<B>, variant: VariantIdx): PlaceRef<B["Value"]> {
      return self.project_downcast(bx, variant);
    },
  };
}

/** `impl DebugInfoOffsetLocation for TyAndLayout<'tcx>` (debuginfo.rs:132). */
const DebugInfoOffsetLocation_TyAndLayout: DebugInfoOffsetLocation<TyAndLayout, BackendTypes> = {
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:135 deref
  deref(self: TyAndLayout, bx: BuilderMethods<BackendTypes>): TyAndLayout {
    return bx.cx().layout_of(self.ty.builtin_deref(true) ?? bug(`cannot deref \`${display_Ty(self.ty)}\``));
  },

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:141 layout
  layout(self: TyAndLayout): TyAndLayout {
    return self;
  },

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:145 project_field
  project_field(self: TyAndLayout, bx: BuilderMethods<BackendTypes>, field: FieldIdx): TyAndLayout {
    return self.field(bx.cx(), field);
  },

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:149 project_constant_index
  project_constant_index(self: TyAndLayout, bx: BuilderMethods<BackendTypes>, index: bigint): TyAndLayout {
    return self.field(bx.cx(), Number(index));
  },

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:153 downcast
  downcast(self: TyAndLayout, bx: BuilderMethods<BackendTypes>, variant: VariantIdx): TyAndLayout {
    return self.for_variant(bx.cx(), variant);
  },
};

interface DebugInfoOffset<T> {
  /// Offset from the `base` used to calculate the debuginfo offset.
  direct_offset: Size;
  /// Each offset in this vector indicates one level of indirection from the base or previous
  /// indirect offset plus a dereference.
  indirect_offsets: Size[];
  /// The final location debuginfo should point to.
  result: T;
}

// rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:168 calculate_debuginfo_offset
function calculate_debuginfo_offset<B extends BackendTypes, L>(
  L_: DebugInfoOffsetLocation<L, B>,
  bx: BuilderMethods<B>,
  projection: readonly PlaceElem[],
  base: L,
): DebugInfoOffset<L> {
  let direct_offset = Size.ZERO;
  // FIXME(eddyb) use smallvec here.
  const indirect_offsets: Size[] = [];
  let place = base;

  for (const elem of projection) {
    switch (elem.$) {
      case "Deref": {
        indirect_offsets.push(Size.ZERO);
        place = L_.deref(place, bx);
        break;
      }
      case "Field": {
        const field = elem._0;
        // `let offset = indirect_offsets.last_mut().unwrap_or(&mut direct_offset); *offset += ..`
        const add = FieldsShape.offset(L_.layout(place).fields, field);
        if (indirect_offsets.length !== 0) {
          indirect_offsets[indirect_offsets.length - 1] = indirect_offsets[indirect_offsets.length - 1]!.add(add);
        } else {
          direct_offset = direct_offset.add(add);
        }
        place = L_.project_field(place, bx, field);
        break;
      }
      case "Downcast": {
        const variant = elem._1;
        place = L_.downcast(place, bx, variant);
        break;
      }
      case "ConstantIndex": {
        if (elem.from_end === false) {
          const index = elem.offset;
          const fields = L_.layout(place).fields;
          if (fields.$ !== "Array") {
            bug(`ConstantIndex on non-array type ${format_debug(L_.layout(place), debug_TyAndLayout_Ty, PLAIN)}`);
          }
          const stride = fields.stride;
          const add = stride.mul(index);
          if (indirect_offsets.length !== 0) {
            indirect_offsets[indirect_offsets.length - 1] = indirect_offsets[indirect_offsets.length - 1]!.add(add);
          } else {
            direct_offset = direct_offset.add(add);
          }
          place = L_.project_constant_index(place, bx, index);
          break;
        }
        unsupported_projection(elem, projection);
        break;
      }
      default:
        unsupported_projection(elem, projection);
    }
  }

  return { direct_offset, indirect_offsets, result: place };
}

/** The `_ =>` arm of `calculate_debuginfo_offset` (debuginfo.rs:209); a helper because the `ConstantIndex { from_end:
 *  true }` pattern falls through to it. */
function unsupported_projection(elem: PlaceElem, projection: readonly PlaceElem[]): never {
  // Sanity check for `can_use_in_debuginfo`.
  assert(!ProjectionElem.can_use_in_debuginfo(elem), "assertion failed: !elem.can_use_in_debuginfo()");
  return bug(
    `unsupported var debuginfo projection \`${format_debug(projection, (v, f) => debug_vec(v, f, (x, f) => debug_ProjectionElem(x, f, debug_Local, debug_Ty)), PLAIN)}\``,
  );
}

/** `self.debug_context` with its real type (header). */
function dctx<B extends BackendTypes>(fx: FunctionCx<B>): FunctionDebugContext<B["DIScope"], B["DILocation"]> | undefined {
  return fx.debug_context as unknown as FunctionDebugContext<B["DIScope"], B["DILocation"]> | undefined;
}

/** `self.per_local_var_debug_info` with its real type (header). */
function per_local<B extends BackendTypes>(fx: FunctionCx<B>): PerLocalVarDebugInfo<B["DIVariable"]>[][] | undefined {
  return fx.per_local_var_debug_info as unknown as PerLocalVarDebugInfo<B["DIVariable"]>[][] | undefined;
}

// PORT: inside `declare module "./mod.ts"` the names resolve in mod.ts's scope first, where the ssa-mir-core placeholders of
// the same names live (header); these aliases name this file's types.
type PerLocalVarDebugInfo_<D> = PerLocalVarDebugInfo<D>;
type ConstDebugInfo_<B extends BackendTypes> = ConstDebugInfo<B>;
type DebugScope_<S, L> = DebugScope<S, L>;

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    set_debug_loc(bx: Bx, source_info: SourceInfo): void;
    dbg_loc(bx: Bx, source_info: SourceInfo): B["DILocation"] | undefined;
    adjusted_span_and_dbg_scope(bx: Bx, source_info: SourceInfo): [B["DIScope"], B["DILocation"] | undefined, Span] | undefined;
    debug_new_val_to_local(bx: Bx, local: Local, base: PlaceRef<B["Value"]>, projection: readonly PlaceElem[]): void;
    debug_poison_to_local(bx: Bx, local: Local): void;
    debug_introduce_local(bx: Bx, local: Local): void;
    debug_introduce_local_as_var(bx: Bx, local: Local, base: PlaceRef<B["Value"]>, var_: PerLocalVarDebugInfo_<B["DIVariable"]>): void;
    debug_introduce_locals(bx: Bx, consts: ConstDebugInfo_<B>[]): void;
    compute_per_local_var_debug_info(bx: Bx): [PerLocalVarDebugInfo_<B["DIVariable"]>[][], ConstDebugInfo_<B>[]] | undefined;
    codegen_stmt_debuginfo(bx: Bx, debuginfo: StmtDebugInfo): void;
    codegen_stmt_debuginfos(bx: Bx, debuginfos: readonly StmtDebugInfo[]): void;
    fill_function_debug_context(bx: Bx): void;
    make_mir_scope(
      bx: Bx,
      variables: DenseBitSet<SourceScope> | undefined,
      discriminators: Map<BytePos, number>,
      scope: SourceScope,
    ): DebugScope_<B["DIScope"], B["DILocation"]>;
  }
}

/** `FunctionCx::spill_operand_to_stack` (debuginfo.rs:243), an associated fn without `self`. */
// rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:243 spill_operand_to_stack
export function FunctionCx_spill_operand_to_stack<B extends BackendTypes>(
  operand: OperandRef<B["Value"]>,
  name: string | undefined,
  bx: BuilderMethods<B>,
): PlaceRef<B["Value"]> {
  // "Spill" the value onto the stack, for debuginfo,
  // without forcing non-debuginfo uses of the local
  // to also load from the stack every single time.
  // FIXME(#68817) use `llvm.dbg.value` instead,
  // at least for the cases which LLVM handles correctly.
  const spill_slot = PlaceRef.alloca(bx, operand.layout);
  if (name !== undefined) {
    bx.set_var_name(spill_slot.val.llval, name + ".dbg.spill");
  }
  OperandValue.store(operand.val, bx, spill_slot);
  return spill_slot;
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of debuginfo.rs (header). */
// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; header).
export function install_FunctionCx_debuginfo(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  type B = BackendTypes;
  type Fx = FunctionCx<B>;
  type Bx = BuilderMethods<B>;

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:221 set_debug_loc
  FunctionCx_.prototype.set_debug_loc = function (this: Fx, bx: Bx, source_info: SourceInfo): void {
    bx.set_span(source_info.span);
    const dbg_loc = this.dbg_loc(bx, source_info);
    if (dbg_loc !== undefined) {
      bx.set_dbg_loc(dbg_loc);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:228 dbg_loc
  FunctionCx_.prototype.dbg_loc = function (this: Fx, bx: Bx, source_info: SourceInfo): B["DILocation"] | undefined {
    const r = this.adjusted_span_and_dbg_scope(bx, source_info);
    if (r === undefined) return undefined;
    const [dbg_scope, inlined_at, span] = r;
    return bx.dbg_loc(dbg_scope, inlined_at, span);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:233 adjusted_span_and_dbg_scope
  FunctionCx_.prototype.adjusted_span_and_dbg_scope = function (
    this: Fx,
    bx: Bx,
    source_info: SourceInfo,
  ): [B["DIScope"], B["DILocation"] | undefined, Span] | undefined {
    const debug_context = dctx(this);
    if (debug_context === undefined) return undefined;
    const scope = debug_context.scopes[source_info.scope]!;
    const span = walk_chain_collapsed(source_info.span, this.mir.span);
    return [scope.adjust_dbg_scope_for_span(bx, span), scope.inlined_at, span];
  };

  // Indicates that local is set to a new value. The `layout` and `projection` are used to
  // calculate the offset.
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:263 debug_new_val_to_local
  FunctionCx_.prototype.debug_new_val_to_local = function (
    this: Fx,
    bx: Bx,
    local: Local,
    base: PlaceRef<B["Value"]>,
    projection: readonly PlaceElem[],
  ): void {
    const full_debug_info = bx.sess().opts.debuginfo === ("Full" satisfies DebugInfo);
    if (!full_debug_info) {
      return;
    }

    const per_local_ = per_local(this);
    if (per_local_ === undefined) return;
    const vars = per_local_[local]!;

    const { direct_offset, indirect_offsets } = calculate_debuginfo_offset(DebugInfoOffsetLocation_TyAndLayout, bx, projection, base.layout);
    for (const var_ of vars) {
      const dbg_var = var_.dbg_var;
      if (dbg_var === undefined) {
        continue;
      }
      const dbg_loc = this.dbg_loc(bx, var_.source_info);
      if (dbg_loc === undefined) {
        continue;
      }
      bx.dbg_var_value(dbg_var, dbg_loc, base.val.llval, direct_offset, indirect_offsets, var_.fragment);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:300 debug_poison_to_local
  FunctionCx_.prototype.debug_poison_to_local = function (this: Fx, bx: Bx, local: Local): void {
    const ty = this.monomorphize(this.mir.local_decls[local]!.ty, fold_Ty);
    const layout = bx.cx().layout_of(ty);
    const to_backend_ty = bx.cx().immediate_backend_type(layout);
    const place_ref = PlaceRef.new_sized(bx.cx().const_poison(to_backend_ty), layout);
    this.debug_new_val_to_local(bx, local, place_ref, []);
  };

  /// Apply debuginfo and/or name, after creating the `alloca` for a local,
  /// or initializing the local with an operand (whichever applies).
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:310 debug_introduce_local
  FunctionCx_.prototype.debug_introduce_local = function (this: Fx, bx: Bx, local: Local): void {
    const full_debug_info = bx.sess().opts.debuginfo === ("Full" satisfies DebugInfo);

    const per_local_ = per_local(this);
    if (per_local_ === undefined) return;
    const vars = per_local_[local]!;
    const whole_local_var = vars.find((var_) => var_.projection.length === 0);
    const has_proj = (): boolean => vars.some((var_) => var_.projection.length !== 0);

    let fallback_var: PerLocalVarDebugInfo<B["DIVariable"]> | undefined;
    if (this.mir.local_kind(local) === "Arg") {
      const arg_index = Local.as_usize(local) - 1;

      // Add debuginfo even to unnamed arguments.
      // FIXME(eddyb) is this really needed?
      if (arg_index === 0 && has_proj()) {
        // Hide closure environments from debuginfo.
        // FIXME(eddyb) shouldn't `ArgumentVariable` indices
        // be offset to account for the hidden environment?
        fallback_var = undefined;
      } else if (whole_local_var !== undefined) {
        // No need to make up anything, there is a `mir::VarDebugInfo`
        // covering the whole local.
        // FIXME(eddyb) take `whole_local_var.source_info.scope` into
        // account, just in case it doesn't use `ArgumentVariable`
        // (after #67586 gets fixed).
        fallback_var = undefined;
      } else {
        const name = sym.empty;
        const decl = this.mir.local_decls[local]!;
        let dbg_var: B["DIVariable"] | undefined;
        if (full_debug_info) {
          const r = this.adjusted_span_and_dbg_scope(bx, decl.source_info);
          if (r !== undefined) {
            const [dbg_scope, , span] = r;
            // FIXME(eddyb) is this `+ 1` needed at all?
            const kind: VariableKind = { $: "ArgumentVariable", _0: arg_index + 1 };

            const arg_ty = this.monomorphize(decl.ty, fold_Ty);

            dbg_var = bx.create_dbg_var(name, arg_ty, dbg_scope, kind, span);
          } else {
            dbg_var = undefined;
          }
        } else {
          dbg_var = undefined;
        }

        fallback_var = {
          name,
          source_info: decl.source_info,
          dbg_var,
          fragment: undefined,
          projection: RawList.empty(),
        };
      }
    } else {
      fallback_var = undefined;
    }

    const local_ref: LocalRef<B["Value"]> = this.locals.index(local);

    let name: string | undefined;
    if (bx.sess().fewer_names()) {
      name = undefined;
    } else {
      const var_ = whole_local_var ?? fallback_var;
      name = var_ !== undefined && var_.name !== sym.empty ? Symbol.as_str(var_.name) : format_debug(local, debug_Local, PLAIN);
    }

    if (name !== undefined) {
      switch (local_ref.$) {
        case "Place":
        case "UnsizedPlace": {
          const place = local_ref._0;
          bx.set_var_name(place.val.llval, name);
          break;
        }
        case "Operand": {
          const operand = local_ref._0;
          const val = operand.val;
          switch (val.$) {
            case "Ref":
              bx.set_var_name(val._0.llval, name);
              break;
            case "Immediate":
              bx.set_var_name(val._0, name);
              break;
            case "Pair": {
              const a = val._0;
              const b = val._1;
              // FIXME(eddyb) these are scalar components,
              // maybe extract the high-level fields?
              bx.set_var_name(a, name + ".0");
              bx.set_var_name(b, name + ".1");
              break;
            }
            case "ZeroSized":
              // These never have a value to talk about
              break;
          }
          break;
        }
        case "PendingOperand":
          break;
      }
    }

    if (!full_debug_info || (vars.length === 0 && fallback_var === undefined)) {
      return;
    }

    let base: PlaceRef<B["Value"]>;
    switch (local_ref.$) {
      case "PendingOperand":
        return;

      case "Operand": {
        const operand = local_ref._0;
        // Don't spill operands onto the stack in naked functions.
        // See: https://github.com/rust-lang/rust/issues/42779
        const attrs = TyCtxt_codegen_instance_attrs(bx.tcx_(), this.instance.def);
        if (CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.NAKED)) {
          return;
        }

        // Don't spill `<vscale x N x i1>` for `N != 16`:
        //
        // SVE predicates are only one bit for each byte in an SVE vector (which makes
        // sense, the predicate only needs to keep track of whether a lane is
        // enabled/disabled). i.e. a `<vscale x 16 x i8>` vector has a `<vscale x 16 x i1>`
        // predicate type. `<vscale x 16 x i1>` corresponds to two bytes of storage,
        // multiplied by the `vscale`, with one bit for each of the sixteen lanes.
        //
        // For a vector with fewer elements, such as `svint32_t`/`<vscale x 4 x i32>`,
        // while only a `<vscale x 4 x i1>` predicate type would be strictly necessary,
        // relevant intrinsics still take a `svbool_t`/`<vscale x 16 x i1>` - this is
        // because a `<vscale x 4 x i1>` is only half of a byte (for `vscale=1`), and with
        // memory being byte-addressable, it's unclear how to store that.
        //
        // Due to this, LLVM ultimately decided not to support stores of `<vscale x N x i1>`
        // for `N != 16`. As for `vscale=1` and `N` fewer than sixteen, partial bytes would
        // need to be stored (except for `N=8`, but that also isn't supported). `N` can
        // never be greater than sixteen as that ends up larger than the 128-bit increment
        // size.
        //
        // Internally, with an intrinsic operating on a `svint32_t`/`<vscale x 4 x i32>`
        // (for example), the intrinsic takes the `svbool_t`/`<vscale x 16 x i1>` predicate
        // and casts it to a `svbool4_t`/`<vscale x 4 x i1>`. Therefore, it's important that
        // the `<vscale x 4 x i1>` never spills because that'll cause errors during
        // instruction selection. Spilling to the stack to create debuginfo for these
        // intermediate values must be avoided and doing so won't affect the
        // debugging experience anyway.
        if (operand.layout.ty.is_scalable_vector() && bx.sess().target.arch.$ === "AArch64") {
          const [count, element_ty] = unwrap(operand.layout.ty.scalable_vector_parts(bx.tcx_()));
          // i.e. `<vscale x N x i1>` when `N != 16`
          if (element_ty.is_bool() && count !== 16) {
            return;
          }
        }

        base = FunctionCx_spill_operand_to_stack(operand, name, bx);
        break;
      }

      case "Place":
        base = local_ref._0;
        break;

      // FIXME(eddyb) add debuginfo for unsized places too.
      case "UnsizedPlace":
        return;
    }

    const all_vars = fallback_var === undefined ? [...vars] : [...vars, fallback_var];

    for (const var_ of all_vars) {
      this.debug_introduce_local_as_var(bx, local, base, var_);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:470 debug_introduce_local_as_var
  FunctionCx_.prototype.debug_introduce_local_as_var = function (
    this: Fx,
    bx: Bx,
    local: Local,
    base: PlaceRef<B["Value"]>,
    var_: PerLocalVarDebugInfo<B["DIVariable"]>,
  ): void {
    const dbg_var = var_.dbg_var;
    if (dbg_var === undefined) return;
    const dbg_loc = this.dbg_loc(bx, var_.source_info);
    if (dbg_loc === undefined) return;

    const { direct_offset, indirect_offsets } = calculate_debuginfo_offset(DebugInfoOffsetLocation_TyAndLayout, bx, var_.projection, base.layout);

    // When targeting MSVC, create extra allocas for arguments instead of pointing multiple
    // dbg_var_addr() calls into the same alloca with offsets. MSVC uses CodeView records
    // not DWARF and LLVM doesn't support translating the resulting
    // [DW_OP_deref, DW_OP_plus_uconst, offset, DW_OP_deref] debug info to CodeView.
    // Creating extra allocas on the stack makes the resulting debug info simple enough
    // that LLVM can generate correct CodeView records and thus the values appear in the
    // debugger. (#83709)
    const should_create_individual_allocas =
      bx.cx().sess().target.is_like_msvc &&
      this.mir.local_kind(local) === "Arg" &&
      // LLVM can handle simple things but anything more complex than just a direct
      // offset or one indirect offset of 0 is too complex for it to generate CV records
      // correctly.
      (!Size_eq(direct_offset, Size.ZERO) ||
        !((indirect_offsets.length === 1 && Size_eq(indirect_offsets[0]!, Size.ZERO)) || indirect_offsets.length === 0));

    if (should_create_individual_allocas) {
      const { result: place } = calculate_debuginfo_offset(DebugInfoOffsetLocation_PlaceRef<B>(), bx, var_.projection, base);

      // Create a variable which will be a pointer to the actual value
      const ptr_ty = TyC.new_mut_ptr(bx.tcx_(), place.layout.ty);
      const ptr_layout = bx.layout_of(ptr_ty);
      const alloca = PlaceRef.alloca(bx, ptr_layout);
      bx.set_var_name(alloca.val.llval, Symbol.as_str(var_.name) + ".dbg.spill");

      // Write the pointer to the variable
      bx.store_to_place(place.val.llval, alloca.val);

      // Point the debug info to `*alloca` for the current variable
      bx.dbg_var_addr(dbg_var, dbg_loc, alloca.val.llval, Size.ZERO, [Size.ZERO], var_.fragment);
    } else {
      bx.dbg_var_addr(dbg_var, dbg_loc, base.val.llval, direct_offset, indirect_offsets, var_.fragment);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:531 debug_introduce_locals
  FunctionCx_.prototype.debug_introduce_locals = function (this: Fx, bx: Bx, consts: ConstDebugInfo<B>[]): void {
    if (bx.sess().opts.debuginfo === ("Full" satisfies DebugInfo) || !bx.sess().fewer_names()) {
      for (const local of this.locals.indices()) {
        this.debug_introduce_local(bx, local);
      }

      for (const { name, source_info, operand, dbg_var, dbg_loc, fragment } of consts) {
        this.set_debug_loc(bx, source_info);
        const base = FunctionCx_spill_operand_to_stack(operand, name, bx);
        bx.clear_dbg_loc();

        bx.dbg_var_addr(dbg_var, dbg_loc, base.val.llval, Size.ZERO, [], fragment);
      }
    }
  };

  /// Partition all `VarDebugInfo` in `self.mir`, by their base `Local`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:554 compute_per_local_var_debug_info
  FunctionCx_.prototype.compute_per_local_var_debug_info = function (
    this: Fx,
    bx: Bx,
  ): [PerLocalVarDebugInfo<B["DIVariable"]>[][], ConstDebugInfo<B>[]] | undefined {
    const full_debug_info = this.cx.sess().opts.debuginfo === ("Full" satisfies DebugInfo);

    const target_is_msvc = this.cx.sess().target.is_like_msvc;

    if (!full_debug_info && this.cx.sess().fewer_names()) {
      return undefined;
    }

    const per_local: PerLocalVarDebugInfo<B["DIVariable"]>[][] = this.mir.local_decls.map(() => []);
    const constants: ConstDebugInfo<B>[] = [];
    // PORT: `FxHashMap<(Bx::DIScope, usize), Bx::DIVariable>` is a map per scope (backend objects are unique per value,
    // ssa-contract PORT 2); it is only looked up, never iterated.
    const params_seen = new Map<B["DIScope"], Map<number, B["DIVariable"]>>();
    for (const var_ of this.mir.var_debug_info) {
      const dbg_scope_and_span = full_debug_info ? this.adjusted_span_and_dbg_scope(bx, var_.source_info) : undefined;

      let var_ty: Ty;
      if (var_.composite !== undefined) {
        const fragment = var_.composite;
        var_ty = this.monomorphize(fragment.ty, fold_Ty);
      } else {
        const value = var_.value;
        switch (value.$) {
          case "Place": {
            const place = value._0;
            var_ty = this.monomorphized_place_ty(place.as_ref());
            break;
          }
          case "Const": {
            const c = value._0;
            var_ty = this.monomorphize(c.ty(), fold_Ty);
            break;
          }
        }
      }

      let dbg_var: B["DIVariable"] | undefined;
      if (dbg_scope_and_span !== undefined) {
        const [dbg_scope, , span] = dbg_scope_and_span;
        let var_kind: VariableKind;
        const arg_index_ = var_.argument_index;
        const value = var_.value;
        if (arg_index_ !== undefined && var_.composite === undefined && value.$ === "Place" && value._0.projection.length === 0) {
          const arg_index = arg_index_;
          if (target_is_msvc) {
            // ScalarPair parameters are spilled to the stack so they need to
            // be marked as a `LocalVariable` for MSVC debuggers to visualize
            // their data correctly. (See #81894 & #88625)
            const var_ty_layout = this.cx.layout_of(var_ty);
            if (var_ty_layout.backend_repr.$ === "ScalarPair") {
              var_kind = VariableKind.LocalVariable;
            } else {
              var_kind = { $: "ArgumentVariable", _0: arg_index };
            }
          } else {
            // FIXME(eddyb) shouldn't `ArgumentVariable` indices be
            // offset in closures to account for the hidden environment?
            var_kind = { $: "ArgumentVariable", _0: arg_index };
          }
        } else {
          var_kind = VariableKind.LocalVariable;
        }

        if (var_kind.$ === "ArgumentVariable") {
          const arg_index = var_kind._0;
          let by_index = params_seen.get(dbg_scope);
          if (by_index === undefined) {
            by_index = new Map();
            params_seen.set(dbg_scope, by_index);
          }
          const o = by_index.get(arg_index);
          if (o !== undefined || by_index.has(arg_index)) {
            dbg_var = o;
          } else {
            const v = bx.create_dbg_var(var_.name, var_ty, dbg_scope, var_kind, span);
            by_index.set(arg_index, v);
            dbg_var = v;
          }
        } else {
          dbg_var = bx.create_dbg_var(var_.name, var_ty, dbg_scope, var_kind, span);
        }
      } else {
        dbg_var = undefined;
      }

      let fragment: readonly [Size, Size] | undefined;
      if (var_.composite !== undefined) {
        const fragment_ = var_.composite;
        const var_layout = this.cx.layout_of(var_ty);

        const {
          direct_offset,
          indirect_offsets,
          result: fragment_layout,
        } = calculate_debuginfo_offset(DebugInfoOffsetLocation_TyAndLayout, bx, fragment_.projection, var_layout);
        assert(indirect_offsets.length === 0, "assertion failed: indirect_offsets.is_empty()");

        if (Size_eq(fragment_layout.size, Size.ZERO)) {
          // Fragment is a ZST, so does not represent anything. Avoid generating anything
          // as this may conflict with a fragment that covers the entire variable.
          continue;
        } else if (Size_eq(fragment_layout.size, var_layout.size)) {
          // Fragment covers entire variable, so as far as
          // DWARF is concerned, it's not really a fragment.
          fragment = undefined;
        } else {
          fragment = [direct_offset, direct_offset.add(fragment_layout.size)];
        }
      } else {
        fragment = undefined;
      }

      const value = var_.value;
      switch (value.$) {
        case "Place": {
          const place: Place = value._0;
          per_local[place.local]!.push({
            name: var_.name,
            source_info: var_.source_info,
            dbg_var,
            fragment,
            projection: place.projection,
          });
          break;
        }
        case "Const": {
          const c = value._0;
          if (dbg_var !== undefined) {
            const dbg_loc = this.dbg_loc(bx, var_.source_info);
            if (dbg_loc === undefined) continue;

            const operand = this.eval_mir_constant_to_operand(bx, c);
            constants.push({
              name: Symbol.as_str(var_.name),
              source_info: var_.source_info,
              operand,
              dbg_var,
              dbg_loc,
              fragment,
            });
          }
          break;
        }
      }
    }
    return [per_local, constants];
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:683 codegen_stmt_debuginfo
  FunctionCx_.prototype.codegen_stmt_debuginfo = function (this: Fx, bx: Bx, debuginfo: StmtDebugInfo): void {
    switch (debuginfo.$) {
      case "AssignRef": {
        const dest = debuginfo._0;
        const place = debuginfo._1;
        let local_ref: [PlaceRef<B["Value"]>, readonly PlaceElem[]] | undefined;
        const lr: LocalRef<B["Value"]> = this.locals.index(place.local);
        switch (lr.$) {
          // For an rvalue like `&(_1.1)`, when `BackendRepr` is `BackendRepr::Memory`, we allocate a block of memory to this place.
          // The place is an indirect pointer, we can refer to it directly.
          case "Place":
            local_ref = [lr._0, place.projection];
            break;
          case "Operand":
            if (place.is_indirect_first_projection()) {
              // For an rvalue like `&((*_1).1)`, we are calculating the address of `_1.1`.
              // The deref projection is no-op here.
              local_ref = [lr._0.deref(bx.cx()), place.projection.slice(1)];
            } else {
              // For an rvalue like `&1`, when `BackendRepr` is `BackendRepr::Scalar`,
              // we cannot get the address.
              // N.B. `non_ssa_locals` returns that this is an SSA local.
              local_ref = undefined;
            }
            break;
          case "UnsizedPlace":
          case "PendingOperand":
            local_ref = undefined;
            break;
        }
        if (local_ref !== undefined) {
          const [, projection] = local_ref;
          // Drop unsupported projections.
          if (!projection.every((p) => ProjectionElem.can_use_in_debuginfo(p))) local_ref = undefined;
        }
        if (local_ref !== undefined) {
          const [base, projection] = local_ref;
          this.debug_new_val_to_local(bx, dest, base, projection);
        } else {
          // If the address cannot be calculated, use poison to indicate that the value has been optimized out.
          this.debug_poison_to_local(bx, dest);
        }
        break;
      }
      case "InvalidAssign": {
        const local = debuginfo._0;
        this.debug_poison_to_local(bx, local);
        break;
      }
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:722 codegen_stmt_debuginfos
  FunctionCx_.prototype.codegen_stmt_debuginfos = function (this: Fx, bx: Bx, debuginfos: readonly StmtDebugInfo[]): void {
    for (const debuginfo of debuginfos) {
      this.codegen_stmt_debuginfo(bx, debuginfo);
    }
  };

  /// Creates the function-specific debug context.
  ///
  /// Returns the FunctionDebugContext for the function which holds state needed
  /// for debug info creation, if it is enabled.
  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:736 fill_function_debug_context
  FunctionCx_.prototype.fill_function_debug_context = function (this: Fx, bx: Bx): void {
    if (this.cx.sess().opts.debuginfo === ("None" satisfies DebugInfo)) {
      return;
    }

    // Initialize fn debug context (including scopes).
    const new_context: FunctionDebugContext<B["DIScope"], B["DILocation"]> = {
      scopes: [],
      inlined_function_scopes: new KeyedMap<Instance, B["DIScope"]>(intern_key),
    };
    this.debug_context = new_context as unknown as typeof this.debug_context;

    // Find all scopes with variables defined in them.
    let variables: DenseBitSet<SourceScope> | undefined;
    if (this.cx.sess().opts.debuginfo === ("Full" satisfies DebugInfo)) {
      const vars = DenseBitSet.new_empty<SourceScope>(this.mir.source_scopes.length);
      // FIXME(eddyb) take into account that arguments always have debuginfo,
      // irrespective of their name (assuming full debuginfo is enabled).
      // NOTE(eddyb) actually, on second thought, those are always in the
      // function scope, which always exists.
      for (const var_debug_info of this.mir.var_debug_info) {
        vars.insert(var_debug_info.source_info.scope);
      }
      variables = vars;
    } else {
      // Nothing to emit, of course.
      variables = undefined;
    }

    // Instantiate all scopes.
    const discriminators = new Map<BytePos, number>();
    for (let scope = 0 as SourceScope; scope < this.mir.source_scopes.length; scope = (scope + 1) as SourceScope) {
      const scope_data = this.make_mir_scope(bx, variables, discriminators, scope);
      const scopes = unwrap(dctx(this)).scopes;
      scopes.push(scope_data);
      // debug_assert_eq!(_s, scope);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs:772 make_mir_scope
  FunctionCx_.prototype.make_mir_scope = function (
    this: Fx,
    bx: Bx,
    variables: DenseBitSet<SourceScope> | undefined,
    discriminators: Map<BytePos, number>,
    scope: SourceScope,
  ): DebugScope<B["DIScope"], B["DILocation"]> {
    const scope_data = this.mir.source_scopes[scope]!;
    let parent_scope: DebugScope<B["DIScope"], B["DILocation"]>;
    if (scope_data.parent_scope !== undefined) {
      const parent = scope_data.parent_scope;
      // debug_assert!(parent.as_u32() < scope.as_u32());
      parent_scope = unwrap(dctx(this)).scopes[parent]!;
    } else {
      // The root is the function itself.
      const file = this.cx.sess().source_map().lookup_source_file(Span.lo(this.mir.span));
      const dbg_scope = bx.dbg_scope_fn(this.instance, this.fn_abi, this.llfn);
      return new DebugScope(dbg_scope, undefined, file.start_pos, file.end_position());
    }

    if (variables !== undefined && !variables.contains(scope) && scope_data.inlined === undefined) {
      // Do not create a DIScope if there are no variables defined in this
      // MIR `SourceScope`, and it's not `inlined`, to avoid debuginfo bloat.
      return parent_scope;
    }

    let dbg_scope: B["DIScope"];
    if (scope_data.inlined !== undefined) {
      const [callee_] = scope_data.inlined;
      const callee = this.monomorphize(callee_, d_Instance);
      const inlined_function_scopes = unwrap(dctx(this)).inlined_function_scopes;
      const existing = inlined_function_scopes.get(callee);
      if (existing !== undefined || inlined_function_scopes.has(callee)) {
        dbg_scope = existing as B["DIScope"];
      } else {
        const callee_fn_abi = this.cx.fn_abi_of_instance(callee, RawList.empty());
        const s = bx.dbg_scope_fn(callee, callee_fn_abi, undefined);
        inlined_function_scopes.set(callee, s);
        dbg_scope = s;
      }
    } else {
      dbg_scope = bx.dbg_create_lexical_block(Span.lo(scope_data.span), parent_scope.dbg_scope);
    }

    let inlined_at: B["DILocation"] | undefined;
    if (scope_data.inlined !== undefined) {
      const [, callsite_span_] = scope_data.inlined;
      const callsite_span = walk_chain_collapsed(callsite_span_, this.mir.span);
      const callsite_scope = parent_scope.adjust_dbg_scope_for_span(bx, callsite_span);
      const loc = bx.dbg_loc(callsite_scope, parent_scope.inlined_at, callsite_span);

      // NB: In order to produce proper debug info for variables (particularly
      // arguments) in multiply-inlined functions, LLVM expects to see a single
      // DILocalVariable with multiple different DILocations in the IR. While
      // the source information for each DILocation would be identical, their
      // inlinedAt attributes will be unique to the particular callsite.
      //
      // We generate DILocations here based on the callsite's location in the
      // source code. A single location in the source code usually can't
      // produce multiple distinct calls so this mostly works, until
      // macros get involved. A macro can generate multiple calls
      // at the same span, which breaks the assumption that we're going to
      // produce a unique DILocation for every scope we process here. We
      // have to explicitly add discriminators if we see inlines into the
      // same source code location.
      //
      // Note further that we can't key this hashtable on the span itself,
      // because these spans could have distinct SyntaxContexts. We have
      // to key on exactly what we're giving to LLVM.
      const key = Span.lo(callsite_span);
      const o = discriminators.get(key);
      if (o !== undefined) {
        const n = o + 1;
        discriminators.set(key, n);
        // NB: We have to emit *something* here or we'll fail LLVM IR verification
        // in at least some circumstances (see issue #135322) so if the required
        // discriminant cannot be encoded fall back to the dummy location.
        inlined_at = bx.dbg_location_clone_with_discriminator(loc, n) ?? bx.dbg_loc(callsite_scope, parent_scope.inlined_at, DUMMY_SP);
      } else {
        discriminators.set(key, 0);
        inlined_at = loc;
      }
    } else {
      inlined_at = undefined;
    }

    const file = this.cx.sess().source_map().lookup_source_file(Span.lo(scope_data.span));
    return new DebugScope(dbg_scope, inlined_at ?? parent_scope.inlined_at, file.start_pos, file.end_position());
  };
}
