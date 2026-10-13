//! Validate AST before lowering it to HIR.
//!
//! This pass intends to check that the constructed AST is *syntactically valid* to allow the rest
//! of the compiler to assume that the AST is valid. These checks cannot be performed during parsing
//! because attribute macros are allowed to accept certain pieces of invalid syntax such as a
//! function without body outside of a trait definition:
//!
//! ```ignore (illustrative)
//! #[my_attribute]
//! mod foo {
//!     fn missing_body();
//! }
//! ```
//!
//! These checks are run post-expansion, after AST is frozen, to be able to check for erroneous
//! constructions produced by proc macros. This pass is only intended for simple checks that do not
//! require name resolution or type checking, or other kinds of complex analysis.
import { type CVariadicStatus } from "../rustc_abi/lib.ts";
import { display_ExternAbi, ExternAbi } from "../rustc_abi/extern_abi.ts";
import { ast, attr, visit } from "../rustc_ast/lib.ts";
import type {
  AngleBracketedArgs,
  AnonConst,
  AssocItem,
  Attribute,
  AttrVec,
  BorrowedFnSig,
  Const,
  Crate,
  Defaultness,
  EiiImpl,
  FnDecl,
  FnHeader,
  FnSig,
  ForeignItem,
  GenericArgs,
  GenericBound,
  GenericBounds,
  GenericParam,
  Generics,
  Item,
  ImplPolarity,
  Param,
  PathSegment,
  Safety,
  Ty,
  TyAlias,
  Visibility,
  WhereClause,
} from "../rustc_ast/ast.ts";
import { CRATE_NODE_ID, type NodeId } from "../rustc_ast/node_id.ts";
import { type AssocCtxt, type BoundKind, type FnCtxt, type FnKind, Visitor } from "../rustc_ast/visit.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { is_builtin_attr, validate_attr } from "../rustc_attr_parsing/lib.ts";
import type { DiagCtxtHandle, LintBuffer } from "../rustc_errors/lib.ts";
import type { Features } from "../rustc_feature/lib.ts";
import {
  DEPRECATED_WHERE_CLAUSE_LOCATION,
  MISSING_ABI,
  MISSING_UNSAFE_ON_EXTERN,
  PATTERNS_IN_FNS_WITHOUT_BODY,
  UNUSED_VISIBILITIES,
} from "../rustc_lint_defs/builtin.ts";
import type { Session } from "../rustc_session/session.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { Edition } from "../rustc_span/edition.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, type Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { Arch } from "../rustc_target/spec/mod.ts";
import { AbiMap } from "../rustc_target/spec/abi_map.ts";
import { is_whitespace } from "../std/char.ts";
import { panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";
import { AbiCustomCannotBeCold_diagnostic, AbiCustomMustBeNaked_diagnostic, type TildeConstReason } from "./diagnostics.ts";

/** PORT: `str::is_ascii`. */
function str_is_ascii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

/// Is `self` allowed semantically as the first parameter in an `FnDecl`?
type SelfSemantic = "Yes" | "No";

/// Is `#[rustc_splat]` allowed semantically in a function or closure?
/// Only applies to the function kind and header, the parameters are checked elsewhere.
type SplatSemantic =
  | { readonly $: "Yes" }
  | { readonly $: "NoClosures"; readonly _0: Span }
  | { readonly $: "NoAbiCall"; readonly span: Span; readonly abi: Symbol };

const SplatSemantic = {
  Yes: Object.freeze({ $: "Yes" }) as SplatSemantic,

  /// Returns if splatting is semantically allowed for the given `FnKind`,
  /// Only checks the function kind and header, not the parameters.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:60 from_fn_kind
  from_fn_kind(fk: FnKind): SplatSemantic {
    switch (fk.$) {
      case "Fn":
        return SplatSemantic.from_extern(fk._2.sig.header.ext);
      // Splatting closures is banned, because closure arguments are already de-tupled.
      case "Closure":
        return { $: "NoClosures", _0: fk._3.span };
    }
  },

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:68 from_extern
  from_extern(ext: ast.Extern): SplatSemantic {
    switch (ext.$) {
      case "None":
        return SplatSemantic.Yes;
      // FIXME(splat): should splatting extern "C" or other ABIs be allowed?
      case "Implicit":
        return SplatSemantic.Yes;
      // For now, splatting rust-call is banned, because it already de-tuples args.
      case "Explicit": {
        const abi_str = ext._0;
        const span = ext._1;
        if (abi_str.symbol_unescaped === sym.rust_dash_call) {
          return { $: "NoAbiCall", span, abi: abi_str.symbol_unescaped };
        }
        return SplatSemantic.Yes;
      }
    }
  },
};

type TraitOrImpl =
  | { readonly $: "Trait"; readonly vis: Span; readonly constness: Const }
  | { readonly $: "TraitImpl"; readonly constness: Const; readonly polarity: ImplPolarity; readonly trait_ref_span: Span }
  | { readonly $: "Impl"; readonly constness: Const };

const TraitOrImpl = {
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:91 constness
  constness(self: TraitOrImpl): Span | undefined {
    if (self.constness.$ === "Yes") {
      return self.constness._0;
    }
    return undefined;
  },
};

type AllowDefault = "Yes" | "No";

const AllowDefault = {
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:107 when
  when(b: boolean): AllowDefault {
    return b ? "Yes" : "No";
  },
};

type AllowFinal = "Yes" | "No";

const AllowFinal = {
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:118 when
  when(b: boolean): AllowFinal {
    return b ? "Yes" : "No";
  },
};

class AstValidator extends Visitor {
  constructor(
    public sess: Session,
    public features: Features,

    /// The span of the `extern` in an `extern { ... }` block, if any.
    public extern_mod_span: Span | undefined,

    public outer_trait_or_trait_impl: TraitOrImpl | undefined,

    public has_proc_macro_decls: boolean,

    /// Used to ban nested `impl Trait`, e.g., `impl Into<impl Debug>`.
    /// Nested `impl Trait` _is_ allowed in associated type position,
    /// e.g., `impl Iterator<Item = impl Debug>`.
    public outer_impl_trait_span: Span | undefined,

    public disallow_tilde_const: TildeConstReason | undefined,

    /// Used to ban explicit safety on foreign items when the extern block is not marked as unsafe.
    public extern_mod_safety: Safety | undefined,
    public extern_mod_abi: ExternAbi | undefined,

    public lint_node_id: NodeId,

    public is_sdylib_interface: boolean,

    public lint_buffer: LintBuffer,
  ) {
    super();
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:153 with_in_trait_or_impl
  with_in_trait_or_impl(in_trait_or_impl: TraitOrImpl | undefined, f: (this_: AstValidator) => void): void {
    const old = this.outer_trait_or_trait_impl;
    this.outer_trait_or_trait_impl = in_trait_or_impl;
    f(this);
    this.outer_trait_or_trait_impl = old;
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:163 with_in_trait
  with_in_trait(vis: Span, constness: Const, f: (this_: AstValidator) => void): void {
    const old = this.outer_trait_or_trait_impl;
    this.outer_trait_or_trait_impl = { $: "Trait", vis, constness };
    f(this);
    this.outer_trait_or_trait_impl = old;
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:172 with_in_extern_mod
  with_in_extern_mod(extern_mod_safety: Safety, abi: ExternAbi | undefined, f: (this_: AstValidator) => void): void {
    const old_safety = this.extern_mod_safety;
    this.extern_mod_safety = extern_mod_safety;
    const old_abi = this.extern_mod_abi;
    this.extern_mod_abi = abi;
    f(this);
    this.extern_mod_safety = old_safety;
    this.extern_mod_abi = old_abi;
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:185 with_tilde_const
  with_tilde_const(disallowed: TildeConstReason | undefined, f: (this_: AstValidator) => void): void {
    const old = this.disallow_tilde_const;
    this.disallow_tilde_const = disallowed;
    f(this);
    this.disallow_tilde_const = old;
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:195 check_type_alias_where_clause_location
  check_type_alias_where_clause_location(ty_alias: TyAlias): Result<undefined, diagnostics.WhereClauseBeforeTypeAlias> {
    if (ty_alias.ty === undefined || !ty_alias.generics.where_clause.has_where_token) {
      return Ok(undefined);
    }

    const span = ty_alias.generics.where_clause.span;

    let sugg: diagnostics.WhereClauseBeforeTypeAliasSugg;
    if (ty_alias.generics.where_clause.predicates.length !== 0 || !ty_alias.after_where_clause.has_where_token) {
      const state = pprust.State.new();

      let needs_comma = ty_alias.after_where_clause.predicates.length !== 0;
      if (!ty_alias.after_where_clause.has_where_token) {
        state.s.space();
        state.s.word_space("where");
      } else if (!needs_comma) {
        state.s.space();
      }

      for (const p of ty_alias.generics.where_clause.predicates) {
        if (needs_comma) {
          state.s.word_space(",");
        }
        needs_comma = true;
        state.print_where_predicate(p);
      }

      sugg = {
        $: "Move",
        left: span,
        snippet: state.s.eof(),
        right: Span.shrink_to_hi(ty_alias.after_where_clause.span),
      };
    } else {
      sugg = { $: "Remove", span };
    }

    return Err({ span, sugg });
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:238 with_impl_trait
  with_impl_trait(outer_span: Span | undefined, f: (this_: AstValidator) => void): void {
    const old = this.outer_impl_trait_span;
    this.outer_impl_trait_span = outer_span;
    f(this);
    this.outer_impl_trait_span = old;
  }

  // Mirrors `visit::walk_ty`, but tracks relevant state.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:245 walk_ty
  walk_ty(t: Ty): void {
    switch (t.kind.$) {
      case "ImplTrait": {
        const bounds = t.kind._1;
        this.with_impl_trait(t.span, (this_) => visit.walk_ty(this_, t));

        // FIXME(precise_capturing): If we were to allow `use` in other positions
        // (e.g. GATs), then we must validate those as well. However, we don't have
        // a good way of doing this with the current `Visitor` structure.
        const use_bounds: Span[] = [];
        for (const bound of bounds) {
          if (bound.$ === "Use") use_bounds.push(bound._1);
        }
        const bound1 = use_bounds[0];
        const bound2 = use_bounds[1];
        if (bound1 !== undefined && bound2 !== undefined) {
          this.dcx().emit_err(diagnostics.DuplicatePreciseCapturing_diagnostic({ bound1, bound2 }));
        }
        break;
      }
      case "TraitObject":
        this.with_tilde_const({ $: "TraitObject" }, (this_) => {
          visit.walk_ty(this_, t);
        });
        break;
      default:
        visit.walk_ty(this, t);
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:274 dcx
  dcx(): DiagCtxtHandle {
    return this.sess.dcx();
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:278 visibility_not_permitted
  visibility_not_permitted(vis: Visibility, note: diagnostics.VisibilityNotPermittedNote): void {
    if (vis.kind.$ === "Inherited") {
      return;
    }

    this.dcx().emit_err(
      diagnostics.VisibilityNotPermitted_diagnostic({
        span: vis.span,
        note,
        remove_qualifier_sugg: vis.span,
      }),
    );
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:294 check_decl_no_pat
  static check_decl_no_pat(fn_inputs: readonly Param[], report_err: (span: Span, ident: Ident | undefined, mut_ident: boolean) => void): void {
    for (const { pat } of fn_inputs) {
      const k = pat.kind;
      if (k.$ === "Missing" || (k.$ === "Ident" && ast.BindingMode_eq(k._0, ast.BindingMode.NONE) && k._2 === undefined) || k.$ === "Wild") {
        // nothing
      } else if (k.$ === "Ident" && ast.BindingMode_eq(k._0, ast.BindingMode.MUT) && k._2 === undefined) {
        report_err(pat.span, k._1, true);
      } else {
        report_err(pat.span, undefined, false);
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:309 check_impl_fn_not_const
  check_impl_fn_not_const(constness: Const, parent_constness_: Const): void {
    if (constness.$ !== "Yes") {
      return;
    }
    let span = constness._0;

    span = this.sess.source_map().span_extend_while_whitespace(span);

    if (parent_constness_.$ !== "Yes") {
      return;
    }
    const parent_constness = parent_constness_._0;

    this.dcx().emit_err(diagnostics.ImplFnConst_diagnostic({ span, parent_constness }));
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:323 check_trait_fn_not_const
  check_trait_fn_not_const(constness: Const, parent: TraitOrImpl): void {
    if (constness.$ !== "Yes") {
      return;
    }
    const span = constness._0;

    const const_trait_impl = this.features.const_trait_impl();
    let make_impl_const_sugg: Span | undefined;
    if (const_trait_impl && parent.$ === "TraitImpl" && parent.constness.$ === "No" && parent.polarity.$ === "Positive") {
      make_impl_const_sugg = Span.shrink_to_lo(parent.trait_ref_span);
    } else {
      make_impl_const_sugg = undefined;
    }

    const map = this.sess.source_map();

    let make_trait_const_sugg: Span | undefined;
    if (const_trait_impl && parent.$ === "Trait" && parent.constness.$ === "No") {
      make_trait_const_sugg = Span.shrink_to_hi(map.span_extend_while_whitespace(parent.vis));
    } else {
      make_trait_const_sugg = undefined;
    }

    const parent_constness = TraitOrImpl.constness(parent);
    this.dcx().emit_err(
      diagnostics.TraitFnConst_diagnostic({
        span,
        in_impl: parent.$ === "TraitImpl",
        const_context_label: parent_constness,
        remove_const_sugg: [map.span_extend_while_whitespace(span), parent_constness !== undefined ? "MachineApplicable" : "MaybeIncorrect"],
        requires_multiple_changes: make_impl_const_sugg !== undefined || make_trait_const_sugg !== undefined,
        make_impl_const_sugg,
        make_trait_const_sugg,
      }),
    );
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:371 check_async_fn_in_const_trait_or_impl
  check_async_fn_in_const_trait_or_impl(sig: FnSig, parent: TraitOrImpl): void {
    const const_keyword = TraitOrImpl.constness(parent);
    if (const_keyword === undefined) return;

    const marker = sig.header.coroutine_marker;
    if (marker === undefined || marker.kind !== "Async") {
      return;
    }
    const async_keyword = marker.span;

    let context: string;
    switch (parent.$) {
      case "Trait":
        context = "trait";
        break;
      case "TraitImpl":
        context = "trait_impl";
        break;
      case "Impl":
        context = "impl";
        break;
    }

    this.dcx().emit_err(
      diagnostics.AsyncFnInConstTraitOrTraitImpl_diagnostic({
        async_keyword,
        context,
        const_keyword,
      }),
    );
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:393 check_fn_decl
  check_fn_decl(fn_decl: FnDecl, self_semantic: SelfSemantic, splat_semantic: SplatSemantic): void {
    this.check_decl_num_args(fn_decl);
    const c_variadic_span = this.check_decl_cvariadic_pos(fn_decl);
    this.check_decl_splatting(fn_decl, c_variadic_span, splat_semantic);
    this.check_decl_attrs(fn_decl);
    this.check_decl_self_param(fn_decl.inputs, self_semantic);
  }

  /// Emits fatal error if function declaration has more than `u16::MAX` arguments
  /// Error is fatal to prevent errors during typechecking
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:408 check_decl_num_args
  check_decl_num_args(fn_decl: FnDecl): void {
    const max_num_args = 0xffff; // u16::MAX.into()
    if (fn_decl.inputs.length > max_num_args) {
      const { span } = fn_decl.inputs[0]!;
      this.dcx().emit_fatal(diagnostics.FnParamTooMany_diagnostic({ span, max_num_args }));
    }
  }

  /// Emits an error if a function declaration has a variadic parameter in the
  /// beginning or middle of parameter list.
  /// Example: `fn foo(..., x: i32)` will emit an error.
  /// If a C-variadic parameter is found, returns its span.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:420 check_decl_cvariadic_pos
  check_decl_cvariadic_pos(fn_decl: FnDecl): Span | undefined {
    let c_variadic_span: Span | undefined = undefined;

    const inputs = fn_decl.inputs;
    if (inputs.length >= 1) {
      // [ps @ .., _]
      for (const { ty, span } of inputs.slice(0, -1)) {
        if (ty.kind.$ === "CVarArgs") {
          c_variadic_span = span;
          this.dcx().emit_err(diagnostics.FnParamCVarArgsNotLast_diagnostic({ span }));
        }
      }
    }

    const last = inputs[inputs.length - 1];
    if (last !== undefined && last.ty.kind.$ === "CVarArgs") {
      c_variadic_span = last.span;
    }

    return c_variadic_span;
  }

  /// Emits an error if a function declaration has more than one splatted argument, with a
  /// C-variadic parameter, or a splat at an unsupported index (for performance).
  /// Example: `fn foo(#[rustc_splat] x: (), #[rustc_splat] y: ())` will emit an error.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:447 check_decl_splatting
  check_decl_splatting(fn_decl: FnDecl, c_variadic_span: Span | undefined, splat_semantic: SplatSemantic): void {
    // PORT: `BTreeMap<u16, Vec<Span>>` -> entries in ascending key order (the keys are the enumerate indices).
    let splatted_arg_spans: [number, Span[]][] = [];
    fn_decl.inputs.forEach((arg, index) => {
      const splat_arg_spans: Span[] = [];
      for (const a of arg.attrs) {
        if (a.has_name(sym.rustc_splat)) splat_arg_spans.push(a.span);
      }
      if (splat_arg_spans.length !== 0) {
        if (index > 0xffff) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
        splatted_arg_spans.push([index, splat_arg_spans]);
      }
    });

    // A splatted argument greater than or equal to the "no splatted" marker index is not
    // supported. It is ok to drop these spans after issuing this error, because they are
    // always invalid.
    const out_of_range_spans = splatted_arg_spans.filter(([k]) => k >= ast.FnDecl.NO_SPLATTED_ARG_INDEX);
    splatted_arg_spans = splatted_arg_spans.filter(([k]) => k < ast.FnDecl.NO_SPLATTED_ARG_INDEX);
    if (out_of_range_spans.length !== 0) {
      this.dcx().emit_err(
        diagnostics.InvalidSplattedArgs_diagnostic({
          max_valid_splatted_arg_index: ast.FnDecl.MAX_VALID_SPLATTED_ARG_INDEX,
          first_invalid_splatted_arg_index: out_of_range_spans[0]![0],
          spans: out_of_range_spans.flatMap(([, v]) => v),
        }),
      );
    }

    if (splatted_arg_spans.length !== 0) {
      const splatted_spans = (): Span[] => splatted_arg_spans.flatMap(([, v]) => v);

      // Multiple splatted arguments are invalid: we can't know which arguments go in each splat.
      if (splatted_arg_spans.length > 1) {
        this.dcx().emit_err(diagnostics.DuplicateSplattedArgs_diagnostic({ spans: splatted_spans() }));
      }

      // C-variadic parameters and splats are not allowed together.
      if (c_variadic_span !== undefined) {
        const splatted_spans_ = splatted_spans();
        splatted_spans_.push(c_variadic_span);
        this.dcx().emit_err(diagnostics.CVarArgsAndSplat_diagnostic({ spans: splatted_spans_ }));
      }

      // Splatting is not allowed on closures, or some function ABIs.
      switch (splat_semantic.$) {
        case "NoClosures": {
          const closure_span = splat_semantic._0;
          const splatted_spans_ = splatted_spans();
          splatted_spans_.push(closure_span);
          this.dcx().emit_err(diagnostics.SplatNotAllowedOnClosures_diagnostic({ spans: splatted_spans_ }));
          break;
        }
        case "NoAbiCall": {
          const { span, abi } = splat_semantic;
          const splatted_spans_ = splatted_spans();
          splatted_spans_.push(span);
          this.dcx().emit_err(
            diagnostics.SplatNotAllowedOnAbiCall_diagnostic({
              spans: splatted_spans_,
              abi,
            }),
          );
          break;
        }
        case "Yes":
          break;
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:520 check_decl_attrs
  check_decl_attrs(fn_decl: FnDecl): void {
    // use SyntheticAttr::*;
    for (const i of fn_decl.inputs) {
      for (const a of i.attrs) {
        let keep: boolean;
        switch (a.kind.$) {
          case "Normal": {
            const normal = a.kind._0;
            const arr = [sym.allow, sym.deny, sym.expect, sym.forbid, sym.rustc_splat, sym.warn];
            keep = !a.has_any_name(arr) && is_builtin_attr(normal.item);
            break;
          }
          case "Synthetic": // CfgTrace(_) | CfgAttrTrace(_)
            keep = false;
            break;
          case "DocComment":
            keep = true;
            break;
        }
        if (!keep) continue;
        if (a.is_doc_comment()) {
          this.dcx().emit_err(diagnostics.FnParamDocComment_diagnostic({ span: a.span }));
        } else {
          this.dcx().emit_err(diagnostics.FnParamForbiddenAttr_diagnostic({ span: a.span }));
        }
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:550 check_decl_self_param
  check_decl_self_param(fn_inputs: readonly Param[], self_semantic: SelfSemantic): void {
    const param = fn_inputs[0];
    if (self_semantic === "No" && param !== undefined) {
      if (param.is_self()) {
        this.dcx().emit_err(diagnostics.FnParamForbiddenSelf_diagnostic({ span: param.span }));
      }
    }
  }

  /// Check that the signature of this function does not violate the constraints of its ABI.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:559 check_extern_fn_signature
  check_extern_fn_signature(
    abi: ExternAbi,
    ctxt: FnCtxt,
    opt_function_name: Ident | undefined, // None for function pointers
    sig: BorrowedFnSig,
  ): void {
    const mapping = AbiMap.from_target(this.sess.target).canonize_abi(abi, false);
    switch (mapping.$) {
      case "Direct":
      case "Deprecated": {
        const canon_abi = mapping._0;
        switch (canon_abi.$) {
          case "C":
          case "Rust":
          case "RustCold":
          case "RustPreserveNone":
          case "RustTail":
          case "Swift":
          case "Arm":
          case "X86":
            /* nothing to check */
            break;

          case "GpuKernel":
            // An `extern "gpu-kernel"` function cannot be `async` and/or `gen`.
            this.reject_coroutine(abi, sig);

            // An `extern "gpu-kernel"` function cannot return a value.
            this.reject_return(abi, sig);
            break;

          case "Custom":
            // An `extern "custom"` function must be unsafe.
            this.reject_safe_fn(abi, ctxt, sig, opt_function_name === undefined);

            // An `extern "custom"` function cannot be `async` and/or `gen`.
            this.reject_coroutine(abi, sig);

            // An `extern "custom"` function must have type `fn()`.
            this.reject_params_or_return(abi, opt_function_name, sig);
            break;

          case "Interrupt": {
            const interrupt_kind = canon_abi._0;
            // An interrupt handler cannot be `async` and/or `gen`.
            this.reject_coroutine(abi, sig);

            if (interrupt_kind === "X86") {
              // "x86-interrupt" is special because it does have arguments.
              // FIXME(workingjubilee): properly lint on acceptable input types.
              const inputs = sig.decl.inputs;
              const param_count = inputs.length;
              if (!(param_count === 1 || param_count === 2)) {
                let spans: Span[] = inputs.map((arg) => arg.span);
                if (spans.length === 0) {
                  spans = [sig.span];
                }
                this.dcx().emit_err(diagnostics.AbiX86Interrupt_diagnostic({ spans, param_count }));
              }

              this.reject_return(abi, sig);
            } else {
              // An `extern "interrupt"` function must have type `fn()`.
              this.reject_params_or_return(abi, opt_function_name, sig);
            }
            break;
          }
        }
        break;
      }
      case "Invalid":
        /* ignore */
        break;
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:628 reject_safe_fn
  reject_safe_fn(abi: ExternAbi, ctxt: FnCtxt, sig: BorrowedFnSig, is_fn_ptr: boolean): void {
    const dcx = this.dcx();

    const safety = sig.header.safety;
    switch (safety.$) {
      case "Unsafe":
        /* all good */
        break;
      case "Safe": {
        const safe_span_ = safety._0;
        // Function pointers already error when `safe` is used.
        if (!is_fn_ptr) {
          const source_map = this.sess.psess.source_map();
          const safe_span = source_map.span_until_non_whitespace(Span.to(safe_span_, sig.span));
          dcx.emit_err(
            diagnostics.AbiCustomSafeForeignFunction_diagnostic({
              span: sig.span,
              safe_span,
            }),
          );
        }
        break;
      }
      case "Default":
        switch (ctxt.$) {
          case "Foreign":
            /* all good */
            break;
          case "Free":
          case "Assoc":
            dcx.emit_err(
              diagnostics.AbiCustomSafeFunction_diagnostic({
                span: sig.span,
                abi,
                unsafe_span: Span.shrink_to_lo(sig.span),
              }),
            );
            break;
        }
        break;
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:663 reject_coroutine
  reject_coroutine(abi: ExternAbi, sig: BorrowedFnSig): void {
    const coroutine_marker = sig.header.coroutine_marker;
    if (coroutine_marker !== undefined) {
      const coroutine_kind_span = this.sess.psess.source_map().span_until_non_whitespace(Span.to(coroutine_marker.span, sig.span));

      this.dcx().emit_err(
        diagnostics.AbiCannotBeCoroutine_diagnostic({
          span: sig.span,
          abi,
          coroutine_kind_span,
          coroutine_kind_str: ast.CoroutineKind.as_str(coroutine_marker.kind),
        }),
      );
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:680 reject_return
  reject_return(abi: ExternAbi, sig: BorrowedFnSig): void {
    const output = sig.decl.output;
    if (output.$ === "Ty") {
      const ret_ty = output._0;
      let reject: boolean;
      if (ret_ty.kind.$ === "Never") {
        reject = false;
      } else if (ret_ty.kind.$ === "Tup" && ret_ty.kind._0.length === 0) {
        reject = false;
      } else {
        reject = true;
      }
      if (reject) {
        this.dcx().emit_err(diagnostics.AbiMustNotHaveReturnType_diagnostic({ span: ret_ty.span, abi }));
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:692 reject_params_or_return
  reject_params_or_return(
    abi: ExternAbi,
    opt_function_name: Ident | undefined, // None for function pointers
    sig: BorrowedFnSig,
  ): void {
    const spans: Span[] = sig.decl.inputs.map((p) => p.span);

    const allowed_return = (ret_ty: Ty): boolean => {
      if (ret_ty.kind.$ === "Never" && !ExternAbi.eq(abi, ExternAbi.Custom)) return true;
      if (ret_ty.kind.$ === "Tup" && ret_ty.kind._0.length === 0) return true;
      return false;
    };

    const output = sig.decl.output;
    if (output.$ === "Ty" && !allowed_return(output._0)) {
      spans.push(output._0.span);
    }

    if (spans.length !== 0) {
      const header_span = sig.header.span() ?? Span.shrink_to_lo(sig.span);
      const suggestion_span = Span.to(Span.shrink_to_hi(header_span), ast.FnRetTy.span(sig.decl.output));
      const padding = Span.is_empty(header_span) ? "" : " ";

      this.dcx().emit_err(
        diagnostics.AbiMustNotHaveParametersOrReturnType_diagnostic({
          spans,
          abi,

          suggestion_span,
          padding,
          symbol: opt_function_name !== undefined ? ` ${Symbol.as_str(opt_function_name.name)}` : "",
        }),
      );
    }
  }

  /// This ensures that items can only be `unsafe` (or unmarked) outside of extern
  /// blocks.
  ///
  /// This additionally ensures that within extern blocks, items can only be
  /// `safe`/`unsafe` inside of a `unsafe`-adorned extern block.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:736 check_item_safety
  check_item_safety(span: Span, safety: Safety): void {
    const extern_safety = this.extern_mod_safety;
    if (extern_safety !== undefined) {
      if ((safety.$ === "Unsafe" || safety.$ === "Safe") && extern_safety.$ === "Default") {
        this.dcx().emit_err(
          diagnostics.InvalidSafetyOnExtern_diagnostic({
            item_span: span,
            block: Span.shrink_to_lo(this.current_extern_span()),
          }),
        );
      }
    } else {
      if (safety.$ === "Safe") {
        this.dcx().emit_err(diagnostics.InvalidSafetyOnItem_diagnostic({ span }));
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:756 check_fn_ptr_safety
  check_fn_ptr_safety(span: Span, safety: Safety): void {
    if (safety.$ === "Safe") {
      const safe_span = safety._0;
      const remove_span = this.sess.source_map().span_until_non_whitespace(span);
      this.dcx().emit_err(
        diagnostics.InvalidSafetyOnFnPtr_diagnostic({
          span: safe_span,
          safe_span: remove_span,
        }),
      );
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:766 check_defaultness
  check_defaultness(span_: Span, defaultness: Defaultness, allow_default: AllowDefault, allow_final: AllowFinal): void {
    if (defaultness.$ === "Default" && allow_default === "No") {
      const def_span = defaultness._0;
      const span = this.sess.source_map().guess_head_span(span_);
      this.dcx().emit_err(diagnostics.ForbiddenDefault_diagnostic({ span, def_span }));
    } else if (defaultness.$ === "Final" && allow_final === "No") {
      const def_span = defaultness._0;
      const span = this.sess.source_map().guess_head_span(span_);
      this.dcx().emit_err(diagnostics.ForbiddenFinal_diagnostic({ span, def_span }));
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:786 check_final_has_body
  check_final_has_body(item: AssocItem, defaultness: Defaultness): void {
    if (item.kind.$ === "Fn" && item.kind._0.body === undefined && defaultness.$ === "Final") {
      const def_span = defaultness._0;
      const span = this.sess.source_map().guess_head_span(item.span);
      this.dcx().emit_err(diagnostics.ForbiddenFinalWithoutBody_diagnostic({ span, def_span }));
    }
  }

  /// If `sp` ends with a semicolon, returns it as a `Span`
  /// Otherwise, returns `sp.shrink_to_hi()`
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:797 ending_semi_or_hi
  ending_semi_or_hi(sp: Span): Span {
    const source_map = this.sess.source_map();
    const end = source_map.end_point(sp);

    const snippet = source_map.span_to_snippet(end);
    if (snippet.$ === "Ok" && snippet._0.toString() === ";") {
      return end;
    } else {
      return Span.shrink_to_hi(sp);
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:808 check_type_no_bounds
  check_type_no_bounds(bounds: readonly GenericBound[], ctx: string): void {
    let span: Span;
    if (bounds.length === 0) {
      return;
    } else if (bounds.length === 1) {
      span = ast.GenericBound.span(bounds[0]!);
    } else {
      span = Span.to(ast.GenericBound.span(bounds[0]!), ast.GenericBound.span(bounds[bounds.length - 1]!));
    }
    this.dcx().emit_err(diagnostics.BoundInContext_diagnostic({ span, ctx }));
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:817 check_foreign_ty_genericless
  check_foreign_ty_genericless(generics: Generics, after_where_clause: WhereClause): void {
    const cannot_have = (span: Span, descr: string, remove_descr: string): void => {
      this.dcx().emit_err(
        diagnostics.ExternTypesCannotHave_diagnostic({
          span,
          descr,
          remove_descr,
          block_span: this.current_extern_span(),
        }),
      );
    };

    if (generics.params.length !== 0) {
      cannot_have(generics.span, "generic parameters", "generic parameters");
    }

    const check_where_clause = (where_clause: WhereClause): void => {
      if (where_clause.has_where_token) {
        cannot_have(where_clause.span, "`where` clauses", "`where` clause");
      }
    };

    check_where_clause(generics.where_clause);
    check_where_clause(after_where_clause);
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:841 check_foreign_kind_bodyless
  check_foreign_kind_bodyless(ident: Ident, kind: string, body_span: Span | undefined): void {
    if (body_span === undefined) {
      return;
    }
    this.dcx().emit_err(
      diagnostics.BodyInExtern_diagnostic({
        span: ident.span,
        body: body_span,
        block: this.current_extern_span(),
        kind,
      }),
    );
  }

  /// An `fn` in `extern { ... }` cannot have a body `{ ... }`.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:854 check_foreign_fn_bodyless
  check_foreign_fn_bodyless(ident: Ident, body: ast.Block | undefined): void {
    if (body === undefined) {
      return;
    }
    this.dcx().emit_err(
      diagnostics.FnBodyInExtern_diagnostic({
        span: ident.span,
        body: body.span,
        block: this.current_extern_span(),
      }),
    );
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:865 current_extern_span
  current_extern_span(): Span {
    return this.sess.source_map().guess_head_span(unwrap(this.extern_mod_span));
  }

  /// An `fn` in `extern { ... }` cannot have qualifiers, e.g. `async fn`.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:870 check_foreign_fn_headerless
  check_foreign_fn_headerless(
    // Deconstruct to ensure exhaustiveness
    { coroutine_marker, constness, ext }: FnHeader,
  ): void {
    const report_err = (span: Span, kw: string): void => {
      this.dcx().emit_err(
        diagnostics.FnQualifierInExtern_diagnostic({
          span,
          kw,
          block: this.current_extern_span(),
        }),
      );
    };
    if (coroutine_marker !== undefined) {
      const marker = coroutine_marker;
      report_err(marker.span, ast.CoroutineKind.as_str(marker.kind));
    }
    if (constness.$ === "Yes") {
      report_err(constness._0, "const");
    }
    switch (ext.$) {
      case "None":
        break;
      case "Implicit":
        report_err(ext._0, "extern");
        break;
      case "Explicit":
        report_err(ext._1, "extern");
        break;
    }
  }

  /// An item in `extern { ... }` cannot use non-ascii identifier.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:897 check_foreign_item_ascii_only
  check_foreign_item_ascii_only(ident: Ident): void {
    if (!str_is_ascii(ident.as_str())) {
      this.dcx().emit_err(
        diagnostics.ExternItemAscii_diagnostic({
          span: ident.span,
          block: this.current_extern_span(),
        }),
      );
    }
  }

  /// Check the attributes on an `extern "custom"` function:
  ///
  /// - require `#[naked]`
  /// - reject `#[cold]` (these functions cannot be called so `#[cold]` is meaningless)
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:910 check_extern_custom
  check_extern_custom(fk: FnKind, attrs: AttrVec): void {
    if (!(fk.$ === "Fn" && fk._2.body !== undefined)) {
      return;
    }
    const fn_ctxt = fk._0;
    const sig = fk._2.sig;

    switch (fn_ctxt.$) {
      case "Foreign":
        return;
      case "Free":
      case "Assoc":
        /* fall through */
        break;
    }

    const ext = sig.header.ext;
    if (ext.$ !== "Explicit") {
      return;
    }
    const symbol_unescaped = ext._0.symbol_unescaped;
    const ext_span = ext._1;

    const parsed = ExternAbi.from_str(Symbol.as_str(symbol_unescaped));
    if (!(parsed.$ === "Ok" && parsed._0.$ === "Custom")) {
      return;
    }

    if (!attr.contains_name(attrs, sym.naked)) {
      this.dcx().emit_err(
        AbiCustomMustBeNaked_diagnostic({
          span: sig.span,
          naked_span: Span.shrink_to_lo(sig.span),
        }),
      );
    }

    const cold = attr.find_by_name(attrs, sym.cold);
    if (cold !== undefined) {
      this.dcx().emit_err(
        AbiCustomCannotBeCold_diagnostic({
          span: sig.span,
          abi_span: ext_span,
          cold_span: cold.span,
        }),
      );
    }
  }

  /// Reject invalid C-variadic types.
  ///
  /// C-variadics must be:
  /// - Non-const
  /// - Either foreign, or free and `unsafe extern "C"` semantically
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:949 check_c_variadic_type
  check_c_variadic_type(fk: FnKind, attrs: AttrVec): void {
    // `...` is already rejected when it is not the final parameter.
    const inputs = visit.FnKind.decl(fk).inputs;
    const last = inputs[inputs.length - 1];
    let variadic_param: Param;
    if (last !== undefined && last.ty.kind.$ === "CVarArgs") {
      variadic_param = last;
    } else {
      return;
    }

    if (fk.$ !== "Fn") {
      // Unreachable because the parser already rejects `...` in closures.
      return unreachable("internal error: entered unreachable code: C variable argument list cannot be used in closures");
    }
    const fn_ctxt = fk._0;
    const sig = fk._2.sig;

    if (sig.header.constness.$ === "Yes" && !this.features.enabled(sym.const_c_variadic)) {
      const msg = `c-variadic const function definitions are unstable`;
      feature_err(this.sess, sym.const_c_variadic, sig.span, msg).emit();
    }

    const coroutine_marker = sig.header.coroutine_marker;
    if (coroutine_marker !== undefined) {
      this.dcx().emit_err(
        diagnostics.CoroutineAndCVariadic_diagnostic({
          spans: [coroutine_marker.span, variadic_param.span],
          coroutine_kind: ast.CoroutineKind.as_str(coroutine_marker.kind),
          coroutine_span: coroutine_marker.span,
          variadic_span: variadic_param.span,
        }),
      );
    }

    switch (fn_ctxt.$) {
      case "Foreign":
        return;
      case "Free":
      case "Assoc": {
        // Reject `...` without a pattern post-expansion. The varargs_without_pattern
        // FCW is already triggered pre-expansion.
        if (variadic_param.pat.kind.$ === "Missing") {
          this.dcx().emit_err(diagnostics.VarargsWithoutPattern_diagnostic({ span: variadic_param.span }));
        }

        const status: CVariadicStatus = this.sess.target.supports_c_variadic_definitions();
        switch (status.$) {
          case "NotSupported":
            this.dcx().emit_err(
              diagnostics.CVariadicNotSupported_diagnostic({
                variadic_span: variadic_param.span,
                target: this.sess.target.llvm_target,
              }),
            );
            return;
          case "Unstable":
            if (!this.features.enabled(status.feature)) {
              const msg = `C-variadic function definitions on this target are unstable`;
              feature_err(this.sess, status.feature, variadic_param.span, msg).emit();
              return;
            }
            /* fall through */
            break;
          case "Stable":
            /* fall through */
            break;
        }

        const ext = sig.header.ext;
        switch (ext.$) {
          case "Implicit":
            if (sig.header.safety.$ !== "Unsafe") {
              this.dcx().emit_err(
                diagnostics.CVariadicMustBeUnsafe_diagnostic({
                  span: variadic_param.span,
                  unsafe_span: sig.safety_span(),
                }),
              );
            }
            break;
          case "Explicit": {
            // Just bail if the ABI is not even recognized.
            const r = ExternAbi.from_str(Symbol.as_str(ext._0.symbol_unescaped));
            if (r.$ !== "Ok") {
              return;
            }
            const abi = r._0;

            this.check_c_variadic_abi(abi, attrs, variadic_param.span, sig);

            if (sig.header.safety.$ !== "Unsafe") {
              this.dcx().emit_err(
                diagnostics.CVariadicMustBeUnsafe_diagnostic({
                  span: variadic_param.span,
                  unsafe_span: sig.safety_span(),
                }),
              );
            }
            break;
          }
          case "None": {
            const err = diagnostics.CVariadicNoExtern_diagnostic({ span: variadic_param.span });
            this.dcx().emit_err(err);
            break;
          }
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1039 check_c_variadic_abi
  check_c_variadic_abi(abi: ExternAbi, attrs: AttrVec, dotdotdot_span: Span, sig: FnSig): void {
    if (attr.contains_name(attrs, sym.naked)) {
      const status = ExternAbi.supports_c_variadic(abi);
      switch (status.$) {
        case "Stable":
          // For naked functions we accept any ABI that is accepted
          // on c-variadic foreign functions.
          break;
        case "Unstable": {
          const feature = status.feature;
          // Some ABIs need additional features to be enabled.
          if (!this.features.enabled(feature)) {
            const msg = `C-variadic functions with the ${display_ExternAbi(abi)} calling convention are unstable`;
            feature_err(this.sess, feature, sig.span, msg).emit();
          }
          break;
        }
        case "NotSupported":
          // Some ABIs, e.g. `extern "Rust"`, never support c-variadic functions.
          this.dcx().emit_err(
            diagnostics.CVariadicBadNakedExtern_diagnostic({
              span: dotdotdot_span,
              abi: ExternAbi.as_str(abi),
              extern_span: sig.extern_span(),
            }),
          );
          break;
      }
    } else if (abi.$ !== "C") {
      this.dcx().emit_err(
        diagnostics.CVariadicBadExtern_diagnostic({
          span: dotdotdot_span,
          abi: ExternAbi.as_str(abi),
          extern_span: sig.extern_span(),
        }),
      );
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1079 check_item_named
  check_item_named(ident: Ident, kind: string): void {
    if (ident.name !== kw.Underscore) {
      return;
    }
    this.dcx().emit_err(diagnostics.ItemUnderscore_diagnostic({ span: ident.span, kind }));
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1086 check_nomangle_item_asciionly
  check_nomangle_item_asciionly(ident: Ident, item_span: Span): void {
    if (str_is_ascii(Symbol.as_str(ident.name))) {
      return;
    }
    const span = this.sess.source_map().guess_head_span(item_span);
    this.dcx().emit_err(diagnostics.NoMangleAscii_diagnostic({ span }));
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1094 check_mod_file_item_asciionly
  check_mod_file_item_asciionly(ident: Ident): void {
    if (str_is_ascii(Symbol.as_str(ident.name))) {
      return;
    }
    this.dcx().emit_err(diagnostics.ModuleNonAscii_diagnostic({ span: ident.span, name: ident.name }));
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1101 deny_const_auto_traits
  deny_const_auto_traits(constness: Const): void {
    if (constness.$ === "Yes") {
      this.dcx().emit_err(diagnostics.ConstAutoTrait_diagnostic({ span: constness._0 }));
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1107 deny_generic_params
  deny_generic_params(generics: Generics, ident_span: Span): void {
    if (generics.params.length !== 0) {
      this.dcx().emit_err(diagnostics.AutoTraitGeneric_diagnostic({ span: generics.span, ident: ident_span }));
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1114 deny_super_traits
  deny_super_traits(bounds: GenericBounds, ident: Span): void {
    const last = bounds[bounds.length - 1];
    if (last !== undefined) {
      const span = bounds.map((b) => ast.GenericBound.span(b));
      const removal = Span.to(Span.shrink_to_hi(ident), ast.GenericBound.span(last));
      this.dcx().emit_err(diagnostics.AutoTraitBounds_diagnostic({ span, removal, ident }));
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1122 deny_where_clause
  deny_where_clause(where_clause: WhereClause, ident: Span): void {
    if (where_clause.predicates.length !== 0) {
      // FIXME: The current diagnostic is misleading since it only talks about
      // super trait and lifetime bounds while we should just say “bounds”.
      this.dcx().emit_err(
        diagnostics.AutoTraitBounds_diagnostic({
          span: [where_clause.span],
          removal: where_clause.span,
          ident,
        }),
      );
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1134 deny_items
  deny_items(trait_items: readonly AssocItem[], ident_span: Span): void {
    if (trait_items.length !== 0) {
      const spans = trait_items.map((i) => unwrap(ast.AssocItemKind.ident(i.kind)).span);
      const total = Span.to(trait_items[0]!.span, trait_items[trait_items.length - 1]!.span);
      this.dcx().emit_err(diagnostics.AutoTraitItems_diagnostic({ spans, total, ident: ident_span }));
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1142 correct_generic_order_suggestion
  correct_generic_order_suggestion(data: AngleBracketedArgs): string {
    // Lifetimes always come first.
    const lt_sugg: string[] = [];
    for (const arg of data.args) {
      if (arg.$ === "Arg" && arg._0.$ === "Lifetime") {
        const lt = arg._0;
        lt_sugg.push(pprust.to_string((s) => s.print_generic_arg(lt)));
      }
    }
    const args_sugg: string[] = [];
    for (const a of data.args) {
      if ((a.$ === "Arg" && a._0.$ === "Lifetime") || a.$ === "Constraint") {
        continue;
      }
      const arg = a._0;
      args_sugg.push(pprust.to_string((s) => s.print_generic_arg(arg)));
    }
    // Constraints always come last.
    const constraint_sugg: string[] = [];
    for (const a of data.args) {
      if (a.$ === "Arg") continue;
      const c = a._0;
      constraint_sugg.push(pprust.to_string((s) => s.print_assoc_item_constraint(c)));
    }
    return `<${[...lt_sugg, ...args_sugg, ...constraint_sugg].join(", ")}>`;
  }

  /// Enforce generic args coming before constraints in `<...>` of a path segment.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1170 check_generic_args_before_constraints
  check_generic_args_before_constraints(data: AngleBracketedArgs): void {
    // Early exit in case it's partitioned as it should be.
    // PORT: `Itertools::is_partitioned`: every `Arg` precedes every `Constraint`.
    let seen_constraint = false;
    let partitioned = true;
    for (const arg of data.args) {
      if (arg.$ === "Arg") {
        if (seen_constraint) {
          partitioned = false;
          break;
        }
      } else {
        seen_constraint = true;
      }
    }
    if (partitioned) {
      return;
    }
    // Find all generic argument coming after the first constraint...
    const constraint_spans: Span[] = [];
    const arg_spans: Span[] = [];
    for (const arg of data.args) {
      switch (arg.$) {
        case "Constraint":
          constraint_spans.push(arg._0.span);
          break;
        case "Arg":
          arg_spans.push(ast.GenericArg.span(arg._0));
          break;
      }
    }
    const args_len = arg_spans.length;
    const constraint_len = constraint_spans.length;
    // ...and then error:
    this.dcx().emit_err(
      diagnostics.ArgsBeforeConstraint_diagnostic({
        arg_spans: arg_spans.slice(),
        constraints: constraint_spans[0]!,
        args: unwrap(arg_spans[arg_spans.length - 1]),
        data: data.span,
        constraint_spans: { _0: constraint_spans },
        arg_spans2: { _0: arg_spans },
        suggestion: this.correct_generic_order_suggestion(data),
        constraint_len,
        args_len,
      }),
    );
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1197 visit_ty_common
  visit_ty_common(ty: Ty): void {
    switch (ty.kind.$) {
      case "FnPtr": {
        const bfty = ty.kind._0;
        this.check_fn_ptr_safety(bfty.decl_span, bfty.safety);
        this.check_fn_decl(bfty.decl, "No", SplatSemantic.from_extern(bfty.ext));
        AstValidator.check_decl_no_pat(bfty.decl.inputs, (span, _1, _2) => {
          this.dcx().emit_err(diagnostics.PatternFnPointer_diagnostic({ span }));
        });
        if (bfty.ext.$ === "Implicit") {
          this.handle_missing_abi(bfty.ext._0, ty.id);
        }

        let ext: ExternAbi | undefined;
        switch (bfty.ext.$) {
          case "None":
            ext = undefined;
            break;
          case "Implicit":
            ext = ExternAbi.FALLBACK;
            break;
          case "Explicit": {
            const r = ExternAbi.from_str(Symbol.as_str(bfty.ext._0.symbol));
            ext = r.$ === "Ok" ? r._0 : undefined;
            break;
          }
        }

        // Some ABIs impose special restrictions on the signature.
        if (ext !== undefined) {
          this.check_extern_fn_signature(ext, visit.FnCtxt.Free, undefined, bfty.as_borrowed_fn_sig());
        }
        break;
      }
      case "TraitObject": {
        const bounds = ty.kind._0;
        let any_lifetime_bounds = false;
        for (const bound of bounds) {
          if (bound.$ === "Outlives") {
            const lifetime = bound._0;
            if (any_lifetime_bounds) {
              this.dcx().emit_err(
                diagnostics.TraitObjectBound_diagnostic({
                  span: lifetime.ident.span,
                }),
              );
              break;
            }
            any_lifetime_bounds = true;
          }
        }
        break;
      }
      case "ImplTrait": {
        const bounds = ty.kind._1;
        const outer_impl_trait_sp = this.outer_impl_trait_span;
        if (outer_impl_trait_sp !== undefined) {
          this.dcx().emit_err(
            diagnostics.NestedImplTrait_diagnostic({
              span: ty.span,
              outer: outer_impl_trait_sp,
              inner: ty.span,
            }),
          );
        }

        if (!bounds.some((b) => b.$ === "Trait")) {
          this.dcx().emit_err(diagnostics.AtLeastOneTrait_diagnostic({ span: ty.span }));
        }
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1262 handle_missing_abi
  handle_missing_abi(span: Span, id: NodeId): void {
    // FIXME(davidtwco): This is a hack to detect macros which produce spans of the
    // call site which do not have a macro backtrace. See #61963.
    let snippet;
    if (Edition.at_least_edition_future(Span.edition(span)) && this.features.explicit_extern_abis()) {
      this.dcx().emit_err(diagnostics.MissingAbi_diagnostic({ span }));
    } else if ((snippet = this.sess.source_map().span_to_snippet(span)).$ === "Ok" && !snippet._0.starts_with("#[")) {
      this.lint_buffer.buffer_lint(
        MISSING_ABI,
        id,
        span,
        diagnostics.MissingAbiSugg_diagnostic({ span, default_abi: ExternAbi.FALLBACK }),
      );
    }
  }

  // Used within `visit_item` for item kinds where we don't call `visit::walk_item`.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1283 visit_attrs_vis
  visit_attrs_vis(attrs: AttrVec, vis: Visibility): void {
    for (const a of attrs) this.visit_attribute(a); // walk_list!(self, visit_attribute, attrs)
    this.visit_vis(vis);
  }

  // Used within `visit_item` for item kinds where we don't call `visit::walk_item`.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1289 visit_attrs_vis_ident
  visit_attrs_vis_ident(attrs: AttrVec, vis: Visibility, ident: Ident): void {
    for (const a of attrs) this.visit_attribute(a); // walk_list!(self, visit_attribute, attrs)
    this.visit_vis(vis);
    this.visit_ident(ident);
  }

  // Check EII implementation attributes against an allowlist.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1296 check_eii_impl_attrs
  check_eii_impl_attrs(attrs: readonly Attribute[], eii_impl_: EiiImpl | undefined): void {
    if (eii_impl_ === undefined) {
      return;
    }
    const eii_impl = eii_impl_;

    const allowed_attrs: readonly Symbol[] = [
      sym.allow,
      sym.warn,
      sym.deny,
      sym.forbid,
      sym.expect,
      sym.doc,
      sym.inline,
      sym.cold,
      sym.optimize,
      sym.coverage,
      sym.sanitize,
      sym.must_use,
      sym.deprecated,
    ];

    for (const a of attrs) {
      if (a.kind.$ !== "Normal") {
        continue;
      }
      const normal = a.kind._0;
      if (a.has_any_name(allowed_attrs)) {
        continue;
      }

      const attr_name = pprust.path_to_string(normal.item.path);
      this.dcx().emit_err(
        diagnostics.EiiImplAttributeNotSupported_diagnostic({
          attr_span: a.span,
          attr_name,
          eii_span: eii_impl.span,
          eii_name: pprust.path_to_string(eii_impl.eii_macro_path),
        }),
      );
    }
  }

  // ---- impl Visitor<'_> for AstValidator<'_> ----

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1410 visit_attribute
  override visit_attribute(a: Attribute): undefined {
    validate_attr.check_attr(this.sess.psess, a);
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1414 visit_ty
  override visit_ty(ty: Ty): undefined {
    this.visit_ty_common(ty);
    this.walk_ty(ty);
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1419 visit_item
  override visit_item(item: Item): undefined {
    if (item.attrs.some((a) => a.is_proc_macro_attr())) {
      this.has_proc_macro_decls = true;
    }

    const previous_lint_node_id = this.lint_node_id;
    this.lint_node_id = item.id;

    const ident_ = ast.ItemKind.ident(item.kind);
    if (ident_ !== undefined && attr.contains_name(item.attrs, sym.no_mangle)) {
      this.check_nomangle_item_asciionly(ident_, item.span);
    }

    const kind = item.kind;
    switch (kind.$) {
      case "Impl": {
        const { generics, constness, of_trait, self_ty, items } = kind._0;
        if (of_trait !== undefined) {
          const { safety, polarity, trait_ref: t } = of_trait;
          this.visit_attrs_vis(item.attrs, item.vis);
          this.visibility_not_permitted(item.vis, "TraitImpl");
          if (self_ty.kind.$ === "Dummy") {
            // Abort immediately otherwise the `TyKind::Dummy` will reach HIR lowering,
            // which isn't allowed. Not a problem for this obscure, obsolete syntax.
            this.dcx().emit_fatal(diagnostics.ObsoleteAuto_diagnostic({ span: item.span }));
          }
          if (safety.$ === "Unsafe" && polarity.$ === "Negative") {
            const span = safety._0;
            const sp = polarity._0;
            this.dcx().emit_err(
              diagnostics.UnsafeNegativeImpl_diagnostic({
                span: Span.to(sp, t.path.span),
                negative: sp,
                unsafe: span,
              }),
            );
          }

          const disallowed: TildeConstReason | undefined = constness.$ === "No" ? { $: "TraitImpl", span: item.span } : undefined;
          this.with_tilde_const(disallowed, (this_) => this_.visit_generics(generics));
          this.visit_trait_ref(t);
          this.visit_ty(self_ty);

          this.with_in_trait_or_impl(
            {
              $: "TraitImpl",
              constness,
              polarity,
              trait_ref_span: t.path.span,
            },
            (this_) => {
              for (const it of items) this_.visit_assoc_item(it, { $: "Impl", of_trait: true });
            },
          );
        } else {
          this.visit_attrs_vis(item.attrs, item.vis);
          this.visibility_not_permitted(item.vis, "IndividualImplItems");

          const disallowed: TildeConstReason | undefined = constness.$ === "No" ? { $: "Impl", span: item.span } : undefined;

          this.with_tilde_const(disallowed, (this_) => this_.visit_generics(generics));

          this.visit_ty(self_ty);
          this.with_in_trait_or_impl({ $: "Impl", constness }, (this_) => {
            for (const it of items) this_.visit_assoc_item(it, { $: "Impl", of_trait: false });
          });
        }
        break;
      }
      case "Fn": {
        const func = kind._0;
        const { defaultness, ident, sig, body, eii_impl } = func;
        this.visit_attrs_vis_ident(item.attrs, item.vis, ident);
        this.check_defaultness(item.span, defaultness, "No", "No");

        if (eii_impl !== undefined) {
          this.visit_path(eii_impl.eii_macro_path);
        }
        this.check_eii_impl_attrs(item.attrs, eii_impl);

        const is_intrinsic = item.attrs.some((a) => a.has_name(sym.rustc_intrinsic));
        if (body === undefined && !is_intrinsic && !this.is_sdylib_interface) {
          let extern_block_suggestion: diagnostics.ExternBlockSuggestion | undefined;
          const ext = sig.header.ext;
          switch (ext.$) {
            case "None":
              extern_block_suggestion = undefined;
              break;
            case "Implicit":
              extern_block_suggestion = {
                $: "Implicit",
                start_span: ext._0,
                end_span: Span.shrink_to_hi(item.span),
              };
              break;
            case "Explicit":
              extern_block_suggestion = {
                $: "Explicit",
                start_span: ext._1,
                end_span: Span.shrink_to_hi(item.span),
                abi: ext._0.symbol_unescaped,
              };
              break;
          }
          this.dcx().emit_err(
            diagnostics.FnWithoutBody_diagnostic({
              span: item.span,
              replace_span: this.ending_semi_or_hi(item.span),
              extern_block_suggestion,
            }),
          );
        }

        const fk: FnKind = { $: "Fn", _0: visit.FnCtxt.Free, _1: item.vis, _2: func };
        this.visit_fn(fk, item.attrs, item.span, item.id);
        break;
      }
      case "ForeignMod": {
        const { extern_span, abi, safety } = kind._0;
        const old_item = this.extern_mod_span;
        this.extern_mod_span = item.span;
        this.visibility_not_permitted(item.vis, "IndividualForeignItems");

        if (safety.$ === "Default") {
          if (Span.at_least_rust_2024(item.span)) {
            this.dcx().emit_err(
              diagnostics.MissingUnsafeOnExtern_diagnostic({
                span: item.span,
                unsafe_span: Span.shrink_to_lo(item.span),
              }),
            );
          } else {
            this.lint_buffer.buffer_lint(
              MISSING_UNSAFE_ON_EXTERN,
              item.id,
              item.span,
              diagnostics.MissingUnsafeOnExternLint_diagnostic({
                suggestion: Span.shrink_to_lo(item.span),
              }),
            );
          }
        }

        if (abi === undefined) {
          this.handle_missing_abi(extern_span, item.id);
        }

        let extern_abi: ExternAbi | undefined;
        if (abi !== undefined) {
          const r = ExternAbi.from_str(Symbol.as_str(abi.symbol));
          extern_abi = r.$ === "Ok" ? r._0 : undefined;
        }
        this.with_in_extern_mod(safety, extern_abi, (this_) => {
          visit.walk_item(this_, item, visit.WalkItemKind.ItemKind);
        });
        this.extern_mod_span = old_item;
        break;
      }
      case "Enum": {
        const def = kind._2;
        for (const variant of def.variants) {
          this.visibility_not_permitted(variant.vis, "EnumVariant");
          for (const field of ast.VariantData.fields(variant.data)) {
            this.visibility_not_permitted(field.vis, "EnumVariant");
          }
        }
        this.with_tilde_const({ $: "Enum", span: item.span }, (this_) => {
          visit.walk_item(this_, item, visit.WalkItemKind.ItemKind);
        });
        break;
      }
      case "Trait": {
        const { constness, is_auto, generics, ident, bounds, items } = kind._0;
        this.visit_attrs_vis_ident(item.attrs, item.vis, ident);
        if (is_auto === "Yes") {
          // For why we reject `const auto trait`, see rust-lang/rust#149285.
          this.deny_const_auto_traits(constness);
          // Auto traits cannot have generics, super traits nor contain items.
          this.deny_generic_params(generics, ident.span);
          this.deny_super_traits(bounds, ident.span);
          this.deny_where_clause(generics.where_clause, ident.span);
          this.deny_items(items, ident.span);
        }

        // Equivalent of `visit::walk_item` for `ItemKind::Trait` that inserts a bound
        // context for the supertraits.
        const disallowed: TildeConstReason | undefined = constness.$ === "No" ? { $: "Trait", span: item.span } : undefined;
        this.with_tilde_const(disallowed, (this_) => {
          this_.visit_generics(generics);
          for (const b of bounds) this_.visit_param_bound(b, "SuperTraits");
        });
        this.with_in_trait(item.span, constness, (this_) => {
          for (const it of items) this_.visit_assoc_item(it, visit.AssocCtxt.Trait);
        });
        break;
      }
      case "TraitAlias": {
        const { constness, generics, bounds } = kind._0;
        const disallowed: TildeConstReason | undefined = constness.$ === "No" ? { $: "Trait", span: item.span } : undefined;
        this.with_tilde_const(disallowed, (this_) => {
          this_.visit_generics(generics);
          for (const b of bounds) this_.visit_param_bound(b, "SuperTraits");
        });
        break;
      }
      case "Mod": {
        const safety = kind._0;
        const ident = kind._1;
        const mod_kind = kind._2;
        if (safety.$ === "Unsafe") {
          this.dcx().emit_err(diagnostics.UnsafeItem_diagnostic({ span: safety._0, kind: "module" }));
        }
        // Ensure that `path` attributes on modules are recorded as used (cf. issue #35584).
        if (!(mod_kind.$ === "Loaded" && mod_kind._1.$ === "Yes") && !attr.contains_name(item.attrs, sym.path)) {
          this.check_mod_file_item_asciionly(ident);
        }
        visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
        break;
      }
      case "Struct": {
        const vdata = kind._2;
        this.with_tilde_const({ $: "Struct", span: item.span }, (this_) => {
          // Scalable vectors can only be tuple structs
          const scalable_vector_attr = item.attrs.find((a) => a.has_name(sym.rustc_scalable_vector));
          if (scalable_vector_attr !== undefined) {
            const a = scalable_vector_attr;
            if (vdata.$ !== "Tuple") {
              this_.dcx().emit_err(
                diagnostics.ScalableVectorNotTupleStruct_diagnostic({
                  span: item.span,
                }),
              );
            }
            if (!Arch.supports_scalable_vectors(this.sess.target.arch) && !this.sess.opts.actually_rustdoc) {
              this_.dcx().emit_err(diagnostics.ScalableVectorBadArch_diagnostic({ span: a.span }));
            }
          }

          visit.walk_item(this_, item, visit.WalkItemKind.ItemKind);
        });
        break;
      }
      case "Union": {
        const vdata = kind._2;
        if (ast.VariantData.fields(vdata).length === 0) {
          this.dcx().emit_err(diagnostics.FieldlessUnion_diagnostic({ span: item.span }));
        }
        this.with_tilde_const({ $: "Union", span: item.span }, (this_) => {
          visit.walk_item(this_, item, visit.WalkItemKind.ItemKind);
        });
        break;
      }
      case "Const": {
        const { defaultness, ident, body } = kind._0;
        this.check_defaultness(item.span, defaultness, "No", "No");
        if (body === undefined) {
          this.dcx().emit_err(
            diagnostics.ConstWithoutBody_diagnostic({
              span: item.span,
              replace_span: this.ending_semi_or_hi(item.span),
            }),
          );
        }
        if (ident.name === kw.Underscore && item.vis.kind.$ !== "Inherited" && Span.eq_ctxt(ident.span, item.vis.span)) {
          this.lint_buffer.buffer_lint(
            UNUSED_VISIBILITIES,
            item.id,
            item.vis.span,
            diagnostics.UnusedVisibility_diagnostic({ span: item.vis.span }),
          );
        }

        visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
        break;
      }
      case "Static": {
        const { expr, safety, eii_impl } = kind._0;
        this.check_item_safety(item.span, safety);
        this.check_eii_impl_attrs(item.attrs, eii_impl);
        if (safety.$ === "Unsafe") {
          this.dcx().emit_err(diagnostics.UnsafeStatic_diagnostic({ span: item.span }));
        }

        if (expr === undefined) {
          this.dcx().emit_err(
            diagnostics.StaticWithoutBody_diagnostic({
              span: item.span,
              replace_span: this.ending_semi_or_hi(item.span),
            }),
          );
        }
        visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
        break;
      }
      case "TyAlias": {
        const ty_alias = kind._0;
        const { defaultness, bounds, after_where_clause, ty } = ty_alias;
        this.check_defaultness(item.span, defaultness, "No", "No");
        if (ty === undefined) {
          this.dcx().emit_err(
            diagnostics.TyAliasWithoutBody_diagnostic({
              span: item.span,
              replace_span: this.ending_semi_or_hi(item.span),
            }),
          );
        }
        this.check_type_no_bounds(bounds, "this context");

        if (this.features.checked_type_aliases()) {
          const r = this.check_type_alias_where_clause_location(ty_alias);
          if (r.$ === "Err") {
            this.dcx().emit_err(diagnostics.WhereClauseBeforeTypeAlias_diagnostic(r._0));
          }
        } else if (after_where_clause.has_where_token) {
          this.dcx().emit_err(
            diagnostics.WhereClauseAfterTypeAlias_diagnostic({
              span: after_where_clause.span,
              help: this.sess.is_nightly_build(),
            }),
          );
        }
        visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
        break;
      }
      default:
        visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
    }

    this.lint_node_id = previous_lint_node_id;
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1747 visit_foreign_item
  override visit_foreign_item(fi: ForeignItem): undefined {
    const kind = fi.kind;
    switch (kind.$) {
      case "Fn": {
        const { defaultness, ident, sig, body } = kind._0;
        this.check_defaultness(fi.span, defaultness, "No", "No");
        this.check_foreign_fn_bodyless(ident, body);
        this.check_foreign_fn_headerless(sig.header);
        this.check_foreign_item_ascii_only(ident);
        this.check_extern_fn_signature(this.extern_mod_abi ?? ExternAbi.FALLBACK, visit.FnCtxt.Foreign, ident, sig.as_borrowed());

        const a = attr.find_by_name(fi.attrs, sym.track_caller);
        if (a !== undefined && (this.extern_mod_abi === undefined || !ExternAbi.eq(this.extern_mod_abi, ExternAbi.Rust))) {
          this.dcx().emit_err(
            diagnostics.RequiresRustAbi_diagnostic({
              track_caller_span: a.span,
              extern_abi_span: this.current_extern_span(),
            }),
          );
        }
        break;
      }
      case "TyAlias": {
        const { defaultness, ident, generics, after_where_clause, bounds, ty } = kind._0;
        this.check_defaultness(fi.span, defaultness, "No", "No");
        this.check_foreign_kind_bodyless(ident, "type", ty?.span);
        this.check_type_no_bounds(bounds, "`extern` blocks");
        this.check_foreign_ty_genericless(generics, after_where_clause);
        this.check_foreign_item_ascii_only(ident);
        break;
      }
      case "Static": {
        const { ident, safety, expr } = kind._0;
        this.check_item_safety(fi.span, safety);
        this.check_foreign_kind_bodyless(ident, "static", expr?.span);
        this.check_foreign_item_ascii_only(ident);
        break;
      }
      case "MacCall":
        break;
    }

    visit.walk_item(this, fi, visit.WalkItemKind.ForeignItemKind);
  }

  // Mirrors `visit::walk_generic_args`, but tracks relevant state.
  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1797 visit_generic_args
  override visit_generic_args(generic_args: GenericArgs): undefined {
    switch (generic_args.$) {
      case "AngleBracketed": {
        const data = generic_args._0;
        this.check_generic_args_before_constraints(data);

        for (const arg of data.args) {
          switch (arg.$) {
            case "Arg":
              this.visit_generic_arg(arg._0);
              break;
            // Associated type bindings such as `Item = impl Debug` in
            // `Iterator<Item = Debug>` are allowed to contain nested `impl Trait`.
            case "Constraint": {
              const constraint = arg._0;
              this.with_impl_trait(undefined, (this_) => {
                this_.visit_assoc_item_constraint(constraint);
              });
              break;
            }
          }
        }
        break;
      }
      case "Parenthesized": {
        const data = generic_args._0;
        for (const p of data.inputs) this.visit_param(p); // walk_list!(self, visit_param, &data.inputs)
        if (data.output.$ === "Ty") {
          const ty = data.output._0;
          // `-> Foo` syntax is essentially an associated type binding,
          // so it is also allowed to contain nested `impl Trait`.
          this.with_impl_trait(undefined, (this_) => this_.visit_ty(ty));
        }
        break;
      }
      case "ParenthesizedElided":
        break;
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1827 visit_generics
  override visit_generics(generics: Generics): undefined {
    let prev_param_default: Span | undefined = undefined;
    for (const param of generics.params) {
      const k = param.kind;
      if (k.$ === "Lifetime") {
        // nothing
      } else if ((k.$ === "Type" && k.default !== undefined) || (k.$ === "Const" && k.default !== undefined)) {
        prev_param_default = param.ident.span;
      } else {
        // GenericParamKind::Type { .. } | GenericParamKind::Const { .. }
        if (prev_param_default !== undefined) {
          const span = prev_param_default;
          this.dcx().emit_err(diagnostics.GenericDefaultTrailing_diagnostic({ span }));
          break;
        }
      }
    }

    validate_generic_param_order(this.dcx(), generics.params, generics.span);
    for (const p of generics.params) this.visit_generic_param(p); // walk_list!

    for (const predicate of generics.where_clause.predicates) {
      switch (predicate.kind.$) {
        case "BoundPredicate": {
          const bound_pred = predicate.kind._0;
          // This is slightly complicated. Our representation for poly-trait-refs contains a single
          // binder and thus we only allow a single level of quantification. However,
          // the syntax of Rust permits quantification in two places in where clauses,
          // e.g., `T: for <'a> Foo<'a>` and `for <'a, 'b> &'b T: Foo<'a>`. If both are
          // defined, then error.
          if (bound_pred.bound_generic_params.length !== 0) {
            for (const bound of bound_pred.bounds) {
              switch (bound.$) {
                case "Trait": {
                  const t = bound._0;
                  if (t.bound_generic_params.length !== 0) {
                    this.dcx().emit_err(
                      diagnostics.NestedLifetimes_diagnostic({
                        span: t.span,
                      }),
                    );
                  }
                  break;
                }
                case "Outlives":
                  break;
                case "Use":
                  break;
              }
            }
          }
          break;
        }
        case "RegionPredicate":
          break;
      }
      this.visit_where_predicate(predicate);
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1878 visit_param_bound
  override visit_param_bound(bound: GenericBound, ctxt: BoundKind): undefined {
    switch (bound.$) {
      case "Trait": {
        const trait_ref = bound._0;
        const constness = trait_ref.modifiers.constness;
        const polarity = trait_ref.modifiers.polarity;
        let reason: TildeConstReason | undefined;
        if (ctxt === "TraitObject" && constness.$ === "Always" && polarity.$ === "Positive") {
          this.dcx().emit_err(diagnostics.ConstBoundTraitObject_diagnostic({ span: trait_ref.span }));
        } else if (constness.$ === "Maybe" && polarity.$ === "Positive" && (reason = this.disallow_tilde_const) !== undefined) {
          const span = constness._0;
          this.dcx().emit_err(diagnostics.TildeConstDisallowed_diagnostic({ span, reason }));
        }

        // Negative trait bounds are not allowed to have associated constraints
        const segments = trait_ref.trait_ref.path.segments;
        const segment = segments[segments.length - 1];
        if (trait_ref.modifiers.polarity.$ === "Negative" && segment !== undefined) {
          const args = segment.args;
          if (args === undefined) {
            // None
          } else {
            switch (args.$) {
              case "AngleBracketed":
                for (const arg of args._0.args) {
                  if (arg.$ === "Constraint") {
                    const constraint = arg._0;
                    this.dcx().emit_err(
                      diagnostics.ConstraintOnNegativeBound_diagnostic({
                        span: constraint.span,
                      }),
                    );
                  }
                }
                break;
              // The lowered form of parenthesized generic args contains an associated type binding.
              case "Parenthesized":
                this.dcx().emit_err(
                  diagnostics.NegativeBoundWithParentheticalNotation_diagnostic({
                    span: args._0.span,
                  }),
                );
                break;
              case "ParenthesizedElided":
                break;
            }
          }
        }
        break;
      }
      case "Outlives":
        break;
      case "Use": {
        const span = bound._1;
        switch (ctxt) {
          case "Impl":
            break;
          case "Bound":
          case "TraitObject":
          case "SuperTraits":
            this.dcx().emit_err(
              diagnostics.PreciseCapturingNotAllowedHere_diagnostic({
                loc: visit.BoundKind.descr(ctxt),
                span,
              }),
            );
            break;
        }
        break;
      }
    }

    visit.walk_param_bound(this, bound);
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1939 visit_fn
  override visit_fn(fk: FnKind, attrs: AttrVec, span: Span, id: NodeId): undefined {
    // Only associated `fn`s can have `self` parameters.
    const fk_ctxt = visit.FnKind.ctxt(fk);
    const self_semantic: SelfSemantic = fk_ctxt !== undefined && fk_ctxt.$ === "Assoc" ? "Yes" : "No";
    const splat_semantic = SplatSemantic.from_fn_kind(fk);
    this.check_fn_decl(visit.FnKind.decl(fk), self_semantic, splat_semantic);

    const header = visit.FnKind.header(fk);
    if (header !== undefined) {
      this.check_item_safety(span, header.safety);
    }

    if (fk.$ === "Fn") {
      const ctxt = fk._0;
      const fun = fk._2;
      let ext: [ExternAbi, Span] | undefined;
      const e = fun.sig.header.ext;
      switch (e.$) {
        case "None":
          ext = undefined;
          break;
        case "Implicit":
          ext = [ExternAbi.FALLBACK, e._0];
          break;
        case "Explicit": {
          const r = ExternAbi.from_str(Symbol.as_str(e._0.symbol));
          ext = r.$ === "Ok" ? [r._0, e._1] : undefined;
          break;
        }
      }

      if (ext !== undefined) {
        const [extern_abi, extern_abi_span] = ext;
        // Some ABIs impose special restrictions on the signature.
        this.check_extern_fn_signature(extern_abi, ctxt, fun.ident, fun.sig.as_borrowed());

        // #[track_caller] can only be used with the rust ABI.
        const a = attr.find_by_name(attrs, sym.track_caller);
        if (a !== undefined && !ExternAbi.eq(extern_abi, ExternAbi.Rust)) {
          this.dcx().emit_err(
            diagnostics.RequiresRustAbi_diagnostic({
              track_caller_span: a.span,
              extern_abi_span,
            }),
          );
        }
      }
    }

    this.check_extern_custom(fk, attrs);
    this.check_c_variadic_type(fk, attrs);

    // Functions cannot both be `const async` or `const gen`
    if (header !== undefined && header.constness.$ === "Yes" && header.coroutine_marker !== undefined) {
      const const_span = header.constness._0;
      const coroutine_marker = header.coroutine_marker;
      this.dcx().emit_err(
        diagnostics.ConstAndCoroutine_diagnostic({
          spans: [coroutine_marker.span, const_span],
          const_span,
          coroutine_span: coroutine_marker.span,
          coroutine_kind: ast.CoroutineKind.as_str(coroutine_marker.kind),
          span,
        }),
      );
    }

    if (fk.$ === "Fn" && fk._2.sig.header.ext.$ === "Implicit") {
      const extern_span = fk._2.sig.header.ext._0;
      this.handle_missing_abi(extern_span, id);
    }

    // Functions without bodies cannot have patterns.
    if (fk.$ === "Fn" && fk._2.body === undefined) {
      const ctxt = fk._0;
      const sig = fk._2.sig;
      AstValidator.check_decl_no_pat(sig.decl.inputs, (span, ident, mut_ident) => {
        if (mut_ident && ctxt.$ === "Assoc") {
          if (ident !== undefined) {
            const is_foreign = ctxt.$ === ("Foreign" as string);
            this.lint_buffer.dyn_buffer_lint(PATTERNS_IN_FNS_WITHOUT_BODY, id, span, (dcx, level) => {
              const sub: diagnostics.PatternsInFnsWithoutBodySub = { ident, span };
              const d: diagnostics.PatternsInFnsWithoutBody = is_foreign ? { $: "Foreign", sub } : { $: "Bodiless", sub };
              return diagnostics.PatternsInFnsWithoutBody_into_diag(d, dcx, level);
            });
          }
        } else {
          switch (ctxt.$) {
            case "Foreign":
              this.dcx().emit_err(diagnostics.PatternInForeign_diagnostic({ span }));
              break;
            default:
              this.dcx().emit_err(diagnostics.PatternInBodiless_diagnostic({ span }));
              break;
          }
        }
      });
    }

    const outer = this.outer_trait_or_trait_impl;
    const tilde_const_allowed =
      (header !== undefined && header.constness.$ === "Yes") ||
      (fk_ctxt !== undefined && fk_ctxt.$ === "Assoc" && outer !== undefined && TraitOrImpl.constness(outer) !== undefined);

    let disallowed: TildeConstReason | undefined;
    if (!tilde_const_allowed) {
      switch (fk.$) {
        case "Fn":
          disallowed = { $: "Function", ident: fk._2.ident.span };
          break;
        case "Closure":
          disallowed = { $: "Closure" };
          break;
      }
    } else {
      disallowed = undefined;
    }
    this.with_tilde_const(disallowed, (this_) => visit.walk_fn(this_, fk));
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:2061 visit_assoc_item
  override visit_assoc_item(item: AssocItem, ctxt: AssocCtxt): undefined {
    const ident_ = ast.AssocItemKind.ident(item.kind);
    if (ident_ !== undefined && attr.contains_name(item.attrs, sym.no_mangle)) {
      this.check_nomangle_item_asciionly(ident_, item.span);
    }

    const defaultness = ast.AssocItemKind.defaultness(item.kind);
    this.check_defaultness(
      item.span,
      defaultness,
      // `default` is allowed on all associated items in impls.
      AllowDefault.when(ctxt.$ === "Impl"),
      // `final` is allowed on all associated *functions* in traits.
      AllowFinal.when(ctxt.$ === "Trait" && item.kind.$ === "Fn"),
    );

    this.check_final_has_body(item, defaultness);

    if (ctxt.$ === "Impl") {
      switch (item.kind.$) {
        case "Const": {
          const { body } = item.kind._0;
          if (body === undefined) {
            this.dcx().emit_err(
              diagnostics.AssocConstWithoutBody_diagnostic({
                span: item.span,
                replace_span: this.ending_semi_or_hi(item.span),
              }),
            );
          }
          break;
        }
        case "Fn": {
          const { body } = item.kind._0;
          if (body === undefined && !this.is_sdylib_interface) {
            this.dcx().emit_err(
              diagnostics.AssocFnWithoutBody_diagnostic({
                span: item.span,
                replace_span: this.ending_semi_or_hi(item.span),
              }),
            );
          }
          break;
        }
        case "Type": {
          const { bounds, ty } = item.kind._0;
          if (ty === undefined) {
            this.dcx().emit_err(
              diagnostics.AssocTypeWithoutBody_diagnostic({
                span: item.span,
                replace_span: this.ending_semi_or_hi(item.span),
              }),
            );
          }
          this.check_type_no_bounds(bounds, "`impl`s");
          break;
        }
        default:
          break;
      }
    }

    let r;
    if (item.kind.$ === "Type" && (r = this.check_type_alias_where_clause_location(item.kind._0)).$ === "Err") {
      const err = r._0;
      let sugg: [Span, string] | undefined;
      switch (err.sugg.$) {
        case "Remove":
          sugg = undefined;
          break;
        case "Move":
          sugg = [err.sugg.right, err.sugg.snippet];
          break;
      }
      const ext = this.sess.source_map().span_extend_prev_while(err.span, is_whitespace);
      const left_sp = ext.$ === "Ok" ? ext._0 : err.span;
      this.lint_buffer.dyn_buffer_lint(DEPRECATED_WHERE_CLAUSE_LOCATION, item.id, err.span, (dcx, level) => {
        let suggestion: diagnostics.DeprecatedWhereClauseLocationSugg;
        if (sugg !== undefined) {
          const [right_sp, sugg_] = sugg;
          suggestion = {
            $: "MoveToEnd",
            left: left_sp,
            right: right_sp,
            sugg: sugg_,
          };
        } else {
          suggestion = {
            $: "RemoveWhere",
            span: err.span,
          };
        }
        return diagnostics.DeprecatedWhereClauseLocation_into_diag({ suggestion }, dcx, level);
      });
    }

    const outer = this.outer_trait_or_trait_impl;
    if (outer !== undefined && (outer.$ === "Trait" || outer.$ === "TraitImpl")) {
      const parent = outer;
      this.visibility_not_permitted(item.vis, "TraitImpl");
      if (item.kind.$ === "Fn") {
        const { sig } = item.kind._0;
        this.check_trait_fn_not_const(sig.header.constness, parent);
        this.check_async_fn_in_const_trait_or_impl(sig, parent);
      }
    } else if (outer !== undefined && outer.$ === "Impl") {
      const parent = outer;
      const constness = outer.constness;
      if (item.kind.$ === "Fn") {
        const { sig } = item.kind._0;
        this.check_impl_fn_not_const(sig.header.constness, constness);
        this.check_async_fn_in_const_trait_or_impl(sig, parent);
      }
    }

    if (item.kind.$ === "Const") {
      const ci = item.kind._0;
      this.check_item_named(ci.ident, "const");
    }

    const parent_is_const = this.outer_trait_or_trait_impl !== undefined && TraitOrImpl.constness(this.outer_trait_or_trait_impl) !== undefined;

    const kind = item.kind;
    if (kind.$ === "Fn" && (parent_is_const || ctxt.$ === "Trait" || kind._0.sig.header.constness.$ === "Yes")) {
      const func = kind._0;
      this.visit_attrs_vis_ident(item.attrs, item.vis, func.ident);
      const fk: FnKind = { $: "Fn", _0: { $: "Assoc", _0: ctxt }, _1: item.vis, _2: func };
      this.visit_fn(fk, item.attrs, item.span, item.id);
    } else if (kind.$ === "Type") {
      let disallowed: TildeConstReason | undefined;
      if (!parent_is_const) {
        const o = this.outer_trait_or_trait_impl;
        if (o !== undefined && o.$ === "Trait") {
          disallowed = { $: "TraitAssocTy", span: item.span };
        } else if (o !== undefined && o.$ === "TraitImpl") {
          disallowed = { $: "TraitImplAssocTy", span: item.span };
        } else {
          // Some(TraitOrImpl::Impl { .. }) | None
          disallowed = { $: "InherentAssocTy", span: item.span };
        }
      } else {
        disallowed = undefined;
      }
      this.with_tilde_const(disallowed, (this_) => {
        this_.with_in_trait_or_impl(undefined, (this__) => {
          visit.walk_assoc_item(this__, item, ctxt, visit.WalkItemKind.AssocItemKind);
        });
      });
    } else {
      this.with_in_trait_or_impl(undefined, (this_) => {
        visit.walk_assoc_item(this_, item, ctxt, visit.WalkItemKind.AssocItemKind);
      });
    }
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:2208 visit_anon_const
  override visit_anon_const(anon_const: AnonConst): undefined {
    this.with_tilde_const({ $: "AnonConst", span: anon_const.value.span }, (this_) => {
      visit.walk_anon_const(this_, anon_const);
    });
  }

  // rustc: compiler/rustc_ast_passes/src/ast_validation.rs:2215 visit_path_segment
  override visit_path_segment(seg: PathSegment): undefined {
    if (seg.args !== undefined && seg.args.$ === "Parenthesized") {
      const args = seg.args._0;
      this.check_decl_self_param(args.inputs, "No");
      AstValidator.check_decl_no_pat(args.inputs, (span, _1, _2) => {
        this.dcx().emit_err(diagnostics.PatternParenthesizedArgList_diagnostic({ span }));
      });
    }
    visit.walk_path_segment(this, seg);
  }
}

/// Checks that generic parameters are in the correct order,
/// which is lifetimes, then types and then consts. (`<'a, T, const N: usize>`)
// rustc: compiler/rustc_ast_passes/src/ast_validation.rs:1338 validate_generic_param_order
function validate_generic_param_order(dcx: DiagCtxtHandle, generics: readonly GenericParam[], span: Span): void {
  let max_param: ast.ParamKindOrd | undefined = undefined;
  // PORT: `FxIndexMap<ParamKindOrd, (ParamKindOrd, Vec<Span>)>` -> insertion-ordered `Map`.
  const out_of_order = new Map<ast.ParamKindOrd, [ast.ParamKindOrd, Span[]]>();
  const param_idents: [ast.GenericParamKind, ast.ParamKindOrd, GenericBounds, number, string][] = [];

  generics.forEach((param, idx) => {
    const ident_ = param.ident;
    const [kind, bounds, span_] = [param.kind, param.bounds, ident_.span];
    let ord_kind: ast.ParamKindOrd;
    let ident: string;
    switch (param.kind.$) {
      case "Lifetime":
        [ord_kind, ident] = ["Lifetime", display_Ident(ident_)];
        break;
      case "Type":
        [ord_kind, ident] = ["TypeOrConst", display_Ident(ident_)];
        break;
      case "Const": {
        const ty = pprust.ty_to_string(param.kind.ty);
        [ord_kind, ident] = ["TypeOrConst", `const ${display_Ident(ident_)}: ${ty}`];
        break;
      }
    }
    param_idents.push([kind, ord_kind, bounds, idx, ident]);
    if (max_param !== undefined && ast.ParamKindOrd_discriminant[max_param] > ast.ParamKindOrd_discriminant[ord_kind]) {
      let entry = out_of_order.get(ord_kind);
      if (entry === undefined) {
        entry = [max_param, []];
        out_of_order.set(ord_kind, entry);
      }
      entry[1].push(span_);
    } else {
      max_param = ord_kind;
    }
  });

  if (out_of_order.size !== 0) {
    let ordered_params = "<";
    // `sort_by_key(|&(_, po, _, i, _)| (po, i))` (stable)
    param_idents.sort((a, b) => ast.ParamKindOrd_discriminant[a[1]] - ast.ParamKindOrd_discriminant[b[1]] || a[3] - b[3]);
    let first = true;
    for (const [kind, , bounds, , ident] of param_idents) {
      if (!first) {
        ordered_params += ", ";
      }
      ordered_params += ident;

      if (bounds.length !== 0) {
        ordered_params += ": ";
        ordered_params += pprust.bounds_to_string(bounds);
      }

      switch (kind.$) {
        case "Type":
          if (kind.default !== undefined) {
            ordered_params += " = ";
            ordered_params += pprust.ty_to_string(kind.default);
          }
          break;
        case "Lifetime":
          break;
        case "Const":
          if (kind.default !== undefined) {
            ordered_params += " = ";
            ordered_params += pprust.expr_to_string(kind.default.value);
          }
          break;
      }
      first = false;
    }

    ordered_params += ">";

    for (const [param_ord, [max_param_, spans]] of out_of_order) {
      dcx.emit_err(
        diagnostics.OutOfOrderParams_diagnostic({
          spans: spans.slice(),
          sugg_span: span,
          param_ord: ast.display_ParamKindOrd(param_ord),
          max_param: ast.display_ParamKindOrd(max_param_),
          ordered_params,
        }),
      );
    }
  }
}

// rustc: compiler/rustc_ast_passes/src/ast_validation.rs:2226 check_crate
export function check_crate(sess: Session, features: Features, krate: Crate, is_sdylib_interface: boolean, lints: LintBuffer): boolean {
  const validator = new AstValidator(
    sess,
    features,
    /* extern_mod_span */ undefined,
    /* outer_trait_or_trait_impl */ undefined,
    /* has_proc_macro_decls */ false,
    /* outer_impl_trait_span */ undefined,
    /* disallow_tilde_const */ { $: "Item" },
    /* extern_mod_safety */ undefined,
    /* extern_mod_abi */ undefined,
    /* lint_node_id */ CRATE_NODE_ID,
    is_sdylib_interface,
    /* lint_buffer */ lints,
  );
  visit.walk_crate(validator, krate);

  return validator.has_proc_macro_decls;
}
