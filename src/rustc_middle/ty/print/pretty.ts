// Port of compiler/rustc_middle/src/ty/print/pretty.rs, in two lane regions: ty-print-a (lines 1..1704) and
// ty-print-b (lines 1705..end). Each region has its own import block; root deduplicates them at merge.
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.

// ==== lane ty-print-a: pretty.rs:1..1704 ====

// ==== lane ty-print-b: pretty.rs:1705..end ====
// ---- lane ty-print-b imports ----
import { type ExternAbi, display_ExternAbi } from "../../../rustc_abi/extern_abi.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { ExternCrate } from "../../../rustc_crate_store/cstore.ts";
import type { DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import { DefKind, Namespace } from "../../../rustc_hir/def.ts";
import { ItemKind, Safety } from "../../../rustc_hir/hir.ts";
import { DefPathData, type DisambiguatedDefPathData } from "../../../rustc_hir_id/definitions.ts";
import { CrateNum, DefId, DefIdMap, DefIdSet, LOCAL_CRATE, debug_DefId } from "../../../rustc_span/def_id.ts";
import { Ident, Symbol, display_Symbol, kw } from "../../../rustc_span/symbol.ts";
import { Limit } from "../../../rustc_structures/limit.ts";
import { BoundVar } from "../../../rustc_type_ir/lib.ts";
import { debug_BoundVariableKind } from "../../../rustc_type_ir/binder.gen.ts";
import { debug_BoundTy, debug_Placeholder, visit_with_Binder } from "../../../rustc_type_ir/binder.ts";
import type { AliasTerm } from "../../../rustc_type_ir/ty/alias.ts";
import type { BoundConstness, CoercePredicate, SubtypePredicate } from "../../../rustc_type_ir/predicate.ts";
import type { TypeAndMut } from "../../../rustc_type_ir/ty_kind.ts";
import type {
  AliasTy,
  Binder,
  BoundRegion,
  BoundRegionKind,
  ClauseKind,
  ClosureArgs,
  ClosureKind,
  ConstVid,
  DebruijnIndex,
  ExistentialPredicate,
  ExistentialProjection,
  ExistentialTraitRef,
  FnSig,
  HostEffectClause,
  NormalizesTo,
  OutlivesClause,
  PlaceholderType,
  PolyExistentialPredicate,
  PolyTraitClause,
  PolyTraitRef,
  PredicateKind,
  ProjectionClause,
  TraitClause,
  TraitRef,
  TyVid,
  TypeFlags as TypeFlagsT,
} from "../../../rustc_type_ir/decls.ts";
import { INNERMOST } from "../../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { fold_with_ClauseKind, try_fold_with_ClauseKind, visit_with_ClauseKind } from "../../../rustc_type_ir/predicate_kind.gen.ts";
import { fold_with_PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../../rustc_type_ir/predicate_kind.gen.ts";
import { debug_RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { Const, Region, debug_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm as AliasTermC } from "../../../rustc_type_ir/term_kind.ts";
import { ClosureArgs as ClosureArgsC, debug_ClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { Binder_map_bound, Binder_skip_binder, DebruijnIndex_shifted_in, DebruijnIndex_shifted_out, FnSig as FnSigC } from "../../../rustc_type_ir/ty_kind.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { type Debug, type Fmt, PLAIN, PRETTY, debug_char, debug_str } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert_eq, panic, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { utf8_len } from "../../../std/str.ts";
import type { Providers } from "../../queries.gen.ts";
import { with_ } from "../context/tls.ts";
import { TyCtxt } from "../context.ts";
import type { AdtDef, Allocation, ConstAllocation, Instance, ScalarInt, Scalar, ValTree, Value } from "../decls.ts";
import { GenericArg } from "../generic_args.ts";
import type { GenericArgs } from "../generic_args.ts";
import type { Generics } from "../generics.ts";
import type { Clauses, List } from "../list.ts";
import { Term, Ty, debug_Ty } from "../mod.ts";
import { Visibility } from "../mod.ts";
import type { Clause, Predicate } from "../predicate.ts";
import type { EarlyParamRegion, LateParamRegionKind } from "../region.ts";
import type { ParamConst, ParamTy } from "../sty.ts";
import type { IntoQueryKey } from "../../query/into_query_key.ts";
import { into_query_key_DefId } from "../../query/into_query_key.ts";

// PORT (lane ty-print-b): conventions of this region (docs/handoff/ty-print-b.md, "PORT decisions").
// 1. `Result<(), PrintError>` (`PrintError = fmt::Error`) is `void`, `Result<bool, PrintError>` is `boolean`, and `?`
//    is dropped: no upstream `Printer` ever produces the error (`FmtPrinter::write_str` always returns `Ok`), so the
//    `Err` arm is dead code. `.unwrap()` of a print result is dropped likewise.
// 2. `trait Print<P>` (print/mod.rs:17) is a D4-style descriptor over the printed type (`Print<T>`, below); each
//    `impl Print<P> for X` is a descriptor `print_<X>`, generic impls are functions from descriptors to descriptors.
//    `x.print(p)` is `print_<X>.print(x, p)`.
// 3. `impl fmt::Display for X` is `display_<X>(self): string` (Display for these types ignores the formatter flags).
// 4. `FmtPrinter(Box<FmtPrinterData>)` keeps its tuple field `_0`; `Deref`/`DerefMut` are realised as that field
//    (PORTING §8), so `self.empty_path` is `this._0.empty_path`.
// 5. `tcx.lift(x)` is the identity (rustc's `Lift` is skipped, PORTING §3).
// 6. The provided methods of `PrettyPrinter` in pretty.rs:1705..2055 are `PrettyPrinter_provided_b` (PORTING §8);
//    root merges it into lane ty-print-a's `PrettyPrinter_provided`.

/** PORT: the provided methods of `PrettyPrinter` from pretty.rs:1705..2055 (PORTING §8; see the region header). */
export const PrettyPrinter_provided_b = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1705 pretty_print_const_scalar
  pretty_print_const_scalar(self: PrettyPrinter, scalar: Scalar, ty: Ty): void {
    const scalar_ = scalar as unknown as ScalarShape;
    switch (scalar_.$) {
      case "Ptr": {
        const ptr = scalar_._0;
        return self.pretty_print_const_scalar_ptr(ptr, ty);
      }
      case "Int": {
        const int = scalar_._0;
        return self.pretty_print_const_scalar_int(int, ty, /* print_ty */ true);
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1718 pretty_print_const_scalar_ptr
  pretty_print_const_scalar_ptr(self: PrettyPrinter, ptr: Pointer, ty: Ty): void {
    const [prov, offset] = Pointer_prov_and_relative_offset(ptr);
    const k = ty.kind();
    switch (k.$) {
      // Byte strings (&[u8; N])
      case "Ref": {
        const inner = k._1;
        const ik = inner.kind();
        if (ik.$ === "Array") {
          const elem = ik._0;
          const ct_len = ik._1;
          const ek = elem.kind();
          let len: number | undefined;
          if (ek.$ === "Uint" && ek._0 === "U8" && (len = ct_len.try_to_target_usize(self.tcx())) !== undefined) {
            const global_alloc = TyCtxt_try_get_global_alloc(self.tcx(), CtfeProvenance_alloc_id(prov));
            if (global_alloc === undefined) {
              self.write_str("<dangling pointer>");
            } else {
              switch (global_alloc.$) {
                case "Memory": {
                  const alloc = global_alloc._0;
                  const range: AllocRange = { start: offset, size: Size.from_bytes(len) };
                  const byte_str = Allocation_get_bytes_strip_provenance(ConstAllocation_inner(alloc), self.tcx(), range);
                  if (byte_str !== undefined) {
                    self.pretty_print_byte_str(byte_str);
                  } else {
                    self.write_str("<too short allocation>");
                  }
                  break;
                }
                // FIXME: for statics, vtables, and functions, we could in principle print more detail.
                case "Static": {
                  const def_id = global_alloc._0;
                  self.write_str(`<static(${debug_DefId(def_id, PLAIN)})>`);
                  break;
                }
                case "Function":
                  self.write_str("<function>");
                  break;
                case "VTable":
                  self.write_str("<vtable>");
                  break;
                case "TypeId":
                  self.write_str("<typeid>");
                  break;
              }
            }
            return;
          }
        }
        break;
      }
      case "FnPtr": {
        // FIXME: We should probably have a helper method to share code with the "Byte strings"
        // printing above (which also has to handle pointers to all sorts of things).
        const global_alloc = TyCtxt_try_get_global_alloc(self.tcx(), CtfeProvenance_alloc_id(prov));
        if (global_alloc !== undefined && global_alloc.$ === "Function") {
          const instance = global_alloc.instance;
          self.typed_value(
            (this_) => this_.pretty_print_value_path(Instance_def_id(instance), Instance_args(instance)),
            (this_) => this_.print_type(ty),
            " as ",
          );
          return;
        }
        break;
      }
      default:
        break;
    }
    // Any pointer values not covered by a branch above
    self.pretty_print_const_pointer(ptr, ty);
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1775 pretty_print_const_scalar_int
  pretty_print_const_scalar_int(self: PrettyPrinter, int: ScalarInt, ty: Ty, print_ty: boolean): void {
    const k = ty.kind();
    // Bool
    if (k.$ === "Bool" && ScalarInt_eq(int, ScalarInt_FALSE())) {
      self.write_str("false");
    } else if (k.$ === "Bool" && ScalarInt_eq(int, ScalarInt_TRUE())) {
      self.write_str("true");
    }
    // Float
    else if (k.$ === "Float") {
      const fty = k._0;
      switch (fty) {
        case "F16": {
          const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Half", int));
          self.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f16`);
          break;
        }
        case "F32": {
          const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Single", int));
          self.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f32`);
          break;
        }
        case "F64": {
          const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Double", int));
          self.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f64`);
          break;
        }
        case "F128": {
          const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Quad", int));
          self.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f128`);
          break;
        }
      }
    }
    // Int
    else if (k.$ === "Uint" || k.$ === "Int") {
      const int_ = ConstInt_new(int, k.$ === "Int", ty.is_ptr_sized_integral());
      if (print_ty) {
        self.write_str(debug_ConstInt(int_, PRETTY));
      } else {
        self.write_str(debug_ConstInt(int_, PLAIN));
      }
    }
    // Char
    else if (k.$ === "Char" && char_try_from_ScalarInt(int) !== undefined) {
      self.write_str(debug_char(unwrap(char_try_from_ScalarInt(int))));
    }
    // Pointer types
    else if (k.$ === "Ref" || k.$ === "RawPtr" || k.$ === "FnPtr") {
      const data = ScalarInt_to_bits(int, TargetDataLayout_pointer_size(self.tcx().gcx.data_layout));
      self.typed_value(
        (this_) => {
          this_.write_str(`0x${data.toString(16)}`);
        },
        (this_) => this_.print_type(ty),
        " as ",
      );
    } else if (k.$ === "Pat" && TyCtxt_validate_scalar_in_layout(self.tcx(), int, ty)) {
      const base_ty = k._0;
      const pat = k._1;
      self.pretty_print_const_scalar_int(int, base_ty, print_ty);
      self.write_str(` is ${debug_Pattern(pat, PLAIN)}`);
    }
    // Nontrivial types with scalar bit representation
    else {
      const print = (this_: PrettyPrinter): void => {
        if (ScalarInt_size(int).raw === Size.ZERO.raw) {
          this_.write_str("transmute(())");
        } else {
          this_.write_str(`transmute(0x${lower_hex_ScalarInt(int)})`);
        }
      };
      if (print_ty) {
        self.typed_value(print, (this_) => this_.print_type(ty), ": ");
      } else {
        print(self);
      }
    }
  },

  /// This is overridden for MIR printing because we only want to hide alloc ids from users, not
  /// from MIR where it is actually useful.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1852 pretty_print_const_pointer
  pretty_print_const_pointer(self: PrettyPrinter, _: Pointer, ty: Ty): void {
    self.typed_value(
      (this_) => {
        this_.write_str("&_");
      },
      (this_) => this_.print_type(ty),
      ": ",
    );
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1867 pretty_print_byte_str
  pretty_print_byte_str(self: PrettyPrinter, byte_str: Uint8Array): void {
    self.write_str(`b"${escape_ascii(byte_str)}"`);
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1872 pretty_print_const_valtree
  pretty_print_const_valtree(self: PrettyPrinter, cv: Value, print_ty: boolean): void {
    const cv_ = cv as unknown as ValueShape;
    if (with_reduced_queries_get() || self.should_print_verbose()) {
      self.write_str(`ValTree(${debug_ValTree(cv_.valtree, PLAIN)}: `);
      print_Ty.print(cv_.ty, self);
      self.write_str(")");
      return;
    }

    const u8_type = self.tcx().types.u8;
    const vk = ValTree_deref(cv_.valtree);
    const tk = cv_.ty.kind();
    if (vk.$ === "Branch" && tk.$ === "Ref") {
      const inner_ty = tk._1;
      const ik = inner_ty.kind();
      if (ik.$ === "Slice" && ik._0 === u8_type) {
        const t = ik._0;
        const bytes = Value_try_to_raw_bytes(cv_, self.tcx());
        if (bytes === undefined) {
          return panic(`expected to convert valtree ${debug_ValTree(cv_.valtree, PLAIN)} to raw bytes for type ${debug_Ty(t, PLAIN)}`);
        }
        return self.pretty_print_byte_str(bytes);
      } else if (ik.$ === "Str") {
        const bytes = Value_try_to_raw_bytes(cv_, self.tcx());
        if (bytes === undefined) {
          return panic(`expected to convert valtree to raw bytes for type ${debug_Ty(cv_.ty, PLAIN)}`);
        }
        self.write_str(debug_str(String_from_utf8_lossy(bytes)));
        return;
      } else {
        const cv: ValueShape = { valtree: cv_.valtree, ty: inner_ty };
        self.write_str("&");
        self.pretty_print_const_valtree(cv as unknown as Value, print_ty);
        return;
      }
    }
    // If it is a branch with an array, and this array can be printed as raw bytes, then dump its bytes
    let bytes: Uint8Array | undefined;
    if (vk.$ === "Branch" && tk.$ === "Array" && tk._0 === u8_type && (bytes = Value_try_to_raw_bytes(cv_, self.tcx())) !== undefined) {
      self.write_str("*");
      self.pretty_print_byte_str(bytes);
      return;
    }
    // Otherwise, print the array separated by commas (or if it's a tuple)
    if (vk.$ === "Branch" && (tk.$ === "Array" || tk.$ === "Tuple")) {
      const fields = vk._0;
      const fields_iter = fields;

      const k2 = cv_.ty.kind();
      switch (k2.$) {
        case "Array": {
          self.write_str("[");
          self.comma_sep(fields_iter, print_Const);
          self.write_str("]");
          break;
        }
        case "Tuple": {
          self.write_str("(");
          self.comma_sep(fields_iter, print_Const);
          if (fields.length === 1) {
            self.write_str(",");
          }
          self.write_str(")");
          break;
        }
        default:
          unreachable();
      }
      return;
    }
    if (vk.$ === "Branch" && tk.$ === "Adt") {
      const def = tk._0;
      const args = tk._1;
      const contents = Value_destructure_adt_const(cv_);
      const fields = contents.fields;

      if (AdtDef_variants(def).length === 0) {
        self.typed_value(
          (this_) => {
            this_.write_str("unreachable()");
          },
          (this_) => this_.print_type(cv_.ty),
          ": ",
        );
      } else {
        const variant_idx = contents.variant;
        const variant_def = AdtDef_variant(def, variant_idx);
        self.pretty_print_value_path(variant_def.def_id, args);
        const ctor_kind = VariantDef_ctor_kind(variant_def);
        if (ctor_kind === "Const") {
          // nothing
        } else if (ctor_kind === "Fn") {
          self.write_str("(");
          self.comma_sep(fields, print_Const);
          self.write_str(")");
        } else {
          self.write_str(" { ");
          let first = true;
          const n = Math.min(variant_def.fields.length, fields.length);
          for (let i = 0; i < n; i++) {
            const field_def = variant_def.fields[i]!;
            const field = fields[i]!;
            if (!first) {
              self.write_str(", ");
            }
            self.write_str(`${display_Symbol(field_def.name)}: `);
            print_Const.print(field, self);
            first = false;
          }
          self.write_str(" }");
        }
      }
      return;
    }
    if (vk.$ === "Leaf" && tk.$ === "Ref") {
      const leaf = vk._0;
      const inner_ty = tk._1;
      self.write_str("&");
      return self.pretty_print_const_scalar_int(leaf, inner_ty, print_ty);
    }
    if (vk.$ === "Leaf") {
      const leaf = vk._0;
      return self.pretty_print_const_scalar_int(leaf, cv_.ty, print_ty);
    }
    if (tk.$ === "FnDef") {
      const def_id = tk._0;
      const args = tk._1;
      // Never allowed today, but we still encounter them in invalid const args.
      // FIXME(addiesh): fix wrt late-bound stuff
      self.pretty_print_value_path(def_id, unwrap(Binder_no_bound_vars(args)));
      return;
    }
    // FIXME(oli-obk): also pretty print arrays and other aggregate constants by reading
    // their fields instead of just dumping the memory.

    // fallback
    if (ValTree_is_zst(cv_.valtree)) {
      self.write_str("<ZST>");
    } else {
      self.write_str(debug_ValTree(cv_.valtree, PLAIN));
    }
    if (print_ty) {
      self.write_str(": ");
      print_Ty.print(cv_.ty, self);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2014 pretty_print_closure_as_impl
  pretty_print_closure_as_impl(self: PrettyPrinter, closure: ClosureArgs): void {
    const sig = ClosureArgsC.sig(closure);
    const kind = ClosureArgsC.kind_ty(closure).to_opt_closure_kind() ?? "Fn";

    self.write_str("impl ");
    self.wrap_binder(
      sig,
      WrapBinderMode.ForAll,
      (sig, p) => {
        p.write_str(`${display_ClosureKind(kind)}(`);
        const fields = unwrap(FnSigC.inputs(sig)[0]).tuple_fields();
        for (let i = 0; i < fields.length; i++) {
          const arg = fields[i]!;
          if (i > 0) {
            p.write_str(", ");
          }
          print_Ty.print(arg, p);
        }
        p.write_str(")");

        if (!FnSigC.output(sig).is_unit()) {
          p.write_str(" -> ");
          print_Ty.print(FnSigC.output(sig), p);
        }
      },
      fold_FnSig,
    );
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2041 pretty_print_bound_constness
  pretty_print_bound_constness(self: PrettyPrinter, constness: BoundConstness): void {
    switch (constness) {
      case "Const":
        self.write_str("const ");
        break;
      case "Maybe":
        self.write_str("[const] ");
        break;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2052 should_print_verbose
  should_print_verbose(self: PrettyPrinter): boolean {
    return self.tcx().sess.verbose_internals();
  },
};

// PORT: `fmt: &mut fmt::Formatter` is the output: the fn returns what it writes (the `Debug<T>` convention).
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2057 pretty_print_const
export function pretty_print_const(c: Const, fmt: Fmt, print_types: boolean): string {
  void fmt;
  return with_((tcx) => {
    const p = FmtPrinter.new(tcx, Namespace.ValueNS);
    p._0.print_alloc_ids = true;
    p.pretty_print_const(/* tcx.lift */ c, print_types);
    return p.into_buffer();
  });
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2074 FmtPrinterData
export interface FmtPrinterData {
  tcx: TyCtxt;
  fmt: string;

  empty_path: boolean;
  in_value: boolean;
  print_alloc_ids: boolean;

  // set of all named (non-anonymous) region names
  used_region_names: Set<Symbol>;

  region_index: number;
  binder_depth: number;
  printed_type_count: number;
  type_length_limit: Limit;

  region_highlight_mode: RegionHighlightMode;

  ty_infer_name_resolver: ((id: TyVid) => Symbol | undefined) | undefined;
  const_infer_name_resolver: ((id: ConstVid) => Symbol | undefined) | undefined;
}

// HACK(eddyb) boxed to avoid moving around a large struct by-value.
// PORT: every `impl` block of `FmtPrinter` (pretty.rs:2096..2953) is in this class body (PORTING §8); the markers keep
// the upstream lines. The provided `Printer`/`PrettyPrinter` methods it does not override delegate to the helpers.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2072 FmtPrinter
export class FmtPrinter implements PrettyPrinter {
  constructor(public _0: FmtPrinterData) {}

  // impl Deref for FmtPrinter
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2098 deref
  deref(): FmtPrinterData {
    return this._0;
  }

  // impl DerefMut for FmtPrinter
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2104 deref_mut
  deref_mut(): FmtPrinterData {
    return this._0;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2110 new
  static new(tcx: TyCtxt, ns: Namespace): FmtPrinter {
    const limit = with_reduced_queries_get() ? Limit.new(1048576) : tcx.type_length_limit();
    return FmtPrinter.new_with_limit(tcx, ns, limit);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2116 print_string
  static print_string(tcx: TyCtxt, ns: Namespace, f: (p: FmtPrinter) => void): string {
    const c = FmtPrinter.new(tcx, ns);
    f(c);
    return c.into_buffer();
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2126 new_with_limit
  static new_with_limit(tcx: TyCtxt, ns: Namespace, type_length_limit: Limit): FmtPrinter {
    return new FmtPrinter({
      tcx,
      // Estimated reasonable capacity to allocate upfront based on a few
      // benchmarks.
      fmt: "",
      empty_path: false,
      in_value: ns === Namespace.ValueNS,
      print_alloc_ids: false,
      used_region_names: new Set(),
      region_index: 0,
      binder_depth: 0,
      printed_type_count: 0,
      type_length_limit,
      region_highlight_mode: RegionHighlightMode.default_(),
      ty_infer_name_resolver: undefined,
      const_infer_name_resolver: undefined,
    });
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2146 into_buffer
  into_buffer(): string {
    return this._0.fmt;
  }

  // impl fmt::Write for FmtPrinter
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2204 write_str
  write_str(s: string): void {
    this._0.fmt += s;
  }

  // ---- impl Printer for FmtPrinter ----
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2211 tcx
  tcx(): TyCtxt {
    return this._0.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2215 reset_path
  reset_path(): void {
    this._0.empty_path = true;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2220 should_omit_parent_def_path
  should_omit_parent_def_path(parent_def_id: DefId): boolean {
    if (RTN_MODE_get() !== "ForSuggestion") return false;
    const data = this.tcx().def_key(parent_def_id).disambiguated_data.data;
    return data.$ === "ValueNs" || data.$ === "Closure" || data.$ === "AnonConst";
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2228 print_def_path
  print_def_path(def_id: DefId, args: readonly GenericArg[]): void {
    if (args.length === 0) {
      if (this.try_print_trimmed_def_path(def_id)) {
        return;
      }

      if (this.try_print_visible_def_path(def_id)) {
        return;
      }
    }

    const key = this._0.tcx.def_key(def_id);
    if (key.disambiguated_data.data.$ === "Impl") {
      // Always use types for non-local impls, where types are always
      // available, and filename/line-number is mostly uninteresting.
      let use_types: boolean;
      if (!def_id.is_local()) {
        use_types = true;
      } else {
        // Otherwise, use filename/line-number if forced.
        const force_no_types = with_forced_impl_filename_line_get();
        use_types = !force_no_types;
      }

      if (!use_types) {
        // If no type info is available, fall back to
        // pretty printing some span information. This should
        // only occur very early in the compiler pipeline.
        const parent_def_id = new DefId(unwrap(key.parent), def_id.krate);
        const span = this._0.tcx.def_span(def_id);

        this.print_def_path(parent_def_id, []);

        // HACK(eddyb) copy of `print_path_with_simple` to avoid
        // constructing a `DisambiguatedDefPathData`.
        if (!this._0.empty_path) {
          this.write_str("::");
        }
        this.write_str(
          `<impl at ${
            // This may end up in stderr diagnostics but it may also be emitted
            // into MIR. Hence we use the remapped path if available
            this._0.tcx.sess.source_map().span_to_diagnostic_string(span)
          }>`,
        );
        this._0.empty_path = false;

        return;
      }
    }

    this.default_print_def_path(def_id, args);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2285 print_region
  print_region(region: Region): void {
    this.pretty_print_region(region);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2289 print_type
  print_type(ty: Ty): void {
    const has_regions = this._0.region_highlight_mode.keep_regions && Ty_has_type_flags(ty, TypeFlags.HAS_REGIONS);
    const k = ty.kind();
    if (k.$ === "Tuple" && k._0.length === 0) {
      // Don't truncate `()`.
      return this.pretty_print_type(ty);
    }

    if (
      k.$ === "Adt" &&
      this.should_truncate() &&
      iter_count(k._1.consts()) < 2 &&
      iter_count(k._1.types()) < 2 &&
      (() => {
        // We ensure that if there's at most a single type parameter and that type
        // *doesn't* have any parameters, to avoid printing all the names in cases
        // like `Foo<Foo<Foo<Foo<...>>>`, instead truncating those always to
        // `Foo<...>`.
        const arg = iter_next(k._1.types());
        if (arg !== undefined) {
          const ak = arg.kind();
          if (ak.$ === "Adt") {
            const arg_args = ak._1;
            if (iter_next(arg_args.terms()) === undefined) {
              // Single param type with no type or const parameters:
              // `Foo<Bar<'a>>`.
              return true;
            } else {
              // Single param type with multiple type or const parameters:
              // `Foo<Bar<Baz, Qux>>`. We don't want to recurse into those,
              // we'll replace the whole thing with `...`.
              return false;
            }
          } else {
            // Single type param that *isn't* a type with parameters, like a
            // primitive: `Foo<i32>`.
            return true;
          }
        } else {
          // No type param: `Foo`.
          return true;
        }
      })() &&
      utf8_len(Symbol.as_str(this._0.tcx.item_name(AdtDef_did(k._0)))) < 7
    ) {
      // Don't fully truncate types that have "short names" and at most one type or const
      // param. We do use the short path for them (only item name instead of full path).
      return with_forced_trimmed_paths(() => this.pretty_print_type(ty));
    }

    if (
      k.$ === "Alias" &&
      this.should_truncate() &&
      k._1.kind.$ === "Opaque" &&
      this._0.region_highlight_mode.keep_regions &&
      (() => {
        const def_id = (k._1.kind as { def_id: DefId }).def_id;
        for (const u of EarlyBinder_iter_instantiated_copied(this._0.tcx.explicit_item_bounds(def_id), this._0.tcx, k._1.args)) {
          const [value, _] = Unnormalized_skip_norm_wip(u);
          if (Clause_has_bound_vars(value)) return true;
        }
        return false;
      })()
    ) {
      // `<impl for<'a> Trait as Trait>`
      this._0.printed_type_count += 1;
      return this.pretty_print_type(ty);
    }

    if (
      (k.$ === "Adt" ||
        k.$ === "Foreign" ||
        k.$ === "Pat" ||
        k.$ === "RawPtr" ||
        k.$ === "Ref" ||
        k.$ === "FnDef" ||
        k.$ === "FnPtr" ||
        k.$ === "UnsafeBinder" ||
        k.$ === "Dynamic" ||
        k.$ === "CoroutineClosure" ||
        k.$ === "Coroutine" ||
        k.$ === "CoroutineWitness" ||
        k.$ === "Tuple" ||
        k.$ === "Alias" ||
        k.$ === "Bound" ||
        k.$ === "Placeholder" ||
        k.$ === "Error") &&
      this.should_truncate() &&
      !has_regions
    ) {
      // We only truncate types that we know are likely to be much longer than 3 chars.
      // There's no point in replacing `i32` or `!`.
      this.write_str("_");
      return;
    }
    if (k.$ === "Ref" && this.should_truncate() && has_regions) return this.pretty_print_type(ty);
    if (k.$ === "Closure") return this.pretty_print_type(ty);
    this._0.printed_type_count += 1;
    return this.pretty_print_type(ty);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2385 print_dyn_existential
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): void {
    this.pretty_print_dyn_existential(predicates);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2392 print_const
  print_const(ct: Const): void {
    this.pretty_print_const(ct, false);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2396 print_crate_name
  print_crate_name(cnum: CrateNum): void {
    this._0.empty_path = true;
    if (cnum === LOCAL_CRATE && !with_resolve_crate_name_get()) {
      if (with_crate_prefix_get()) {
        this.write_str(display_Symbol(kw.Crate));
        this._0.empty_path = false;
      }
    } else {
      this.write_str(display_Symbol(this._0.tcx.crate_name(cnum)));
      this._0.empty_path = false;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2410 print_path_with_qualified
  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): void {
    this.pretty_print_path_with_qualified(self_ty, trait_ref);
    this._0.empty_path = false;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2420 print_path_with_impl
  print_path_with_impl(print_prefix: (p: this) => void, self_ty: Ty, trait_ref: TraitRef | undefined): void {
    this.pretty_print_path_with_impl(
      (p) => {
        print_prefix(p);
        if (!p._0.empty_path) {
          p.write_str("::");
        }
      },
      self_ty,
      trait_ref,
    );
    this._0.empty_path = false;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2442 print_path_with_simple
  print_path_with_simple(print_prefix: (p: this) => void, disambiguated_data: DisambiguatedDefPathData): void {
    print_prefix(this);

    // Skip `::{{extern}}` blocks and `::{{constructor}}` on tuple/unit structs.
    if (disambiguated_data.data.$ === "ForeignMod" || disambiguated_data.data.$ === "Ctor") {
      return;
    }

    const name = DefPathData.name(disambiguated_data.data);
    if (!this._0.empty_path) {
      this.write_str("::");
    }

    if (name.$ === "Named") {
      if (Ident.with_dummy_span(name._0).is_raw_guess()) {
        this.write_str("r#");
      }
    }

    const verbose = this.should_print_verbose();
    this.write_str(display_Symbol(disambiguated_data.as_sym(verbose)));

    this._0.empty_path = false;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2473 print_path_with_generic_args
  print_path_with_generic_args(print_prefix: (p: this) => void, args: readonly GenericArg[]): void {
    print_prefix(this);

    if (args.length !== 0) {
      if (this._0.in_value) {
        this.write_str("::");
      }
      this.generic_delimiters((p) => p.comma_sep(args, print_GenericArg));
    }
  }

  // ---- impl PrettyPrinter for FmtPrinter ----
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2492 ty_infer_name
  ty_infer_name(id: TyVid): Symbol | undefined {
    const func = this._0.ty_infer_name_resolver;
    return func === undefined ? undefined : func(id);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2496 reset_type_limit
  reset_type_limit(): void {
    this._0.printed_type_count = 0;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2500 const_infer_name
  const_infer_name(id: ConstVid): Symbol | undefined {
    const func = this._0.const_infer_name_resolver;
    return func === undefined ? undefined : func(id);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2504 pretty_print_value_path
  pretty_print_value_path(def_id: DefId, args: readonly GenericArg[]): void {
    const was_in_value = this._0.in_value;
    this._0.in_value = true;
    this.print_def_path(def_id, args);
    this._0.in_value = was_in_value;
  }

  // PORT: `T: Print<Self> + TypeFoldable` are the descriptors `p_T` and `d_T` (D4).
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2516 pretty_print_in_binder
  pretty_print_in_binder<T>(value: Binder<T>, p_T: Print<T>, d_T: TypeFoldable<T>): void {
    this.wrap_binder(value, WrapBinderMode.ForAll, (new_value, this_) => p_T.print(new_value, this_), d_T);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2523 wrap_binder
  wrap_binder<T>(value: Binder<T>, mode: WrapBinderMode, f: (value: T, p: this) => void, d_T: TypeFoldable<T>): void {
    const old_region_index = this._0.region_index;
    const [new_value, _] = this.name_all_regions(value, mode, d_T);
    f(new_value, this);
    this._0.region_index = old_region_index;
    this._0.binder_depth -= 1;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2540 typed_value
  typed_value(f: (p: this) => void, t: (p: this) => void, conversion: string): void {
    this.write_str("{");
    f(this);
    this.write_str(conversion);
    const was_in_value = this._0.in_value;
    this._0.in_value = false;
    t(this);
    this._0.in_value = was_in_value;
    this.write_str("}");
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2556 generic_delimiters
  generic_delimiters(f: (p: this) => void): void {
    this.write_str("<");

    const was_in_value = this._0.in_value;
    this._0.in_value = false;
    f(this);
    this._0.in_value = was_in_value;

    this.write_str(">");
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2570 should_truncate
  should_truncate(): boolean {
    return !this._0.type_length_limit.value_within_limit(this._0.printed_type_count);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2574 should_print_optional_region
  should_print_optional_region(region: Region): boolean {
    const highlight = this._0.region_highlight_mode;
    if (highlight.region_highlighted(region) !== undefined) {
      return true;
    }

    if (this.should_print_verbose()) {
      return true;
    }

    if (with_forced_trimmed_paths_get()) {
      return false;
    }

    const identify_regions = this._0.tcx.sess.opts.unstable_opts.identify_regions;

    const k = region.kind();
    switch (k.$) {
      case "ReEarlyParam":
        return EarlyParamRegion_is_named(k._0);

      case "ReLateParam":
        return LateParamRegionKind_is_named(k._0.kind, this._0.tcx);
      case "ReBound":
      case "RePlaceholder": {
        const br = k.$ === "ReBound" ? k._1.kind : k._0.bound.kind;
        if (BoundRegionKind_is_named(br, this._0.tcx)) {
          return true;
        }

        if (highlight.highlight_bound_region !== undefined) {
          const [region, _] = highlight.highlight_bound_region;
          if (BoundRegionKind_eq(br, region)) {
            return true;
          }
        }

        return false;
      }

      case "ReVar":
        if (identify_regions) return true;
        return false;

      case "ReErased":
      case "ReError":
        return false;

      case "ReStatic":
        return true;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2619 pretty_print_const_pointer
  pretty_print_const_pointer(p: Pointer, ty: Ty): void {
    const print = (this_: FmtPrinter): void => {
      if (this_._0.print_alloc_ids) {
        this_.write_str(debug_Pointer(p, PLAIN));
      } else {
        this_.write_str("&_");
      }
    };
    this.typed_value(print, (this_) => this_.print_type(ty), ": ");
  }

  // HACK(eddyb) limited to `FmtPrinter` because of `region_highlight_mode`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2638 pretty_print_region
  pretty_print_region(region: Region): void {
    // Watch out for region highlights.
    const highlight = this._0.region_highlight_mode;
    const n = highlight.region_highlighted(region);
    if (n !== undefined) {
      this.write_str(`'${n}`);
      return;
    }

    if (this.should_print_verbose()) {
      this.write_str(debug_Region(region, PLAIN));
      return;
    }

    const identify_regions = this._0.tcx.sess.opts.unstable_opts.identify_regions;

    // These printouts are concise. They do not contain all the information
    // the user might want to diagnose an error, but there is basically no way
    // to fit that into a short string. Hence the recommendation to use
    // `explain_region()` or `note_and_explain_region()`.
    const k = region.kind();
    switch (k.$) {
      case "ReEarlyParam": {
        const data = k._0;
        this.write_str(display_Symbol(data.name));
        return;
      }
      case "ReLateParam": {
        const kind = k._0.kind;
        const name = LateParamRegionKind_get_name(kind, this._0.tcx);
        if (name !== undefined) {
          this.write_str(display_Symbol(name));
          return;
        }
        break;
      }
      case "ReBound":
      case "RePlaceholder": {
        const br = k.$ === "ReBound" ? k._1.kind : k._0.bound.kind;
        const name = BoundRegionKind_get_name(br, this._0.tcx);
        if (name !== undefined) {
          this.write_str(display_Symbol(name));
          return;
        }

        if (highlight.highlight_bound_region !== undefined) {
          const [region, counter] = highlight.highlight_bound_region;
          if (BoundRegionKind_eq(br, region)) {
            this.write_str(`'${counter}`);
            return;
          }
        }
        break;
      }
      case "ReVar": {
        if (identify_regions) {
          const region_vid = k._0;
          this.write_str(debug_RegionVid(region_vid, PLAIN));
          return;
        }
        break;
      }
      case "ReErased":
        break;
      case "ReError":
        break;
      case "ReStatic": {
        this.write_str("'static");
        return;
      }
    }

    this.write_str("'_");
  }

  // HACK(eddyb) limited to `FmtPrinter` because of `binder_depth`,
  // `region_index` and `used_region_names`.
  // PORT: `T: TypeFoldable` is the descriptor `d_T` (D4); `UnordMap<BoundRegion, Region>` is a `KeyedMap` (D5).
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2778 name_all_regions
  name_all_regions<T>(value: Binder<T>, mode: WrapBinderMode, d_T: TypeFoldable<T>): [T, KeyedMap<BoundRegion, Region>] {
    // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2786 name_by_region_index
    function name_by_region_index(index: number, available_names: Symbol[], num_available: number): Symbol {
      const name = available_names.pop();
      if (name !== undefined) {
        return name;
      } else {
        return Symbol.intern(`'z${index - num_available}`);
      }
    }

    // debug!("name_all_regions");

    // Replace any anonymous late-bound regions with named
    // variants, using new unique identifiers, so that we can
    // clearly differentiate between named and unnamed regions in
    // the output. We'll probably want to tweak this over time to
    // decide just how much information to give.
    if (this._0.binder_depth === 0) {
      this.prepare_region_info(value, d_T);
    }

    // debug!("self.used_region_names: {:?}", self.used_region_names);

    let empty = true;
    const start_or_continue = (p: FmtPrinter, start: string, cont: string): void => {
      let w: string;
      if (empty) {
        empty = false;
        w = start;
      } else {
        w = cont;
      }
      p.write_str(w);
    };
    const do_continue = (p: FmtPrinter, cont: Symbol): void => {
      p.write_str(display_Symbol(cont));
    };

    // `('a'..='z').rev().map(|s| Symbol::intern(&format!("'{s}")))`, collected through the filter below in the
    // same order (the interning order is upstream's).
    const available_names: Symbol[] = [];
    for (let s = 0x7a; s >= 0x61; s--) {
      const name = Symbol.intern(`'${String.fromCharCode(s)}`);
      if (!this._0.used_region_names.has(name)) available_names.push(name);
    }
    // debug!(?available_names);
    const num_available = available_names.length;

    let region_index = this._0.region_index;
    const next_name = (this_: FmtPrinter): Symbol => {
      let name: Symbol;

      for (;;) {
        name = name_by_region_index(region_index, available_names, num_available);
        region_index += 1;

        if (!this_._0.used_region_names.has(name)) {
          break;
        }
      }

      return name;
    };

    // If we want to print verbosely, then print *all* binders, even if they
    // aren't named. Eventually, we might just want this as the default, but
    // this is not *quite* right and changes the ordering of some output
    // anyways.
    let new_value: T;
    let map: KeyedMap<BoundRegion, Region>;
    if (this.should_print_verbose()) {
      for (const var_ of value.bound_vars) {
        start_or_continue(this, WrapBinderMode.start_str(mode), ", ");
        this.write_str(debug_BoundVariableKind(var_, PLAIN));
      }
      // Unconditionally render `unsafe<>`.
      if (value.bound_vars.length === 0 && mode === WrapBinderMode.Unsafe) {
        start_or_continue(this, WrapBinderMode.start_str(mode), "");
      }
      start_or_continue(this, "", "> ");
      [new_value, map] = [Binder_skip_binder(value), new KeyedMap<BoundRegion, Region>(intern_key)];
    } else {
      const tcx = this._0.tcx;

      const trim_path = with_forced_trimmed_paths_get();
      // Closure used in `RegionFolder` to create names for anonymous late-bound
      // regions.
      const name = (br: BoundRegion): Region => {
        let name: Symbol;
        let kind: BoundRegionKind;
        const n = BoundRegionKind_get_name(br.kind, tcx);
        if (n !== undefined) {
          [name, kind] = [n, br.kind];
        } else {
          const name_ = next_name(this);
          [name, kind] = [name_, { $: "NamedForPrinting", _0: name_ }];
        }

        // Unconditionally render `unsafe<>`.
        if (!trim_path || mode === WrapBinderMode.Unsafe) {
          start_or_continue(this, WrapBinderMode.start_str(mode), ", ");
          do_continue(this, name);
        }
        return Region.new_bound(tcx, INNERMOST, { var: br.var, kind });
      };
      const folder = new RegionFolder(tcx, INNERMOST, new KeyedMap<BoundRegion, Region>(intern_key), name);
      const new_value_ = d_T.fold_with(Binder_skip_binder(value), folder);
      const region_map = folder.region_map;

      if (mode === WrapBinderMode.Unsafe && region_map.size === 0) {
        start_or_continue(this, WrapBinderMode.start_str(mode), "");
      }
      start_or_continue(this, "", "> ");

      [new_value, map] = [new_value_, region_map];
    }

    this._0.binder_depth += 1;
    this._0.region_index = region_index;
    return [new_value, map];
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2907 prepare_region_info
  prepare_region_info<T>(value: Binder<T>, d_T: TypeFoldable<T>): void {
    // PORT: `type_collector: SsoHashSet<Ty>` is a `Set<Ty>`: only `insert` is used (never iterated), on interned keys.
    class RegionNameCollector implements TypeVisitor<undefined> {
      readonly Result = VisitorResult.unit;

      constructor(
        public tcx: TyCtxt,
        public used_region_names: Set<Symbol>,
        public type_collector: Set<Ty>,
      ) {}

      // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2918 new
      static new(tcx: TyCtxt): RegionNameCollector {
        return new RegionNameCollector(tcx, new Set(), new Set());
      }

      // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2928 visit_region
      visit_region(r: Region): undefined {
        // trace!("address: {:p}", r.0.0);

        // Collect all named lifetimes. These allow us to prevent duplication
        // of already existing lifetime names when introducing names for
        // anonymous late-bound regions.
        const name = r.get_name(this.tcx);
        if (name !== undefined) {
          this.used_region_names.add(name);
        }
        return undefined;
      }

      // We collect types in order to prevent really large types from compiling for
      // a really long time. See issue #83150 for why this is necessary.
      // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2941 visit_ty
      visit_ty(ty: Ty): undefined {
        const not_previously_inserted = !this.type_collector.has(ty);
        this.type_collector.add(ty);
        if (not_previously_inserted) {
          Ty_super_visit_with(ty, this);
        }
        return undefined;
      }

      visit_binder<U>(t: Binder<U>, d: TypeVisitable<U>): undefined {
        return TypeVisitor_provided.visit_binder(this, t, d);
      }
      visit_const(c: Const): undefined {
        return TypeVisitor_provided.visit_const(this, c);
      }
      visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
        return TypeVisitor_provided.visit_predicate(this, p, d);
      }
      visit_clauses(c: Clauses): undefined {
        return TypeVisitor_provided.visit_clauses(this, c);
      }
      visit_error(guar: Parameters<TypeVisitor<undefined>["visit_error"]>[0]): undefined {
        return TypeVisitor_provided.visit_error(this, guar);
      }
    }

    const collector = RegionNameCollector.new(this.tcx());
    visit_with_Binder(value, collector, d_T.visit_with);
    this._0.used_region_names = collector.used_region_names;
    this._0.region_index = 0;
  }

  // ---- provided `Printer` / `PrettyPrinter` methods that FmtPrinter does not override (delegation) ----
  print_impl_path(impl_def_id: DefId, args: readonly GenericArg[]): void {
    Printer_provided.print_impl_path(this, impl_def_id, args);
  }
  print_coroutine_with_kind(def_id: DefId, parent_args: readonly GenericArg[], kind: Ty): void {
    Printer_provided.print_coroutine_with_kind(this, def_id, parent_args, kind);
  }
  default_print_def_path(def_id: DefId, args: readonly GenericArg[]): void {
    Printer_provided.default_print_def_path(this, def_id, args);
  }
  default_print_impl_path(impl_def_id: DefId, self_ty: Ty, impl_trait_ref: TraitRef | undefined): void {
    Printer_provided.default_print_impl_path(this, impl_def_id, self_ty, impl_trait_ref);
  }
  comma_sep<T>(elems: Iterable<T>, p_T: Print<T>): void {
    PrettyPrinter_provided.comma_sep(this, elems, p_T);
  }
  parenthesized(f: (p: this) => void): void {
    PrettyPrinter_provided.parenthesized(this, f as (p: PrettyPrinter) => void);
  }
  maybe_parenthesized(f: (p: this) => void, parenthesized: boolean): void {
    PrettyPrinter_provided.maybe_parenthesized(this, f as (p: PrettyPrinter) => void, parenthesized);
  }
  try_print_visible_def_path(def_id: DefId): boolean {
    return PrettyPrinter_provided.try_print_visible_def_path(this, def_id);
  }
  force_print_trimmed_def_path(def_id: DefId): boolean {
    return PrettyPrinter_provided.force_print_trimmed_def_path(this, def_id);
  }
  try_print_trimmed_def_path(def_id: DefId): boolean {
    return PrettyPrinter_provided.try_print_trimmed_def_path(this, def_id);
  }
  try_print_visible_def_path_recur(def_id: DefId, callers: DefId[]): boolean {
    return PrettyPrinter_provided.try_print_visible_def_path_recur(this, def_id, callers);
  }
  pretty_print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): void {
    PrettyPrinter_provided.pretty_print_path_with_qualified(this, self_ty, trait_ref);
  }
  pretty_print_path_with_impl(print_prefix: (p: this) => void, self_ty: Ty, trait_ref: TraitRef | undefined): void {
    PrettyPrinter_provided.pretty_print_path_with_impl(this, print_prefix as (p: PrettyPrinter) => void, self_ty, trait_ref);
  }
  pretty_print_closure_inner(did: DefId, args: GenericArgs): void {
    PrettyPrinter_provided.pretty_print_closure_inner(this, did, args);
  }
  pretty_print_type(ty: Ty): void {
    PrettyPrinter_provided.pretty_print_type(this, ty);
  }
  pretty_print_opaque_impl_type(def_id: DefId, args: GenericArgs): void {
    PrettyPrinter_provided.pretty_print_opaque_impl_type(this, def_id, args);
  }
  insert_trait_and_projection(
    trait_pred: PolyTraitClause,
    proj_ty: [DefId, Binder<Term>] | undefined,
    traits: KeyedMap<PolyTraitClause, KeyedMap<DefId, Binder<Term>>>,
    fn_traits: KeyedMap<[Binder<[List<Ty>, Ty]>, boolean], OpaqueFnEntry>,
  ): void {
    PrettyPrinter_provided.insert_trait_and_projection(this, trait_pred, proj_ty, traits, fn_traits);
  }
  pretty_print_inherent_projection(alias_term: AliasTerm): void {
    PrettyPrinter_provided.pretty_print_inherent_projection(this, alias_term);
  }
  pretty_print_rpitit(def_id: DefId, args: GenericArgs): void {
    PrettyPrinter_provided.pretty_print_rpitit(this, def_id, args);
  }
  pretty_print_dyn_existential(predicates: List<PolyExistentialPredicate>): void {
    PrettyPrinter_provided.pretty_print_dyn_existential(this, predicates);
  }
  pretty_print_fn_sig(inputs: readonly Ty[], c_variadic: boolean, splatted: number | undefined, output: Ty): void {
    PrettyPrinter_provided.pretty_print_fn_sig(this, inputs, c_variadic, splatted, output);
  }
  pretty_print_const(ct: Const, print_ty: boolean): void {
    PrettyPrinter_provided.pretty_print_const(this, ct, print_ty);
  }
  pretty_print_const_expr(expr: Expr, print_ty: boolean): void {
    PrettyPrinter_provided.pretty_print_const_expr(this, expr, print_ty);
  }
  pretty_print_const_scalar(scalar: Scalar, ty: Ty): void {
    PrettyPrinter_provided_b.pretty_print_const_scalar(this, scalar, ty);
  }
  pretty_print_const_scalar_ptr(ptr: Pointer, ty: Ty): void {
    PrettyPrinter_provided_b.pretty_print_const_scalar_ptr(this, ptr, ty);
  }
  pretty_print_const_scalar_int(int: ScalarInt, ty: Ty, print_ty: boolean): void {
    PrettyPrinter_provided_b.pretty_print_const_scalar_int(this, int, ty, print_ty);
  }
  pretty_print_byte_str(byte_str: Uint8Array): void {
    PrettyPrinter_provided_b.pretty_print_byte_str(this, byte_str);
  }
  pretty_print_const_valtree(cv: Value, print_ty: boolean): void {
    PrettyPrinter_provided_b.pretty_print_const_valtree(this, cv, print_ty);
  }
  pretty_print_closure_as_impl(closure: ClosureArgs): void {
    PrettyPrinter_provided_b.pretty_print_closure_as_impl(this, closure);
  }
  pretty_print_bound_constness(constness: BoundConstness): void {
    PrettyPrinter_provided_b.pretty_print_bound_constness(this, constness);
  }
  should_print_verbose(): boolean {
    return PrettyPrinter_provided_b.should_print_verbose(this);
  }
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2151 guess_def_namespace
function guess_def_namespace(tcx: TyCtxt, def_id: DefId): Namespace {
  const data = tcx.def_key(def_id).disambiguated_data.data;
  switch (data.$) {
    case "TypeNs":
    case "CrateRoot":
    case "OpaqueTy":
      return Namespace.TypeNS;

    case "ValueNs":
    case "AnonConst":
    case "Closure":
    case "Ctor":
      return Namespace.ValueNS;

    case "MacroNs":
      return Namespace.MacroNS;

    default:
      return Namespace.TypeNS;
  }
}

// ---- impl TyCtxt (pretty.rs:2168) ----
// PORT: `def_path_str` replaces the placeholder method of the `TyCtxt` class body (context.ts, "ty/print/pretty.rs").

/// Returns a string identifying this `DefId`. This string is
/// suitable for user output.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2171 def_path_str
TyCtxt.prototype.def_path_str = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>): string {
  const def_id = into_query_key_DefId(def_id_);
  return this.def_path_str_with_args(def_id, []);
};

/// For this one we determine the appropriate namespace for the `def_id`.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2177 def_path_str_with_args
TyCtxt.prototype.def_path_str_with_args = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>, args: readonly GenericArg[]): string {
  const def_id = into_query_key_DefId(def_id_);
  const ns = guess_def_namespace(this, def_id);
  // debug!("def_path_str: def_id={:?}, ns={:?}", def_id, ns);

  return FmtPrinter.print_string(this, ns, (p) => p.print_def_path(def_id, args));
};

/// For this one we always use value namespace.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2190 value_path_str_with_args
TyCtxt.prototype.value_path_str_with_args = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>, args: readonly GenericArg[]): string {
  const def_id = into_query_key_DefId(def_id_);
  const ns = Namespace.ValueNS;
  // debug!("value_path_str: def_id={:?}, ns={:?}", def_id, ns);

  return FmtPrinter.print_string(this, ns, (p) => p.print_def_path(def_id, args));
};

/// Folds through bound vars and placeholders, naming them
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2704 RegionFolder
class RegionFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public current_index: DebruijnIndex,
    /// Regions bound by the binder being named (and placeholders) that have
    /// already been named.
    public region_map: KeyedMap<BoundRegion, Region>,
    public name: (br: BoundRegion) => Region,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2714 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2718 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.current_index = DebruijnIndex_shifted_in(this.current_index, 1);
    const t_ = Binder_super_fold_with(t, this, d);
    this.current_index = DebruijnIndex_shifted_out(this.current_index, 1);
    return t_;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2728 fold_ty
  fold_ty(t: Ty): Ty {
    if (Ty_has_vars_bound_at_or_above(t, this.current_index) || Ty_has_placeholders(t)) {
      return Ty_super_fold_with(t, this);
    }
    return t;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2738 fold_region
  fold_region(r: Region): Region {
    const name = this.name;
    let region: Region;
    const k = r.kind();
    // Only name regions bound by the binder being named. Regions bound by an
    // enclosing binder that merely escape through this one keep their name
    // (they were named when that binder was folded) and their index, and must
    // not end up in `region_map`, which callers use to build `for<...>` lists
    // (#102392, #134410).
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 === this.current_index) {
      const br = k._1;
      region = map_entry_or_insert_with(this.region_map, br, () => name(br));
    } else if (k.$ === "RePlaceholder") {
      const kind = k._0.bound.kind;
      // If this is an anonymous placeholder, don't rename. Otherwise, in some
      // async fns, we get a `for<'r> Send` bound
      switch (kind.$) {
        case "Anon":
        case "ClosureEnv":
          region = r;
          break;
        default: {
          // Index doesn't matter, since this is just for naming and these never get bound
          const br: BoundRegion = { var: BoundVar.ZERO, kind };
          region = map_entry_or_insert_with(this.region_map, br, () => name(br));
        }
      }
    } else {
      return r;
    }
    const rk = region.kind();
    if (rk.$ === "ReBound" && rk._0.$ === "Bound") {
      const debruijn1 = rk._0._0;
      const br = rk._1;
      assert_eq(debruijn1, INNERMOST, (v) => `DebruijnIndex(${v})`);
      return Region.new_bound(this.tcx, this.current_index, br);
    } else {
      return region;
    }
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/** `*map.entry(k).or_insert_with(f)` */
function map_entry_or_insert_with<K, V>(map: Map<K, V>, k: K, f: () => V): V {
  if (map.has(k)) return map.get(k) as V;
  const v = f();
  map.set(k, v);
  return v;
}

// impl<'tcx, T, P: PrettyPrinter<'tcx>> Print<P> for ty::Binder<'tcx, T> where T: Print<P> + TypeFoldable
export function print_Binder<T>(p_T: Print<T>, d_T: TypeFoldable<T>): Print<Binder<T>> {
  return {
    // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2960 print
    print(self: Binder<T>, p: PrettyPrinter): void {
      p.pretty_print_in_binder(self, p_T, d_T);
    },
  };
}

// impl<'tcx, T, P: PrettyPrinter<'tcx>> Print<P> for ty::OutlivesClause<'tcx, T> where T: Print<P>
export function print_OutlivesClause<T>(p_T: Print<T>): Print<OutlivesClause<T>> {
  return {
    // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2969 print
    print(self: OutlivesClause<T>, p: PrettyPrinter): void {
      p_T.print(self._0, p);
      p.write_str(": ");
      print_Region.print(self._1, p);
    },
  };
}

/// Wrapper type for `ty::TraitRef` which opts-in to pretty printing only
/// the trait path. That is, it will print `Trait<U>` instead of
/// `<T as Trait<U>>`.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2981 TraitRefPrintOnlyTraitPath
export interface TraitRefPrintOnlyTraitPath {
  _0: TraitRef;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2984 into_diag_arg
export function TraitRefPrintOnlyTraitPath_into_diag_arg(self: TraitRefPrintOnlyTraitPath, path: MutRef<string | undefined>): DiagArgValue {
  return with_((tcx) => {
    const trait_ref = tcx.short_string(/* tcx.lift */ self, path, as_decls_print(print_TraitRefPrintOnlyTraitPath));
    return { $: "Str", _0: trait_ref };
  });
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2993 fmt
export const debug_TraitRefPrintOnlyTraitPath: Debug<TraitRefPrintOnlyTraitPath> = (v, _f) => display_TraitRefPrintOnlyTraitPath(v);

/// Wrapper type for `ty::TraitRef` which opts-in to pretty printing only
/// the trait path, and additionally tries to "sugar" `Fn(...)` trait bounds.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3001 TraitRefPrintSugared
export interface TraitRefPrintSugared {
  _0: TraitRef;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3004 into_diag_arg
export function TraitRefPrintSugared_into_diag_arg(self: TraitRefPrintSugared, path: MutRef<string | undefined>): DiagArgValue {
  return with_((tcx) => {
    const trait_ref = tcx.short_string(/* tcx.lift */ self, path, as_decls_print(print_TraitRefPrintSugared));
    return { $: "Str", _0: trait_ref };
  });
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3013 fmt
export const debug_TraitRefPrintSugared: Debug<TraitRefPrintSugared> = (v, _f) => display_TraitRefPrintSugared(v);

/// Wrapper type for `ty::TraitRef` which opts-in to pretty printing only
/// the trait name. That is, it will print `Trait` instead of
/// `<T as Trait<U>>`.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3022 TraitRefPrintOnlyTraitName
export interface TraitRefPrintOnlyTraitName {
  _0: TraitRef;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3025 fmt
export const debug_TraitRefPrintOnlyTraitName: Debug<TraitRefPrintOnlyTraitName> = (v, _f) => display_TraitRefPrintOnlyTraitName(v);

/** `#[extension(pub trait PrintTraitRefExt)] impl TraitRef` */
export const PrintTraitRefExt = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3032 print_only_trait_path
  print_only_trait_path(self: TraitRef): TraitRefPrintOnlyTraitPath {
    return { _0: self };
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3036 print_trait_sugared
  print_trait_sugared(self: TraitRef): TraitRefPrintSugared {
    return { _0: self };
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3040 print_only_trait_name
  print_only_trait_name(self: TraitRef): TraitRefPrintOnlyTraitName {
    return { _0: self };
  },
};

/** `#[extension(pub trait PrintPolyTraitRefExt)] impl Binder<TraitRef>` */
export const PrintPolyTraitRefExt = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3047 print_only_trait_path
  print_only_trait_path(self: PolyTraitRef): Binder<TraitRefPrintOnlyTraitPath> {
    return Binder_map_bound(self, (tr) => PrintTraitRefExt.print_only_trait_path(tr));
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3051 print_trait_sugared
  print_trait_sugared(self: PolyTraitRef): Binder<TraitRefPrintSugared> {
    return Binder_map_bound(self, (tr) => PrintTraitRefExt.print_trait_sugared(tr));
  },
};

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3057 TraitClausePrintModifiersAndPath
export interface TraitClausePrintModifiersAndPath {
  _0: TraitClause;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3060 fmt
export const debug_TraitClausePrintModifiersAndPath: Debug<TraitClausePrintModifiersAndPath> = (v, _f) => display_TraitClausePrintModifiersAndPath(v);

/** `#[extension(pub trait PrintTraitClauseExt)] impl TraitClause` */
export const PrintTraitClauseExt = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3067 print_modifiers_and_trait_path
  print_modifiers_and_trait_path(self: TraitClause): TraitClausePrintModifiersAndPath {
    return { _0: self };
  },
};

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3073 TraitClausePrintWithBoundConstness
export interface TraitClausePrintWithBoundConstness {
  _0: TraitClause;
  _1: BoundConstness | undefined;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3079 fmt
export const debug_TraitClausePrintWithBoundConstness: Debug<TraitClausePrintWithBoundConstness> = (v, _f) => display_TraitClausePrintWithBoundConstness(v);

/** `#[extension(pub trait PrintPolyTraitClauseExt)] impl PolyTraitClause` */
export const PrintPolyTraitClauseExt = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3086 print_modifiers_and_trait_path
  print_modifiers_and_trait_path(self: PolyTraitClause): Binder<TraitClausePrintModifiersAndPath> {
    return Binder_map_bound(self, (_0): TraitClausePrintModifiersAndPath => ({ _0 }));
  },

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3092 print_with_bound_constness
  print_with_bound_constness(self: PolyTraitClause, constness: BoundConstness | undefined): Binder<TraitClausePrintWithBoundConstness> {
    return Binder_map_bound(self, (trait_pred): TraitClausePrintWithBoundConstness => ({ _0: trait_pred, _1: constness }));
  },
};

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3101 PrintClosureAsImpl
export interface PrintClosureAsImpl {
  closure: ClosureArgs;
}
/** `#[derive(Debug)]` */
export const debug_PrintClosureAsImpl: Debug<PrintClosureAsImpl> = (v, f) => {
  const fields: [string, string][] = [["closure", debug_ClosureArgs(v.closure, f)]];
  return f.alternate ? `PrintClosureAsImpl {\n${fields.map(([n, s]) => `    ${n}: ${s.replaceAll("\n", "\n    ")},\n`).join("")}}` : `PrintClosureAsImpl { ${fields.map(([n, s]) => `${n}: ${s}`).join(", ")} }`;
};

/** `macro_rules! forward_display_to_print`: `impl fmt::Display for $ty` (one `display_<T>` per type). */
function forward_display_to_print<T>(p_T: Print<T>): (self: T) => string {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3110 fmt
  return function fmt(self: T): string {
    return with_((tcx) => {
      const p = FmtPrinter.new(tcx, Namespace.TypeNS);
      p_T.print(/* tcx.lift */ self, p);
      return p.into_buffer();
    });
  };
}

// `define_print!` / `define_print_and_forward_display!` (pretty.rs:3124 / :3135): each `$ty $print` block is a
// descriptor `print_<T>` whose `print` is the block (the macro's `let _: () = $print; Ok(())`).

// forward_display_to_print! { Ty<'tcx>, &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>> }
export const display_Ty: (self: Ty) => string = (self) => forward_display_to_print(print_Ty)(self);
export const display_List_PolyExistentialPredicate: (self: List<PolyExistentialPredicate>) => string = (self) =>
  forward_display_to_print(print_List_PolyExistentialPredicate)(self);

// ---- define_print! (pretty.rs:3147) ----
export const print_FnSig: Print<FnSig> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: FnSig, p: PrettyPrinter): void {
    p.write_str(Safety.prefix_str(FnSigC.safety(self)));

    const abi: ExternAbi = FnSigC.abi(self);
    if (abi.$ !== "Rust") {
      p.write_str(`extern ${display_ExternAbi(abi)} `);
    }

    p.write_str("fn");
    p.pretty_print_fn_sig(FnSigC.inputs(self), FnSigC.c_variadic(self), FnSigC.splatted(self), FnSigC.output(self));
  },
};

export const print_TraitRef: Print<TraitRef> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitRef, p: PrettyPrinter): void {
    p.write_str(`<${display_Ty(TraitRef_self_ty(self))} as ${display_TraitRefPrintOnlyTraitPath(PrintTraitRefExt.print_only_trait_path(self))}>`);
  },
};

export const print_AliasTy: Print<AliasTy> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: AliasTy, p: PrettyPrinter): void {
    const alias_term: AliasTerm = AliasTermC.from_AliasTy(self);
    print_AliasTerm.print(alias_term, p);
  },
};

export const print_AliasTerm: Print<AliasTerm> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: AliasTerm, p: PrettyPrinter): void {
    const kind = self.kind;
    switch (kind.$) {
      case "InherentTy":
      case "InherentConstSelf": {
        p.pretty_print_inherent_projection(self);
        break;
      }
      case "ProjectionTy": {
        const def_id = kind.def_id;
        if (!(p.should_print_verbose() || with_reduced_queries_get()) && p.tcx().is_impl_trait_in_trait(def_id)) {
          p.pretty_print_rpitit(def_id, self.args);
        } else {
          p.print_def_path(def_id, self.args);
        }
        break;
      }
      case "FreeTy":
      case "FreeConst":
      case "OpaqueTy":
      case "AnonConst":
      case "ProjectionConst":
      case "InherentConstImpl": {
        const def_id = kind.def_id;
        p.print_def_path(def_id, self.args);
        break;
      }
    }
  },
};

export const print_TraitClause: Print<TraitClause> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitClause, p: PrettyPrinter): void {
    print_Ty.print(TraitRef_self_ty(self.trait_ref), p);
    p.write_str(": ");
    if (self.polarity === "Negative") {
      p.write_str("!");
    }
    print_TraitRefPrintSugared.print(PrintTraitRefExt.print_trait_sugared(self.trait_ref), p);
  },
};

export const print_HostEffectClause: Print<HostEffectClause> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: HostEffectClause, p: PrettyPrinter): void {
    let constness: string;
    switch (self.constness) {
      case "Const":
        constness = "const";
        break;
      case "Maybe":
        constness = "[const]";
        break;
    }
    print_Ty.print(TraitRef_self_ty(self.trait_ref), p);
    p.write_str(`: ${constness} `);
    print_TraitRefPrintSugared.print(PrintTraitRefExt.print_trait_sugared(self.trait_ref), p);
  },
};

export const print_TypeAndMut: Print<TypeAndMut> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TypeAndMut, p: PrettyPrinter): void {
    p.write_str(Mutability.prefix_str(self.mutbl));
    print_Ty.print(self.ty, p);
  },
};

export const print_ClauseKind: Print<ClauseKind> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ClauseKind, p: PrettyPrinter): void {
    switch (self.$) {
      case "Trait":
        print_TraitClause.print(self._0, p);
        break;
      case "RegionOutlives":
        print_OutlivesClause(print_Region).print(self._0, p);
        break;
      case "TypeOutlives":
        print_OutlivesClause(print_Ty).print(self._0, p);
        break;
      case "Projection":
        print_ProjectionClause.print(self._0, p);
        break;
      case "HostEffect":
        print_HostEffectClause.print(self._0, p);
        break;
      case "ConstArgHasType": {
        const ct = self._0;
        const ty = self._1;
        p.write_str("the constant `");
        print_Const.print(ct, p);
        p.write_str("` has type `");
        print_Ty.print(ty, p);
        p.write_str("`");
        break;
      }
      case "WellFormed": {
        const term = self._0;
        print_Term.print(term, p);
        p.write_str(" well-formed");
        break;
      }
      case "ConstEvaluatable": {
        const ct = self._0;
        p.write_str("the constant `");
        print_Const.print(ct, p);
        p.write_str("` can be evaluated");
        break;
      }
      case "UnstableFeature": {
        const symbol = self._0;
        p.write_str(`feature(${display_Symbol(symbol)}) is enabled`);
        break;
      }
    }
  },
};

export const print_PredicateKind: Print<PredicateKind> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: PredicateKind, p: PrettyPrinter): void {
    switch (self.$) {
      case "Clause":
        print_ClauseKind.print(self._0, p);
        break;
      case "Subtype":
        print_SubtypePredicate.print(self._0, p);
        break;
      case "Coerce":
        print_CoercePredicate.print(self._0, p);
        break;
      case "DynCompatible": {
        const trait_def_id = self._0;
        p.write_str("the trait `");
        p.print_def_path(trait_def_id, []);
        p.write_str("` is dyn-compatible");
        break;
      }
      case "ConstEquate": {
        const c1 = self._0;
        const c2 = self._1;
        p.write_str("the constant `");
        print_Const.print(c1, p);
        p.write_str("` equals `");
        print_Const.print(c2, p);
        p.write_str("`");
        break;
      }
      case "Ambiguous":
        p.write_str("ambiguous");
        break;
      case "NormalizesTo":
        print_NormalizesTo.print(self._0, p);
        break;
    }
  },
};

export const print_ExistentialPredicate: Print<ExistentialPredicate> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ExistentialPredicate, p: PrettyPrinter): void {
    switch (self.$) {
      case "Trait":
        print_ExistentialTraitRef.print(self._0, p);
        break;
      case "Projection":
        print_ExistentialProjection.print(self._0, p);
        break;
      case "AutoTrait":
        p.print_def_path(self._0, []);
        break;
    }
  },
};

export const print_ExistentialTraitRef: Print<ExistentialTraitRef> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ExistentialTraitRef, p: PrettyPrinter): void {
    // Dummy Self is safe to use as it can't appear in generic param defaults which is important
    // later on for correctly eliding generic args that coincide with their default.
    const trait_ref = ExistentialTraitRef_with_self_ty(self, p.tcx(), p.tcx().types.trait_object_dummy_self);
    print_TraitRefPrintOnlyTraitPath.print(PrintTraitRefExt.print_only_trait_path(trait_ref), p);
  },
};

export const print_ExistentialProjection: Print<ExistentialProjection> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ExistentialProjection, p: PrettyPrinter): void {
    const name = AssocItem_name(p.tcx().associated_item(self.def_id));
    // The args don't contain the self ty (as it has been erased) but the corresp.
    // generics do as the trait always has a self ty param. We need to offset.
    const args = self.args.slice((p.tcx().generics_of(self.def_id) as Generics).parent_count - 1);
    p.print_path_with_generic_args((p) => p.write_str(display_Symbol(name)), args);
    p.write_str(" = ");
    print_Term.print(self.term, p);
  },
};

export const print_ProjectionClause: Print<ProjectionClause> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ProjectionClause, p: PrettyPrinter): void {
    print_AliasTerm.print(self.projection_term, p);
    p.write_str(" == ");
    p.reset_type_limit();
    print_Term.print(self.term, p);
  },
};

export const print_SubtypePredicate: Print<SubtypePredicate> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: SubtypePredicate, p: PrettyPrinter): void {
    print_Ty.print(self.a, p);
    p.write_str(" <: ");
    p.reset_type_limit();
    print_Ty.print(self.b, p);
  },
};

export const print_CoercePredicate: Print<CoercePredicate> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: CoercePredicate, p: PrettyPrinter): void {
    print_Ty.print(self.a, p);
    p.write_str(" -> ");
    p.reset_type_limit();
    print_Ty.print(self.b, p);
  },
};

export const print_NormalizesTo: Print<NormalizesTo> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: NormalizesTo, p: PrettyPrinter): void {
    print_AliasTerm.print(self.alias, p);
    p.write_str(" normalizes-to ");
    p.reset_type_limit();
    print_Term.print(self.term, p);
  },
};

export const print_PlaceholderType: Print<PlaceholderType> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: PlaceholderType, p: PrettyPrinter): void {
    const kind = self.bound.kind;
    switch (kind.$) {
      case "Anon":
        p.write_str(debug_Placeholder(self, PLAIN, debug_BoundTy));
        break;
      case "Param": {
        const def_id = kind._0;
        switch (p.should_print_verbose()) {
          case true:
            p.write_str(debug_Placeholder(self, PLAIN, debug_BoundTy));
            break;
          case false:
            p.write_str(display_Symbol(p.tcx().item_name(def_id)));
            break;
        }
        break;
      }
    }
  },
};

// ---- define_print_and_forward_display! (pretty.rs:3334) ----
export const print_List_Ty: Print<List<Ty>> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: List<Ty>, p: PrettyPrinter): void {
    p.write_str("{");
    p.comma_sep(self, print_Ty);
    p.write_str("}");
  },
};

export const print_TraitRefPrintOnlyTraitPath: Print<TraitRefPrintOnlyTraitPath> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitRefPrintOnlyTraitPath, p: PrettyPrinter): void {
    p.print_def_path(self._0.def_id, self._0.args);
  },
};

export const print_TraitRefPrintSugared: Print<TraitRefPrintSugared> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitRefPrintSugared, p: PrettyPrinter): void {
    let args_ty: Ty | undefined;
    let tk;
    if (
      !with_reduced_queries_get() &&
      TraitDef_paren_sugar(p.tcx().trait_def(self._0.def_id)) &&
      (args_ty = self._0.args[1] === undefined ? undefined : GenericArg.as_type(self._0.args[1])) !== undefined &&
      (tk = args_ty.kind()).$ === "Tuple"
    ) {
      const args = tk._0;
      p.write_str(`${display_Symbol(p.tcx().item_name(self._0.def_id))}(`);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (i > 0) {
          p.write_str(", ");
        }
        print_Ty.print(arg, p);
      }
      p.write_str(")");
    } else {
      p.print_def_path(self._0.def_id, self._0.args);
    }
  },
};

export const print_TraitRefPrintOnlyTraitName: Print<TraitRefPrintOnlyTraitName> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitRefPrintOnlyTraitName, p: PrettyPrinter): void {
    p.print_def_path(self._0.def_id, []);
  },
};

