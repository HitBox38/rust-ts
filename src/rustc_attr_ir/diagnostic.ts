// Port of compiler/rustc_attr_ir/src/diagnostic.rs
//! Contains the data structures used by the diagnostic attribute family.
//
// Types and derived Debug/Clone/Default/PrintAttribute impls are generated into diagnostic.gen.ts
// (tools/codegen/types.ts).
//
// PORT: methods of the generated classes are attached to their prototypes (`declare module`); enum
// methods live on companion consts (PORTING §8). `impl FnMut(..)` parameters are plain callbacks.
// `tracing::debug!` events are kept as comments (no subscriber in rust-ts).
import type { Span } from "../rustc_span/lib.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { display_Symbol, kw, Symbol } from "../rustc_span/symbol.ts";
import * as gen from "./diagnostic.gen.ts";
import { default_CustomDiagnostic, type FilterFormatString, type FormatArgs, type FormatString, type NameValue } from "./diagnostic.gen.ts";

export * from "./diagnostic.gen.ts";

declare module "./diagnostic.gen.ts" {
  interface Directive {
    visit_params(visit: (sym: Symbol, span: Span) => void): void;
    eval(filter_options: FilterOptions | undefined, args: FormatArgs): CustomDiagnostic;
  }
  interface CustomDiagnostic {
    update(di: Directive, args: FormatArgs): void;
  }
  interface FormatString {
    format(args: FormatArgs): string;
    visit_params(visit: (sym: Symbol, span: Span) => void): void;
  }
  interface Filter {
    matches_predicate(options: FilterOptions): boolean;
    visit_params(visit: (sym: Symbol, span: Span) => void): void;
  }
  interface NameValue {
    visit_params(span: Span, visit: (sym: Symbol, span: Span) => void): void;
  }
  interface FilterFormatString {
    format(generic_args: readonly [Symbol, string][]): string;
    visit_params(span: Span, visit: (sym: Symbol, span: Span) => void): void;
  }
  interface FilterOptions {
    has_flag(name: Flag): boolean;
    contains(name: Name, value: string): boolean;
  }
}

export type Directive = gen.Directive;
export const Directive = gen.Directive;

/// Visit all the generic arguments used in the attribute, to see whether they are actually a
/// generic of the item. If not then `visit` must issue a diagnostic.
///
/// We can't check this while parsing the attribute because `rustc_attr_parsing` doesn't have
/// access to the item an attribute is on. Instead we later call this function in `check_attr`.
// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:30 visit_params
Directive.prototype.visit_params = function (this: Directive, visit: (sym: Symbol, span: Span) => void): void {
  for (const [filter, subcommand] of this.filters) {
    filter.visit_params(visit);
    subcommand.visit_params(visit);
  }

  if (this.message !== undefined) {
    const [, message] = this.message;
    message.visit_params(visit);
  }
  if (this.label !== undefined) {
    const [, label] = this.label;
    label.visit_params(visit);
  }

  for (const note of this.notes) {
    note.visit_params(visit);
  }

  if (this.parent_label !== undefined) {
    const [, parent_label] = this.parent_label;
    parent_label.visit_params(visit);
  }
};

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:52 eval
Directive.prototype.eval = function (this: Directive, filter_options: FilterOptions | undefined, args: FormatArgs): CustomDiagnostic {
  // let this = &args.this;
  // debug!("Directive::eval({self:?}, this={this}, options={filter_options:?}, args ={args:?})");

  const ret = default_CustomDiagnostic();

  if (filter_options !== undefined) {
    for (const [filter, directive] of this.filters) {
      if (filter.matches_predicate(filter_options)) {
        // debug!("eval: {filter:?} succeeded");
        ret.update(directive, args);
      } else {
        // debug!("eval: skipping {filter:?} due to {filter_options:?}");
      }
    }
  } else {
    // debug_assert!(
    //     !self.is_rustc_attr,
    //     "Directive::eval called for `rustc_on_unimplemented` without `filter_options`"
    // );
  }
  ret.update(this, args);
  return ret;
};

