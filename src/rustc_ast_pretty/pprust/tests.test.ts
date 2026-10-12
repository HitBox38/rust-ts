// Port of compiler/rustc_ast_pretty/src/pprust/tests.rs
//
// `test_fun_to_string` and `test_variant_to_string` call `print_fn`/`print_variant` from
// `pprust/state/item.rs`, which is not ported yet (placeholders in state.ts call `unported`), so they
// stay skipped. Un-skip them (`test.skip` -> `test`) when the expr/item lane lands.
// PORT: `s.end(..)` through `Deref<Target = Printer>` is `s.s.end(..)` (see state.ts header).
import { expect, test } from "bun:test";
import { ast } from "../../rustc_ast/lib.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Ident } from "../../rustc_span/symbol.ts";
import { to_string } from "./mod.ts";

const PENDING = "pending expr/item lane: print_fn/print_variant (pprust/state/item.rs) are not ported yet";

// PORT: `ast::Generics::default()` (derived `Default`): no params, a default `WhereClause`,
// `DUMMY_SP`.
function generics_default(): ast.Generics {
  return { params: [], where_clause: new ast.WhereClause(false, [], DUMMY_SP), span: DUMMY_SP };
}

// rustc: compiler/rustc_ast_pretty/src/pprust/tests.rs:7 fun_to_string
function fun_to_string(decl: ast.FnDecl, header: ast.FnHeader, ident: Ident, generics: ast.Generics): string {
  return to_string((s) => {
    const [cb, ib] = s.head("");
    s.print_fn(decl, header, ident, generics);
    s.s.end(ib);
    s.s.end(cb);
  });
}

// rustc: compiler/rustc_ast_pretty/src/pprust/tests.rs:21 variant_to_string
function variant_to_string(var_: ast.Variant): string {
  return to_string((s) => s.print_variant(var_));
}

// rustc: compiler/rustc_ast_pretty/src/pprust/tests.rs:25 ty_to_string
function ty_to_string(ty: ast.Ty): string {
  return to_string((s) => {
    s.print_type(ty);
  });
}

// rustc: compiler/rustc_ast_pretty/src/pprust/tests.rs:32 test_fun_to_string
test.skip(`test_fun_to_string (${PENDING})`, () => {
  create_default_session_globals_then(() => {
    const abba_ident = Ident.from_str("abba");

    const decl = new ast.FnDecl([], { $: "Default", _0: DUMMY_SP });
    const generics = generics_default();
    expect(fun_to_string(decl, ast.FnHeader.default(), abba_ident, generics)).toBe("fn abba()");
  });
});

// rustc: compiler/rustc_ast_pretty/src/pprust/tests.rs:46 test_variant_to_string
test.skip(`test_variant_to_string (${PENDING})`, () => {
  create_default_session_globals_then(() => {
    const ident = Ident.from_str("principal_skinner");

    const var_: ast.Variant = {
      ident,
      vis: { span: DUMMY_SP, kind: ast.VisibilityKind.Inherited },
      attrs: [],
      id: ast.DUMMY_NODE_ID,
      data: { $: "Unit", _0: ast.DUMMY_NODE_ID },
      disr_expr: undefined,
      span: DUMMY_SP,
      is_placeholder: false,
    };

    const varstr = variant_to_string(var_);
    expect(varstr).toBe("principal_skinner");
  });
});

// rustc: compiler/rustc_ast_pretty/src/pprust/tests.rs:67 test_field_view
test("test_field_view", () => {
  create_default_session_globals_then(() => {
    const ty = new ast.Ty(
      ast.DUMMY_NODE_ID,
      {
        $: "View",
        _0: new ast.Ty(ast.DUMMY_NODE_ID, ast.TyKind.Dummy, DUMMY_SP),
        _1: [Ident.from_str("milhouse"), Ident.from_str("apu")],
      },
      DUMMY_SP,
    );

    const ty_str = ty_to_string(ty);
    expect(ty_str).toBe("(/*DUMMY*/).{ milhouse, apu }");
  });
});
