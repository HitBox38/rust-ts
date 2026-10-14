// Port of compiler/rustc_ast_lowering/src/pat.rs (lane lower-pat-path-block).
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned onto
// `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates; every other
// rustc_ast_lowering export (lib.ts, diagnostics.ts, ...) is read inside function bodies only.
import {
  type AnonConst,
  type BindingMode,
  clone_BindingMode,
  type Expr,
  type Pat,
  type RangeEnd,
  type TyPat,
} from "../rustc_ast/lib.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import type { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import type { Diagnostic } from "../rustc_errors/diagnostic.ts";
import { DefKind } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, type ErrorGuaranteed, respan, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import type { Ident, Symbol } from "../rustc_span/symbol.ts";
import { format_debug, PRETTY } from "../std/fmt.ts";
import { panic, unported, unwrap } from "../std/panic.ts";
import { debug_Pat } from "../rustc_ast/lib.ts";
import { LoweringContext } from "./decls.ts";
import * as diagnostics from "./diagnostics.ts";
import { ALLOW_PATTERN_TYPE } from "./lib.ts";

// ---- PORT(pending-gen): bridge to codegen set rustc_ast_lowering --------------------------------------------------
// The crate's own types are not generated yet (tools/codegen set `rustc_ast_lowering`): lib.ts aliases the lib.rs
// types to `unknown` and diagnostics.ts has no `#[derive(Diagnostic)]` structs. This block stands in for the
// generated exports with the generator's names and shapes (checked against a scratch run of
// `bun tools/codegen/types.ts rustc_ast_lowering`); a generated value that is still missing at run time stops as
// UNPORTED. On integration: call `diagnostics.X_diagnostic` directly, read `this.curr_owner` without the view, and
// delete this block.

/** A generated export of `module` (see above); UNPORTED while it does not exist. */
function pending_gen<T>(module: object, name: string): T {
  const v = (module as Record<string, unknown>)[name];
  if (v === undefined) return unported(`rustc_ast_lowering::${name} (pending codegen set rustc_ast_lowering)`);
  return v as T;
}

/** The `#[derive(Diagnostic)]` structs of diagnostics.rs this file emits (diagnostics.gen.ts, lane lower-index-diag). */
const diagnostics_ = {
  /** diagnostics.rs:336 */
  SubTupleBinding_diagnostic(d: { span: Span; ident: Ident; ident_name: Symbol; ctx: string }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "SubTupleBinding_diagnostic")(d);
  },
  /** diagnostics.rs:353 */
  ExtraDoubleDot_diagnostic(d: { span: Span; prev_span: Span; ctx: string }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "ExtraDoubleDot_diagnostic")(d);
  },
  /** diagnostics.rs:365 */
  MisplacedDoubleDot_diagnostic(d: { span: Span }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "MisplacedDoubleDot_diagnostic")(d);
  },
  /** diagnostics.rs:403 */
  ArbitraryExpressionInPattern_diagnostic(d: {
    span: Span;
    pattern_from_macro_note: boolean;
    const_block_in_pattern_help: boolean;
  }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "ArbitraryExpressionInPattern_diagnostic")(d);
  },
};

/**
 * The parts of `PerOwnerLoweringState` (lib.rs:155: generated class in lib.gen.ts; `owner_id` lib.rs:177, lane
 * lower-lib-a) this file uses; `LoweringContext.curr_owner` is `unknown` until then.
 */
interface PerOwnerLoweringStateView {
  ident_and_label_to_local_id: Map<NodeId, ItemLocalId>;
  owner_id(): OwnerId;
}
function curr_owner(this_: LoweringContext): PerOwnerLoweringStateView {
  return this_.curr_owner as PerOwnerLoweringStateView;
}
// ---- end PORT(pending-gen) ---------------------------------------------------------------------------------------