export type CustomDiagnostic = gen.CustomDiagnostic;
export const CustomDiagnostic = gen.CustomDiagnostic;

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:94 update
CustomDiagnostic.prototype.update = function (this: CustomDiagnostic, di: Directive, args: FormatArgs): void {
  if (this.message === undefined) {
    this.message = di.message === undefined ? undefined : di.message[1].format(args);
  }
  if (this.label === undefined) {
    this.label = di.label === undefined ? undefined : di.label[1].format(args);
  }
  if (this.parent_label === undefined) {
    this.parent_label = di.parent_label === undefined ? undefined : di.parent_label[1].format(args);
  }

  this.notes.push(...di.notes.map((n) => n.format(args)));
};

/// Formats the format string.
///
/// This is a private method, use `Directive::eval` instead. A diagnostic attribute being used
/// should issue a `tracing` event, which `Directive::eval` does.
// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:123 format
gen.FormatString.prototype.format = function (this: FormatString, args: FormatArgs): string {
  let ret = "";
  for (const piece of this.pieces) {
    // Piece::Lit(s) | Piece::Arg(FormatArg::AsIs(s)) => ret.push_str(s.as_str()),
    if (piece.$ === "Lit") {
      const s = piece._0;
      ret += Symbol.as_str(s);
      continue;
    }
    const arg = piece._0;
    switch (arg.$) {
      case "AsIs": {
        const s = arg._0;
        ret += Symbol.as_str(s);
        break;
      }

      // `A` if we have `trait Trait<A> {}` and `note = "i'm the actual type of {A}"`
      case "GenericParam": {
        const generic_param = arg.generic_param;
        const found = args.generic_args.find(([p]) => p === generic_param);
        if (found !== undefined) {
          const [, val] = found;
          ret += val;
        } else {
          // Apparently this was not actually a generic parameter, so lets write
          // what the user wrote.
          ret += `{${display_Symbol(generic_param)}}`;
        }
        break;
      }
      // `{Self}`
      case "SelfUpper": {
        const found = args.generic_args.find(([p]) => p === kw.SelfUpper);
        const slf = found !== undefined ? found[1] : "Self";
        ret += slf;
        break;
      }
      case "This":
        ret += args.this;
        break;

      // only for on_type_error
      case "Found":
        ret += args.found;
        break;
      case "Expected":
        ret += args.expected;
        break;

      // only for on_unknown
      case "Unresolved":
        ret += args.unresolved;
        break;

      // It's only `rustc_onunimplemented` from here
      case "ThisPath":
        ret += args.this_path;
        break;
      case "ThisResolved":
        ret += args.this_resolved;
        break;
      case "ItemContext":
        ret += args.item_context;
        break;
    }
  }
  return ret;
};

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:169 visit_params
gen.FormatString.prototype.visit_params = function (this: FormatString, visit: (sym: Symbol, span: Span) => void): void {
  for (const piece of this.pieces) {
    if (piece.$ === "Arg" && piece._0.$ === "GenericParam") {
      const { generic_param, span } = piece._0;
      visit(generic_param, span);
    }
  }
};

export type Filter = gen.Filter;
export const Filter = gen.Filter;

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:265 matches_predicate
Filter.prototype.matches_predicate = function (this: Filter, options: FilterOptions): boolean {
  return Predicate.eval(this.pred, (p) => {
    switch (p.$) {
      case "Flag": {
        const b = p._0;
        return options.has_flag(b);
      }
      case "NameValue": {
        const { name, value } = p._0;
        const formatted = value.format(options.generic_args);
        return options.contains(name, formatted);
      }
    }
  });
};

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:275 visit_params
Filter.prototype.visit_params = function (this: Filter, visit: (sym: Symbol, span: Span) => void): void {
  Predicate.visit_params(this.pred, this.span, visit);
};

