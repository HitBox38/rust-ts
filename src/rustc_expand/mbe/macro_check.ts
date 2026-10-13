// Port of compiler/rustc_expand/src/mbe/macro_check.rs
//! Checks that meta-variables in macro definition are correctly declared and used.
//!
//! # What is checked
//!
//! ## Meta-variables must not be bound twice
//!
//! ```compile_fail
//! macro_rules! foo { ($x:tt $x:tt) => { $x }; }
//! ```
//!
//! This check is sound (no false-negative) and complete (no false-positive).
//!
//! ## Meta-variables must not be free
//!
//! ```
//! macro_rules! foo { () => { $x }; }
//! ```
//!
//! This check is also done at macro instantiation but only if the branch is taken.
//!
//! ## Meta-variables must repeat at least as many times as their binder
//!
//! ```
//! macro_rules! foo { ($($x:tt)*) => { $x }; }
//! ```
//!
//! This check is also done at macro instantiation but only if the branch is taken.
//!
//! ## Meta-variables must repeat with the same Kleene operators as their binder
//!
//! ```
//! macro_rules! foo { ($($x:tt)+) => { $($x)* }; }
//! ```
//!
//! This check is not done at macro instantiation.
//!
//! # Disclaimer
//!
//! In the presence of nested macros (a macro defined in a macro), those checks may have false
//! positives and false negatives. We try to detect those cases by recognizing potential macro
//! definitions in RHSes, but nested macros may be hidden through the use of particular values of
//! meta-variables.
//!
//! ## Examples of false positive
//!
//! False positives can come from cases where we don't recognize a nested macro, because it depends
//! on particular values of meta-variables. In the following example, we think both instances of
//! `$x` are free, which is a correct statement if `$name` is anything but `macro_rules`. But when
//! `$name` is `macro_rules`, like in the instantiation below, then `$x:tt` is actually a binder of
//! the nested macro and `$x` is bound to it.
//!
//! ```
//! macro_rules! foo { ($name:ident) => { $name! bar { ($x:tt) => { $x }; } }; }
//! foo!(macro_rules);
//! ```
//!
//! False positives can also come from cases where we think there is a nested macro while there
//! isn't. In the following example, we think `$x` is free, which is incorrect because `bar` is not
//! a nested macro since it is not evaluated as code by `stringify!`.
//!
//! ```
//! macro_rules! foo { () => { stringify!(macro_rules! bar { () => { $x }; }) }; }
//! ```
//!
//! ## Examples of false negative
//!
//! False negatives can come from cases where we don't recognize a meta-variable, because it depends
//! on particular values of meta-variables. In the following examples, we don't see that if `$d` is
//! instantiated with `$` then `$d z` becomes `$z` in the nested macro definition and is thus a free
//! meta-variable. Note however, that if `foo` is instantiated, then we would check the definition
//! of `bar` and would see the issue.
//!
//! ```
//! macro_rules! foo { ($d:tt) => { macro_rules! bar { ($y:tt) => { $d z }; } }; }
//! ```
//!
//! # How it is checked
//!
//! There are 3 main functions: `check_binders`, `check_occurrences`, and `check_nested_macro`. They
//! all need some kind of environment.
//!
//! ## Environments
//!
//! Environments are used to pass information.
//!
//! ### From LHS to RHS
//!
//! When checking a LHS with `check_binders`, we produce (and use) an environment for binders,
//! namely `Binders`. This is a mapping from binder name to information about that binder: the span
//! of the binder for error messages and the stack of Kleene operators under which it was bound in
//! the LHS.
//!
//! This environment is used by both the LHS and RHS. The LHS uses it to detect duplicate binders.
//! The RHS uses it to detect the other errors.
//!
//! ### From outer macro to inner macro
//!
//! When checking the RHS of an outer macro and we detect a nested macro definition, we push the
//! current state, namely `MacroState`, to an environment of nested macro definitions. Each state
//! stores the LHS binders when entering the macro definition as well as the stack of Kleene
//! operators under which the inner macro is defined in the RHS.
//!
//! This environment is a stack representing the nesting of macro definitions. As such, the stack of
//! Kleene operators under which a meta-variable is repeating is the concatenation of the stacks
//! stored when entering a macro definition starting from the state in which the meta-variable is
//! bound.