export const print_TraitClausePrintModifiersAndPath: Print<TraitClausePrintModifiersAndPath> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitClausePrintModifiersAndPath, p: PrettyPrinter): void {
    if (self._0.polarity === "Negative") {
      p.write_str("!");
    }
    print_TraitRefPrintSugared.print(PrintTraitRefExt.print_trait_sugared(self._0.trait_ref), p);
  },
};

export const print_TraitClausePrintWithBoundConstness: Print<TraitClausePrintWithBoundConstness> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: TraitClausePrintWithBoundConstness, p: PrettyPrinter): void {
    print_Ty.print(TraitRef_self_ty(self._0.trait_ref), p);
    p.write_str(": ");
    if (self._1 !== undefined) {
      const constness = self._1;
      p.pretty_print_bound_constness(constness);
    }
    if (self._0.polarity === "Negative") {
      p.write_str("!");
    }
    print_TraitRefPrintSugared.print(PrintTraitRefExt.print_trait_sugared(self._0.trait_ref), p);
  },
};

export const print_PrintClosureAsImpl: Print<PrintClosureAsImpl> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: PrintClosureAsImpl, p: PrettyPrinter): void {
    p.pretty_print_closure_as_impl(self.closure);
  },
};

export const print_ParamTy: Print<ParamTy> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ParamTy, p: PrettyPrinter): void {
    p.write_str(display_Symbol(self.name));
  },
};

