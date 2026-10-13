// Oracle test for build.rs (the `ExtCtxt` AST builders) and base.rs's `MacEager` / `DummyResult`:
// replays build_oracle/out.json, produced by the rustc-dev probe build_oracle/gen.rs (see its header),
// making the same calls in the same order on a real `Session` and comparing `{:?}` of every result.
import "./lib.ts";

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type Arm,
  type AttrVec,
  BindingMode,
  type Block,
  type Crate,
  debug_AnonConst,
  debug_Arm,
  debug_Attribute,
  debug_Block,
  debug_Crate,
  debug_Expr,
  debug_ExprField,
  debug_FnDecl,
  debug_GenericBound,
  debug_GenericParam,
  debug_Generics,
  debug_Item,
  debug_ItemKind,
  debug_MacCall,
  debug_Param,
  debug_Pat,
  debug_Path,
  debug_PolyTraitRef,
  debug_Stmt,
  debug_Ty,
  debug_WherePredicate,
  type Expr,
  type Item,
} from "../rustc_ast/lib.ts";
import { debug_Lifetime } from "../rustc_ast/ast.ts";
import { TokenStream } from "../rustc_ast/tokenstream.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { Features } from "../rustc_feature/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import { LocalExpnId } from "../rustc_span/hygiene.ts";
import { BytePos, type FileName, Span } from "../rustc_span/lib.ts";
import { debug_Ident, Ident, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { Limit } from "../rustc_structures/lib.ts";
import { type Debug, debug_option, debug_vec, PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { DummyResult, ExtCtxt, MacEager, type ResolverExpand } from "./base.ts";
import { ExpansionConfig } from "./expand.ts";

const expected: [string, string][] = JSON.parse(readFileSync(join(import.meta.dir, "build_oracle", "out.json"), "utf8"));

class CaptureConfig extends Error {}

/** The `Config` the driver builds for `rustc t.rs` (captured from the `config` callback). */
function default_config(): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", "--edition=2015", "t.rs"], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  return config!;
}

// PORT(test): `NoResolver` of gen.rs: every method is `unimplemented!()`.
const NoResolver = new Proxy({} as ResolverExpand, {
  get(_t, p) {
    return () => panic(`not implemented: ResolverExpand::${String(p)}`);
  },
});

const debug_ItemT: Debug<Item> = (v, f) => debug_Item(v, f, debug_ItemKind);

test("ExtCtxt builders and MacEager/DummyResult match rustc's Debug output", () => {
  const got: [string, string][] = [];
  run_compiler(default_config(), (compiler) => {
    const sess = compiler.sess;
    const sm = sess.psess.source_map();
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    const p = unwrap_or_emit_fatal(new_parser_from_source_str(sess.psess, fname, "fn main() { #[attr(x)] 1 }\n", "Nothing"));
    const kr = p.parse_crate_mod();
    if (kr.$ === "Err") throw new Error("parse");
    const krate = kr._0;
    const features = Features.default();
    // PORT(test): `ExpansionConfig::default(sym::main, &features)` written out (expand.rs is lane expand-core's).
    const ecfg = new ExpansionConfig(sym.main, features, Limit.new(1024), false, false, false, false);
    const cx = ExtCtxt.new(sess, ecfg, NoResolver, undefined);
    cx.current_expansion.id = LocalExpnId.fresh_empty();

    const sp = Span.with_root_ctxt(BytePos(0), BytePos(2));
    const sp2 = Span.with_root_ctxt(BytePos(3), BytePos(7));
    const a = Ident.from_str_and_span("a", sp2);
    const b = Ident.from_str("b");
    const item0 = krate.items[0]!;
    if (item0.kind.$ !== "Fn") throw new Error("fn");
    const stmt0 = item0.kind._0.body!.stmts[0]!;
    if (stmt0.kind.$ !== "Expr") throw new Error("expr");
    const parsed_attr = stmt0.kind._0.attrs[0]!;

    const op = <T>(name: string, v: T, d: Debug<T>): void => {
      got.push([name, d(v, PLAIN)]);
    };
    const dvec = <T>(d: Debug<T>): Debug<T[]> => (v, f) => debug_vec(v, f, d);
    const dopt = <T>(d: Debug<T>): Debug<T | undefined> => (v, f) => debug_option(v, f, d);

    op("std_path", cx.std_path([sym.option, sym.Option]), dvec(debug_Ident));
    op("path", cx.path(sp, [a, b]), debug_Path);
    op("path_ident", cx.path_ident(sp, a), debug_Path);
    op("path_global", cx.path_global(sp, [a, b]), debug_Path);
    op("path_global_kw", cx.path_global(sp, [Ident.new(kw.Crate, sp2), b]), debug_Path);
    op("path_all", cx.path_all(sp, true, [a], [{ $: "Type", _0: cx.ty_infer(sp2) }]), debug_Path);
    op("macro_call", cx.macro_call(sp, cx.path_ident(sp, a), { $: "Brace" }, TokenStream.default()), debug_MacCall);
    op("ty_infer", cx.ty_infer(sp), debug_Ty);
    op("ty_ident", cx.ty_ident(sp, a), debug_Ty);
    op("anon_const_block", cx.anon_const_block(cx.block_expr(cx.expr_usize(sp, 3))), debug_AnonConst);
    op("const_ident", cx.const_ident(sp, a), debug_AnonConst);
    op("ty_ref", cx.ty_ref(sp, cx.ty_unit(sp2), cx.lifetime_static(sp), "Mut"), debug_Ty);
    op("ty_ptr", cx.ty_ptr(sp, cx.ty_unit(sp2), "Not"), debug_Ty);
    op("ty_self_ref", cx.ty_self_ref(sp), debug_Ty);
    op("typaram", cx.typaram(a, [cx.trait_bound(cx.path_ident(sp, b), false)], cx.ty_unit(sp)), debug_GenericParam);
    op("lifetime_param", cx.lifetime_param(a, []), debug_GenericParam);
    op("const_param", cx.const_param(a, [], cx.ty_unit(sp), cx.const_ident(sp, b)), debug_GenericParam);
    op("poly_trait_ref", cx.poly_trait_ref(sp, cx.path_ident(sp, a), true), debug_PolyTraitRef);
    op("trait_bound", cx.trait_bound(cx.path_ident(sp, a), false), debug_GenericBound);
    op("lifetime", cx.lifetime(sp, a), debug_Lifetime);
    op("stmt_expr", cx.stmt_expr(cx.expr_self(sp)), debug_Stmt);
    op("stmt_let", cx.stmt_let(sp, true, a, cx.expr_bool(sp, true)), debug_Stmt);
    op("stmt_let_ty", cx.stmt_let_ty(sp, false, a, cx.ty_infer(sp), cx.expr_bool(sp, false)), debug_Stmt);
    op("stmt_let_type_only", cx.stmt_let_type_only(sp, cx.ty_unit(sp)), debug_Stmt);
    op("stmt_item", cx.stmt_item(sp, cx.item_const(sp, a, cx.ty_unit(sp), undefined)), debug_Stmt);
    op("block", cx.block(sp, [cx.stmt_expr(cx.expr_u32(sp, 9))]), debug_Block as Debug<Block>);
    op("expr_ident_sym", cx.expr_ident_sym(sp, sym.main), debug_Expr);
    op(
      "expr_macro_call",
      cx.expr_macro_call(sp, cx.macro_call(sp, cx.path_ident(sp, a), { $: "Parenthesis" }, TokenStream.default())),
      debug_Expr,
    );
    op("expr_binary", cx.expr_binary(sp, "Add", cx.expr_usize(sp, 1), cx.expr_usize(sp2, 2)), debug_Expr);
    op("expr_deref", cx.expr_deref(sp, cx.expr_self(sp)), debug_Expr);
    op("expr_addr_of", cx.expr_addr_of(sp, cx.expr_self(sp)), debug_Expr);
    op("expr_paren", cx.expr_paren(sp, cx.expr_self(sp)), debug_Expr);
    op("expr_method_call", cx.expr_method_call(sp, cx.expr_self(sp), a, [cx.expr_usize(sp, 1)]), debug_Expr);
    op("expr_call_ident", cx.expr_call_ident(sp, a, []), debug_Expr);
    op("expr_call_global", cx.expr_call_global(sp, [a, b], [cx.expr_self(sp)]), debug_Expr);
    op("field_imm", cx.field_imm(sp, a, cx.expr_self(sp2)), debug_ExprField);
    op("expr_struct_ident", cx.expr_struct_ident(sp, a, [cx.field_imm(sp, b, cx.expr_self(sp))]), debug_Expr);
    op("expr_str", cx.expr_str(sp, Symbol.intern("a\"b\né")), debug_Expr);
    op("expr_byte_str", cx.expr_byte_str(sp, new Uint8Array([0, 65, 0x22, 0x5c, 255])), debug_Expr);
    op("expr_array_ref", cx.expr_array_ref(sp, [cx.expr_usize(sp, 1), cx.expr_usize(sp, 2)]), debug_Expr);
    op("expr_some", cx.expr_some(sp, cx.expr_self(sp)), debug_Expr);
    op("expr_none", cx.expr_none(sp), debug_Expr);
    op("expr_tuple", cx.expr_tuple(sp, []), debug_Expr);
    op("expr_ok", cx.expr_ok(sp, cx.expr_self(sp)), debug_Expr);
    op("pat_wild", cx.pat_wild(sp), debug_Pat);
    op("pat_ident", cx.pat_ident(sp, a), debug_Pat);
    op("pat_ident_binding_mode", cx.pat_ident_binding_mode(sp, a, BindingMode.REF_MUT), debug_Pat);
    op("pat_path", cx.pat_path(sp, cx.path_ident(sp, a)), debug_Pat);
    op("pat_struct", cx.pat_struct(sp, cx.path_ident(sp, a), []), debug_Pat);
    op("pat_tuple", cx.pat_tuple(sp, [cx.pat_wild(sp)]), debug_Pat);
    op("pat_some", cx.pat_some(sp, cx.pat_wild(sp)), debug_Pat);
    op("arm", cx.arm(sp, cx.pat_wild(sp), cx.expr_self(sp)), debug_Arm as Debug<Arm>);
    op("expr_match", cx.expr_match(sp, cx.expr_self(sp), [cx.arm(sp2, cx.pat_wild(sp), cx.expr_self(sp))]), debug_Expr);
    op("expr_if", cx.expr_if(sp, cx.expr_bool(sp, true), cx.expr_usize(sp, 1), cx.expr_usize(sp2, 2)), debug_Expr);
    op("expr_if_none", cx.expr_if(sp, cx.expr_bool(sp, true), cx.expr_usize(sp, 1), undefined), debug_Expr);
    op("closure", cx.closure(sp, [a, b], cx.expr_self(sp)), debug_Expr);
    op("param", cx.param(sp, a, cx.ty_infer(sp)), debug_Param);
    op("fn_decl", cx.fn_decl([], { $: "Ty", _0: cx.ty_unit(sp) }), debug_FnDecl);
    op(
      "item_trait_impl",
      cx.item_trait_impl(sp, [] as AttrVec, cx.empty_generics(sp2), { $: "Default" }, true, cx.trait_ref(cx.path_ident(sp, a)), cx.ty_self(sp), []),
      debug_ItemT,
    );
    op("item_static", cx.item_static(sp, [], a, cx.ty_unit(sp), "Mut", cx.expr_tuple(sp, [])), debug_ItemT);
    op("item_const", cx.item_const(sp, a, cx.ty_unit(sp), cx.expr_usize(sp, 0)), debug_ItemT);
    op("attr_word", cx.attr_word(sym.inline, sp), debug_Attribute);
    op("attr_name_value_str", cx.attr_name_value_str(sym.doc, Symbol.intern('x"y'), sp), debug_Attribute);
    op("attr_nested_word", cx.attr_nested_word(sym.derive, sym.Debug, sp), debug_Attribute);
    op("attr_nested", cx.attr_nested(parsed_attr.get_normal_item(), sp), debug_Attribute);
    op("empty_generics", cx.empty_generics(sp), debug_Generics);
    // base.rs: MacEager / DummyResult
    op("mac_eager_expr", MacEager.expr(cx.expr_usize(sp, 5)).make_expr(), dopt<Expr>(debug_Expr));
    op("mac_eager_pat_lit", MacEager.expr(cx.expr_usize(sp, 5)).make_pat(), dopt(debug_Pat));
    op("mac_eager_pat_none", MacEager.expr(cx.expr_self(sp)).make_pat(), dopt(debug_Pat));
    op("mac_eager_stmts", MacEager.expr(cx.expr_usize(sp, 5)).make_stmts(), dopt(dvec(debug_Stmt)));
    op("mac_eager_items_none", MacEager.expr(cx.expr_usize(sp, 5)).make_items(), dopt(dvec(debug_ItemT)));
    op("mac_eager_ty", MacEager.ty(cx.ty_unit(sp)).make_ty(), dopt(debug_Ty));
    op("dummy_valid_expr", DummyResult.any_valid(sp).make_expr(), dopt<Expr>(debug_Expr));
    op("dummy_stmts", DummyResult.any_valid(sp).make_stmts(), dopt(dvec(debug_Stmt)));
    op("dummy_pat", DummyResult.any_valid(sp).make_pat(), dopt(debug_Pat));
    op("dummy_ty", DummyResult.any_valid(sp).make_ty(), dopt(debug_Ty));
    op("dummy_items", DummyResult.any_valid(sp).make_items(), dopt(dvec(debug_ItemT)));
    op("dummy_where_predicates", DummyResult.any_valid(sp).make_where_predicates(), dopt(dvec(debug_WherePredicate)));
    op("dummy_crate", DummyResult.any_valid(sp).make_crate(), dopt<Crate>(debug_Crate));
    op("raw_expr", DummyResult.raw_expr(sp2, undefined), debug_Expr);
  });
  expect(got.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(got[i]).toEqual(expected[i]!);
  }
});
