// Port of compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs (lane ssa-debuginfo, plan-m7 wave 40o).
//
//! Type Names for Debug Info.
//
// PORT (ssa-debuginfo): `output: &mut String` is a `MutRef<string>` (`output.value`); the strings are built from
// identifiers, type and crate names and numbers, and `push`/`pop`/`ends_with`/`truncate` only ever touch the ASCII
// separators, so JS string indices agree with upstream's byte indices wherever this file uses them.
// PORT (ssa-debuginfo): `FxHashSet<Ty>` is a `Set<Ty>` (interned `Ty`, PORTING §5).
// PORT (ssa-debuginfo): nothing in the port printed these names before (rustc_symbol_mangling's printers produce other
// forms: `{{closure}}`, `[T]`, no `{impl#N}`), so the file is ported as is; its `push_item_name` walks `def_key` like
// legacy.ts does, but the name rules differ.

// Notes on targeting MSVC:
// In general, MSVC's debugger attempts to parse all arguments as C++ expressions,
// even if the argument is explicitly a symbol name.
// As such, there are many things that cause parsing issues:
// * `#` is treated as a special character for macros.
// * `{` or `<` at the beginning of a name is treated as an operator.
// * `>>` is always treated as a right-shift.
// * `[` in a name is treated like a regex bracket expression (match any char
//   within the brackets).
// * `"` is treated as the start of a string.