export const print_ParamConst: Print<ParamConst> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: ParamConst, p: PrettyPrinter): void {
    p.write_str(display_Symbol(self.name));
  },
};

export const print_Term: Print<Term> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: Term, p: PrettyPrinter): void {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        print_Ty.print(k._0, p);
        break;
      case "Const":
        print_Const.print(k._0, p);
        break;
    }
  },
};

export const print_Predicate: Print<Predicate> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: Predicate, p: PrettyPrinter): void {
    print_Binder(print_PredicateKind, fold_PredicateKind).print(self.kind(), p);
  },
};

export const print_Clause: Print<Clause> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: Clause, p: PrettyPrinter): void {
    print_Binder(print_ClauseKind, fold_ClauseKind).print(self.kind(), p);
  },
};

export const print_UserTypeKind: Print<UserTypeKind> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: UserTypeKind, p: PrettyPrinter): void {
    switch (self.$) {
      case "Ty": {
        const ty = self._0;
        p.write_str("Ty(");
        print_Ty.print(ty, p);
        break;
      }
      case "TypeOf": {
        const def_id = self._0;
        const { args, user_self_ty } = self._1;
        p.write_str("TypeOf(");
        p.print_def_path(def_id, args);
        if (user_self_ty !== undefined) {
          const { impl_def_id, self_ty } = user_self_ty;
          p.write_str(" at <impl ");
          const key = p.tcx().def_key(impl_def_id);
          const parent_def_id = new DefId(unwrap(key.parent), impl_def_id.krate);
          p.print_def_path(parent_def_id, []);
          p.write_str(`::<${display_Symbol(key.disambiguated_data.as_sym(false))}> for `);
          print_Ty.print(self_ty, p);
          p.write_str(">");
        }
        break;
      }
    }
    p.write_str(")");
  },
};