import { token } from "../../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../../rustc_ast/node_id.ts";
import type { NodeId } from "../../rustc_ast/node_id.ts";
import type { TokenKind } from "../../rustc_ast/token.ts";
import type { DecorateDiagCompat } from "../../rustc_errors/lib.ts";
import type { Diagnostic } from "../../rustc_errors/diagnostic.ts";
import { META_VARIABLE_MISUSE } from "../../rustc_lint_defs/builtin.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { kw, MacroRulesNormalizedIdent } from "../../rustc_span/symbol.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type KleeneToken, MetaVarExpr, TokenTree } from "../mbe.ts";
import { MacroRulesIdentMap } from "./macro_parser.ts";
import type { Layout } from "../../rust_ts/hash_map.ts";
import { type DuplicateMatcherBinding, type DuplicateMatcherBindingLint, DuplicateMatcherBindingLint_diagnostic, DuplicateMatcherBinding_diagnostic, type MetaVarStillRepeatingLint, MetaVarStillRepeatingLint_diagnostic, type MetaVariableWrongOperator, MetaVariableWrongOperator_diagnostic, type UnknownMacroVariable, UnknownMacroVariable_diagnostic } from "../diagnostics.ts";


const { TokenKind: TokenKindC } = token;

/// Stack represented as linked list.
///
/// Those are used for environments because they grow incrementally and are not mutable.
// rustc-type: compiler/rustc_expand/src/mbe/macro_check.rs:123 Stack
type Stack<T> =
  /// Empty stack.
  | { readonly $: "Empty" }
  /// A non-empty stack.
  | {
      readonly $: "Push";
      /// The top element.
      top: T;
      /// The previous elements.
      prev: Stack<T>;
    };

const EMPTY: Stack<never> = Object.freeze({ $: "Empty" as const });

// impl<'a, T> Stack<'a, T> (methods on the companion, PORTING §8)
const Stack = {
  Empty: EMPTY,

  /// Returns whether a stack is empty.
  // rustc: compiler/rustc_expand/src/mbe/macro_check.rs:137 is_empty
  is_empty<T>(self: Stack<T>): boolean {
    return self.$ === "Empty";
  },

  /// Returns a new stack with an element of top.
  // rustc: compiler/rustc_expand/src/mbe/macro_check.rs:142 push
  push<T>(self: Stack<T>, top: T): Stack<T> {
    return { $: "Push", top, prev: self };
  },

  /** `impl<'a, T> Iterator for &'a Stack<'a, T>`: `for x in stack`. */
  iter<T>(self: Stack<T>): StackIter<T> {
    return new StackIter(self);
  },
};

/** `&'a Stack<'a, T>` used as an iterator. */
class StackIter<T> implements Iterable<T> {
  constructor(private self: Stack<T>) {}

  // Iterates from top to bottom of the stack.
  // rustc: compiler/rustc_expand/src/mbe/macro_check.rs:151 next
  next(): T | undefined {
    const self = this.self;
    switch (self.$) {
      case "Empty":
        return undefined;
      case "Push": {
        const { top, prev } = self;
        this.self = prev;
        return top;
      }
    }
  }

