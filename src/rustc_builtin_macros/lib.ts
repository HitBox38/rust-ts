// Port of compiler/rustc_builtin_macros/src/lib.rs
//! This crate contains implementations of built-in macros and other code generating facilities
//! injecting code into the crate before it is lowered to HIR.
//
// PORT: `register_bang!` / `register_attr!` / `register_derive!` (decl macros) are expanded in place, one
// `register(..)` call per entry in upstream order:
// - `LegacyBang(Arc::new($f as MacroExpanderFn))` -> `TTMacroExpander_from_fn(f)`;
// - `LegacyAttr(Arc::new($f))` -> `MultiItemModifier_from_fn(f)` for fns (the blanket impl), or the
//   `MultiItemModifier` object itself (`cfg_accessible::Expander`, `derive::Expander { is_const }`);
// - `LegacyDerive(Arc::new(BuiltinDerive($f)))` -> `new BuiltinDerive(f)`.
// Modules owned by other lanes (asm, format, test, derive, deriving/*, eii, global_allocator, contracts)
// are stubs whose bodies are `unported` until those lanes land.

// rustc_expand (and through it rustc_ast / rustc_parse) is loaded first: the expanders use the
// `ExtCtxt` builder methods attached by rustc_expand/build.ts.
import "../rustc_expand/lib.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import {
  type BangProcMacro,
  type ExtCtxt,
  MultiItemModifier_from_fn,
  type ResolverExpand,
  type SyntaxExtensionKind,
  TTMacroExpander_from_fn,
} from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import * as alloc_error_handler from "./alloc_error_handler.ts";
import * as asm from "./asm.ts";
import * as assert from "./assert.ts";
import * as autodiff from "./autodiff.ts";
import * as cfg from "./cfg.ts";
import * as cfg_accessible from "./cfg_accessible.ts";
import * as cfg_eval from "./cfg_eval.ts";
import * as cfg_select from "./cfg_select.ts";
import * as compile_error from "./compile_error.ts";
import * as concat from "./concat.ts";
import * as concat_bytes from "./concat_bytes.ts";
import * as contracts from "./contracts.ts";
import * as define_opaque from "./define_opaque.ts";
import * as derive from "./derive.ts";
import { BuiltinDerive, clone, coerce_pointee, const_param_ty, copy, debug, default as default_, eq, from, hash, ord, partial_eq, partial_ord, reborrow } from "./deriving/mod.ts";
import * as edition_panic from "./edition_panic.ts";
import * as eii from "./eii.ts";
import * as env from "./env.ts";
import * as format from "./format.ts";
import * as gca from "./gca.ts";
import * as global_allocator from "./global_allocator.ts";
import * as iter from "./iter.ts";
import * as log_syntax from "./log_syntax.ts";
import * as offload from "./offload.ts";
import * as pattern_type from "./pattern_type.ts";
import * as source_util from "./source_util.ts";
import * as test from "./test.ts";
import * as test_binder_constraints from "./test_binder_constraints.ts";
import * as trace_macros from "./trace_macros.ts";
import * as view_type from "./view_type.ts";

// mod alloc_error_handler; mod assert; mod autodiff; mod cfg; mod cfg_accessible; mod cfg_eval;
// mod cfg_select; mod compile_error; mod concat; mod concat_bytes; mod define_opaque; mod derive;
// mod deriving; mod diagnostics; mod edition_panic; mod eii; mod env; mod format; mod format_foreign;
// mod gca; mod global_allocator; mod iter; mod log_syntax; mod offload; mod pattern_type;
// mod source_util; mod test; mod test_binder_constraints; mod trace_macros; mod view_type;

export * as asm from "./asm.ts";
export * as cmdline_attrs from "./cmdline_attrs.ts";
export * as contracts from "./contracts.ts";
// pub mod proc_macro_harness; (lane bm-rest)
export * as standard_library_imports from "./standard_library_imports.ts";
// pub mod test_harness; (lane bm-rest)
export * as util from "./util.ts";