export const print_GenericArg: Print<GenericArg> = {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
  print(self: GenericArg, p: PrettyPrinter): void {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime":
        print_Region.print(k._0, p);
        break;
      case "Type":
        print_Ty.print(k._0, p);
        break;
      case "Const":
        print_Const.print(k._0, p);
        break;
    }
  },
};

// The `forward_display_to_print!` half of `define_print_and_forward_display!`.
export const display_List_Ty: (self: List<Ty>) => string = (self) => forward_display_to_print(print_List_Ty)(self);
export const display_TraitRefPrintOnlyTraitPath: (self: TraitRefPrintOnlyTraitPath) => string = (self) =>
  forward_display_to_print(print_TraitRefPrintOnlyTraitPath)(self);
export const display_TraitRefPrintSugared: (self: TraitRefPrintSugared) => string = (self) => forward_display_to_print(print_TraitRefPrintSugared)(self);
export const display_TraitRefPrintOnlyTraitName: (self: TraitRefPrintOnlyTraitName) => string = (self) =>
  forward_display_to_print(print_TraitRefPrintOnlyTraitName)(self);
export const display_TraitClausePrintModifiersAndPath: (self: TraitClausePrintModifiersAndPath) => string = (self) =>
  forward_display_to_print(print_TraitClausePrintModifiersAndPath)(self);