import { display_ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { Integer } from "../../rustc_abi/lib.ts";
import { FloatTy, IntTy, Mutability, UintTy } from "../../rustc_ast_ir/lib.ts";
import { StableHasher } from "../../rustc_data_structures/stable_hash.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import { Safety } from "../../rustc_hir/hir.ts";
import { DefPathData, type DisambiguatedDefPathData } from "../../rustc_hir_id/definitions.ts";
import "../../rustc_middle/ty/consts.ts";
import { Value } from "../../rustc_middle/ty/consts/valtree.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, GenericArgs, Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { display_LayoutError, IntegerExt, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { debug_Ty, Term, type Term as TermT, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { debug_Pattern } from "../../rustc_middle/ty/pattern.ts";
import { stable_hash_Value } from "../../rustc_middle/stable_hash.gen.ts";
import { DefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { debug_GenericArgKind } from "../../rustc_type_ir/generic_arg.gen.ts";
import {
  type ExistentialProjection,
  type ExistentialTraitRef,
  fold_with_ExistentialProjection,
  fold_with_ExistentialTraitRef,
  try_fold_with_ExistentialProjection,
  try_fold_with_ExistentialTraitRef,
  visit_with_ExistentialProjection,
  visit_with_ExistentialTraitRef,
} from "../../rustc_type_ir/predicate.ts";
import { debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import { FnSig, fold_FnSig, UnsafeBinderInner_deref } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic } from "../../std/panic.ts";
import { wants_c_like_enum_debuginfo } from "./mod.ts";

const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};
const d_ExistentialProjection: TypeFoldable<ExistentialProjection> = {
  visit_with: visit_with_ExistentialProjection,
  try_fold_with: try_fold_with_ExistentialProjection,
  fold_with: fold_with_ExistentialProjection,
};

/// Compute the name of the type as it should be stored in debuginfo. Does not do
/// any caching, i.e., calling the function twice with the same type will also do
/// the work twice. The `qualified` parameter only affects the first level of the
/// type name, further levels (i.e., type parameters) are always fully qualified.
// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:37 compute_debuginfo_type_name
export function compute_debuginfo_type_name(tcx: TyCtxt, t: Ty, qualified: boolean): string {
  const _prof = tcx.prof.generic_activity("compute_debuginfo_type_name");

  const result: MutRef<string> = { value: "" };
  const visited = new Set<Ty>();
  push_debuginfo_type_name(tcx, t, qualified, result, visited);
  return result.value;
}

// Pushes the name of the type as it should be stored in debuginfo on the
// `output` String. See also compute_debuginfo_type_name().
// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:52 push_debuginfo_type_name
function push_debuginfo_type_name(tcx: TyCtxt, t: Ty, qualified: boolean, output: MutRef<string>, visited: Set<Ty>): void {
  // When targeting MSVC, emit C++ style type names for compatibility with
  // .natvis visualizers (and perhaps other existing native debuggers?)
  const cpp_like_debuginfo_ = cpp_like_debuginfo(tcx);

  const k = t.kind();
  switch (k.$) {
    case "Bool":
      output.value += "bool";
      break;
    case "Char":
      output.value += "char";
      break;
    case "Str": {
      if (cpp_like_debuginfo_) {
        output.value += "str$";
      } else {
        output.value += "str";
      }
      break;
    }
    case "Never": {
      if (cpp_like_debuginfo_) {
        output.value += "never$";
      } else {
        output.value += "!";
      }
      break;
    }
    case "Int":
      output.value += IntTy.name_str(k._0);
      break;
    case "Uint":
      output.value += UintTy.name_str(k._0);
      break;
    case "Float":
      output.value += FloatTy.name_str(k._0);
      break;
    case "Foreign":
      push_item_name(tcx, k._0, qualified, output);
      break;
    case "Adt": {
      const def = k._0;
      const args = k._1;
      // `layout_for_cpp_like_fallback` will be `Some` if we want to use the fallback encoding.
      let layout_for_cpp_like_fallback: TyAndLayout | undefined;
      if (cpp_like_debuginfo_ && def.is_enum()) {
        const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(t));
        if (r.$ === "Ok") {
          const layout = r._0;
          if (!wants_c_like_enum_debuginfo(tcx, layout)) {
            layout_for_cpp_like_fallback = layout;
          } else {
            // This is a C-like enum so we don't want to use the fallback encoding
            // for the name.
            layout_for_cpp_like_fallback = undefined;
          }
        } else {
          // Computing the layout can still fail here, e.g. if the target architecture
          // cannot represent the type. See
          // https://github.com/rust-lang/rust/issues/94961.
          tcx.dcx().fatal(display_LayoutError(r._0));
        }
      } else {
        // We are not emitting cpp-like debuginfo or this isn't even an enum.
        layout_for_cpp_like_fallback = undefined;
      }

      if (layout_for_cpp_like_fallback !== undefined) {
        const ty_and_layout = layout_for_cpp_like_fallback;
        msvc_enum_fallback(
          tcx,
          ty_and_layout,
          (output, visited) => {
            push_item_name(tcx, def.did(), true, output);
            push_generic_args_internal(tcx, args, output, visited);
          },
          output,
          visited,
        );
      } else {
        push_item_name(tcx, def.did(), qualified, output);
        push_generic_args_internal(tcx, args, output, visited);
      }
      break;
    }
    case "Tuple": {
      const component_types = k._0;
      if (cpp_like_debuginfo_) {
        output.value += "tuple$<";
      } else {
        output.value += "(";
      }

      for (const component_type of component_types) {
        push_debuginfo_type_name(tcx, component_type, true, output, visited);
        push_arg_separator(cpp_like_debuginfo_, output);
      }
      if (component_types.length !== 0) {
        pop_arg_separator(output);
      }

      if (cpp_like_debuginfo_) {
        push_close_angle_bracket(cpp_like_debuginfo_, output);
      } else {
        output.value += ")";
      }
      break;
    }
    case "RawPtr": {
      const inner_type = k._0;
      const mutbl = k._1;
      if (cpp_like_debuginfo_) {
        switch (mutbl) {
          case "Not":
            output.value += "ptr_const$<";
            break;
          case "Mut":
            output.value += "ptr_mut$<";
            break;
        }
      } else {
        output.value += "*";
        switch (mutbl) {
          case "Not":
            output.value += "const ";
            break;
          case "Mut":
            output.value += "mut ";
            break;
        }
      }

      push_debuginfo_type_name(tcx, inner_type, qualified, output, visited);

      if (cpp_like_debuginfo_) {
        push_close_angle_bracket(cpp_like_debuginfo_, output);
      }
      break;
    }
    case "Ref": {
      const inner_type = k._1;
      const mutbl = k._2;
      if (cpp_like_debuginfo_) {
        switch (mutbl) {
          case "Not":
            output.value += "ref$<";
            break;
          case "Mut":
            output.value += "ref_mut$<";
            break;
        }
      } else {
        output.value += "&";
        output.value += Mutability.prefix_str(mutbl);
      }

      push_debuginfo_type_name(tcx, inner_type, qualified, output, visited);

      if (cpp_like_debuginfo_) {
        push_close_angle_bracket(cpp_like_debuginfo_, output);
      }
      break;
    }
    case "Array": {
      const inner_type = k._0;
      const len = k._1;
      if (cpp_like_debuginfo_) {
        output.value += "array$<";
        push_debuginfo_type_name(tcx, inner_type, true, output, visited);
        const lk = len.kind();
        switch (lk.$) {
          case "Param":
            output.value += `,${Symbol.as_str(lk._0.name)}>`;
            break;
          default:
            output.value += `,${expect_bigint(len.try_to_target_usize(tcx), "expected monomorphic const in codegen")}>`;
            break;
        }
      } else {
        output.value += "[";
        push_debuginfo_type_name(tcx, inner_type, true, output, visited);
        const lk = len.kind();
        switch (lk.$) {
          case "Param":
            output.value += `; ${Symbol.as_str(lk._0.name)}]`;
            break;
          default:
            output.value += `; ${expect_bigint(len.try_to_target_usize(tcx), "expected monomorphic const in codegen")}]`;
            break;
        }
      }
      break;
    }
    case "Pat": {
      const inner_type = k._0;
      const pat = k._1;
      if (cpp_like_debuginfo_) {
        output.value += "pat$<";
        push_debuginfo_type_name(tcx, inner_type, true, output, visited);
        // FIXME(wg-debugging): implement CPP like printing for patterns.
        output.value += `,${debug_Pattern(pat, PLAIN)}>`;
      } else {
        output.value += debug_Ty(t, PLAIN);
      }
      break;
    }
    case "Slice": {
      const inner_type = k._0;
      if (cpp_like_debuginfo_) {
        output.value += "slice2$<";
      } else {
        output.value += "[";
      }

      push_debuginfo_type_name(tcx, inner_type, true, output, visited);

      if (cpp_like_debuginfo_) {
        push_close_angle_bracket(cpp_like_debuginfo_, output);
      } else {
        output.value += "]";
      }
      break;
    }
    case "Dynamic": {
      const trait_data = k._0;
      const auto_traits: DefId[] = [...trait_data.auto_traits()];

      let has_enclosing_parens: boolean;
      if (cpp_like_debuginfo_) {
        output.value += "dyn$<";
        has_enclosing_parens = false;
      } else if (trait_data.length > 1 && auto_traits.length !== 0) {
        // We need enclosing parens because there is more than one trait
        output.value += "(dyn ";
        has_enclosing_parens = true;
      } else {
        output.value += "dyn ";
        has_enclosing_parens = false;
      }

      const principal_ = trait_data.principal();
      if (principal_ !== undefined) {
        const principal = tcx.normalize_erasing_late_bound_regions(TypingEnv.fully_monomorphized(), principal_, d_ExistentialTraitRef);
        push_item_name(tcx, principal.def_id, qualified, output);
        const principal_has_generic_params = push_generic_args_internal(tcx, principal.args, output, visited);

        const projection_bounds: [DefId, TermT][] = [...trait_data.projection_bounds()].map((bound) => {
          const { def_id: item_def_id, term } = tcx.instantiate_bound_regions_with_erased(bound, d_ExistentialProjection);
          return [item_def_id, term];
        });

        if (projection_bounds.length !== 0) {
          if (principal_has_generic_params) {
            // push_generic_params_internal() above added a `>` but we actually
            // want to add more items to that list, so remove that again...
            pop_close_angle_bracket(output);
            // .. and add a comma to separate the regular generic args from the
            // associated types.
            push_arg_separator(cpp_like_debuginfo_, output);
          } else {
            // push_generic_params_internal() did not add `<...>`, so we open
            // angle brackets here.
            output.value += "<";
          }

          for (const [item_def_id, term] of projection_bounds) {
            if (cpp_like_debuginfo_) {
              output.value += "assoc$<";
              push_item_name(tcx, item_def_id, false, output);
              push_arg_separator(cpp_like_debuginfo_, output);
              push_debuginfo_term_name(tcx, term, true, output, visited);
              push_close_angle_bracket(cpp_like_debuginfo_, output);
            } else {
              push_item_name(tcx, item_def_id, false, output);
              output.value += "=";
              push_debuginfo_term_name(tcx, term, true, output, visited);
            }
            push_arg_separator(cpp_like_debuginfo_, output);
          }

          pop_arg_separator(output);
          push_close_angle_bracket(cpp_like_debuginfo_, output);
        }

        if (auto_traits.length !== 0) {
          push_auto_trait_separator(cpp_like_debuginfo_, output);
        }
      }

      if (auto_traits.length !== 0) {
        const auto_trait_names: string[] = auto_traits.map((def_id) => {
          const name: MutRef<string> = { value: "" };
          push_item_name(tcx, def_id, true, name);
          return name.value;
        });
        auto_trait_names.sort(cmp_str);

        for (const auto_trait of auto_trait_names) {
          output.value += auto_trait;
          push_auto_trait_separator(cpp_like_debuginfo_, output);
        }

        pop_auto_trait_separator(output);
      }

      if (cpp_like_debuginfo_) {
        push_close_angle_bracket(cpp_like_debuginfo_, output);
      } else if (has_enclosing_parens) {
        output.value += ")";
      }
      break;
    }
    case "FnDef":
    case "FnPtr": {
      // We've encountered a weird 'recursive type'
      // Currently, the only way to generate such a type
      // is by using 'impl trait':
      //
      // fn foo() -> impl Copy { foo }
      //
      // There's not really a sensible name we can generate,
      // since we don't include 'impl trait' types (e.g. ty::Opaque)
      // in the output
      //
      // Since we need to generate *something*, we just
      // use a dummy string that should make it clear
      // that something unusual is going on
      if (visited.has(t)) {
        output.value += cpp_like_debuginfo_ ? "recursive_type$" : "<recursive_type>";
        return;
      }
      visited.add(t);

      const sig = tcx.normalize_erasing_late_bound_regions(TypingEnv.fully_monomorphized(), t.fn_sig(tcx), fold_FnSig);

      if (cpp_like_debuginfo_) {
        // Format as a C++ function pointer: return_type (*)(params...)
        if (FnSig.output(sig).is_unit()) {
          output.value += "void";
        } else {
          push_debuginfo_type_name(tcx, FnSig.output(sig), true, output, visited);
        }
        output.value += " (*)(";
      } else {
        output.value += Safety.prefix_str(FnSig.safety(sig));

        if (FnSig.abi(sig).$ !== "Rust") {
          output.value += `extern ${display_ExternAbi(FnSig.abi(sig))} `;
        }

        output.value += "fn(";
      }

      // FIXME(splat): should debuginfo be de-tupled in the callee (and caller)?
      if (FnSig.inputs(sig).length !== 0) {
        for (const parameter_type of FnSig.inputs(sig)) {
          push_debuginfo_type_name(tcx, parameter_type, true, output, visited);
          push_arg_separator(cpp_like_debuginfo_, output);
        }
        pop_arg_separator(output);
      }

      if (FnSig.c_variadic(sig)) {
        if (FnSig.inputs(sig).length !== 0) {
          output.value += ", ...";
        } else {
          output.value += "...";
        }
      }

      output.value += ")";

      if (!cpp_like_debuginfo_ && !FnSig.output(sig).is_unit()) {
        output.value += " -> ";
        push_debuginfo_type_name(tcx, FnSig.output(sig), true, output, visited);
      }

      // We only keep the type in 'visited'
      // for the duration of the body of this method.
      // It's fine for a particular function type
      // to show up multiple times in one overall type
      // (e.g. MyType<fn() -> u8, fn() -> u8>
      //
      // We only care about avoiding recursing
      // directly back to the type we're currently
      // processing
      visited.delete(t);
      break;
    }
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine": {
      const def_id = k._0;
      const args = k._1;
      // Name will be "{closure_env#0}<T1, T2, ...>", "{coroutine_env#0}<T1, T2, ...>", or
      // "{async_fn_env#0}<T1, T2, ...>", etc.
      // In the case of cpp-like debuginfo, the name additionally gets wrapped inside of
      // an artificial `enum2$<>` type, as defined in msvc_enum_fallback().
      if (cpp_like_debuginfo_ && t.is_coroutine()) {
        const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(t));
        if (r.$ !== "Ok") return panic("called `Result::unwrap()` on an `Err` value");
        const ty_and_layout = r._0;
        msvc_enum_fallback(
          tcx,
          ty_and_layout,
          (output, visited) => {
            push_closure_or_coroutine_name(tcx, def_id, args, true, output, visited);
          },
          output,
          visited,
        );
      } else {
        push_closure_or_coroutine_name(tcx, def_id, args, qualified, output, visited);
      }
      break;
    }
    case "UnsafeBinder": {
      const inner = k._0;
      if (cpp_like_debuginfo_) {
        output.value += "unsafe$<";
      } else {
        output.value += "unsafe ";
      }

      push_debuginfo_type_name(tcx, Binder.skip_binder(UnsafeBinderInner_deref(inner)), qualified, output, visited);

      if (cpp_like_debuginfo_) {
        push_close_angle_bracket(cpp_like_debuginfo_, output);
      }
      break;
    }
    case "Param":
    case "Error":
    case "Infer":
    case "Placeholder":
    case "Alias":
    case "Bound":
    case "CoroutineWitness": {
      bug(`debuginfo: Trying to create type name for unexpected type: ${debug_Ty(t, PLAIN)}`);
    }
  }

  /// MSVC names enums differently than other platforms so that the debugging visualization
  // format (natvis) is able to understand enums and render the active variant correctly in the
  // debugger. For more information, look in
  // rustc_codegen_llvm/src/debuginfo/metadata/enums/cpp_like.rs.
  // rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:469 msvc_enum_fallback
  function msvc_enum_fallback(
    tcx: TyCtxt,
    ty_and_layout: TyAndLayout,
    push_inner: (output: MutRef<string>, visited: Set<Ty>) => void,
    output: MutRef<string>,
    visited: Set<Ty>,
  ): void {
    assert(!wants_c_like_enum_debuginfo(tcx, ty_and_layout), "assertion failed: !wants_c_like_enum_debuginfo(tcx, ty_and_layout)");
    output.value += "enum2$<";
    push_inner(output, visited);
    push_close_angle_bracket(true, output);
  }

  // rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:484 push_auto_trait_separator
  function push_auto_trait_separator(cpp_like_debuginfo: boolean, output: MutRef<string>): void {
    if (cpp_like_debuginfo) {
      push_arg_separator(cpp_like_debuginfo, output);
    } else {
      output.value += NON_CPP_AUTO_TRAIT_SEPARATOR;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:492 pop_auto_trait_separator
  function pop_auto_trait_separator(output: MutRef<string>): void {
    if (output.value.endsWith(NON_CPP_AUTO_TRAIT_SEPARATOR)) {
      output.value = output.value.slice(0, output.value.length - NON_CPP_AUTO_TRAIT_SEPARATOR.length);
    } else {
      pop_arg_separator(output);
    }
  }
}

// PORT: an item nested in `push_debuginfo_type_name` upstream (type_names.rs:482); a module const here, as JS function
// bodies cannot hold a `const` that the nested fns above read before the body reaches it.
const NON_CPP_AUTO_TRAIT_SEPARATOR = " + ";

// rustc-type: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:501 VTableNameKind
export type VTableNameKind =
  // Is the name for the const/static holding the vtable?
  | "GlobalVariable"
  // Is the name for the type of the vtable?
  | "Type";
export const VTableNameKind = { GlobalVariable: "GlobalVariable", Type: "Type" } as const;

/// Computes a name for the global variable storing a vtable (or the type of that global variable).
///
/// The name is of the form:
///
/// `<path::to::SomeType as path::to::SomeTrait>::{vtable}`
///
/// or, when generating C++-like names:
///
/// `impl$<path::to::SomeType, path::to::SomeTrait>::vtable$`
///
/// If `kind` is `VTableNameKind::Type` then the last component is `{vtable_ty}` instead of just
/// `{vtable}`, so that the type and the corresponding global variable get assigned different
/// names.
// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:521 compute_debuginfo_vtable_name
export function compute_debuginfo_vtable_name(tcx: TyCtxt, t: Ty, trait_ref_: ExistentialTraitRef | undefined, kind: VTableNameKind): string {
  const cpp_like_debuginfo_ = cpp_like_debuginfo(tcx);

  const vtable_name: MutRef<string> = { value: "" };

  if (cpp_like_debuginfo_) {
    vtable_name.value += "impl$<";
  } else {
    vtable_name.value += "<";
  }

  const visited = new Set<Ty>();
  push_debuginfo_type_name(tcx, t, true, vtable_name, visited);

  if (cpp_like_debuginfo_) {
    vtable_name.value += ", ";
  } else {
    vtable_name.value += " as ";
  }

  if (trait_ref_ !== undefined) {
    const trait_ref = tcx.normalize_erasing_regions(TypingEnv.fully_monomorphized(), Unnormalized.new_wip(trait_ref_), d_ExistentialTraitRef);
    push_item_name(tcx, trait_ref.def_id, true, vtable_name);
    visited.clear();
    push_generic_args_internal(tcx, trait_ref.args, vtable_name, visited);
  } else {
    vtable_name.value += "_";
  }

  push_close_angle_bracket(cpp_like_debuginfo_, vtable_name);

  let suffix: string;
  if (cpp_like_debuginfo_ && kind === "GlobalVariable") suffix = "::vtable$";
  else if (!cpp_like_debuginfo_ && kind === "GlobalVariable") suffix = "::{vtable}";
  else if (cpp_like_debuginfo_ && kind === "Type") suffix = "::vtable_type$";
  else suffix = "::{vtable_type}";

  // vtable_name.reserve_exact(suffix.len());
  vtable_name.value += suffix;

  return vtable_name.value;
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:573 push_item_name
export function push_item_name(tcx: TyCtxt, def_id: DefId, qualified: boolean, output: MutRef<string>): void {
  const def_key = tcx.def_key(def_id);
  const parent = def_key.parent;
  if (qualified && parent !== undefined) {
    push_item_name(tcx, new DefId(parent, def_id.krate), true, output);
    output.value += "::";
  }

  push_unqualified_item_name(tcx, def_id, def_key.disambiguated_data, output);
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:583 coroutine_kind_label
function coroutine_kind_label(coroutine_kind: CoroutineKind | undefined): string {
  if (coroutine_kind === undefined) return "closure";
  switch (coroutine_kind.$) {
    case "Desugared": {
      const d = coroutine_kind._0;
      const s = coroutine_kind._1;
      if (d === "Gen" && s === "Block") return "gen_block";
      if (d === "Gen" && s === "Closure") return "gen_closure";
      if (d === "Gen" && s === "Fn") return "gen_fn";
      if (d === "Async" && s === "Block") return "async_block";
      if (d === "Async" && s === "Closure") return "async_closure";
      if (d === "Async" && s === "Fn") return "async_fn";
      if (d === "AsyncGen" && s === "Block") return "async_gen_block";
      if (d === "AsyncGen" && s === "Closure") return "async_gen_closure";
      // `Some(Desugared(AsyncGen, Fn))`
      return "async_gen_fn";
    }
    case "Coroutine":
      return "coroutine";
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:602 push_disambiguated_special_name
function push_disambiguated_special_name(label: string, disambiguator: number, cpp_like_debuginfo: boolean, output: MutRef<string>): void {
  if (cpp_like_debuginfo) {
    output.value += `${label}$${disambiguator}`;
  } else {
    output.value += `{${label}#${disambiguator}}`;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:615 push_unqualified_item_name
function push_unqualified_item_name(tcx: TyCtxt, def_id: DefId, disambiguated_data: DisambiguatedDefPathData, output: MutRef<string>): void {
  switch (disambiguated_data.data.$) {
    case "CrateRoot": {
      output.value += Symbol.as_str(tcx.crate_name(def_id.krate));
      break;
    }
    case "Closure": {
      const label = coroutine_kind_label(tcx.coroutine_kind(def_id) as CoroutineKind | undefined);

      push_disambiguated_special_name(label, disambiguated_data.disambiguator, cpp_like_debuginfo(tcx), output);
      break;
    }
    default: {
      const name = DefPathData.name(disambiguated_data.data);
      switch (name.$) {
        case "Named": {
          output.value += Symbol.as_str(name._0);
          break;
        }
        case "Anon": {
          push_disambiguated_special_name(Symbol.as_str(name.namespace), disambiguated_data.disambiguator, cpp_like_debuginfo(tcx), output);
          break;
        }
      }
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:651 push_generic_args
export function push_generic_args(tcx: TyCtxt, args: GenericArgs, output: MutRef<string>): void {
  const _prof = tcx.prof.generic_activity("compute_debuginfo_type_name");
  const visited = new Set<Ty>();
  push_generic_args_internal(tcx, args, output, visited);
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:657 push_generic_args_internal
function push_generic_args_internal(tcx: TyCtxt, args_: GenericArgs, output: MutRef<string>, visited: Set<Ty>): boolean {
  tcx.assert_fully_normalized(TypingEnv.fully_monomorphized(), args_, fold_GenericArgs);
  const args = [...args_.non_erasable_generics()];
  if (args.length === 0) {
    return false;
  }
  const cpp_like_debuginfo_ = cpp_like_debuginfo(tcx);

  output.value += "<";

  for (const arg of args) {
    switch (arg.$) {
      case "Type":
        push_debuginfo_type_name(tcx, arg._0, true, output, visited);
        break;
      case "Const":
        push_debuginfo_const_name(tcx, arg._0, output);
        break;
      default:
        bug(`Unexpected non-erasable generic: ${debug_GenericArgKind(arg, PLAIN)}`);
    }

    push_arg_separator(cpp_like_debuginfo_, output);
  }
  pop_arg_separator(output);
  push_close_angle_bracket(cpp_like_debuginfo_, output);

  return true;
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:687 push_debuginfo_term_name
function push_debuginfo_term_name(tcx: TyCtxt, term: TermT, qualified: boolean, output: MutRef<string>, visited: Set<Ty>): void {
  const k = Term.kind(term);
  switch (k.$) {
    case "Ty":
      push_debuginfo_type_name(tcx, k._0, qualified, output, visited);
      break;
    case "Const":
      push_debuginfo_const_name(tcx, k._0, output);
      break;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:700 push_debuginfo_const_name
function push_debuginfo_const_name(tcx: TyCtxt, ct: Const, output: MutRef<string>): void {
  const k = ct.kind();
  switch (k.$) {
    case "Param": {
      output.value += Symbol.as_str(k._0.name);
      break;
    }
    case "Value": {
      const cv = k._0;
      const tk = cv.ty.kind();
      switch (tk.$) {
        case "Int": {
          const bits = expect_bigint(Value.try_to_bits(cv, tcx, TypingEnv.fully_monomorphized()), "expected monomorphic const in codegen");
          // `sign_extend(bits) as i128`: the sign-extended u128 reinterpreted as i128.
          const val = BigInt.asIntN(128, Integer.size(IntegerExt.from_int_ty(tcx, tk._0)).sign_extend(bits));
          output.value += `${val}`;
          break;
        }
        case "Uint": {
          const val = expect_bigint(Value.try_to_bits(cv, tcx, TypingEnv.fully_monomorphized()), "expected monomorphic const in codegen");
          output.value += `${val}`;
          break;
        }
        case "Bool": {
          const val = Value.try_to_bool(cv);
          if (val === undefined) panic("expected monomorphic const in codegen");
          output.value += `${val}`;
          break;
        }
        default: {
          // If we cannot evaluate the constant to a known type, we fall back
          // to emitting a stable hash value of the constant. This isn't very pretty
          // but we get a deterministic, virtually unique value for the constant.
          //
          // Let's only emit 64 bits of the hash value. That should be plenty for
          // avoiding collisions and will make the emitted type names shorter.
          const hash_short = tcx.with_stable_hashing_context((hcx) => {
            const hasher = StableHasher.new();
            hcx.while_hashing_spans(false, (hcx) => stable_hash_Value(cv, hcx, hasher));
            return hasher.finish(Hash64);
          });

          // `{hash_short:x}`: `Hash64`'s `LowerHex` is its `u64`'s.
          if (cpp_like_debuginfo(tcx)) {
            output.value += `CONST$${Hash64.as_u64(hash_short).toString(16)}`;
          } else {
            output.value += `{CONST#${Hash64.as_u64(hash_short).toString(16)}}`;
          }
          break;
        }
      }
      break;
    }
    default:
      bug(`Invalid \`Const\` during codegen: ${debug_Const(ct, PLAIN)}`);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:750 push_closure_or_coroutine_name
function push_closure_or_coroutine_name(tcx: TyCtxt, def_id: DefId, args_: GenericArgs, qualified: boolean, output: MutRef<string>, visited: Set<Ty>): void {
  // Name will be "{closure_env#0}<T1, T2, ...>", "{coroutine_env#0}<T1, T2, ...>", or
  // "{async_fn_env#0}<T1, T2, ...>", etc.
  const def_key = tcx.def_key(def_id);
  const coroutine_kind = tcx.coroutine_kind(def_id) as CoroutineKind | undefined;

  if (qualified) {
    const parent = def_key.parent;
    if (parent === undefined) panic("called `Option::unwrap()` on a `None` value");
    const parent_def_id = new DefId(parent, def_id.krate);
    push_item_name(tcx, parent_def_id, true, output);
    output.value += "::";
  }

  const label = `${coroutine_kind_label(coroutine_kind)}_env`;

  push_disambiguated_special_name(label, def_key.disambiguated_data.disambiguator, cpp_like_debuginfo(tcx), output);

  // We also need to add the generic arguments of the async fn/coroutine or
  // the enclosing function (for closures or async blocks), so that we end
  // up with a unique name for every instantiation.

  // Find the generics of the enclosing function, as defined in the source code.
  const enclosing_fn_def_id = tcx.typeck_root_def_id(def_id);
  const generics = tcx.generics_of(enclosing_fn_def_id);

  // Truncate the args to the length of the above generics. This will cut off
  // anything closure- or coroutine-specific.
  // FIXME(async_closures): This is probably not going to be correct w.r.t.
  // multiple coroutine flavors. Maybe truncate to (parent + 1)?
  const args = args_.truncate_to(tcx, generics);
  push_generic_args_internal(tcx, args, output, visited);
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:795 push_close_angle_bracket
function push_close_angle_bracket(cpp_like_debuginfo: boolean, output: MutRef<string>): void {
  // MSVC debugger always treats `>>` as a shift, even when parsing templates,
  // so add a space to avoid confusion.
  if (cpp_like_debuginfo && output.value.endsWith(">")) {
    output.value += " ";
  }

  output.value += ">";
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:805 pop_close_angle_bracket
function pop_close_angle_bracket(output: MutRef<string>): void {
  assert(output.value.endsWith(">"), () => `'output' does not end with '>': ${output.value}`);
  output.value = output.value.slice(0, -1);
  if (output.value.endsWith(" ")) {
    output.value = output.value.slice(0, -1);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:813 push_arg_separator
function push_arg_separator(cpp_like_debuginfo: boolean, output: MutRef<string>): void {
  // Natvis does not always like having spaces between parts of the type name
  // and this causes issues when we need to write a typename in natvis, for example
  // as part of a cast like the `HashMap` visualizer does.
  if (cpp_like_debuginfo) {
    output.value += ",";
  } else {
    output.value += ", ";
  }
}

// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:824 pop_arg_separator
function pop_arg_separator(output: MutRef<string>): void {
  if (output.value.endsWith(" ")) {
    output.value = output.value.slice(0, -1);
  }

  assert(output.value.endsWith(","), "assertion failed: output.ends_with(',')");

  output.value = output.value.slice(0, -1);
}

/// Check if we should generate C++ like names and debug information.
// rustc: compiler/rustc_codegen_ssa/src/debuginfo/type_names.rs:835 cpp_like_debuginfo
export function cpp_like_debuginfo(tcx: TyCtxt): boolean {
  return tcx.sess.target.is_like_msvc;
}

/** `Option::expect` on a `u64`/`u128` result. */
function expect_bigint(v: bigint | undefined, msg: string): bigint {
  if (v === undefined) return panic(msg);
  return v;
}

/** `Ord for String`: byte-wise (UTF-8) order, which is code point order. PORT: JS `<` compares UTF-16 code units, which
 *  differs above U+FFFF, so `sort_unstable` compares code points (the names are distinct, so stability cannot show). */
function cmp_str(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i]!.codePointAt(0)!;
    const y = cb[i]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}