export type Predicate = gen.Predicate;
// PORT: no generated companion (no unit variants).
export const Predicate = {
  // rustc: compiler/rustc_attr_ir/src/diagnostic.rs:299 eval
  eval(self: Predicate, eval_: (p: gen.FlagOrNv) => boolean): boolean {
    switch (self.$) {
      case "Flag": {
        const flag = self._0;
        return eval_({ $: "Flag", _0: flag });
      }
      case "Match": {
        const nv = self._0;
        return eval_({ $: "NameValue", _0: nv });
      }
      case "Not": {
        const not = self._0;
        return !Predicate.eval(not, eval_);
      }
      case "All": {
        const preds = self._0;
        return preds.every((pred) => Predicate.eval(pred, eval_));
      }
      case "Any": {
        const preds = self._0;
        return preds.some((pred) => Predicate.eval(pred, eval_));
      }
    }
  },

  // rustc: compiler/rustc_attr_ir/src/diagnostic.rs:309 visit_params
  visit_params(self: Predicate, span: Span, visit: (sym: Symbol, span: Span) => void): void {
    switch (self.$) {
      case "Flag":
        break;
      case "Match": {
        const nv = self._0;
        nv.visit_params(span, visit);
        break;
      }
      case "Not": {
        const not = self._0;
        Predicate.visit_params(not, span, visit);
        break;
      }
      case "All":
      case "Any": {
        const preds = self._0;
        preds.forEach((pred) => Predicate.visit_params(pred, span, visit));
        break;
      }
    }
  },
};

export type Flag = gen.Flag;
export const Flag = gen.Flag;

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:347 visit_params
gen.NameValue.prototype.visit_params = function (this: NameValue, span: Span, visit: (sym: Symbol, span: Span) => void): void {
  if (this.name.$ === "GenericArg") {
    const arg = this.name._0;
    visit(arg, span);
  }
  this.value.visit_params(span, visit);
};

export type Name = gen.Name;
export const Name = gen.Name;

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:382 format
gen.FilterFormatString.prototype.format = function (this: FilterFormatString, generic_args: readonly [Symbol, string][]): string {
  let ret = "";

  for (const piece of this.pieces) {
    switch (piece.$) {
      case "Lit": {
        const s = piece._0;
        ret += Symbol.as_str(s);
        break;
      }
      case "Arg": {
        const s = piece._0;
        const found = generic_args.find(([k]) => k === s);
        if (found !== undefined) {
          const [, val] = found;
          ret += val;
        } else {
          ret += `{${display_Symbol(s)}}`;
        }
        break;
      }
    }
  }

  return ret;
};
// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:399 visit_params
gen.FilterFormatString.prototype.visit_params = function (this: FilterFormatString, span: Span, visit: (sym: Symbol, span: Span) => void): void {
  for (const piece of this.pieces) {
    if (piece.$ === "Arg") {
      const arg = piece._0;
      visit(arg, span);
    }
  }
};

export type FilterOptions = gen.FilterOptions;
export const FilterOptions = gen.FilterOptions;

// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:468 has_flag
FilterOptions.prototype.has_flag = function (this: FilterOptions, name: Flag): boolean {
  switch (name) {
    case "CrateLocal":
      return this.crate_local;
    case "Direct":
      return this.direct;
    case "FromDesugaring":
      return this.from_desugaring !== undefined;
  }
};
// rustc: compiler/rustc_attr_ir/src/diagnostic.rs:475 contains
FilterOptions.prototype.contains = function (this: FilterOptions, name: Name, value: string): boolean {
  switch (name.$) {
    case "SelfUpper":
      return this.self_types.includes(value);
    case "FromDesugaring":
      return this.from_desugaring !== undefined && DesugaringKind.matches(this.from_desugaring, value);
    case "Cause":
      return this.cause === value;
    case "GenericArg": {
      const arg = name._0;
      return this.generic_args.some(([a, v]) => a === arg && v === value);
    }
  }
};