export const display_TraitClausePrintWithBoundConstness: (self: TraitClausePrintWithBoundConstness) => string = (self) =>
  forward_display_to_print(print_TraitClausePrintWithBoundConstness)(self);
export const display_PrintClosureAsImpl: (self: PrintClosureAsImpl) => string = (self) => forward_display_to_print(print_PrintClosureAsImpl)(self);
export const display_ParamTy: (self: ParamTy) => string = (self) => forward_display_to_print(print_ParamTy)(self);
export const display_ParamConst: (self: ParamConst) => string = (self) => forward_display_to_print(print_ParamConst)(self);
export const display_Term: (self: Term) => string = (self) => forward_display_to_print(print_Term)(self);
export const display_Predicate: (self: Predicate) => string = (self) => forward_display_to_print(print_Predicate)(self);
export const display_Clause: (self: Clause) => string = (self) => forward_display_to_print(print_Clause)(self);
export const display_UserTypeKind: (self: UserTypeKind) => string = (self) => forward_display_to_print(print_UserTypeKind)(self);
export const display_GenericArg: (self: GenericArg) => string = (self) => forward_display_to_print(print_GenericArg)(self);

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3448 for_each_def
function for_each_def(tcx: TyCtxt, collect_fn: (ident: Ident, ns: Namespace, def_id: DefId) => void): void {
  // Iterate all (non-anonymous) local crate items no matter where they are defined.
  for (const id of tcx.hir_free_items()) {
    if (tcx.def_kind(id.owner_id).$ === "Use") {
      continue;
    }

    const item = tcx.hir_item(id);
    const ident = ItemKind.ident(item.kind);
    if (ident === undefined) continue;

    const def_id = item.owner_id.to_def_id();
    const ns = DefKind.ns(tcx.def_kind(def_id)) ?? Namespace.TypeNS;
    collect_fn(ident, ns, def_id);
  }

  // Now take care of extern crate items.
  const queue: DefId[] = [];
  const seen_defs = new DefIdSet();

  for (const cnum of tcx.crates(null)) {
    // Ignore crates that are not direct dependencies.
    const extern_crate = tcx.extern_crate(cnum) as ExternCrate | undefined;
    if (extern_crate === undefined) {
      continue;
    } else {
      if (!extern_crate.is_direct()) {
        continue;
      }
    }

    queue.push(CrateNum.as_def_id(cnum));
  }

  // Iterate external crate defs but be mindful about visibility
  for (let def = queue.pop(); def !== undefined; def = queue.pop()) {
    for (const child of tcx.module_children(def)) {
      if (!Visibility.is_public(child.vis)) {
        continue;
      }

      const res = child.res;
      if (res.$ !== "Def") continue;
      const defkind = res._0;
      const def_id = res._1;
      if (defkind.$ === "AssocTy") continue;
      if (defkind.$ === "TyAlias") continue;
      // Ignore external `#[doc(hidden)]` items and their descendants.
      // They shouldn't prevent other items from being considered
      // unique, and should be printed with a full path if necessary.
      if (tcx.is_doc_hidden(def_id)) {
        continue;
      }

      const ns = DefKind.ns(defkind);
      if (ns !== undefined) {
        collect_fn(child.ident, ns, def_id);
      }

      if (DefKind.is_module_like(defkind) && !seen_defs.has(def_id)) {
        seen_defs.add(def_id);
        queue.push(def_id);
      }
    }
  }
}

