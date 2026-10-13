// Port of compiler/rustc_builtin_macros/src/contracts.rs
import { token, tokenstream } from "../rustc_ast/lib.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { type AttrProcMacro, AttrProcMacro_provided, type ExtCtxt } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Ident, kw, type Symbol } from "../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../std/result.ts";

type TokenStream = tokenstream.TokenStream;
type TokenTree = tokenstream.TokenTree;
const { DelimSpacing, DelimSpan, Spacing, TokenStream, clone_TokenTree } = tokenstream;

// pub(crate) struct ExpandRequires;
// pub(crate) struct ExpandEnsures;

/** `impl AttrProcMacro for ExpandRequires` */
export const ExpandRequires: AttrProcMacro = AttrProcMacro_provided({
  // rustc: compiler/rustc_builtin_macros/src/contracts.rs:13 expand
  expand(ecx: ExtCtxt, span: Span, annotation: TokenStream, annotated: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    return expand_contract_clause_tts(ecx, span, annotation, annotated, kw.ContractRequires);
  },
});

/** `impl AttrProcMacro for ExpandEnsures` */
export const ExpandEnsures: AttrProcMacro = AttrProcMacro_provided({
  // rustc: compiler/rustc_builtin_macros/src/contracts.rs:25 expand
  expand(ecx: ExtCtxt, span: Span, annotation: TokenStream, annotated: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    return expand_contract_clause_tts(ecx, span, annotation, annotated, kw.ContractEnsures);
  },
});

/// Expand the function signature to include the contract clause.
///
/// The contracts clause will be injected before the function body and the optional where clause.
/// For that, we search for the body / where token, and invoke the `inject` callback to generate the
/// contract clause in the right place.
///
// FIXME: this kind of manual token tree munging does not have significant precedent among
// rustc builtin macros, probably because most builtin macros use direct AST manipulation to
// accomplish similar goals. But since our attributes need to take arbitrary expressions, and
// our attribute infrastructure does not yet support mixing a token-tree annotation with an AST
// annotated, we end up doing token tree manipulation.
// rustc: compiler/rustc_builtin_macros/src/contracts.rs:47 expand_contract_clause
function expand_contract_clause(
  ecx: ExtCtxt,
  attr_span: Span,
  annotated: TokenStream,
  inject: (new_tts: TokenTree[]) => Result<undefined, ErrorGuaranteed>,
): Result<TokenStream, ErrorGuaranteed> {
  const new_tts: TokenTree[] = [];
  const cursor = annotated.iter();

  const is_kw = (tt: TokenTree, sym: Symbol): boolean => {
    if (tt.$ === "Token") {
      return tt._0.is_ident_named(sym);
    } else {
      return false;
    }
  };

  // Find the `fn` keyword to check if this is a function.
  // PORT: `cursor.find(|tt| { new_tts.push(tt.clone()); is_kw(tt, kw::Fn) }).is_none()`.
  let found = false;
  for (let tt = cursor.next(); tt !== undefined; tt = cursor.next()) {
    new_tts.push(clone_TokenTree(tt));
    if (is_kw(tt, kw.Fn)) {
      found = true;
      break;
    }
  }
  if (!found) {
    return Err(ecx.sess.dcx().span_err(attr_span, "contract annotations can only be used on functions"));
  }

  // Contracts are not yet supported on async/gen functions
  if (new_tts.some((tt) => is_kw(tt, kw.Async) || is_kw(tt, kw.Gen))) {
    return Err(ecx.sess.dcx().span_err(attr_span, "contract annotations are not yet supported on async or gen functions"));
  }

  // Found the `fn` keyword, now find either the `where` token or the function body.
  let next_tt: TokenTree;
  for (;;) {
    const tt = cursor.next();
    if (tt === undefined) {
      return Err(ecx.sess.dcx().span_err(attr_span, "contract annotations is only supported in functions with bodies"));
    }
    // If `tt` is the last element. Check if it is the function body.
    if (cursor.peek() === undefined) {
      if (tt.$ === "Delimited" && tt._2.$ === "Brace") {
        next_tt = tt;
        break;
      } else {
        return Err(ecx.sess.dcx().span_err(attr_span, "contract annotations is only supported in functions with bodies"));
      }
    }

    if (is_kw(tt, kw.Where)) {
      next_tt = tt;
      break;
    }
    new_tts.push(clone_TokenTree(tt));
  }

  // At this point, we've transcribed everything from the `fn` through the formal parameter list
  // and return type declaration, (if any), but `tt` itself has *not* been transcribed.
  //
  // Now inject the AST contract form.
  //
  const r = inject(new_tts);
  if (r.$ === "Err") return r;

  // Above we injected the internal AST requires/ensures construct. Now copy over all the other
  // token trees.
  new_tts.push(clone_TokenTree(next_tt));
  for (let tt = cursor.next(); tt !== undefined; tt = cursor.next()) {
    new_tts.push(clone_TokenTree(tt));
    if (cursor.peek() === undefined && !(tt.$ === "Delimited" && tt._2.$ === "Brace")) {
      return Err(ecx.sess.dcx().span_err(attr_span, "contract annotations is only supported in functions with bodies"));
    }
  }

  return Ok(TokenStream.new(new_tts));
}

// rustc: compiler/rustc_builtin_macros/src/contracts.rs:133 expand_contract_clause_tts
function expand_contract_clause_tts(
  ecx: ExtCtxt,
  attr_span: Span,
  annotation: TokenStream,
  annotated: TokenStream,
  clause_keyword: Symbol,
): Result<TokenStream, ErrorGuaranteed> {
  if (annotation.is_empty()) {
    const [name, example] = clause_keyword === kw.ContractRequires ? ["requires", "condition"] : ["ensures", "|result: &T| condition"];
    ecx.sess.dcx().span_err(attr_span, `\`${name}\` attribute requires an argument, e.g., \`#[${name}(${example})]\``);
    // Returning `Err` would replace it with a dummy fragment and cause cascading name-resolution errors.
    // Instead, we return the original token stream so that there is no later noises.
    return Ok(annotated);
  }

  const feature_span = ecx.with_def_site_ctxt(attr_span);
  return expand_contract_clause(ecx, attr_span, annotated, (new_tts) => {
    new_tts.push({ $: "Token", _0: token.Token.from_ast_ident(Ident.new(clause_keyword, feature_span)), _1: Spacing.Joint });
    new_tts.push({
      $: "Delimited",
      _0: DelimSpan.from_single(attr_span),
      _1: DelimSpacing.new(Spacing.JointHidden, Spacing.JointHidden),
      _2: token.Delimiter.Brace,
      _3: annotation,
    });
    return Ok(undefined);
  });
}