  /** `Iterator::find_map` */
  find_map<R>(f: (x: T) => R | undefined): R | undefined {
    for (let x = this.next(); x !== undefined; x = this.next()) {
      const r = f(x);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}

// impl From<&Stack<'_, KleeneToken>> for SmallVec<[KleeneToken; 1]>
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:163 from
function kleene_ops_from(ops_: Stack<KleeneToken>): KleeneToken[] {
  const ops: KleeneToken[] = [...Stack.iter(ops_)];
  // The stack is innermost on top. We want outermost first.
  ops.reverse();
  return ops;
}

/// Information attached to a meta-variable binder in LHS.
// rustc-type: compiler/rustc_expand/src/mbe/macro_check.rs:172 BinderInfo
interface BinderInfo {
  /// The span of the meta-variable in LHS.
  span: Span;
  /// The stack of Kleene operators (outermost first).
  ops: KleeneToken[];
}

/// An environment of meta-variables to their binder information.
type Binders = MacroRulesIdentMap<BinderInfo>;
/// PORT: `Layout::new::<BinderInfo>()` is not reproduced exactly: it holds a `Span`, so it is at least
/// 8 bytes (align 4). Binders are never iterated, and on the oracle host hashbrown's placement only
/// depends on whether `size_of::<(K, V)>() <= 1` (see macro_parser.ts `LAYOUT_NamedMatch`).
const LAYOUT_BinderInfo: Layout = { size: 8, align: 4 };

/// The state at which we entered a macro definition in the RHS of another macro definition.
// rustc-type: compiler/rustc_expand/src/mbe/macro_check.rs:183 MacroState
interface MacroState {
  /// The binders of the branch where we entered the macro definition.
  binders: Binders;
  /// The stack of Kleene operators (outermost first) where we entered the macro definition.
  ops: KleeneToken[];
}

/// Checks that meta-variables are used correctly in one rule of a macro definition.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `args`, `lhs`, and `rhs` represent the rule
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:196 check_meta_variables
export function check_meta_variables(
  psess: ParseSess,
  node_id: NodeId,
  args: TokenTree | undefined,
  lhs: TokenTree,
  rhs: TokenTree,
): Result<undefined, ErrorGuaranteed> {
  const guar: MutRef<ErrorGuaranteed | undefined> = { value: undefined };
  const binders: Binders = MacroRulesIdentMap.default(LAYOUT_BinderInfo);
  if (args !== undefined) {
    check_binders(psess, node_id, args, Stack.Empty, binders, Stack.Empty, guar);
  }
  check_binders(psess, node_id, lhs, Stack.Empty, binders, Stack.Empty, guar);
  check_occurrences(psess, node_id, rhs, Stack.Empty, binders, Stack.Empty, guar);
  return guar.value === undefined ? Ok(undefined) : Err(guar.value);
}

/// Checks `lhs` as part of the LHS of a macro definition.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `lhs` is checked as part of a LHS
/// - `macros` is the stack of possible outer macros
/// - `binders` contains the binders of the LHS
/// - `ops` is the stack of Kleene operators from the LHS
/// - `guar` is set in case of errors
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:223 check_binders
function check_binders(
  psess: ParseSess,
  node_id: NodeId,
  lhs: TokenTree,
  macros: Stack<MacroState>,
  binders: Binders,
  ops: Stack<KleeneToken>,
  guar: MutRef<ErrorGuaranteed | undefined>,
): void {
  switch (lhs.$) {
    case "Token":
      break;
    // This can only happen when checking a nested macro because this LHS is then in the RHS of
    // the outer macro. See ui/macros/macro-of-higher-order.rs where $y:$fragment in the
    // LHS of the nested macro (and RHS of the outer macro) is parsed as MetaVar(y) Colon
    // MetaVar(fragment) and not as MetaVarDecl(y, fragment).
    case "MetaVar": {
      const span = lhs._0;
      if (Stack.is_empty(macros)) {
        psess.dcx().span_bug(span, "unexpected MetaVar in lhs");
      }
      const name = MacroRulesNormalizedIdent.new(lhs._1);
      // There are 3 possibilities:
      const prev_info = binders.get(name);
      if (prev_info !== undefined) {
        // 1. The meta-variable is already bound in the current LHS: This is an error.
        buffer_lint(psess, span, node_id, DuplicateMatcherBindingLint_diagnostic({ span, prev: prev_info.span }));
      } else if (get_binder_info(macros, binders, name) === undefined) {
        // 2. The meta-variable is free: This is a binder.
        binders.insert(name, { span, ops: kleene_ops_from(ops) });
      } else {
        // 3. The meta-variable is bound: This is an occurrence.
        check_occurrences(psess, node_id, lhs, macros, binders, ops, guar);
      }
      break;
    }
    // Similarly, this can only happen when checking a toplevel macro.
    case "MetaVarDecl": {
      const span = lhs.span;
      if (!Stack.is_empty(macros)) {
        psess.dcx().span_bug(span, "unexpected MetaVarDecl in nested lhs");
      }
      const name = MacroRulesNormalizedIdent.new(lhs.name);
      const prev_info = get_binder_info(macros, binders, name);
      if (prev_info !== undefined) {
        // Duplicate binders at the top-level macro definition are errors. The lint is only
        // for nested macro definitions.
        guar.value = psess.dcx().emit_err(
          DuplicateMatcherBinding_diagnostic({
            span,
            prev: prev_info.span,
          }),
        );
      } else {
        binders.insert(name, { span, ops: kleene_ops_from(ops) });
      }
      break;
    }
    // `MetaVarExpr` can not appear in the LHS of a macro arm
    case "MetaVarExpr":
      break;
    case "Delimited": {
      const del = lhs._2;
      for (const tt of del.tts) {
        check_binders(psess, node_id, tt, macros, binders, ops, guar);
      }
      break;
    }
    case "Sequence": {
      const seq = lhs._1;
      const ops_ = Stack.push(ops, seq.kleene);
      for (const tt of seq.tts) {
        check_binders(psess, node_id, tt, macros, binders, ops_, guar);
      }
      break;
    }
  }
}

/// Returns the binder information of a meta-variable.
///
/// Arguments:
/// - `macros` is the stack of possible outer macros
/// - `binders` contains the current binders
/// - `name` is the name of the meta-variable we are looking for
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:300 get_binder_info
function get_binder_info(macros: Stack<MacroState>, binders: Binders, name: MacroRulesNormalizedIdent): BinderInfo | undefined {
  return binders.get(name) ?? Stack.iter(macros).find_map((state) => state.binders.get(name));
}

/// Checks `rhs` as part of the RHS of a macro definition.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `rhs` is checked as part of a RHS
/// - `macros` is the stack of possible outer macros
/// - `binders` contains the binders of the associated LHS
/// - `ops` is the stack of Kleene operators from the RHS
/// - `guar` is set in case of errors
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:318 check_occurrences
function check_occurrences(
  psess: ParseSess,
  node_id: NodeId,
  rhs: TokenTree,
  macros: Stack<MacroState>,
  binders: Binders,
  ops: Stack<KleeneToken>,
  guar: MutRef<ErrorGuaranteed | undefined>,
): void {
  switch (rhs.$) {
    case "Token":
      break;
    case "MetaVarDecl":
      return psess.dcx().span_bug(rhs.span, "unexpected MetaVarDecl in rhs");
    case "MetaVar": {
      const span = rhs._0;
      const name = MacroRulesNormalizedIdent.new(rhs._1);
      check_ops_is_prefix(psess, node_id, macros, binders, ops, span, name);
      break;
    }
    case "MetaVarExpr": {
      const dl = rhs._0;
      const mve = rhs._1;
      MetaVarExpr.for_each_metavar(mve, undefined, (_, ident) => {
        const name = MacroRulesNormalizedIdent.new(ident);
        check_ops_is_prefix(psess, node_id, macros, binders, ops, dl.entire(), name);
        return undefined;
      });
      break;
    }
    case "Delimited": {
      const del = rhs._2;
      check_nested_occurrences(psess, node_id, del.tts, macros, binders, ops, guar);
      break;
    }
    case "Sequence": {
      const seq = rhs._1;
      const ops_ = Stack.push(ops, seq.kleene);
      check_nested_occurrences(psess, node_id, seq.tts, macros, binders, ops_, guar);
      break;
    }
  }
}

/// Represents the processed prefix of a nested macro.
// rustc-type: compiler/rustc_expand/src/mbe/macro_check.rs:354 NestedMacroState
type NestedMacroState =
  /// Nothing that matches a nested macro definition was processed yet.
  | "Empty"
  /// The token `macro_rules` was processed.
  | "MacroRules"
  /// The tokens `macro_rules!` were processed.
  | "MacroRulesBang"
  /// The tokens `macro_rules!` followed by a name were processed. The name may be either directly
  /// an identifier or a meta-variable (that hopefully would be instantiated by an identifier).
  | "MacroRulesBangName"
  /// The keyword `macro` was processed.
  | "Macro"
  /// The keyword `macro` followed by a name was processed.
  | "MacroName"
  /// The keyword `macro` followed by a name and a token delimited by parentheses was processed.
  | "MacroNameParen";

/// Checks `tts` as part of the RHS of a macro definition, tries to recognize nested macro
/// definitions.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `tts` is checked as part of a RHS and may contain macro definitions
/// - `macros` is the stack of possible outer macros
/// - `binders` contains the binders of the associated LHS
/// - `ops` is the stack of Kleene operators from the RHS
/// - `guar` is set in case of errors
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:383 check_nested_occurrences
function check_nested_occurrences(
  psess: ParseSess,
  node_id: NodeId,
  tts: readonly TokenTree[],
  macros: Stack<MacroState>,
  binders: Binders,
  ops: Stack<KleeneToken>,
  guar: MutRef<ErrorGuaranteed | undefined>,
): void {
  let state: NestedMacroState = "Empty";
  const nested_macros = Stack.push(macros, { binders, ops: kleene_ops_from(ops) });
  let nested_binders: Binders = MacroRulesIdentMap.default(LAYOUT_BinderInfo);
  for (const tt of tts) {
    // PORT: `match (state, tt)`: the arms in upstream order; a guard that fails falls through to
    // the next arm, as in Rust.
    if (
      state === "Empty" &&
      tt.$ === "Token" &&
      tt._0.kind.$ === "Ident" &&
      (tt._0.kind._1 === "Normal" || tt._0.kind._1 === "ForcedKeyword")
    ) {
      const name = tt._0.kind._0;
      if (name === kw.MacroRules) {
        state = "MacroRules";
      } else if (name === kw.Macro) {
        state = "Macro";
      }
    } else if (state === "MacroRules" && tt.$ === "Token" && tt._0.kind.$ === "Bang") {
      state = "MacroRulesBang";
    } else if (state === "MacroRulesBang" && tt.$ === "Token" && tt._0.kind.$ === "Ident") {
      state = "MacroRulesBangName";
    } else if (state === "MacroRulesBang" && tt.$ === "MetaVar") {
      state = "MacroRulesBangName";
      // We check that the meta-variable is correctly used.
      check_occurrences(psess, node_id, tt, macros, binders, ops, guar);
    } else if (
      (state === "MacroRulesBangName" || state === "MacroName") &&
      tt.$ === "Delimited" &&
      tt._2.delim.$ === "Brace"
    ) {
      const del = tt._2;
      const macro_rules = state === "MacroRulesBangName";
      state = "Empty";
      const rest = check_nested_macro(psess, node_id, macro_rules, del.tts, nested_macros, guar);
      // If we did not check the whole macro definition, then check the rest as if outside
      // the macro definition.
      check_nested_occurrences(psess, node_id, del.tts.slice(rest), macros, binders, ops, guar);
    } else if (state === "Macro" && tt.$ === "Token" && tt._0.kind.$ === "Ident") {
      state = "MacroName";
    } else if (state === "Macro" && tt.$ === "MetaVar") {
      state = "MacroName";
      // We check that the meta-variable is correctly used.
      check_occurrences(psess, node_id, tt, macros, binders, ops, guar);
    } else if (state === "MacroName" && tt.$ === "Delimited" && tt._2.delim.$ === "Parenthesis") {
      state = "MacroNameParen";
      nested_binders = MacroRulesIdentMap.default(LAYOUT_BinderInfo);
      check_binders(psess, node_id, tt, nested_macros, nested_binders, Stack.Empty, guar);
    } else if (state === "MacroNameParen" && tt.$ === "Delimited" && tt._2.delim.$ === "Brace") {
      state = "Empty";
      check_occurrences(psess, node_id, tt, nested_macros, nested_binders, Stack.Empty, guar);
    } else {
      state = "Empty";
      check_occurrences(psess, node_id, tt, macros, binders, ops, guar);
    }
  }
}

/// Checks the body of nested macro, returns where the check stopped.
///
/// The token trees are checked as long as they look like a list of (LHS) => {RHS} token trees. This
/// check is a best-effort to detect a macro definition. It returns the position in `tts` where we
/// stopped checking because we detected we were not in a macro definition anymore.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `macro_rules` specifies whether the macro is `macro_rules`
/// - `tts` is checked as a list of (LHS) => {RHS}
/// - `macros` is the stack of outer macros
/// - `guar` is set in case of errors
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:508 check_nested_macro
function check_nested_macro(
  psess: ParseSess,
  node_id: NodeId,
  macro_rules: boolean,
  tts: readonly TokenTree[],
  macros: Stack<MacroState>,
  guar: MutRef<ErrorGuaranteed | undefined>,
): number {
  const n = tts.length;
  let i = 0;
  const separator: TokenKind = macro_rules ? TokenKindC.Semi : TokenKindC.Comma;
  for (;;) {
    // We expect 3 token trees: `(LHS) => {RHS}`. The separator is checked after.
    if (
      i + 2 >= n ||
      !TokenTree.is_delimited(tts[i]!) ||
      !TokenTree.is_token(tts[i + 1]!, TokenKindC.FatArrow) ||
      !TokenTree.is_delimited(tts[i + 2]!)
    ) {
      break;
    }
    const lhs = tts[i]!;
    const rhs = tts[i + 2]!;
    const binders: Binders = MacroRulesIdentMap.default(LAYOUT_BinderInfo);
    check_binders(psess, node_id, lhs, macros, binders, Stack.Empty, guar);
    check_occurrences(psess, node_id, rhs, macros, binders, Stack.Empty, guar);
    // Since the last semicolon is optional for `macro_rules` macros and decl_macro are not terminated,
    // we increment our checked position by how many token trees we already checked (the 3
    // above) before checking for the separator.
    i += 3;
    if (i === n || !TokenTree.is_token(tts[i]!, separator)) {
      break;
    }
    // We increment our checked position for the semicolon.
    i += 1;
  }
  return i;
}

/// Checks that a meta-variable occurrence is valid.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `macros` is the stack of possible outer macros
/// - `binders` contains the binders of the associated LHS
/// - `ops` is the stack of Kleene operators from the RHS
/// - `span` is the span of the meta-variable to check
/// - `name` is the name of the meta-variable to check
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:556 check_ops_is_prefix
function check_ops_is_prefix(
  psess: ParseSess,
  node_id: NodeId,
  macros_: Stack<MacroState>,
  binders: Binders,
  ops: Stack<KleeneToken>,
  span: Span,
  name: MacroRulesNormalizedIdent,
): void {
  const macros = Stack.push(macros_, { binders, ops: kleene_ops_from(ops) });
  // Accumulates the stacks the operators of each state until (and including when) the
  // meta-variable is found. The innermost stack is first.
  const acc: KleeneToken[][] = [];
  for (const state of Stack.iter(macros)) {
    acc.push(state.ops);
    const binder = state.binders.get(name);
    if (binder !== undefined) {
      // This variable concatenates the stack of operators from the RHS of the LHS where the
      // meta-variable was defined to where it is used (in possibly nested macros). The
      // outermost operator is first.
      const occurrence_ops: KleeneToken[] = [];
      // We need to iterate from the end to start with outermost stack.
      for (let j = acc.length - 1; j >= 0; j--) {
        occurrence_ops.push(...acc[j]!);
      }
      ops_is_prefix(psess, node_id, span, name, binder.ops, occurrence_ops);
      return;
    }
  }
  buffer_lint(psess, span, node_id, UnknownMacroVariable_diagnostic({ name }));
}

/// Returns whether `binder_ops` is a prefix of `occurrence_ops`.
///
/// The stack of Kleene operators of a meta-variable occurrence just needs to have the stack of
/// Kleene operators of its binder as a prefix.
///
/// Consider $i in the following example:
/// ```ignore (illustrative)
/// ( $( $i:ident = $($j:ident),+ );* ) => { $($( $i += $j; )+)* }
/// ```
/// It occurs under the Kleene stack ["*", "+"] and is bound under ["*"] only.
///
/// Arguments:
/// - `psess` is used to emit diagnostics and lints
/// - `node_id` is used to emit lints
/// - `span` is the span of the meta-variable being check
/// - `name` is the name of the meta-variable being check
/// - `binder_ops` is the stack of Kleene operators for the binder
/// - `occurrence_ops` is the stack of Kleene operators for the occurrence
// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:605 ops_is_prefix
function ops_is_prefix(
  psess: ParseSess,
  node_id: NodeId,
  span: Span,
  ident: MacroRulesNormalizedIdent,
  binder_ops: readonly KleeneToken[],
  occurrence_ops: readonly KleeneToken[],
): void {
  for (let i = 0; i < binder_ops.length; i++) {
    const binder = binder_ops[i]!;
    if (i >= occurrence_ops.length) {
      buffer_lint(psess, span, node_id, MetaVarStillRepeatingLint_diagnostic({ label: binder.span, ident }));
      return;
    }
    const occurrence = occurrence_ops[i]!;
    if (occurrence.op !== binder.op) {
      buffer_lint(
        psess,
        span,
        node_id,
        MetaVariableWrongOperator_diagnostic({
          binder: binder.span,
          occurrence: occurrence.span,
        }),
      );
      return;
    }
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_check.rs:639 buffer_lint
function buffer_lint(psess: ParseSess, span: Span, node_id: NodeId, diag: DecorateDiagCompat | Diagnostic): void {
  // Macros loaded from other crates have dummy node ids.
  if (node_id !== DUMMY_NODE_ID) {
    psess.buffer_lint(META_VARIABLE_MISUSE, span, node_id, diag);
  }
}