/// The purpose of this function is to collect public symbols names that are unique across all
/// crates in the build. Later, when printing about types we can use those names instead of the
/// full exported path to them.
///
/// So essentially, if a symbol name can only be imported from one place for a type, and as
/// long as it was not glob-imported anywhere in the current crate, we can trim its printed
/// path and print only the name.
///
/// This has wide implications on error messages with types, for example, shortening
/// `std::vec::Vec` to just `Vec`, as long as there is no other `Vec` importable anywhere.
///
/// The implementation uses similar import discovery logic to that of 'use' suggestions.
///
/// See also [`with_no_trimmed_paths!`].
// this is pub to be able to intra-doc-link it
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3528 trimmed_def_paths
export function trimmed_def_paths(tcx: TyCtxt, _: null): DefIdMap<Symbol> {
  // Trimming paths is expensive and not optimized, since we expect it to only be used for error
  // reporting. Record the fact that we did it, so we can abort if we later found it was
  // unnecessary.
  //
  // The `rustc_middle::ty::print::with_no_trimmed_paths` wrapper can be used to suppress this
  // checking, in exchange for full paths being formatted.
  tcx.sess.record_trimmed_def_paths();

  // Once constructed, unique namespace+symbol pairs will have a `Some(_)` entry, while
  // non-unique pairs will have a `None` entry.
  // PORT: `FxIndexMap<(Namespace, Symbol), Option<DefId>>`: an insertion-ordered `KeyedMap`; `None` is `undefined`
  // (an occupied entry is told apart with `has`).
  const unique_symbols_rev = new KeyedMap<[Namespace, Symbol], DefId | undefined>(([ns, symbol]) => `${ns}:${symbol}`);

  for (const symbol_set of tcx.resolutions(null).glob_map.values()) {
    for (const symbol of symbol_set) {
      unique_symbols_rev.set([Namespace.TypeNS, symbol], undefined);
      unique_symbols_rev.set([Namespace.ValueNS, symbol], undefined);
      unique_symbols_rev.set([Namespace.MacroNS, symbol], undefined);
    }
  }

  for_each_def(tcx, (ident, ns, def_id) => {
    const key: [Namespace, Symbol] = [ns, ident.name];
    if (unique_symbols_rev.has(key)) {
      const v = unique_symbols_rev.get(key);
      if (v === undefined) {
        // nothing
      } else {
        const existing = v;
        if (!DefId_eq(existing, def_id)) {
          unique_symbols_rev.set(key, undefined);
        }
      }
    } else {
      unique_symbols_rev.set(key, def_id);
    }
  });

  // Put the symbol from all the unique namespace+symbol pairs into `map`.
  const map = new DefIdMap<Symbol>();
  for (const [[_, symbol], opt_def_id] of unique_symbols_rev) {
    if (opt_def_id !== undefined) {
      const def_id = opt_def_id;
      if (map.has(def_id)) {
        const v = map.get(def_id)!;
        // A single DefId can be known under multiple names (e.g.,
        // with a `pub use ... as ...;`). We need to ensure that the
        // name placed in this map is chosen deterministically, so
        // if we find multiple names (`symbol`) resolving to the
        // same `def_id`, we prefer the lexicographically smallest
        // name.
        //
        // Any stable ordering would be fine here though.
        if (v !== symbol && str_cmp_utf8(Symbol.as_str(v), Symbol.as_str(symbol)) > 0) {
          map.set(def_id, symbol);
        }
      } else {
        map.set(def_id, symbol);
      }
    }
  }
  unique_symbols_rev.clear();

  return map;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3594 provide
export function provide(providers: Providers): void {
  providers.trimmed_def_paths = trimmed_def_paths;
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3598 OpaqueFnEntry
export interface OpaqueFnEntry {
  kind: ClosureKind;
  return_ty: Binder<Term> | undefined;
}

// ---- helpers of this region (not upstream fns) ----

/** `iter.count()` */
function iter_count<T>(it: Iterable<T>): number {
  let n = 0;
  for (const _ of it) n++;
  return n;
}

/** `iter.next()` on a fresh iterator */
function iter_next<T>(it: Iterable<T>): T | undefined {
  for (const x of it) return x;
  return undefined;
}

/** `DefId`'s derived `PartialEq`. */
function DefId_eq(a: DefId, b: DefId): boolean {
  return a.index === b.index && a.krate === b.krate;
}

/** `str`'s `Ord` (byte-wise UTF-8, i.e. code point order). */
function str_cmp_utf8(a: string, b: string): number {
  const ai = a[globalThis.Symbol.iterator]();
  const bi = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** PORT: `<[u8]>::escape_ascii` (core `ascii::escape_default` per byte), not in src/std yet. */
function escape_ascii(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    switch (b) {
      case 0x09:
        s += "\\t";
        break;
      case 0x0d:
        s += "\\r";
        break;
      case 0x0a:
        s += "\\n";
        break;
      case 0x5c:
        s += "\\\\";
        break;
      case 0x27:
        s += "\\'";
        break;
      case 0x22:
        s += '\\"';
        break;
      default:
        if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
        else s += "\\x" + b.toString(16).padStart(2, "0");
    }
  }
  return s;
}

/** PORT: `String::from_utf8_lossy` (WHATWG decoding replaces maximal invalid subparts with U+FFFD, as std does). */
function String_from_utf8_lossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
}

// ==== stand-ins (PORT: pending other lanes). Root deletes each when its owner lands and points the uses at the
// real port; bodies are upstream's where they only read fields / call ported code, `unported` otherwise. ====

// ---- PORT: pending ty-print-a (pretty.rs:1..1704 and print/mod.rs) ----

/// Rendering style for RTN types.
// PORT: pending ty-print-a: `RtnMode` (pretty.rs:47).
export type RtnMode = "ForDiagnostic" | "ForSignature" | "ForSuggestion";

// PORT: pending ty-print-a: the `thread_local!` cells of pretty.rs:33 as module-level `let`s, at their initial values
// (nothing in this region sets them).
let REDUCED_QUERIES = false;
let FORCE_IMPL_FILENAME_LINE = false;
let SHOULD_PREFIX_WITH_CRATE_NAME = false;
let SHOULD_PREFIX_WITH_CRATE = false;
let FORCE_TRIMMED_PATH = false;
let RTN_MODE: RtnMode = "ForDiagnostic";

/** PORT: pending ty-print-a: `pub fn with_reduced_queries() -> bool` (define_helper!, pretty.rs:82). */
function with_reduced_queries_get(): boolean {
  return REDUCED_QUERIES;
}
/** PORT: pending ty-print-a: `pub fn with_forced_impl_filename_line() -> bool` (define_helper!, pretty.rs:82). */
function with_forced_impl_filename_line_get(): boolean {
  return FORCE_IMPL_FILENAME_LINE;
}
/** PORT: pending ty-print-a: `pub fn with_resolve_crate_name() -> bool` (define_helper!, pretty.rs:82). */
function with_resolve_crate_name_get(): boolean {
  return SHOULD_PREFIX_WITH_CRATE_NAME;
}
/** PORT: pending ty-print-a: `pub fn with_crate_prefix() -> bool` (define_helper!, pretty.rs:82). */
function with_crate_prefix_get(): boolean {
  return SHOULD_PREFIX_WITH_CRATE;
}
/** PORT: pending ty-print-a: `pub fn with_forced_trimmed_paths() -> bool` (define_helper!, pretty.rs:82). */
function with_forced_trimmed_paths_get(): boolean {
  return FORCE_TRIMMED_PATH;
}
/** PORT: pending ty-print-a: `pub macro with_forced_trimmed_paths($e)` (define_helper!, pretty.rs:69). */
function with_forced_trimmed_paths<R>(f: () => R): R {
  const old = FORCE_TRIMMED_PATH;
  FORCE_TRIMMED_PATH = true;
  try {
    return f();
  } finally {
    FORCE_TRIMMED_PATH = old;
  }
}
/** PORT: pending ty-print-a: `RTN_MODE.with(|mode| mode.get())`. */
function RTN_MODE_get(): RtnMode {
  return RTN_MODE;
}
/** PORT: test hook for the stand-in thread-locals above (lane ty-print-a's `with_*` guards replace it). */
export function with_print_flags_b<R>(flags: { reduced_queries?: boolean; forced_impl_filename_line?: boolean; resolve_crate_name?: boolean; crate_prefix?: boolean; forced_trimmed_paths?: boolean; rtn_mode?: RtnMode }, f: () => R): R {
  const old = [REDUCED_QUERIES, FORCE_IMPL_FILENAME_LINE, SHOULD_PREFIX_WITH_CRATE_NAME, SHOULD_PREFIX_WITH_CRATE, FORCE_TRIMMED_PATH, RTN_MODE] as const;
  REDUCED_QUERIES = flags.reduced_queries ?? REDUCED_QUERIES;
  FORCE_IMPL_FILENAME_LINE = flags.forced_impl_filename_line ?? FORCE_IMPL_FILENAME_LINE;
  SHOULD_PREFIX_WITH_CRATE_NAME = flags.resolve_crate_name ?? SHOULD_PREFIX_WITH_CRATE_NAME;
  SHOULD_PREFIX_WITH_CRATE = flags.crate_prefix ?? SHOULD_PREFIX_WITH_CRATE;
  FORCE_TRIMMED_PATH = flags.forced_trimmed_paths ?? FORCE_TRIMMED_PATH;
  RTN_MODE = flags.rtn_mode ?? RTN_MODE;
  try {
    return f();
  } finally {
    [REDUCED_QUERIES, FORCE_IMPL_FILENAME_LINE, SHOULD_PREFIX_WITH_CRATE_NAME, SHOULD_PREFIX_WITH_CRATE, FORCE_TRIMMED_PATH, RTN_MODE] = old;
  }
}

// PORT: pending ty-print-a: `WrapBinderMode` (pretty.rs:166) and `start_str` (:173).
export type WrapBinderMode = "ForAll" | "Unsafe";
export const WrapBinderMode = {
  ForAll: "ForAll",
  Unsafe: "Unsafe",
  start_str(self: WrapBinderMode): string {
    switch (self) {
      case "ForAll":
        return "for<";
      case "Unsafe":
        return "unsafe<";
    }
  },
} as const;

/// The "region highlights" are used to control region printing during
/// specific error messages.
// PORT: pending ty-print-a: `RegionHighlightMode` (pretty.rs:188), `default()` and `region_highlighted` (:246).
export class RegionHighlightMode {
  constructor(
    public highlight_regions: ([Region, number] | undefined)[],
    public keep_regions: boolean,
    public highlight_bound_region: [BoundRegionKind, number] | undefined,
  ) {}

  static default_(): RegionHighlightMode {
    return new RegionHighlightMode([undefined, undefined, undefined], false, undefined);
  }

  region_highlighted(region: Region): number | undefined {
    for (const h of this.highlight_regions) {
      if (h !== undefined && h[0] === region) return h[1];
    }
    return undefined;
  }
}

/** PORT: pending ty-print-a: `trait Print<P>` (print/mod.rs:17) as a descriptor over the printed type (header 2). */
export interface Print<T> {
  print(self: T, p: PrettyPrinter): void;
}

/// A trait that "prints" user-facing type system entities.
// PORT: pending ty-print-a: `trait Printer` (print/mod.rs:28). Provided methods are in `Printer_provided`.
export interface Printer {
  tcx(): TyCtxt;
  print_def_path(def_id: DefId, args: readonly GenericArg[]): void;
  print_impl_path(impl_def_id: DefId, args: readonly GenericArg[]): void;
  print_region(region: Region): void;
  print_type(ty: Ty): void;
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): void;
  print_const(ct: Const): void;
  print_crate_name(cnum: CrateNum): void;
  print_path_with_simple(print_prefix: (p: this) => void, disambiguated_data: DisambiguatedDefPathData): void;
  print_path_with_impl(print_prefix: (p: this) => void, self_ty: Ty, trait_ref: TraitRef | undefined): void;
  print_path_with_generic_args(print_prefix: (p: this) => void, args: readonly GenericArg[]): void;
  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): void;
  print_coroutine_with_kind(def_id: DefId, parent_args: readonly GenericArg[], kind: Ty): void;
  reset_path(): void;
  should_omit_parent_def_path(parent_def_id: DefId): boolean;
  default_print_def_path(def_id: DefId, args: readonly GenericArg[]): void;
  default_print_impl_path(impl_def_id: DefId, self_ty: Ty, impl_trait_ref: TraitRef | undefined): void;
}

