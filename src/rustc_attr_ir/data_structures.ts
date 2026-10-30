// Port of compiler/rustc_attr_ir/src/data_structures.rs
// Types and derived Debug/Clone/PrintAttribute impls are generated into data_structures.gen.ts
// (tools/codegen/types.ts).
//
// PORT: enum methods live on the companion consts (PORTING §8); the generated companions (unit-variant
// singletons / string tables) are spread into them here. Methods of generated classes are attached
// to their prototypes (`declare module`), statics are typed on the re-exported class const.
// `impl IntoDiagArg for T` -> `T_into_diag_arg(self, path)`, `impl Display` -> `display_T(self)`.
import { RustcVersion, RustcVersion_cmp } from "../rustc_ast/attr/version.ts";
import { DiffActivity, DiffMode } from "../rustc_ast/expand/autodiff_attrs.ts";
import { debug_TypeTree, type TypeTree } from "../rustc_ast/expand/typetree.ts";
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span, SpanEncoder } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import * as gen from "./data_structures.gen.ts";
import { encode_CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import { encode_bool, encode_IndexMap, encode_Option, encode_ThinVec, encode_tuple } from "../rustc_serialize/serialize.ts";
import { type AutoDiffItem, debug_RustcAutodiff, DocCfgHideShowValue as DocCfgHideShowValueC, RustcAutodiff as RustcAutodiffC } from "./data_structures.gen.ts";
import { encode_cross_crate, is_extern_indicator } from "./encode_cross_crate.ts";

export * from "./data_structures.gen.ts";
// pub use rustc_ast::attr::data_structures::*;
export * from "../rustc_ast/attr/data_structures.ts";
// pub use rustc_ast::attr::version::RustcVersion;
export { RustcVersion, debug_RustcVersion } from "../rustc_ast/attr/version.ts";
// pub use crate::canonical_symbols::{CanonicalSymbol, CanonicalSymbols};
export { type CanonicalSymbol, CanonicalSymbols, debug_CanonicalSymbol, debug_CanonicalSymbols } from "./canonical_symbols.ts";

declare module "./data_structures.gen.ts" {
  interface Deprecation {
    is_in_effect(): boolean;
    is_since_rustc_version(): boolean;
  }
  interface StrippedCfgItem<ScopeId> {
    map_scope_id<New>(f: (scope_id: ScopeId) => New): StrippedCfgItem<New>;
  }
  interface RustcAutodiff {
    has_primal_ret(): boolean;
    has_ret_activity(): boolean;
    has_active_only_ret(): boolean;
    is_active(): boolean;
    is_source(): boolean;
    apply_autodiff(): boolean;
    into_item(source: string, target: string, inputs: TypeTree[], output: TypeTree): AutoDiffItem;
  }
}

export type InlineAttr = gen.InlineAttr;
export const InlineAttr = {
  ...gen.InlineAttr,

  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:91 always
  always(self: InlineAttr): boolean {
    switch (self.$) {
      case "Always":
      case "Force":
        return true;
      case "None":
      case "Hint":
      case "Never":
        return false;
    }
  },
};

export type OptimizeAttr = gen.OptimizeAttr;
export const OptimizeAttr = {
  ...gen.OptimizeAttr,

  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:137 do_not_optimize
  do_not_optimize(self: OptimizeAttr): boolean {
    return self === "DoNotOptimize";
  },
};

// pub use ReprAttr::*;
// PORT: the unit variants, as values (the tuple variants are object literals).
export const { ReprRust, ReprC, ReprSimd, ReprTransparent } = gen.ReprAttr;

export type Deprecation = gen.Deprecation;
export const Deprecation = gen.Deprecation;

/// Whether an item marked with #[deprecated(since = "X")] is currently
/// deprecated (i.e., whether X is not greater than the current rustc
/// version).
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:224 is_in_effect
Deprecation.prototype.is_in_effect = function (this: Deprecation): boolean {
  const since = this.since;
  switch (since.$) {
    case "RustcVersion":
      return RustcVersion_cmp(since._0, RustcVersion.CURRENT) <= 0;
    case "Future":
      return false;
    // The `since` field doesn't have semantic purpose without `#![staged_api]`.
    case "NonStandard":
      return true;
    // Assume deprecation is in effect if "since" field is absent or invalid.
    case "Unspecified":
    case "Err":
      return true;
  }
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:235 is_since_rustc_version
Deprecation.prototype.is_since_rustc_version = function (this: Deprecation): boolean {
  return this.since.$ === "RustcVersion";
};

export type MacroUseArgs = gen.MacroUseArgs;
export const MacroUseArgs = {
  ...gen.MacroUseArgs,

  // impl Default for MacroUseArgs
  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:260 default
  default(): MacroUseArgs {
    return { $: "UseSpecific", _0: [] };
  },
};

export type StrippedCfgItem<ScopeId = DefId> = gen.StrippedCfgItem<ScopeId>;
export const StrippedCfgItem = gen.StrippedCfgItem;

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:273 map_scope_id
StrippedCfgItem.prototype.map_scope_id = function <ScopeId, New>(this: StrippedCfgItem<ScopeId>, f: (scope_id: ScopeId) => New): StrippedCfgItem<New> {
  return new gen.StrippedCfgItem<New>(f(this.parent_scope), this.ident, this.cfg);
};

// impl IntoDiagArg for MirDialect
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:304 into_diag_arg
export function MirDialect_into_diag_arg(self: gen.MirDialect, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  let arg: string;
  switch (self) {
    case "Analysis":
      arg = "analysis";
      break;
    case "Built":
      arg = "built";
      break;
    case "Runtime":
      arg = "runtime";
      break;
  }
  return { $: "Str", _0: arg };
}

// impl IntoDiagArg for MirPhase
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:323 into_diag_arg
export function MirPhase_into_diag_arg(self: gen.MirPhase, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  let arg: string;
  switch (self) {
    case "Initial":
      arg = "initial";
      break;
    case "PostCleanup":
      arg = "post-cleanup";
      break;
    case "Optimized":
      arg = "optimized";
      break;
  }
  return { $: "Str", _0: arg };
}

export type WindowsSubsystemKind = gen.WindowsSubsystemKind;
export const WindowsSubsystemKind = {
  ...gen.WindowsSubsystemKind,

  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:394 as_str
  as_str(self: WindowsSubsystemKind): string {
    switch (self) {
      case "Console":
        return "console";
      case "Windows":
        return "windows";
    }
  },
};

export type DocCfgHideShowValue = gen.DocCfgHideShowValue;
export const DocCfgHideShowValue = DocCfgHideShowValueC as typeof DocCfgHideShowValueC & {
  new: (value: Symbol, span: Span) => DocCfgHideShowValue;
  new_none: (span: Span) => DocCfgHideShowValue;
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:424 new
DocCfgHideShowValue.new = function (value: Symbol, span: Span): DocCfgHideShowValue {
  return new DocCfgHideShowValueC(span, value);
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:428 new_none
DocCfgHideShowValue.new_none = function (span: Span): DocCfgHideShowValue {
  return new DocCfgHideShowValueC(span, undefined);
};

export type DocCfgHideShow = gen.DocCfgHideShow;
// PORT: no generated companion (no unit variants). `&mut self` methods that replace the whole value
// (`*s = Self::Any(..)`) take a `MutRef<DocCfgHideShow>` (PORTING §8); `push_none` only pushes into the
// `List` vector and takes the value itself.
export const DocCfgHideShow = {
  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:440 new
  new(): DocCfgHideShow {
    return { $: "List", _0: [] };
  },

  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:444 new_with_only_key
  new_with_only_key(span: Span): DocCfgHideShow {
    const values: DocCfgHideShowValue[] = [];
    values.push(new DocCfgHideShowValueC(span, undefined));
    return { $: "List", _0: values };
  },

  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:450 push_none
  push_none(self: DocCfgHideShow, span: Span): void {
    if (self.$ === "List" && !self._0.some((v) => v.value === undefined)) {
      const values = self._0;
      values.push(new DocCfgHideShowValueC(span, undefined));
    }
  },

  // rustc: compiler/rustc_attr_ir/src/data_structures.rs:458 merge_with
  merge_with(self: MutRef<DocCfgHideShow>, other: DocCfgHideShow): void {
    const s = self.value;
    if (s.$ === "Any" && (other.$ === "Any" || other.$ === "List")) {
      // Nothing to do.
    } else if (other.$ === "Any") {
      const span = other._0;
      // We "upgrade" the list values to "all".
      self.value = { $: "Any", _0: span };
    } else if (s.$ === "List" && other.$ === "List") {
      const values = s._0;
      const other_values = other._0;
      // Having duplicates is not an issue, we simply ignore them. Would be more
      // convenient to have a `set` type though. T_T
      for (const other of other_values) {
        if (!values.some((value) => value.value === other.value)) {
          values.push(gen.clone_DocCfgHideShowValue(other));
        }
      }
    }
  },
};

// impl<E: rustc_span::SpanEncoder> rustc_serialize::Encodable<E> for DocAttribute
// PORT (lane encode-contract): `rustc_serialize::Encodable::<E>::encode(x, encoder)` of each field is the derived /
// rustc_span impl of its type (`Span` / `Symbol`: the `SpanEncoder` methods).
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:523 encode
export function encode_DocAttribute(self: gen.DocAttribute, encoder: SpanEncoder): void {
  const {
    first_span,
    aliases,
    hidden,
    inline,
    cfg,
    auto_cfg,
    auto_cfg_change,
    fake_variadic,
    keyword,
    attribute,
    masked,
    notable_trait,
    search_unbox,
    html_favicon_url,
    html_logo_url,
    html_playground_url,
    html_root_url,
    html_no_source,
    issue_tracker_base_url,
    rust_logo,
    test_attrs,
    no_crate_inject,
  } = self;
  const span = (v: Span, e: SpanEncoder): void => e.encode_span(v);
  const symbol_span = (v: readonly [Symbol, Span], e: SpanEncoder): void => encode_tuple(v, e, (s, e) => e.encode_symbol(s), span);
  span(first_span, encoder);
  encode_IndexMap(aliases, encoder, (s, e) => e.encode_symbol(s), span);
  encode_Option(hidden, encoder, span);

  // FIXME: The `doc(inline)` attribute is never encoded, but is it actually the right thing
  // to do? I suspect the condition was broken, should maybe instead not encode anything if we
  // have `doc(no_inline)`.
  const inline_ = inline !== undefined && inline[0] !== gen.DocInline.Inline ? inline : undefined;
  encode_Option(inline_, encoder, (v, e) => encode_tuple(v, e, gen.encode_DocInline, span));

  encode_ThinVec(cfg, encoder, encode_CfgEntry);
  encode_ThinVec(auto_cfg, encoder, (v, e) => encode_tuple(v, e, gen.encode_CfgHideShow, span));
  encode_ThinVec(auto_cfg_change, encoder, (v, e) => encode_tuple(v, e, encode_bool, span));
  encode_Option(fake_variadic, encoder, span);
  encode_Option(keyword, encoder, symbol_span);
  encode_Option(attribute, encoder, symbol_span);
  encode_Option(masked, encoder, span);
  encode_Option(notable_trait, encoder, span);
  encode_Option(search_unbox, encoder, span);
  encode_Option(html_favicon_url, encoder, symbol_span);
  encode_Option(html_logo_url, encoder, symbol_span);
  encode_Option(html_playground_url, encoder, symbol_span);
  encode_Option(html_root_url, encoder, symbol_span);
  encode_Option(html_no_source, encoder, span);
  encode_Option(issue_tracker_base_url, encoder, symbol_span);
  encode_Option(rust_logo, encoder, span);
  encode_ThinVec(test_attrs, encoder, span);
  encode_Option(no_crate_inject, encoder, span);
}

export type RustcAutodiff = gen.RustcAutodiff;
export const RustcAutodiff = RustcAutodiffC as typeof RustcAutodiffC & {
  error: () => RustcAutodiff;
  source: () => RustcAutodiff;
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:647 has_primal_ret
RustcAutodiff.prototype.has_primal_ret = function (this: RustcAutodiff): boolean {
  return this.ret_activity.$ === "Active" || this.ret_activity.$ === "Dual";
};

// PORT: `DiffActivity` derives `PartialEq`; comparing against a unit variant is a tag check.
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:653 has_ret_activity
RustcAutodiff.prototype.has_ret_activity = function (this: RustcAutodiff): boolean {
  return this.ret_activity.$ !== "None";
};
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:656 has_active_only_ret
RustcAutodiff.prototype.has_active_only_ret = function (this: RustcAutodiff): boolean {
  return this.ret_activity.$ === "ActiveOnly";
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:660 error
RustcAutodiff.error = function (): RustcAutodiff {
  // RustcAutodiff { mode: DiffMode::Error, width: 0, ret_activity: DiffActivity::None, input_activity: ThinVec::new() }
  return new RustcAutodiffC(DiffMode.Error, 0, [], DiffActivity.None);
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:669 source
RustcAutodiff.source = function (): RustcAutodiff {
  // RustcAutodiff { mode: DiffMode::Source, width: 0, ret_activity: DiffActivity::None, input_activity: ThinVec::new() }
  return new RustcAutodiffC(DiffMode.Source, 0, [], DiffActivity.None);
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:678 is_active
RustcAutodiff.prototype.is_active = function (this: RustcAutodiff): boolean {
  return this.mode !== DiffMode.Error;
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:682 is_source
RustcAutodiff.prototype.is_source = function (this: RustcAutodiff): boolean {
  return this.mode === DiffMode.Source;
};
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:685 apply_autodiff
RustcAutodiff.prototype.apply_autodiff = function (this: RustcAutodiff): boolean {
  return !(this.mode === DiffMode.Error || this.mode === DiffMode.Source);
};

// rustc: compiler/rustc_attr_ir/src/data_structures.rs:689 into_item
RustcAutodiff.prototype.into_item = function (this: RustcAutodiff, source: string, target: string, inputs: TypeTree[], output: TypeTree): AutoDiffItem {
  return { source, target, attrs: this, inputs, output };
};

// impl fmt::Display for AutoDiffItem
// rustc: compiler/rustc_attr_ir/src/data_structures.rs:713 fmt
export function display_AutoDiffItem(self: AutoDiffItem): string {
  let f = `Differentiating ${self.source} -> ${self.target}`;
  f += ` with attributes: ${debug_RustcAutodiff(self.attrs, PLAIN)}`;
  f += ` with inputs: ${debug_vec(self.inputs, PLAIN, debug_TypeTree)}`;
  f += ` with output: ${debug_TypeTree(self.output, PLAIN)}`;
  return f;
}

export type AttributeKind = gen.AttributeKind;
// PORT: `impl AttributeKind` of encode_cross_crate.rs (methods on the companion, PORTING §8).
export const AttributeKind = {
  ...gen.AttributeKind,
  encode_cross_crate,
  is_extern_indicator,
};