// rustc: compiler/rustc_builtin_macros/src/lib.rs:70 register_builtin_macros
export function register_builtin_macros(resolver: ResolverExpand): void {
  const register = (name: Symbol, kind: SyntaxExtensionKind): void => resolver.register_builtin_macro(name, kind);
  const register_bang = (name: Symbol, f: (cx: ExtCtxt, sp: Span, tts: TokenStream) => ReturnType<typeof cfg.expand_cfg>): void =>
    register(name, { $: "LegacyBang", _0: TTMacroExpander_from_fn(f) });
  const register_attr = (name: Symbol, f: Parameters<typeof MultiItemModifier_from_fn>[0]): void =>
    register(name, { $: "LegacyAttr", _0: MultiItemModifier_from_fn(f) });
  const register_derive = (name: Symbol, f: ConstructorParameters<typeof BuiltinDerive>[0]): void =>
    register(name, { $: "LegacyDerive", _0: new BuiltinDerive(f) });

  // register_bang! {
  // tidy-alphabetical-start
  register_bang(sym.asm, asm.expand_asm);
  register_bang(sym.assert, assert.expand_assert);
  register_bang(sym.cfg, cfg.expand_cfg);
  register_bang(sym.cfg_select, cfg_select.expand_cfg_select);
  register_bang(sym.column, source_util.expand_column);
  register_bang(sym.compile_error, compile_error.expand_compile_error);
  register_bang(sym.concat, concat.expand_concat);
  register_bang(sym.concat_bytes, concat_bytes.expand_concat_bytes);
  register_bang(sym.const_format_args, format.expand_format_args);
  register_bang(sym.core_panic, edition_panic.expand_panic);
  register_bang(sym.env, env.expand_env);
  register_bang(sym.file, source_util.expand_file);
  register_bang(sym.format_args, format.expand_format_args);
  register_bang(sym.format_args_nl, format.expand_format_args_nl);
  register_bang(sym.gca, gca.expand);
  register_bang(sym.global_asm, asm.expand_global_asm);
  register_bang(sym.include, source_util.expand_include);
  register_bang(sym.include_bytes, source_util.expand_include_bytes);
  register_bang(sym.include_str, source_util.expand_include_str);
  register_bang(sym.iter, iter.expand);
  register_bang(sym.line, source_util.expand_line);
  register_bang(sym.log_syntax, log_syntax.expand_log_syntax);
  register_bang(sym.module_path, source_util.expand_mod);
  register_bang(sym.naked_asm, asm.expand_naked_asm);
  register_bang(sym.option_env, env.expand_option_env);
  register_bang(sym.pattern_type, pattern_type.expand);
  register_bang(sym.std_panic, edition_panic.expand_panic);
  register_bang(sym.stringify, source_util.expand_stringify);
  register_bang(sym.test_binder_constraints, test_binder_constraints.expand);
  register_bang(sym.trace_macros, trace_macros.expand_trace_macros);
  register_bang(sym.unreachable, edition_panic.expand_unreachable);
  register_bang(sym.view_type, view_type.expand);
  // tidy-alphabetical-end
  // }

  // register_attr! {
  // tidy-alphabetical-start
  register_attr(sym.alloc_error_handler, alloc_error_handler.expand);
  register_attr(sym.autodiff_forward, autodiff.expand_forward);
  register_attr(sym.autodiff_reverse, autodiff.expand_reverse);
  register_attr(sym.bench, test.expand_bench);
  register(sym.cfg_accessible, { $: "LegacyAttr", _0: new cfg_accessible.Expander() });
  register_attr(sym.cfg_eval, cfg_eval.expand);
  register_attr(sym.define_opaque, define_opaque.expand);
  register(sym.derive, { $: "LegacyAttr", _0: new derive.Expander(false) });
  register(sym.derive_const, { $: "LegacyAttr", _0: new derive.Expander(true) });
  register_attr(sym.eii, eii.eii);
  register_attr(sym.eii_declaration, eii.eii_declaration);
  register_attr(sym.eii_shared_macro, eii.eii_shared_macro);
  register_attr(sym.global_allocator, global_allocator.expand);
  register_attr(sym.offload_kernel, offload.expand_kernel);
  register_attr(sym.test, test.expand_test);
  register_attr(sym.test_case, test.expand_test_case);
  register_attr(sym.unsafe_eii, eii.unsafe_eii);
  // tidy-alphabetical-end
  // }

  // register_derive! {
  register_derive(sym.Clone, clone.expand_deriving_clone);
  register_derive(sym.CoerceShared, reborrow.expand_deriving_coerce_shared);
  register_derive(sym.Copy, copy.expand_deriving_copy);
  register_derive(sym.ConstParamTy, const_param_ty.expand_deriving_const_param_ty);
  register_derive(sym.Debug, debug.expand_deriving_debug);
  register_derive(sym.Default, default_.expand_deriving_default);
  register_derive(sym.Eq, eq.expand_deriving_eq);
  register_derive(sym.Hash, hash.expand_deriving_hash);
  register_derive(sym.Ord, ord.expand_deriving_ord);
  register_derive(sym.PartialEq, partial_eq.expand_deriving_partial_eq);
  register_derive(sym.PartialOrd, partial_ord.expand_deriving_partial_ord);
  register_derive(sym.CoercePointee, coerce_pointee.expand_deriving_coerce_pointee);
  register_derive(sym.Reborrow, reborrow.expand_deriving_reborrow);
  register_derive(sym.From, from.expand_deriving_from);
  // }

  // `rustc_proc_macro::bridge::client::Client::expand1(rustc_proc_macro::quote)`
  const client = quote_client;
  register(sym.quote, { $: "Bang", _0: client });
  const requires: SyntaxExtensionKind = { $: "Attr", _0: contracts.ExpandRequires };
  register(sym.contracts_requires, requires);
  const ensures: SyntaxExtensionKind = { $: "Attr", _0: contracts.ExpandEnsures };
  register(sym.contracts_ensures, ensures);
}

/**
 * `SyntaxExtensionKind::Bang(Arc::new(BangProcMacro { client }))` for `quote!`. PORT: the proc-macro
 * bridge (`rustc_proc_macro::bridge::client::Client::expand1(rustc_proc_macro::quote)` and
 * `rustc_expand::proc_macro::BangProcMacro`) is M6; registering the macro is side-effect free, and
 * expanding a `quote!` stops here.
 */
const quote_client: BangProcMacro = {
  expand(_ecx: ExtCtxt, _span: Span, _ts: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    return unported("rustc_expand::proc_macro::BangProcMacro::expand (quote!; proc-macro bridge, M6)");
  },
};