/// Trait for printers that pretty-print using `fmt::Write` to the printer.
// PORT: pending ty-print-a: `trait PrettyPrinter: Printer + fmt::Write` (pretty.rs:263).
export interface PrettyPrinter extends Printer {
  /** `fmt::Write::write_str` */
  write_str(s: string): void;
  pretty_print_value_path(def_id: DefId, args: readonly GenericArg[]): void;
  pretty_print_in_binder<T>(value: Binder<T>, p_T: Print<T>, d_T: TypeFoldable<T>): void;
  wrap_binder<T>(value: Binder<T>, mode: WrapBinderMode, f: (value: T, p: this) => void, d_T: TypeFoldable<T>): void;
  comma_sep<T>(elems: Iterable<T>, p_T: Print<T>): void;
  typed_value(f: (p: this) => void, t: (p: this) => void, conversion: string): void;
  parenthesized(f: (p: this) => void): void;
  maybe_parenthesized(f: (p: this) => void, parenthesized: boolean): void;
  generic_delimiters(f: (p: this) => void): void;
  should_truncate(): boolean;
  should_print_optional_region(region: Region): boolean;
  reset_type_limit(): void;
  try_print_visible_def_path(def_id: DefId): boolean;
  force_print_trimmed_def_path(def_id: DefId): boolean;
  try_print_trimmed_def_path(def_id: DefId): boolean;
  try_print_visible_def_path_recur(def_id: DefId, callers: DefId[]): boolean;
  pretty_print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): void;
  pretty_print_path_with_impl(print_prefix: (p: this) => void, self_ty: Ty, trait_ref: TraitRef | undefined): void;
  pretty_print_closure_inner(did: DefId, args: GenericArgs): void;
  pretty_print_type(ty: Ty): void;
  pretty_print_opaque_impl_type(def_id: DefId, args: GenericArgs): void;
  insert_trait_and_projection(
    trait_pred: PolyTraitClause,
    proj_ty: [DefId, Binder<Term>] | undefined,
    traits: KeyedMap<PolyTraitClause, KeyedMap<DefId, Binder<Term>>>,
    fn_traits: KeyedMap<[Binder<[List<Ty>, Ty]>, boolean], OpaqueFnEntry>,
  ): void;
  pretty_print_inherent_projection(alias_term: AliasTerm): void;
  pretty_print_rpitit(def_id: DefId, args: GenericArgs): void;
  ty_infer_name(id: TyVid): Symbol | undefined;
  const_infer_name(id: ConstVid): Symbol | undefined;
  pretty_print_dyn_existential(predicates: List<PolyExistentialPredicate>): void;
  pretty_print_fn_sig(inputs: readonly Ty[], c_variadic: boolean, splatted: number | undefined, output: Ty): void;
  pretty_print_const(ct: Const, print_ty: boolean): void;
  pretty_print_const_expr(expr: Expr, print_ty: boolean): void;
  // pretty.rs:1705..2055 (this region, `PrettyPrinter_provided_b`)
  pretty_print_const_scalar(scalar: Scalar, ty: Ty): void;
  pretty_print_const_scalar_ptr(ptr: Pointer, ty: Ty): void;
  pretty_print_const_scalar_int(int: ScalarInt, ty: Ty, print_ty: boolean): void;
  pretty_print_const_pointer(p: Pointer, ty: Ty): void;
  pretty_print_byte_str(byte_str: Uint8Array): void;
  pretty_print_const_valtree(cv: Value, print_ty: boolean): void;
  pretty_print_closure_as_impl(closure: ClosureArgs): void;
  pretty_print_bound_constness(constness: BoundConstness): void;
  should_print_verbose(): boolean;
}

/** PORT: pending ty-print-a: the provided methods of `Printer` (print/mod.rs). */
const Printer_provided = {
  print_impl_path(_self: Printer, _impl_def_id: DefId, _args: readonly GenericArg[]): void {
    unported("rustc_middle::ty::print::Printer::print_impl_path (lane ty-print-a)");
  },
  print_coroutine_with_kind(_self: Printer, _def_id: DefId, _parent_args: readonly GenericArg[], _kind: Ty): void {
    unported("rustc_middle::ty::print::Printer::print_coroutine_with_kind (lane ty-print-a)");
  },
  default_print_def_path(_self: Printer, _def_id: DefId, _args: readonly GenericArg[]): void {
    unported("rustc_middle::ty::print::Printer::default_print_def_path (lane ty-print-a)");
  },
  default_print_impl_path(_self: Printer, _impl_def_id: DefId, _self_ty: Ty, _impl_trait_ref: TraitRef | undefined): void {
    unported("rustc_middle::ty::print::Printer::default_print_impl_path (lane ty-print-a)");
  },
};

/** PORT: pending ty-print-a: the provided methods of `PrettyPrinter` (pretty.rs:263..1704); bodies only where trivial. */
const PrettyPrinter_provided = {
  comma_sep<T>(self: PrettyPrinter, elems: Iterable<T>, p_T: Print<T>): void {
    const it = elems[globalThis.Symbol.iterator]();
    const first = it.next();
    if (!first.done) {
      p_T.print(first.value, self);
      for (let elem = it.next(); !elem.done; elem = it.next()) {
        self.write_str(", ");
        p_T.print(elem.value, self);
      }
    }
  },
  parenthesized(self: PrettyPrinter, f: (p: PrettyPrinter) => void): void {
    self.write_str("(");
    f(self);
    self.write_str(")");
  },
  maybe_parenthesized(self: PrettyPrinter, f: (p: PrettyPrinter) => void, parenthesized: boolean): void {
    if (parenthesized) {
      self.parenthesized(f);
    } else {
      f(self);
    }
  },
  try_print_visible_def_path(_self: PrettyPrinter, _def_id: DefId): boolean {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::try_print_visible_def_path (lane ty-print-a)");
  },
  force_print_trimmed_def_path(_self: PrettyPrinter, _def_id: DefId): boolean {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::force_print_trimmed_def_path (lane ty-print-a)");
  },
  try_print_trimmed_def_path(_self: PrettyPrinter, _def_id: DefId): boolean {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::try_print_trimmed_def_path (lane ty-print-a)");
  },
  try_print_visible_def_path_recur(_self: PrettyPrinter, _def_id: DefId, _callers: DefId[]): boolean {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::try_print_visible_def_path_recur (lane ty-print-a)");
  },
  pretty_print_path_with_qualified(_self: PrettyPrinter, _self_ty: Ty, _trait_ref: TraitRef | undefined): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_path_with_qualified (lane ty-print-a)");
  },
  pretty_print_path_with_impl(_self: PrettyPrinter, _print_prefix: (p: PrettyPrinter) => void, _self_ty: Ty, _trait_ref: TraitRef | undefined): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_path_with_impl (lane ty-print-a)");
  },
  pretty_print_closure_inner(_self: PrettyPrinter, _did: DefId, _args: GenericArgs): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_closure_inner (lane ty-print-a)");
  },
  pretty_print_type(_self: PrettyPrinter, _ty: Ty): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_type (lane ty-print-a)");
  },
  pretty_print_opaque_impl_type(_self: PrettyPrinter, _def_id: DefId, _args: GenericArgs): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_opaque_impl_type (lane ty-print-a)");
  },
  insert_trait_and_projection(
    _self: PrettyPrinter,
    _trait_pred: PolyTraitClause,
    _proj_ty: [DefId, Binder<Term>] | undefined,
    _traits: KeyedMap<PolyTraitClause, KeyedMap<DefId, Binder<Term>>>,
    _fn_traits: KeyedMap<[Binder<[List<Ty>, Ty]>, boolean], OpaqueFnEntry>,
  ): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::insert_trait_and_projection (lane ty-print-a)");
  },
  pretty_print_inherent_projection(_self: PrettyPrinter, _alias_term: AliasTerm): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_inherent_projection (lane ty-print-a)");
  },
  pretty_print_rpitit(_self: PrettyPrinter, _def_id: DefId, _args: GenericArgs): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_rpitit (lane ty-print-a)");
  },
  pretty_print_dyn_existential(_self: PrettyPrinter, _predicates: List<PolyExistentialPredicate>): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_dyn_existential (lane ty-print-a)");
  },
  pretty_print_fn_sig(_self: PrettyPrinter, _inputs: readonly Ty[], _c_variadic: boolean, _splatted: number | undefined, _output: Ty): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_fn_sig (lane ty-print-a)");
  },
  pretty_print_const(_self: PrettyPrinter, _ct: Const, _print_ty: boolean): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_const (lane ty-print-a)");
  },
  pretty_print_const_expr(_self: PrettyPrinter, _expr: Expr, _print_ty: boolean): void {
    unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_const_expr (lane ty-print-a)");
  },
};

/** PORT: pending ty-print-a: `impl Print<P> for Region` (print/mod.rs:354). */
export const print_Region: Print<Region> = {
  print(self: Region, p: PrettyPrinter): void {
    p.print_region(self);
  },
};
/** PORT: pending ty-print-a: `impl Print<P> for Ty` (print/mod.rs:360). */
export const print_Ty: Print<Ty> = {
  print(self: Ty, p: PrettyPrinter): void {
    p.print_type(self);
  },
};
/** PORT: pending ty-print-a: `impl Print<P> for &List<PolyExistentialPredicate>` (print/mod.rs:412). */
export const print_List_PolyExistentialPredicate: Print<List<PolyExistentialPredicate>> = {
  print(self: List<PolyExistentialPredicate>, p: PrettyPrinter): void {
    p.print_dyn_existential(self);
  },
};
/** PORT: pending ty-print-a: `impl Print<P> for Const` (print/mod.rs:418). */
export const print_Const: Print<Const> = {
  print(self: Const, p: PrettyPrinter): void {
    p.print_const(self);
  },
};

// ---- PORT: pending root (decls.ts) ----
// `Print<T>` is `Pending1<"Print", T>` in ty/decls.ts (ty-contract left its shape to this lane): the descriptor above.
function as_decls_print<T>(d: Print<T>): import("../decls.ts").Print<T> {
  return d as unknown as import("../decls.ts").Print<T>;
}
// `TyCtxt::is_impl_trait_in_trait` (context.rs:2847, lane ty-ctxt) is not declared on the class yet; merge-w14 installed
// an `unported` placeholder for it.
declare module "../context.ts" {
  interface TyCtxt {
    is_impl_trait_in_trait(def_id: DefId): boolean;
  }
}

// ---- PORT: pending tyir-binder / tyir-misc (rustc_type_ir binder.rs, predicate.rs, visit.rs) ----

/** PORT: pending tyir-binder: `BoundRegionKind::is_named` (binder.rs:1037). */
function BoundRegionKind_is_named(self: BoundRegionKind, tcx: TyCtxt): boolean {
  return BoundRegionKind_get_name(self, tcx) !== undefined;
}
/** PORT: pending tyir-binder: `BoundRegionKind::get_name` (binder.rs:1041). */
function BoundRegionKind_get_name(self: BoundRegionKind, tcx: TyCtxt): Symbol | undefined {
  switch (self.$) {
    case "Named": {
      const name = tcx.item_name(self._0);
      return name === kw.UnderscoreLifetime ? undefined : name;
    }
    case "NamedForPrinting":
      return self._0;
    default:
      return undefined;
  }
}
/** PORT: pending tyir-binder: the derived `PartialEq` of `BoundRegionKind` (binder.rs). */
function BoundRegionKind_eq(a: BoundRegionKind, b: BoundRegionKind): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "NamedForPrinting" && b.$ === "NamedForPrinting") return a._0 === b._0;
  if (a.$ === "Named" && b.$ === "Named") return DefId_eq(a._0, b._0);
  return true;
}
/** PORT: pending tyir-binder: `impl TypeSuperFoldable for Binder` (binder.rs): `self.map_bound(|t| t.fold_with(folder))`. */
function Binder_super_fold_with<T>(self: Binder<T>, folder: TypeFolder, d: TypeFoldable<T>): Binder<T> {
  return Binder_map_bound(self, (t) => d.fold_with(t, folder));
}
/** PORT: pending tyir-binder: `Binder::no_bound_vars` (binder.rs). */
function Binder_no_bound_vars<T>(_self: Binder<T>): T | undefined {
  return unported("rustc_type_ir::binder::Binder::no_bound_vars (lane tyir-binder)");
}
/** PORT: pending tyir-binder: `EarlyBinder::iter_instantiated_copied` (binder.rs) over `explicit_item_bounds`. */
function EarlyBinder_iter_instantiated_copied(_self: unknown, _tcx: TyCtxt, _args: GenericArgs): Iterable<unknown> {
  return unported("rustc_type_ir::binder::EarlyBinder::iter_instantiated_copied (lane tyir-binder)");
}
/** PORT: pending tyir-misc: `Unnormalized::skip_norm_wip` (unnormalized.rs). */
function Unnormalized_skip_norm_wip(_u: unknown): [Clause, unknown] {
  return unported("rustc_type_ir::unnormalized::Unnormalized::skip_norm_wip (lane tyir-misc)");
}
/** PORT: pending tyir-binder: `TypeVisitableExt::has_bound_vars` on `Clause`. */
function Clause_has_bound_vars(_c: Clause): boolean {
  return unported("rustc_type_ir::visit::TypeVisitableExt::has_bound_vars (lane tyir-binder)");
}
/**
 * PORT: pending tyir-binder: `TypeVisitableExt::has_type_flags` (visit.rs) on a `Ty`: `ty.visit_with(HasTypeFlagsVisitor)`
 * is `visit_ty`, which breaks iff `t.flags().intersects(self.flags)`.
 */
function Ty_has_type_flags(t: Ty, flags: TypeFlagsT): boolean {
  return TypeFlags.intersects(t.flags(), flags);
}
/** PORT: pending tyir-binder: `TypeVisitableExt::has_placeholders` (visit.rs): `self.has_type_flags(HAS_PLACEHOLDER)`. */
function Ty_has_placeholders(t: Ty): boolean {
  return Ty_has_type_flags(t, TypeFlags.HAS_PLACEHOLDER);
}
/**
 * PORT: pending tyir-binder: `TypeVisitableExt::has_vars_bound_at_or_above` (visit.rs) on a `Ty`: `HasEscapingVarsVisitor`'s
 * `visit_ty` breaks iff `t.outer_exclusive_binder() > outer_index`.
 */
