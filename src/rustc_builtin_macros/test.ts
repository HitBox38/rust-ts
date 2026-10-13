// Port of compiler/rustc_builtin_macros/src/test.rs
//! The expansion from a test function to the appropriate test struct for libtest
//! Ideally, this code would be in libtest but for efficiency and error messages it lives here.
//
// PORT: `debug!` (tracing) is dropped.
import { ast, attr, join_path_idents } from "../rustc_ast/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/interface.ts";
import { Applicability, Diag, type ErrorGuaranteed, Level } from "../rustc_errors/lib.ts";
import { Annotatable, type ExtCtxt } from "../rustc_expand/base.ts";
import { FileName, RemapPathScopeComponents, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { type Component, path_components } from "../std/path.ts";
import { assert } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";
import { check_builtin_macro_attribute, warn_on_duplicate_attribute } from "./util.ts";

/// #[test_case] is used by custom test authors to mark tests
/// When building for test, it needs to make the item public and gensym the name
/// Otherwise, we'll omit the item. This behavior means that any item annotated
/// with #[test_case] is never addressable.
///
/// We mark item with an inert attribute "rustc_test_marker" which the test generation
/// logic will pick up on.
// rustc: compiler/rustc_builtin_macros/src/test.rs:26 expand_test_case
export function expand_test_case(ecx: ExtCtxt, attr_sp: Span, meta_item: ast.MetaItem, anno_item: Annotatable): Annotatable[] {
  check_builtin_macro_attribute(ecx, meta_item, sym.test_case);
  warn_on_duplicate_attribute(ecx, anno_item, sym.test_case);

  const sp = ecx.with_def_site_ctxt(attr_sp);
  let item: ast.Item;
  let is_stmt: boolean;
  if (anno_item.$ === "Item") {
    [item, is_stmt] = [anno_item._0, false];
  } else if (anno_item.$ === "Stmt" && anno_item._0.kind.$ === "Item") {
    [item, is_stmt] = [anno_item._0.kind._0, true];
  } else {
    ecx.dcx().emit_err(diagnostics.TestCaseNonItem_diagnostic({ span: Annotatable.span(anno_item) }));
    return [];
  }

  if (!ecx.ecfg.should_test) {
    return [];
  }

  // `#[test_case]` is valid on functions, consts, and statics. Only modify
  // the item in those cases.
  const kind = item.kind;
  if (kind.$ === "Fn" || kind.$ === "Const" || kind.$ === "Static") {
    const node = kind._0;
    // PORT: `ident.span = ..` on the `Copy` ident: the field gets a new `Ident`.
    node.ident = Ident.new(node.ident.name, Span.with_ctxt(node.ident.span, Span.ctxt(sp)));
    const ident = node.ident;
    const test_path_symbol = Symbol.intern(
      item_path(
        // skip the name of the root module
        ecx.current_expansion.module.mod_path.slice(1),
        ident,
      ),
    );
    item.vis = { span: item.vis.span, kind: ast.VisibilityKind.Public };
    item.attrs.push(ecx.attr_name_value_str(sym.rustc_test_marker, test_path_symbol, sp));
  }

  const ret: Annotatable = is_stmt ? { $: "Stmt", _0: ecx.stmt_item(item.span, item) } : { $: "Item", _0: item };

  return [ret];
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:82 expand_test
export function expand_test(cx: ExtCtxt, attr_sp: Span, meta_item: ast.MetaItem, item: Annotatable): Annotatable[] {
  check_builtin_macro_attribute(cx, meta_item, sym.test);
  warn_on_duplicate_attribute(cx, item, sym.test);
  return expand_test_or_bench(cx, attr_sp, item, false);
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:93 expand_bench
export function expand_bench(cx: ExtCtxt, attr_path_sp: Span, meta_item: ast.MetaItem, item: Annotatable): Annotatable[] {
  check_builtin_macro_attribute(cx, meta_item, sym.bench);
  warn_on_duplicate_attribute(cx, item, sym.bench);
  return expand_test_or_bench(cx, attr_path_sp, item, true);
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:104 expand_test_or_bench
export function expand_test_or_bench(cx: ExtCtxt, attr_sp_: Span, item_: Annotatable, is_bench: boolean): Annotatable[] {
  let item: ast.Item;
  let is_stmt: boolean;
  if (item_.$ === "Item") {
    [item, is_stmt] = [item_._0, false];
  } else if (item_.$ === "Stmt" && item_._0.kind.$ === "Item") {
    [item, is_stmt] = [item_._0.kind._0, true];
  } else {
    const other = item_;
    not_testable_error(cx, is_bench, attr_sp_, undefined);
    return [other];
  }

  if (item.kind.$ !== "Fn") {
    not_testable_error(cx, is_bench, attr_sp_, item);
    return is_stmt ? [{ $: "Stmt", _0: cx.stmt_item(item.span, item) }] : [{ $: "Item", _0: item }];
  }
  const fn_ = item.kind._0;

  // If we're not in test configuration, remove the annotated item
  if (!cx.ecfg.should_test) {
    return [];
  }

  const naked = attr.find_by_name(item.attrs, sym.naked);
  if (naked !== undefined) {
    cx.dcx().emit_err(diagnostics.NakedFunctionTestingAttribute_diagnostic({ testing_span: attr_sp_, naked_span: naked.span }));
    return [{ $: "Item", _0: item }];
  }

  // check_*_signature will report any errors in the type so compilation
  // will fail. We shouldn't try to expand in this case because the errors
  // would be spurious.
  const check_result = is_bench ? check_bench_signature(cx, item, fn_) : check_test_signature(cx, item, fn_);
  if (check_result.$ === "Err") {
    return is_stmt ? [{ $: "Stmt", _0: cx.stmt_item(item.span, item) }] : [{ $: "Item", _0: item }];
  }

  const sp = cx.with_def_site_ctxt(item.span);
  const ret_ty_sp = cx.with_def_site_ctxt(ast.FnRetTy.span(fn_.sig.decl.output));
  const attr_sp = cx.with_def_site_ctxt(attr_sp_);

  const test_ident = Ident.new(sym.test, attr_sp);

  // creates test::$name
  const test_path = (name: string): ast.Path => cx.path(ret_ty_sp, [test_ident, Ident.from_str_and_span(name, sp)]);

  // creates test::ShouldPanic::$name
  const should_panic_path = (name: string): ast.Path =>
    cx.path(sp, [test_ident, Ident.new(sym.ShouldPanic, sp), Ident.from_str_and_span(name, sp)]);

  // creates test::TestType::$name
  const test_type_path = (name: string): ast.Path =>
    cx.path(sp, [test_ident, Ident.new(sym.TestType, sp), Ident.from_str_and_span(name, sp)]);

  // creates $name: $expr
  const field = (name: string, expr: ast.Expr): ast.ExprField => cx.field_imm(sp, Ident.from_str_and_span(name, sp), expr);

  // Adds `#[coverage(off)]` to a closure, so it won't be instrumented in
  // `-Cinstrument-coverage` builds.
  // This requires `#[allow_internal_unstable(coverage_attribute)]` on the
  // corresponding macro declaration in `core::macros`.
  const coverage_off = (expr: ast.Expr): ast.Expr => {
    assert(expr.kind.$ === "Closure", "assertion failed: matches!(expr.kind, ast::ExprKind::Closure(_))");
    expr.attrs.push(cx.attr_nested_word(sym.coverage, sym.off, sp));
    return expr;
  };

  let test_fn: ast.Expr;
  if (is_bench) {
    // avoid name collisions by using the function name within the identifier, see bug #148275
    const bencher_param = Ident.from_str_and_span(`__bench_${Symbol.as_str(fn_.ident.name)}`, attr_sp);
    test_fn = cx.expr_call(sp, cx.expr_path(test_path("StaticBenchFn")), [
      // #[coverage(off)]
      // |__bench_fn_name| self::test::assert_test_result(
      coverage_off(
        cx.closure(
          sp,
          [bencher_param],
          cx.expr_call(sp, cx.expr_path(test_path("assert_test_result")), [
            // super::$test_fn(__bench_fn_name)
            cx.expr_call(ret_ty_sp, cx.expr_path(cx.path(sp, [fn_.ident])), [cx.expr_ident(sp, bencher_param)]),
          ]),
        ),
      ), // )
    ]);
  } else {
    test_fn = cx.expr_call(sp, cx.expr_path(test_path("StaticTestFn")), [
      // #[coverage(off)]
      // || {
      coverage_off(
        cx.closure(
          sp,
          [],
          // test::assert_test_result(
          cx.expr_call(sp, cx.expr_path(test_path("assert_test_result")), [
            // $test_fn()
            cx.expr_call(ret_ty_sp, cx.expr_path(cx.path(sp, [fn_.ident])), []), // )
          ]), // }
        ),
      ), // )
    ]);
  }

  const test_path_symbol = Symbol.intern(
    item_path(
      // skip the name of the root module
      cx.current_expansion.module.mod_path.slice(1),
      fn_.ident,
    ),
  );

  const location_info = get_location_info(cx, fn_);

  // static $ident: test::TestDescAndFn =
  // We use a static because these things only exist to have references taken
  // to them for the test case array. No reason to introduce tons of promoteds for that.
  // Promoteds have the advantage that they can be merged to save space, but every one
  // of these points to a different function so that will not happen.
  const test_const = cx.item_static(
    sp,
    [
      // #[cfg(test)]
      cx.attr_nested_word(sym.cfg, sym.test, attr_sp),
      // #[rustc_test_marker = "test_case_sort_key"]
      cx.attr_name_value_str(sym.rustc_test_marker, test_path_symbol, attr_sp),
      // #[doc(hidden)]
      cx.attr_nested_word(sym.doc, sym.hidden, attr_sp),
    ],
    Ident.new(fn_.ident.name, sp),
    cx.ty(sp, { $: "Path", _0: undefined, _1: test_path("TestDescAndFn") }),
    "Not",
    // test::TestDescAndFn {
    cx.expr_struct(sp, test_path("TestDescAndFn"), [
      // desc: test::TestDesc {
      field(
        "desc",
        cx.expr_struct(sp, test_path("TestDesc"), [
          // name: "path::to::test"
          field("name", cx.expr_call(sp, cx.expr_path(test_path("StaticTestName")), [cx.expr_str(sp, test_path_symbol)])),
          // ignore: true | false
          field("ignore", cx.expr_bool(sp, should_ignore(item))),
          // ignore_message: Some("...") | None
          field(
            "ignore_message",
            (() => {
              const msg = should_ignore_message(item);
              if (msg !== undefined) {
                return cx.expr_some(sp, cx.expr_str(sp, msg));
              } else {
                return cx.expr_none(sp);
              }
            })(),
          ),
          // source_file: <relative_path_of_source_file>
          field("source_file", cx.expr_str(sp, location_info[0])),
          // start_line: start line of the test fn identifier.
          field("start_line", cx.expr_usize(sp, location_info[1])),
          // start_col: start column of the test fn identifier.
          field("start_col", cx.expr_usize(sp, location_info[2])),
          // end_line: end line of the test fn identifier.
          field("end_line", cx.expr_usize(sp, location_info[3])),
          // end_col: end column of the test fn identifier.
          field("end_col", cx.expr_usize(sp, location_info[4])),
          // compile_fail: true | false
          field("compile_fail", cx.expr_bool(sp, false)),
          // no_run: true | false
          field("no_run", cx.expr_bool(sp, false)),
          // should_panic: ...
          field(
            "should_panic",
            (() => {
              const p = should_panic(cx, item);
              switch (p.$) {
                // test::ShouldPanic::No
                case "No":
                  return cx.expr_path(should_panic_path("No"));
                case "Yes":
                  if (p._0 === undefined) {
                    // test::ShouldPanic::Yes
                    return cx.expr_path(should_panic_path("Yes"));
                  } else {
                    // test::ShouldPanic::YesWithMessage("...")
                    return cx.expr_call(sp, cx.expr_path(should_panic_path("YesWithMessage")), [cx.expr_str(sp, p._0)]);
                  }
              }
            })(),
          ),
          // test_type: ...
          field(
            "test_type",
            (() => {
              switch (test_type(cx)) {
                // test::TestType::UnitTest
                case "UnitTest":
                  return cx.expr_path(test_type_path("UnitTest"));
                // test::TestType::IntegrationTest
                case "IntegrationTest":
                  return cx.expr_path(test_type_path("IntegrationTest"));
                // test::TestPath::Unknown
                case "Unknown":
                  return cx.expr_path(test_type_path("Unknown"));
              }
            })(),
          ),
          // },
        ]),
      ),
      // testfn: test::StaticTestFn(...) | test::StaticBenchFn(...)
      field("testfn", test_fn), // }
    ]),
    // }
  );
  test_const.vis.kind = ast.VisibilityKind.Public;

  // extern crate test
  const test_extern = cx.item(sp, [], { $: "ExternCrate", _0: undefined, _1: test_ident });

  // debug!("synthetic test item:\n{}\n", pprust::item_to_string(&test_const));

  if (is_stmt) {
    return [
      // Access to libtest under a hygienic name
      { $: "Stmt", _0: cx.stmt_item(sp, test_extern) },
      // The generated test case
      { $: "Stmt", _0: cx.stmt_item(sp, test_const) },
      // The original item
      { $: "Stmt", _0: cx.stmt_item(sp, item) },
    ];
  } else {
    return [
      // Access to libtest under a hygienic name
      { $: "Item", _0: test_extern },
      // The generated test case
      { $: "Item", _0: test_const },
      // The original item
      { $: "Item", _0: item },
    ];
  }
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:400 not_testable_error
function not_testable_error(cx: ExtCtxt, is_bench: boolean, attr_sp: Span, item: ast.Item | undefined): void {
  const dcx = cx.dcx();
  const name = is_bench ? "bench" : "test";
  const msg = `the \`${name}\` attribute may only be used on a free function`;
  // These were a warning before #92959 and need to continue being that to avoid breaking
  // stable user code (#94508).
  const level: Level = item !== undefined && item.kind.$ === "MacCall" ? { $: "Warning", _0: undefined } : Level.Error;
  const err = Diag.new(dcx, level, msg);
  err.span(attr_sp);
  if (item !== undefined) {
    err.span_label(
      item.span,
      `expected a non-associated function, found ${ast.ItemKind.article(item.kind)} ${ast.ItemKind.descr(item.kind)}`,
    );
  }
  err.span_label(attr_sp, `the \`${name}\` attribute causes a function to be run as a test and has no effect on non-functions`);

  if (!is_bench) {
    err
      .with_span_suggestion(
        attr_sp,
        "replace with conditional compilation to make the item only exist when tests are being run",
        "#[cfg(test)]",
        Applicability.MaybeIncorrect,
      )
      .emit();
  } else {
    err.emit();
  }
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:434 get_location_info
function get_location_info(cx: ExtCtxt, fn_: ast.Fn): [Symbol, number, number, number, number] {
  const span = fn_.ident.span;
  const [source_file, lo_line, lo_col, hi_line, hi_col] = cx.sess.source_map().span_to_location_info(span);

  let file_name: string;
  if (source_file !== undefined) {
    const sf = source_file;
    file_name = FileName.display(sf.name, RemapPathScopeComponents.MACRO).to_string();
  } else {
    file_name = "no-location";
  }

  return [Symbol.intern(file_name), lo_line, lo_col, hi_line, hi_col];
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:447 item_path
function item_path(mod_path: readonly Ident[], item_ident: Ident): string {
  return join_path_idents([...mod_path, item_ident]);
}

type ShouldPanic = { $: "No" } | { $: "Yes"; _0: Symbol | undefined };

// rustc: compiler/rustc_builtin_macros/src/test.rs:456 should_ignore
function should_ignore(i: ast.Item): boolean {
  return attr.contains_name(i.attrs, sym.ignore);
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:460 should_ignore_message
function should_ignore_message(i: ast.Item): Symbol | undefined {
  const a = attr.find_by_name(i.attrs, sym.ignore);
  if (a !== undefined) {
    if (a.meta_item_list() !== undefined) {
      // Handle #[ignore(bar = "foo")]
      return undefined;
    } else {
      // Handle #[ignore] and #[ignore = "message"]
      return a.value_str();
    }
  } else {
    return undefined;
  }
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:474 should_panic
function should_panic(cx: ExtCtxt, i: ast.Item): ShouldPanic {
  const parsed = AttributeParser.parse_limited_sym(cx.sess, i.attrs, [sym.should_panic]);
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "ShouldPanic") {
    return { $: "Yes", _0: parsed._0.reason };
  } else {
    return { $: "No" };
  }
}

type TestType = "UnitTest" | "IntegrationTest" | "Unknown";

/// Attempts to determine the type of test.
/// Since doctests are created without macro expanding, only possible variants here
/// are `UnitTest`, `IntegrationTest` or `Unknown`.
// rustc: compiler/rustc_builtin_macros/src/test.rs:493 test_type
function test_type(cx: ExtCtxt): TestType {
  // Root path from context contains the topmost sources directory of the crate.
  // I.e., for `project` with sources in `src` and tests in `tests` folders
  // (no matter how many nested folders lie inside),
  // there will be two different root paths: `/project/src` and `/project/tests`.
  const crate_path = cx.root_path;

  if (path_ends_with(crate_path, "src")) {
    // `/src` folder contains unit-tests.
    return "UnitTest";
  } else if (path_ends_with(crate_path, "tests")) {
    // `/tests` folder contains integration tests.
    return "IntegrationTest";
  } else {
    // Crate layout doesn't match expected one, test type is unknown.
    return "Unknown";
  }
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:512 check_test_signature
function check_test_signature(cx: ExtCtxt, i: ast.Item, f: ast.Fn): Result<undefined, ErrorGuaranteed> {
  const has_should_panic_attr = attr.contains_name(i.attrs, sym.should_panic);
  const dcx = cx.dcx();

  const safety = f.sig.header.safety;
  if (safety.$ === "Unsafe") {
    const span = safety._0;
    return Err(dcx.emit_err(diagnostics.TestBadFn_diagnostic({ span: i.span, cause: span, kind: "unsafe" })));
  }

  const coroutine_marker = f.sig.header.coroutine_marker;
  if (coroutine_marker !== undefined) {
    return Err(
      dcx.emit_err(
        diagnostics.TestBadFn_diagnostic({
          span: i.span,
          cause: coroutine_marker.span,
          kind: ast.CoroutineKind.as_str(coroutine_marker.kind),
        }),
      ),
    );
  }

  // If the termination trait is active, the compiler will check that the output
  // type implements the `Termination` trait as `libtest` enforces that.
  let has_output: boolean;
  const output = f.sig.decl.output;
  if (output.$ === "Default") {
    has_output = false;
  } else if (output.$ === "Ty" && ast.TyKind.is_unit(output._0.kind)) {
    has_output = false;
  } else {
    has_output = true;
  }

  if (f.sig.decl.inputs.length !== 0) {
    return Err(dcx.span_err(i.span, "functions used as tests can not have any arguments"));
  }

  if (has_should_panic_attr && has_output) {
    return Err(dcx.span_err(i.span, "functions using `#[should_panic]` must return `()`"));
  }

  if (f.generics.params.some((param) => param.kind.$ !== "Lifetime")) {
    return Err(dcx.span_err(i.span, "functions used as tests can not have any non-lifetime generic parameters"));
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_builtin_macros/src/test.rs:562 check_bench_signature
function check_bench_signature(cx: ExtCtxt, i: ast.Item, f: ast.Fn): Result<undefined, ErrorGuaranteed> {
  // N.B., inadequate check, but we're running
  // well before resolve, can't get too deep.
  if (f.sig.decl.inputs.length !== 1) {
    return Err(cx.dcx().emit_err(diagnostics.BenchSig_diagnostic({ span: i.span })));
  }
  return Ok(undefined);
}

/**
 * PORT: std `Path::ends_with` (library/std/src/path.rs `_ends_with`:
 * `iter_after(self.components().rev(), child.components().rev()).is_some()`); src/std/path.ts does not
 * export it.
 */
function path_ends_with(self_: string, child: string): boolean {
  const iter = path_components(self_);
  const prefix = path_components(child);
  for (;;) {
    const y = prefix.next_back();
    if (y === undefined) return true;
    const x = iter.next_back();
    if (x === undefined) return false;
    if (!component_eq(x, y)) return false;
  }
}

/** PORT: `Component: PartialEq` (src/std/path.ts keeps `component_eq` private), as in source_util.ts. */
function component_eq(a: Component, b: Component): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Prefix") return a.raw === (b as { raw: string }).raw;
  if (a.$ === "Normal") return a._0 === (b as { _0: string })._0;
  return true;
}