// rustc: compiler/rustc_ast_lowering/src/pat.rs:18 lower_pat
LoweringContext.prototype.lower_pat = function (this: LoweringContext, pattern: Pat): hir.Pat {
  return this.arena.alloc(this.lower_pat_mut(pattern));
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:22 lower_pat_mut
LoweringContext.prototype.lower_pat_mut = function (this: LoweringContext, pattern: Pat): hir.Pat {
  // loop here to avoid recursion
  const pat_hir_id = this.lower_node_id(pattern.id);
  let node: hir.PatKind;
  loop: for (;;) {
    const kind = pattern.kind;
    switch (kind.$) {
      case "Missing":
        node = hir.PatKind.Missing;
        break loop;
      case "Wild":
        node = hir.PatKind.Wild;
        break loop;
      case "Never":
        node = hir.PatKind.Never;
        break loop;
      case "Ident": {
        const [binding_mode, ident, sub] = [kind._0, kind._1, kind._2];
        const lower_sub = (this_: LoweringContext): hir.Pat | undefined =>
          sub === undefined ? undefined : this_.lower_pat(sub);
        node = this.lower_pat_ident(pattern, clone_BindingMode(binding_mode), ident, pat_hir_id, lower_sub);
        break loop;
      }
      case "Expr": {
        node = { $: "Expr", _0: this.lower_expr_within_pat(kind._0, false) };
        break loop;
      }
      case "TupleStruct": {
        const [qself, path, pats] = [kind._0, kind._1, kind._2];
        const qpath = this.lower_qpath(
          pattern.id,
          qself,
          path,
          "Optional",
          "No",
          { $: "Disallowed", _0: "Path" },
          undefined,
        );
        const [pats_, ddpos] = this.lower_pat_tuple(pats, "tuple struct");
        node = { $: "TupleStruct", _0: qpath, _1: pats_, _2: ddpos };
        break loop;
      }
      case "Or": {
        const pats = kind._0;
        node = { $: "Or", _0: this.arena.alloc_from_iter(pats.map((x) => this.lower_pat_mut(x))) };
        break loop;
      }
      case "Path": {
        const [qself, path] = [kind._0, kind._1];
        const qpath = this.lower_qpath(
          pattern.id,
          qself,
          path,
          "Optional",
          "No",
          { $: "Disallowed", _0: "Path" },
          undefined,
        );
        const kind_: hir.PatExprKind = { $: "Path", _0: qpath };
        const span = this.lower_span(pattern.span);
        const expr_: hir.PatExpr = { hir_id: pat_hir_id, span, kind: kind_ };
        const expr = this.arena.alloc(expr_);
        return new hir.Pat(this.next_id(), { $: "Expr", _0: expr }, span, true);
      }
      case "Struct": {
        const [qself, path, fields, etc] = [kind._0, kind._1, kind._2, kind._3];
        const qpath = this.lower_qpath(
          pattern.id,
          qself,
          path,
          "Optional",
          "No",
          { $: "Disallowed", _0: "Path" },
          undefined,
        );

        const fs = this.arena.alloc_from_iter(
          fields.map((f): hir.PatField => {
            const hir_id = this.lower_node_id(f.id);
            this.lower_attrs(hir_id, f.attrs, f.span, Target.PatField);

            return {
              hir_id,
              ident: this.lower_ident(f.ident),
              pat: this.lower_pat(f.pat),
              is_shorthand: f.is_shorthand,
              span: this.lower_span(f.span),
            };
          }),
        );
        let rest: Span | undefined;
        switch (etc.$) {
          case "Rest":
            rest = this.lower_span(etc._0);
            break;
          case "Recovered":
            rest = DUMMY_SP;
            break;
          default:
            rest = undefined;
        }
        node = { $: "Struct", _0: qpath, _1: fs, _2: rest };
        break loop;
      }
      case "Tuple": {
        const [pats, ddpos] = this.lower_pat_tuple(kind._0, "tuple");
        node = { $: "Tuple", _0: pats, _1: ddpos };
        break loop;
      }
      case "Deref": {
        node = { $: "Deref", _0: this.lower_pat(kind._0) };
        break loop;
      }
      case "Ref": {
        const [inner, pinned, mutbl] = [kind._0, kind._1, kind._2];
        node = { $: "Ref", _0: this.lower_pat(inner), _1: pinned, _2: mutbl };
        break loop;
      }
      case "Range": {
        const [e1, e2, end] = [kind._0, kind._1, kind._2.node];
        node = {
          $: "Range",
          _0: e1 === undefined ? undefined : this.lower_expr_within_pat(e1, true),
          _1: e2 === undefined ? undefined : this.lower_expr_within_pat(e2, true),
          _2: this.lower_range_end(end, e2 !== undefined),
        };
        break loop;
      }
      case "Guard": {
        const [inner, guard] = [kind._0, kind._1];
        node = { $: "Guard", _0: this.lower_pat(inner), _1: this.lower_expr(guard.cond) };
        break loop;
      }
      case "Slice":
        node = this.lower_pat_slice(kind._0);
        break loop;
      case "Rest": {
        // If we reach here the `..` pattern is not semantically allowed.
        node = this.ban_illegal_rest_pat(pattern.span);
        break loop;
      }
      // return inner to be processed in next loop
      case "Paren":
        pattern = kind._0;
        break;
      case "MacCall": {
        return panic(`${format_debug(pattern, debug_Pat, PRETTY)} shouldn't exist here`);
      }
      case "Err":
        node = { $: "Err", _0: kind._0 };
        break loop;
    }
  }

  return this.pat_with_node_id_of(pattern, node, pat_hir_id);
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:152 lower_pat_tuple
LoweringContext.prototype.lower_pat_tuple = function (
  this: LoweringContext,
  pats: readonly Pat[],
  ctx: string,
): [readonly hir.Pat[], hir.DotDotPos] {
  const elems: hir.Pat[] = [];
  let rest: [number, Span] | undefined = undefined;

  // `let mut iter = pats.iter().enumerate(); for (idx, pat) in iter.by_ref() { .. }`: `idx` is the iterator's
  // position, shared by both loops.
  let idx = 0;
  while (idx < pats.length) {
    const pat = pats[idx]!;
    idx += 1;
    // Interpret the first `..` pattern as a sub-tuple pattern.
    // Note that unlike for slice patterns,
    // where `xs @ ..` is a legal sub-slice pattern,
    // it is not a legal sub-tuple pattern.
    const kind = pat.kind;
    // Found a sub-tuple rest pattern
    if (kind.$ === "Rest") {
      rest = [idx - 1, pat.span];
      break;
    }
    // Found a sub-tuple pattern `$binding_mode $ident @ ..`.
    // This is not allowed as a sub-tuple pattern
    else if (kind.$ === "Ident" && kind._2 !== undefined && kind._2.is_rest()) {
      const ident = kind._1;
      const sp = pat.span;
      this.dcx().emit_err(
        diagnostics_.SubTupleBinding_diagnostic({
          span: sp,
          ident_name: ident.name,
          ident: ident,
          ctx,
        }),
      );
    }

    // It was not a sub-tuple pattern so lower it normally.
    elems.push(this.lower_pat_mut(pat));
  }

  for (; idx < pats.length; idx++) {
    const pat = pats[idx]!;
    // There was a previous sub-tuple pattern; make sure we don't allow more...
    if (pat.is_rest()) {
      // ...but there was one again, so error.
      this.ban_extra_rest_pat(pat.span, unwrap(rest)[1], ctx);
    } else {
      elems.push(this.lower_pat_mut(pat));
    }
  }

  return [this.arena.alloc_from_iter(elems), hir.DotDotPos.new(rest === undefined ? undefined : rest[0])];
};

/// Lower a slice pattern of form `[pat_0, ..., pat_n]` into
/// `hir::PatKind::Slice(before, slice, after)`.
///
/// When encountering `($binding_mode $ident @)? ..` (`slice`),
/// this is interpreted as a sub-slice pattern semantically.
/// Patterns that follow, which are not like `slice` -- or an error occurs, are in `after`.
// rustc: compiler/rustc_ast_lowering/src/pat.rs:209 lower_pat_slice
LoweringContext.prototype.lower_pat_slice = function (this: LoweringContext, pats: readonly Pat[]): hir.PatKind {
  const before: hir.Pat[] = [];
  const after: hir.Pat[] = [];
  let slice: hir.Pat | undefined = undefined;
  let prev_rest_span: Span | undefined = undefined;

  // Lowers `$bm $ident @ ..` to `$bm $ident @ _`.
  const lower_rest_sub = (this_: LoweringContext, pat: Pat, ann: BindingMode, ident: Ident, sub: Pat): hir.Pat => {
    const sub_hir_id = this_.lower_node_id(sub.id);
    const lower_sub = (this__: LoweringContext): hir.Pat | undefined =>
      this__.pat_wild_with_node_id_of(sub, sub_hir_id);
    const pat_hir_id = this_.lower_node_id(pat.id);
    const node = this_.lower_pat_ident(pat, clone_BindingMode(ann), ident, pat_hir_id, lower_sub);
    return this_.pat_with_node_id_of(pat, node, pat_hir_id);
  };

  // `let mut iter = pats.iter();` shared by both loops.
  let i = 0;
  // Lower all the patterns until the first occurrence of a sub-slice pattern.
  while (i < pats.length) {
    const pat = pats[i]!;
    i += 1;
    const kind = pat.kind;
    // Found a sub-slice pattern `..`. Record, lower it to `_`, and stop here.
    if (kind.$ === "Rest") {
      prev_rest_span = pat.span;
      const hir_id = this.lower_node_id(pat.id);
      slice = this.pat_wild_with_node_id_of(pat, hir_id);
      break;
    }
    // Found a sub-slice pattern `$binding_mode $ident @ ..`.
    // Record, lower it to `$binding_mode $ident @ _`, and stop here.
    else if (kind.$ === "Ident" && kind._2 !== undefined && kind._2.is_rest()) {
      const sub = kind._2;
      prev_rest_span = sub.span;
      slice = this.arena.alloc(lower_rest_sub(this, pat, kind._0, kind._1, sub));
      break;
    }
    // It was not a subslice pattern so lower it normally.
    else {
      before.push(this.lower_pat_mut(pat));
    }
  }

  // Lower all the patterns after the first sub-slice pattern.
  for (; i < pats.length; i++) {
    const pat = pats[i]!;
    // There was a previous subslice pattern; make sure we don't allow more.
    let rest_span: Span | undefined;
    const kind = pat.kind;
    if (kind.$ === "Rest") {
      rest_span = pat.span;
    } else if (kind.$ === "Ident" && kind._2 !== undefined && kind._2.is_rest()) {
      const sub = kind._2;
      // #69103: Lower into `binding @ _` as above to avoid ICEs.
      after.push(lower_rest_sub(this, pat, kind._0, kind._1, sub));
      rest_span = sub.span;
    } else {
      rest_span = undefined;
    }
    if (rest_span !== undefined) {
      // We have e.g., `[a, .., b, ..]`. That's no good, error!
      this.ban_extra_rest_pat(rest_span, unwrap(prev_rest_span), "slice");
    } else {
      // Lower the pattern normally.
      after.push(this.lower_pat_mut(pat));
    }
  }

  return {
    $: "Slice",
    _0: this.arena.alloc_from_iter(before),
    _1: slice,
    _2: this.arena.alloc_from_iter(after),
  };
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:275 lower_pat_ident
LoweringContext.prototype.lower_pat_ident = function (
  this: LoweringContext,
  p: Pat,
  annotation: BindingMode,
  ident: Ident,
  hir_id: HirId,
  lower_sub: (this_: LoweringContext) => hir.Pat | undefined,
): hir.PatKind {
  const partial_res = this.get_partial_res(p.id);
  const res = partial_res === undefined ? undefined : partial_res.expect_full_res();
  // `None` can occur in body-less function signatures
  if (res === undefined || res.$ === "Local") {
    let binding_id: HirId;
    if (res !== undefined && res.$ === "Local") {
      const id = res._0;
      // In `Or` patterns like `VariantA(s) | VariantB(s, _)`, multiple identifier patterns
      // will be resolved to the same `Res::Local`. Thus they just share a single
      // `HirId`.
      if (id === p.id) {
        curr_owner(this).ident_and_label_to_local_id.set(id, hir_id.local_id);
        binding_id = hir_id;
      } else {
        const owner = curr_owner(this).owner_id();
        const local_id = unwrap(curr_owner(this).ident_and_label_to_local_id.get(id), "no entry found for key");
        binding_id = new hir.HirId(owner, local_id);
      }
    } else {
      curr_owner(this).ident_and_label_to_local_id.set(p.id, hir_id.local_id);
      binding_id = hir_id;
    }
    return { $: "Binding", _0: annotation, _1: binding_id, _2: this.lower_ident(ident), _3: lower_sub(this) };
  } else {
    const res_ = this.lower_res(res);
    const span = this.lower_span(ident.span);
    // `hir::PatExpr { kind: .., hir_id: self.next_id(), span }`: the fields in source order.
    const segments = [hir.PathSegment.new(this.lower_ident(ident), this.next_id(), res_)];
    const path = this.arena.alloc(new hir.Path(span, res_, segments));
    const kind: hir.PatExprKind = { $: "Path", _0: { $: "Resolved", _0: undefined, _1: path } };
    const expr: hir.PatExpr = { kind, hir_id: this.next_id(), span };
    return { $: "Expr", _0: this.arena.alloc(expr) };
  }
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:332 pat_wild_with_node_id_of
LoweringContext.prototype.pat_wild_with_node_id_of = function (this: LoweringContext, p: Pat, hir_id: HirId): hir.Pat {
  return this.arena.alloc(this.pat_with_node_id_of(p, hir.PatKind.Wild, hir_id));
};

/// Construct a `Pat` with the `HirId` of `p.id` already lowered.
// rustc: compiler/rustc_ast_lowering/src/pat.rs:337 pat_with_node_id_of
LoweringContext.prototype.pat_with_node_id_of = function (
  this: LoweringContext,
  p: Pat,
  kind: hir.PatKind,
  hir_id: HirId,
): hir.Pat {
  return new hir.Pat(hir_id, kind, this.lower_span(p.span), true);
};

/// Emit a friendly error for extra `..` patterns in a tuple/tuple struct/slice pattern.
// rustc: compiler/rustc_ast_lowering/src/pat.rs:347 ban_extra_rest_pat
LoweringContext.prototype.ban_extra_rest_pat = function (this: LoweringContext, sp: Span, prev_sp: Span, ctx: string): void {
  this.dcx().emit_err(diagnostics_.ExtraDoubleDot_diagnostic({ span: sp, prev_span: prev_sp, ctx }));
};

/// Used to ban the `..` pattern in places it shouldn't be semantically.
// rustc: compiler/rustc_ast_lowering/src/pat.rs:352 ban_illegal_rest_pat
LoweringContext.prototype.ban_illegal_rest_pat = function (this: LoweringContext, sp: Span): hir.PatKind {
  this.dcx().emit_err(diagnostics_.MisplacedDoubleDot_diagnostic({ span: sp }));

  // We're not in a list context so `..` can be reasonably treated
  // as `_` because it should always be valid and roughly matches the
  // intent of `..` (notice that the rest of a single slot is that slot).
  return hir.PatKind.Wild;
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:361 lower_range_end
LoweringContext.prototype.lower_range_end = function (this: LoweringContext, e: RangeEnd, has_end: boolean): hir.RangeEnd {
  if (e.$ === "Excluded" && has_end) {
    return "Excluded";
  }
  // No end; so `X..` behaves like `RangeFrom`.
  return "Included";
};

/// Matches `'-' lit | lit (cf. parser::Parser::parse_literal_maybe_minus)`,
/// or paths for ranges.
//
// FIXME: do we want to allow `expr -> pattern` conversion to create path expressions?
// That means making this work:
//
// ```rust,ignore (FIXME)
// struct S;
// macro_rules! m {
//     ($a:expr) => {
//         let $a = S;
//     }
// }
// m!(S);
// ```
// rustc: compiler/rustc_ast_lowering/src/pat.rs:384 lower_expr_within_pat
LoweringContext.prototype.lower_expr_within_pat = function (
  this: LoweringContext,
  expr: Expr,
  allow_paths: boolean,
): hir.PatExpr {
  const span = this.lower_span(expr.span);
  const err = (guar: ErrorGuaranteed): hir.PatExprKind => ({
    $: "Lit",
    lit: respan(span, { $: "Err", _0: guar }),
    negated: false,
  });
  let kind: hir.PatExprKind;
  const ek = expr.kind;
  if (ek.$ === "Lit") {
    kind = { $: "Lit", lit: this.lower_lit(ek._0, span), negated: false };
  } else if (ek.$ === "IncludedBytes") {
    kind = {
      $: "Lit",
      lit: respan(span, { $: "ByteStr", _0: ek._0, _1: { $: "Cooked" } }),
      negated: false,
    };
  } else if (ek.$ === "Err") {
    kind = err(ek._0);
  } else if (ek.$ === "Dummy") {
    return span_bug(span, "lowered ExprKind::Dummy");
  } else if (ek.$ === "Path" && allow_paths) {
    kind = {
      $: "Path",
      _0: this.lower_qpath(expr.id, ek._0, ek._1, "Optional", "No", { $: "Disallowed", _0: "Path" }, undefined),
    };
  } else if (ek.$ === "Unary" && ek._0 === "Neg" && ek._1.kind.$ === "Lit") {
    const lit = ek._1.kind._0;
    kind = { $: "Lit", lit: this.lower_lit(lit, span), negated: true };
  } else {
    const is_const_block = expr.kind.$ === "ConstBlock";
    const peeled = expr.peel_parens().kind;
    const pattern_from_macro =
      expr.is_approximately_pattern() || (peeled.$ === "Binary" && peeled._0.node === "BitOr");
    const guar = this.dcx().emit_err(
      diagnostics_.ArbitraryExpressionInPattern_diagnostic({
        span,
        pattern_from_macro_note: pattern_from_macro,
        const_block_in_pattern_help: is_const_block,
      }),
    );
    kind = err(guar);
  }
  return this.arena.alloc({ hir_id: this.lower_node_id(expr.id), span, kind });
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:432 lower_ty_pat
LoweringContext.prototype.lower_ty_pat = function (this: LoweringContext, pattern: TyPat, base_type: Span): hir.TyPat {
  return this.arena.alloc(this.lower_ty_pat_mut(pattern, base_type));
};

// rustc: compiler/rustc_ast_lowering/src/pat.rs:440 lower_ty_pat_mut
LoweringContext.prototype.lower_ty_pat_mut = function (this: LoweringContext, pattern: TyPat, base_type: Span): hir.TyPat {
  // loop here to avoid recursion
  const pat_hir_id = this.lower_node_id(pattern.id);
  let node: hir.TyPatKind;
  const kind = pattern.kind;
  switch (kind.$) {
    case "Range": {
      const [e1, e2, end, span] = [kind._0, kind._1, kind._2.node, kind._2.span];
      const _0 =
        e1 !== undefined
          ? this.lower_anon_const_to_const_arg_and_alloc(e1)
          : this.lower_ty_pat_range_end("RangeMin", Span.shrink_to_lo(span), base_type);
      let _1: hir.ConstArg;
      if (e2 !== undefined) {
        switch (end.$) {
          case "Included":
            _1 = this.lower_anon_const_to_const_arg_and_alloc(e2);
            break;
          case "Excluded":
            _1 = this.lower_excluded_range_end(e2);
            break;
        }
      } else {
        _1 = this.lower_ty_pat_range_end("RangeMax", Span.shrink_to_hi(span), base_type);
      }
      node = { $: "Range", _0, _1 };
      break;
    }
    case "NotNull":
      node = hir.TyPatKind.NotNull;
      break;
    case "Or": {
      const variants = kind._0;
      node = { $: "Or", _0: this.arena.alloc_from_iter(variants.map((pat) => this.lower_ty_pat_mut(pat, base_type))) };
      break;
    }
    case "Err":
      node = { $: "Err", _0: kind._0 };
      break;
  }

  return { hir_id: pat_hir_id, kind: node, span: this.lower_span(pattern.span) };
};

/// Lowers the range end of an exclusive range (`2..5`) to an inclusive range 2..=(5 - 1).
/// This way the type system doesn't have to handle the distinction between inclusive/exclusive ranges.
// rustc: compiler/rustc_ast_lowering/src/pat.rs:481 lower_excluded_range_end
LoweringContext.prototype.lower_excluded_range_end = function (this: LoweringContext, e: AnonConst): hir.ConstArg {
  const span = this.lower_span(e.value.span);
  const unstable_span = this.mark_span_with_reason(DesugaringKind.PatTyRange, span, ALLOW_PATTERN_TYPE);
  const anon_const = this.with_new_scopes(span, (this_): hir.AnonConst => {
    const def_id = this_.local_def_id(e.id);
    const hir_id = this_.lower_node_id(e.id);
    const body = this_.lower_body((this__) => {
      // Need to use a custom function as we can't just subtract `1` from a `char`.
      const kind: hir.ExprKind = {
        $: "Path",
        _0: this__.make_lang_item_qpath("RangeSub", unstable_span, undefined),
      };
      const fn_def = this__.arena.alloc(new hir.Expr(this__.next_id(), kind, span));
      const args = this__.arena.alloc([this__.lower_expr_mut(e.value)]);
      return [[], new hir.Expr(this__.next_id(), { $: "Call", _0: fn_def, _1: args }, span)];
    });
    return { def_id, hir_id, body, span };
  });
  return this.arena.alloc(new hir.ConstArg<null>(this.next_id(), { $: "Anon", _0: this.arena.alloc(anon_const) }, span));
};

/// When a range has no end specified (`1..` or `1..=`) or no start specified (`..5` or `..=5`),
/// we instead use a constant of the MAX/MIN of the type.
/// This way the type system does not have to handle the lack of a start/end.
// rustc: compiler/rustc_ast_lowering/src/pat.rs:521 lower_ty_pat_range_end
LoweringContext.prototype.lower_ty_pat_range_end = function (
  this: LoweringContext,
  lang_item: LangItem,
  span: Span,
  base_type: Span,
): hir.ConstArg {
  const node_id = this.next_node_id();

  // Add a definition for the in-band const def.
  // We're generating a range end that didn't exist in the AST,
  // so the def collector didn't create the def ahead of time. That's why we have to do
  // it here.
  const def_id = this.create_def(node_id, undefined, DefKind.AnonConst, span);
  const hir_id = this.lower_node_id(node_id);

  const unstable_span = this.mark_span_with_reason(DesugaringKind.PatTyRange, this.lower_span(span), ALLOW_PATTERN_TYPE);
  const span_ = this.lower_span(base_type);

  const path_expr = new hir.Expr(
    this.next_id(),
    { $: "Path", _0: this.make_lang_item_qpath(lang_item, unstable_span, undefined) },
    span_,
  );

  const ct = this.with_new_scopes(span_, (this_): hir.AnonConst => {
    const body = this_.lower_body((_this) => [[], path_expr]);
    return this.arena.alloc({ def_id, hir_id, body, span: span_ });
  });
  const hir_id_ = this.next_id();
  return this.arena.alloc(new hir.ConstArg<null>(hir_id_, { $: "Anon", _0: ct }, span_));
};