function Ty_has_vars_bound_at_or_above(t: Ty, binder: DebruijnIndex): boolean {
  return t.outer_exclusive_binder() > binder;
}
/** PORT: pending tyir-misc: `TraitRef::self_ty` (predicate.rs): `self.args.type_at(0)`. */
function TraitRef_self_ty(self: TraitRef): Ty {
  return self.args.type_at(0);
}
/** PORT: pending tyir-misc: `ExistentialTraitRef::with_self_ty` (predicate.rs). */
function ExistentialTraitRef_with_self_ty(_self: ExistentialTraitRef, _tcx: TyCtxt, _self_ty: Ty): TraitRef {
  return unported("rustc_type_ir::predicate::ExistentialTraitRef::with_self_ty (lane tyir-misc)");
}
/** PORT: pending tyir-misc: `ClosureKind`'s `Display` (lib.rs): `self.as_str()`. */
function display_ClosureKind(self: ClosureKind): string {
  switch (self) {
    case "Fn":
      return "Fn";
    case "FnMut":
      return "FnMut";
    case "FnOnce":
      return "FnOnce";
  }
}
/** PORT: pending tyir-binder / codegen: the `TypeFoldable` descriptor of `PredicateKind` from its generated fns. */
const fold_PredicateKind: TypeFoldable<PredicateKind> = {
  try_fold_with: try_fold_with_PredicateKind,
  fold_with: fold_with_PredicateKind,
  visit_with: visit_with_PredicateKind,
};
/** PORT: pending tyir-binder / codegen: the `TypeFoldable` descriptor of `ClauseKind` from its generated fns. */
const fold_ClauseKind: TypeFoldable<ClauseKind> = {
  try_fold_with: try_fold_with_ClauseKind,
  fold_with: fold_with_ClauseKind,
  visit_with: visit_with_ClauseKind,
};
/** PORT: pending tyir-kind / codegen: the `TypeFoldable` descriptor of `FnSig`. */
const fold_FnSig: TypeFoldable<FnSig> = {
  try_fold_with() {
    return unported("rustc_type_ir::ty_kind::FnSig: TypeFoldable descriptor (codegen)");
  },
  fold_with() {
    return unported("rustc_type_ir::ty_kind::FnSig: TypeFoldable descriptor (codegen)");
  },
  visit_with() {
    return unported("rustc_type_ir::ty_kind::FnSig: TypeVisitable descriptor (codegen)");
  },
};

// ---- PORT: pending ty-results / ty-sty / ty-adt-assoc / ty-mod (rustc_middle ty/*) ----

/** PORT: pending ty-results: `impl TypeSuperFoldable for Ty` (structural_impls.rs). */
function Ty_super_fold_with(_t: Ty, _folder: TypeFolder): Ty {
  return unported("rustc_middle::ty::structural_impls::<Ty as TypeSuperFoldable>::super_fold_with (lane ty-results)");
}
/** PORT: pending ty-results: `impl TypeSuperVisitable for Ty` (structural_impls.rs). */
function Ty_super_visit_with<R>(_t: Ty, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::structural_impls::<Ty as TypeSuperVisitable>::super_visit_with (lane ty-results)");
}
/** PORT: pending ty-results: `EarlyParamRegion::is_named` (region.rs:31). */
function EarlyParamRegion_is_named(self: EarlyParamRegion): boolean {
  return self.name !== kw.UnderscoreLifetime;
}
/** PORT: pending ty-results: `LateParamRegionKind::is_named` (region.rs:103). */
function LateParamRegionKind_is_named(self: LateParamRegionKind, tcx: TyCtxt): boolean {
  return LateParamRegionKind_get_name(self, tcx) !== undefined;
}
/** PORT: pending ty-results: `LateParamRegionKind::get_name` (region.rs:107). */
function LateParamRegionKind_get_name(self: LateParamRegionKind, tcx: TyCtxt): Symbol | undefined {
  switch (self.$) {
    case "Named": {
      const name = tcx.item_name(self._0);
      return name !== kw.UnderscoreLifetime ? name : undefined;
    }
    case "NamedAnon":
      return self._1;
    default:
      return undefined;
  }
}
/** PORT: pending ty-adt-assoc: `AdtDef::did` (adt.rs). */
function AdtDef_did(_def: AdtDef): DefId {
  return unported("rustc_middle::ty::adt::AdtDef::did (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: `AdtDef::variants` (adt.rs). */
function AdtDef_variants(_def: AdtDef): readonly VariantDefShape[] {
  return unported("rustc_middle::ty::adt::AdtDef::variants (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: `AdtDef::variant` (adt.rs). */
function AdtDef_variant(_def: AdtDef, _idx: number): VariantDefShape {
  return unported("rustc_middle::ty::adt::AdtDef::variant (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: `VariantDef::ctor_kind` (mod.rs). */
function VariantDef_ctor_kind(_v: VariantDefShape): "Fn" | "Const" | undefined {
  return unported("rustc_middle::ty::VariantDef::ctor_kind (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: the fields of `VariantDef` read here (ty/mod.rs). */
interface VariantDefShape {
  def_id: DefId;
  fields: readonly { name: Symbol }[];
}
/** PORT: pending ty-adt-assoc: `AssocItem::name` (assoc.rs). */
function AssocItem_name(_item: unknown): Symbol {
  return unported("rustc_middle::ty::assoc::AssocItem::name (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: `TraitDef::paren_sugar` (trait_def.rs; the `trait_def` query value is `unknown`). */
function TraitDef_paren_sugar(trait_def: unknown): boolean {
  return (trait_def as { paren_sugar: boolean }).paren_sugar;
}
/** PORT: pending ty-results: the `Debug` of `ty::Pattern` (pattern.rs). */
function debug_Pattern(_p: unknown, _f: Fmt): string {
  return unported("rustc_middle::ty::pattern::Pattern Debug (lane ty-results)");
}
// `ty::Value` (valtree.rs:103) is `Pending` in decls.ts; its fields read here.
interface ValueShape {
  valtree: ValTree;
  ty: Ty;
}
/** PORT: pending ty-results: `Deref for ValTree` (valtree.rs). */
function ValTree_deref(_v: ValTree): import("../../../rustc_type_ir/decls.ts").ValTreeKind {
  return unported("rustc_middle::ty::consts::valtree::ValTree: Deref (lane ty-results)");
}
/** PORT: pending ty-results: `ValTree::is_zst` (valtree.rs). */
function ValTree_is_zst(_v: ValTree): boolean {
  return unported("rustc_middle::ty::consts::valtree::ValTree::is_zst (lane ty-results)");
}
/** PORT: pending ty-results: `Debug for ValTree` (valtree.rs). */
function debug_ValTree(_v: ValTree, _f: Fmt): string {
  return unported("rustc_middle::ty::consts::valtree::ValTree: Debug (lane ty-results)");
}
/** PORT: pending ty-results: `Value::try_to_raw_bytes` (valtree.rs). */
function Value_try_to_raw_bytes(_cv: ValueShape, _tcx: TyCtxt): Uint8Array | undefined {
  return unported("rustc_middle::ty::consts::valtree::Value::try_to_raw_bytes (lane ty-results)");
}
/** PORT: pending ty-results: `Value::destructure_adt_const` (valtree.rs). */
function Value_destructure_adt_const(_cv: ValueShape): { variant: number; fields: readonly Const[] } {
  return unported("rustc_middle::ty::consts::valtree::Value::destructure_adt_const (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt == ScalarInt` (int.rs, derived). */
function ScalarInt_eq(_a: ScalarInt, _b: ScalarInt): boolean {
  return unported("rustc_middle::ty::consts::int::ScalarInt: PartialEq (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::FALSE` (int.rs). */
function ScalarInt_FALSE(): ScalarInt {
  return unported("rustc_middle::ty::consts::int::ScalarInt::FALSE (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::TRUE` (int.rs). */
function ScalarInt_TRUE(): ScalarInt {
  return unported("rustc_middle::ty::consts::int::ScalarInt::TRUE (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::size` (int.rs). */
function ScalarInt_size(_int: ScalarInt): Size {
  return unported("rustc_middle::ty::consts::int::ScalarInt::size (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::to_bits` (int.rs). */
function ScalarInt_to_bits(_int: ScalarInt, _size: Size): bigint {
  return unported("rustc_middle::ty::consts::int::ScalarInt::to_bits (lane ty-results)");
}
/** PORT: pending ty-results: `LowerHex for ScalarInt` (int.rs). */
function lower_hex_ScalarInt(_int: ScalarInt): string {
  return unported("rustc_middle::ty::consts::int::ScalarInt: LowerHex (lane ty-results)");
}
/** PORT: pending ty-results: `char::try_from(ScalarInt)` (int.rs); `Err` is `undefined`. */
function char_try_from_ScalarInt(_int: ScalarInt): number | undefined {
  return unported("rustc_middle::ty::consts::int::<char as TryFrom<ScalarInt>>::try_from (lane ty-results)");
}
/** PORT: pending ty-results: `ConstInt` (int.rs). */
type ConstInt = import("../../../rustc_type_ir/decls.ts").Pending<"ConstInt">;
/** PORT: pending ty-results: `ConstInt::new` (int.rs). */
function ConstInt_new(_int: ScalarInt, _signed: boolean, _is_ptr_sized_integral: boolean): ConstInt {
  return unported("rustc_middle::ty::consts::int::ConstInt::new (lane ty-results)");
}
/** PORT: pending ty-results: `Debug for ConstInt` (int.rs). */
function debug_ConstInt(_v: ConstInt, _f: Fmt): string {
  return unported("rustc_middle::ty::consts::int::ConstInt: Debug (lane ty-results)");
}
/** PORT: pending (rustc_apfloat, not ported): `Half`/`Single`/`Double`/`Quad::try_from(ScalarInt)` (int.rs). */
type IeeeFloat = import("../../../rustc_type_ir/decls.ts").Pending<"rustc_apfloat::ieee::IeeeFloat">;
function IeeeFloat_try_from_ScalarInt(_kind: "Half" | "Single" | "Double" | "Quad", _int: ScalarInt): IeeeFloat | undefined {
  return unported("rustc_middle::ty::consts::int::<IeeeFloat as TryFrom<ScalarInt>>::try_from (rustc_apfloat, not ported)");
}
/** `.unwrap()` of a `Result<IeeeFloat, Size>` (`Err` is `undefined`). */
function unwrap_float(v: IeeeFloat | undefined): IeeeFloat {
  return v === undefined ? panic("called `Result::unwrap()` on an `Err` value") : v;
}
/** PORT: pending (rustc_apfloat, not ported): `Float::is_finite`. */
function IeeeFloat_is_finite(_v: IeeeFloat): boolean {
  return unported("rustc_apfloat::Float::is_finite (not ported)");
}
/** PORT: pending (rustc_apfloat, not ported): `Display for IeeeFloat`. */
function display_IeeeFloat(_v: IeeeFloat): string {
  return unported("rustc_apfloat::ieee::IeeeFloat: Display (not ported)");
}
/** PORT: pending (rustc_const_eval, not ported): `TyCtxt::validate_scalar_in_layout` (check_validity_requirement.rs:183). */
function TyCtxt_validate_scalar_in_layout(_tcx: TyCtxt, _int: ScalarInt, _ty: Ty): boolean {
  return unported("rustc_const_eval::util::check_validity_requirement::validate_scalar_in_layout (not ported)");
}
/** PORT: pending (rustc_abi / target data layout): `TargetDataLayout::pointer_size` of `tcx.data_layout`. */
function TargetDataLayout_pointer_size(_dl: unknown): Size {
  return unported("rustc_abi::TargetDataLayout::pointer_size (tcx.data_layout is pending)");
}
/** PORT: pending (UserTypeKind, typeck_results.rs, lane ty-results): the shape per PORTING §5. */
export type UserTypeKind = { readonly $: "Ty"; _0: Ty } | { readonly $: "TypeOf"; _0: DefId; _1: UserArgs };
interface UserArgs {
  args: GenericArgs;
  user_self_ty: UserSelfTy | undefined;
}
interface UserSelfTy {
  impl_def_id: DefId;
  self_ty: Ty;
}
/** PORT: pending (rustc_middle ty/consts/kind.rs `Expr`, lane ty-results). */
type Expr = import("../decls.ts").Expr;

// ---- PORT: pending mir-interpret (M4): mir/interpret's `Scalar`, `Pointer`, `GlobalAlloc`, `AllocRange` ----
// `Scalar` is `Pending` in decls.ts; `ScalarShape` is mir/interpret/value.rs:25 per PORTING §5.
type ScalarShape = { readonly $: "Int"; _0: ScalarInt } | { readonly $: "Ptr"; _0: Pointer; _1: number };
type Pointer = import("../../../rustc_type_ir/decls.ts").Pending<"mir::interpret::Pointer">;
type CtfeProvenance = import("../../../rustc_type_ir/decls.ts").Pending<"mir::interpret::CtfeProvenance">;
type AllocId = import("../../../rustc_type_ir/decls.ts").Pending<"mir::interpret::AllocId">;
/** mir/interpret/mod.rs:255 per PORTING §5. */
type GlobalAlloc =
  | { readonly $: "Function"; instance: Instance }
  | { readonly $: "VTable"; _0: Ty; _1: List<PolyExistentialPredicate> }
  | { readonly $: "Static"; _0: DefId }
  | { readonly $: "Memory"; _0: ConstAllocation }
  | { readonly $: "TypeId"; ty: Ty };
/** mir/interpret/allocation.rs:334 */
interface AllocRange {
  start: Size;
  size: Size;
}
function Pointer_prov_and_relative_offset(_ptr: Pointer): [CtfeProvenance, Size] {
  return unported("rustc_middle::mir::interpret::Pointer::prov_and_relative_offset (M4)");
}
function debug_Pointer(_ptr: Pointer, _f: Fmt): string {
  return unported("rustc_middle::mir::interpret::Pointer: Debug (M4)");
}
function CtfeProvenance_alloc_id(_prov: CtfeProvenance): AllocId {
  return unported("rustc_middle::mir::interpret::CtfeProvenance::alloc_id (M4)");
}
function TyCtxt_try_get_global_alloc(_tcx: TyCtxt, _id: AllocId): GlobalAlloc | undefined {
  return unported("rustc_middle::mir::interpret::TyCtxt::try_get_global_alloc (M4)");
}
function ConstAllocation_inner(_alloc: ConstAllocation): Allocation {
  return unported("rustc_middle::mir::interpret::ConstAllocation::inner (M4)");
}
/** `Ok(bytes)` is the bytes, `Err(_)` is `undefined`. */
function Allocation_get_bytes_strip_provenance(_alloc: Allocation, _tcx: TyCtxt, _range: AllocRange): Uint8Array | undefined {
  return unported("rustc_middle::mir::interpret::Allocation::get_bytes_strip_provenance (M4)");
}
function Instance_def_id(_instance: Instance): DefId {
  return unported("rustc_middle::ty::instance::Instance::def_id (M4)");
}
function Instance_args(_instance: Instance): GenericArgs {
  return unported("rustc_middle::ty::instance::Instance::args (M4)");
}
