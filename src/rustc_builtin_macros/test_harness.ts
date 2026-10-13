// Port of compiler/rustc_builtin_macros/src/test_harness.rs
// Code that generates a test runner to run all the tests in a crate
//
// PORT: `debug!` (tracing) is dropped.
import { ast, attr, entry, mut_visit, visit } from "../rustc_ast/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/interface.ts";
import type { ExtCtxt as ExtCtxtT, ResolverExpand } from "../rustc_expand/base.ts";
import { ExtCtxt } from "../rustc_expand/base.ts";
import { AstFragment, ExpansionConfig } from "../rustc_expand/expand.ts";
import type { Features } from "../rustc_feature/lib.ts";
import { UNNAMEABLE_TEST_ITEMS } from "../rustc_lint_defs/builtin.gen.ts";
import { str_cmp } from "../rustc_session/options.ts";
import type { Session } from "../rustc_session/session.ts";
import { LocalExpnId, SyntaxContext, Transparency } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { PanicStrategy } from "../rustc_target/spec/mod.ts";
import { unwrap } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";

const { contains_name } = attr;
const { MutVisitor, walk_crate } = mut_visit;
const { Visitor } = visit;

/** `#[derive(Clone)] struct Test` */
interface Test {
  span: Span;
  ident: Ident;
  name: Symbol;
}

class TestCtxt {
  constructor(
    public ext_cx: ExtCtxtT,
    public panic_strategy: PanicStrategy,
    public def_site: Span,
    public test_cases: Test[],
    public reexport_test_harness_main: Symbol | undefined,
    /// Value of a `#[test_runner]` attribute, if present.
    public test_runner: ast.Path | undefined,
  ) {}
}

/// Traverse the crate, collecting all the test functions, eliding any
/// existing main functions, and synthesizing a main test harness
// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:47 inject
export function inject(krate: ast.Crate, sess: Session, features: Features, resolver: ResolverExpand): void {
  const dcx = sess.dcx();
  const panic_strategy_ = sess.panic_strategy();
  const platform_panic_strategy = sess.target.panic_strategy;

  // Check for #![reexport_test_harness_main = "some_name"] which gives the
  // main test function the name `some_name` without hygiene. This needs to be
  // unconditional, so that the attribute is still marked as used in
  // non-test builds.
  const reexport_test_harness_main = attr.first_attr_value_str_by_name(krate.attrs, sym.reexport_test_harness_main);

  // Do this here so that the test_runner crate attribute gets marked as used
  // even in non-test builds
  const test_runner = get_test_runner(sess, krate);

  if (sess.is_test_crate()) {
    let panic_strategy: PanicStrategy;
    const panic_abort_tests = sess.opts.unstable_opts.panic_abort_tests;
    if ((panic_strategy_ === "Abort" || panic_strategy_ === "ImmediateAbort") && panic_abort_tests) {
      panic_strategy = panic_strategy_;
    } else if ((panic_strategy_ === "Abort" || panic_strategy_ === "ImmediateAbort") && !panic_abort_tests) {
      if (panic_strategy_ === platform_panic_strategy) {
        // Silently allow compiling with panic=abort on these platforms,
        // but with old behavior (abort if a test fails).
      } else {
        dcx.emit_err(diagnostics.TestsNotSupport_diagnostic({}));
      }
      panic_strategy = "Unwind";
    } else {
      // (PanicStrategy::Unwind, _)
      panic_strategy = "Unwind";
    }
    generate_test_harness(sess, resolver, reexport_test_harness_main, krate, features, panic_strategy, test_runner);
  }
}

class TestHarnessGenerator extends MutVisitor {
  constructor(
    public cx: TestCtxt,
    public tests: Test[],
  ) {
    super();
  }

  // rustc: compiler/rustc_builtin_macros/src/test_harness.rs:100 add_test_cases
  add_test_cases(node_id: ast.NodeId, span: Span, prev_tests: Test[]): void {
    const tests = this.tests;
    this.tests = prev_tests;

    if (tests.length !== 0) {
      // Create an identifier that will hygienically resolve the test
      // case name, even in another module.
      const expn_id = this.cx.ext_cx.resolver.expansion_for_ast_pass(span, "TestHarness", [], node_id);
      for (const test of tests) {
        // See the comment on `add_main` for why we're using `apply_mark` directly.
        test.ident = Ident.new(test.ident.name, Span.apply_mark(test.ident.span, LocalExpnId.to_expn_id(expn_id), Transparency.Opaque));
      }
      this.cx.test_cases.push(...tests);
    }
  }

  // impl<'a> MutVisitor for TestHarnessGenerator<'a>
  // rustc: compiler/rustc_builtin_macros/src/test_harness.rs:123 visit_crate
  override visit_crate(c: ast.Crate): void {
    const prev_tests = this.tests;
    this.tests = [];
    walk_crate(this, c);
    this.add_test_cases(ast.CRATE_NODE_ID, c.spans.inner_span, prev_tests);

    // Create a main function to run our tests
    add_main(this.cx, c);
  }

  // rustc: compiler/rustc_builtin_macros/src/test_harness.rs:132 visit_item
  override visit_item(item: ast.Item): void {
    const name = get_test_name(item);
    if (name !== undefined) {
      // debug!("this is a test item");

      // `unwrap` is ok because only functions, consts, and static should reach here.
      const test: Test = { span: item.span, ident: unwrap(ast.ItemKind.ident(item.kind)), name };
      this.tests.push(test);
    }

    // We don't want to recurse into anything other than mods, since
    // mods or tests inside of functions will break things
    const kind = item.kind;
    if (kind.$ === "Mod" && kind._2.$ === "Loaded") {
      const span = kind._2._2.inner_span;
      const prev_tests = this.tests;
      this.tests = [];
      mut_visit.walk_item(this, item, mut_visit.WalkItemKind.ItemKind);
      this.add_test_cases(item.id, span, prev_tests);
    } else {
      // But in those cases, we emit a lint to warn the user of these missing tests.
      visit.walk_item(new InnerItemLinter(this.cx.ext_cx.sess), item, visit.WalkItemKind.ItemKind);
    }
  }
}

class InnerItemLinter extends Visitor {
  constructor(public sess: Session) {
    super();
  }

  // impl<'a> Visitor<'a> for InnerItemLinter<'_>
  // rustc: compiler/rustc_builtin_macros/src/test_harness.rs:164 visit_item
  override visit_item(i: ast.Item): undefined {
    const a = attr.find_by_name(i.attrs, sym.rustc_test_marker);
    if (a !== undefined) {
      this.sess.psess.buffer_lint(UNNAMEABLE_TEST_ITEMS, a.span, i.id, diagnostics.UnnameableTestItems_diagnostic({}));
    }
    return undefined;
  }
}

// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:176 entry_point_type
function entry_point_type(item: ast.Item, at_root: boolean): entry.EntryPointType {
  const kind = item.kind;
  switch (kind.$) {
    case "Fn": {
      const fn_ = kind._0;
      return entry.entry_point_type(contains_name(item.attrs, sym.rustc_main), at_root, fn_.ident.name);
    }
    default:
      return entry.EntryPointType.None;
  }
}

/// A folder used to remove any entry points (like fn main) because the harness
/// coroutine will provide its own
class EntryPointCleaner extends MutVisitor {
  constructor(
    // Current depth in the ast
    public sess: Session,
    public depth: number,
    public def_site: Span,
  ) {
    super();
  }

  // impl<'a> MutVisitor for EntryPointCleaner<'a>
  // rustc: compiler/rustc_builtin_macros/src/test_harness.rs:197 visit_item
  override visit_item(item: ast.Item): void {
    this.depth += 1;
    mut_visit.walk_item(this, item, mut_visit.WalkItemKind.ItemKind);
    this.depth -= 1;

    // Remove any #[rustc_main] from the AST so it doesn't
    // clash with the one we're going to add, but mark it as
    // #[allow(dead_code)] to avoid printing warnings.
    switch (entry_point_type(item, this.depth === 0)) {
      case "RustcMainAttr": {
        const allow_dead_code = attr.mk_attr_nested_word(
          this.sess.psess.attr_id_generator,
          ast.AttrStyle.Outer,
          sym.allow,
          sym.dead_code,
          this.def_site,
        );
        // PORT: `Vec::retain` in place.
        const kept = item.attrs.filter((a) => !a.has_name(sym.rustc_main));
        item.attrs.length = 0;
        item.attrs.push(...kept);
        item.attrs.push(allow_dead_code);
        this.sess.removed_rustc_main_attr = true;
        break;
      }
      case "None":
      case "MainNamed":
      case "OtherMain":
        break;
    }
  }
}

/// Crawl over the crate, inserting test reexports and the test main function
// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:224 generate_test_harness
function generate_test_harness(
  sess: Session,
  resolver: ResolverExpand,
  reexport_test_harness_main: Symbol | undefined,
  krate: ast.Crate,
  features: Features,
  panic_strategy: PanicStrategy,
  test_runner: ast.Path | undefined,
): void {
  const econfig = ExpansionConfig.default(sym.test, features);
  const ext_cx = ExtCtxt.new(sess, econfig, resolver, undefined);

  const expn_id = ext_cx.resolver.expansion_for_ast_pass(DUMMY_SP, "TestHarness", [sym.test, sym.rustc_attrs, sym.coverage_attribute], undefined);
  const def_site = Span.with_def_site_ctxt(DUMMY_SP, LocalExpnId.to_expn_id(expn_id));

  // Remove the entry points
  const cleaner = new EntryPointCleaner(sess, 0, def_site);
  cleaner.visit_crate(krate);

  const cx = new TestCtxt(ext_cx, panic_strategy, def_site, [], reexport_test_harness_main, test_runner);

  new TestHarnessGenerator(cx, []).visit_crate(krate);
}

/// Creates a function item for use as the main function of a test build.
/// This function will call the `test_runner` as specified by the crate attribute
///
/// By default this expands to
///
/// ```ignore (messes with test internals)
/// #[rustc_main]
/// pub fn main() {
///     extern crate test;
///     test::test_main_env_args(&[
///         &test_const1,
///         &test_const2,
///         &test_const3,
///     ]);
/// }
/// ```
///
/// Most of the Ident have the usual def-site hygiene for the AST pass. The
/// exception is the `test_const`s. These have a syntax context that has two
/// opaque marks: one from the expansion of `test` or `test_case`, and one
/// generated  in `TestHarnessGenerator::visit_item`. When resolving this
/// identifier after failing to find a matching identifier in the root module
/// we remove the outer mark, and try resolving at its def-site, which will
/// then resolve to `test_const`.
///
/// The expansion here can be controlled by two attributes:
///
/// [`TestCtxt::reexport_test_harness_main`] provides a different name for the `main`
/// function and [`TestCtxt::test_runner`] provides a path that replaces
/// `test::test_main_env_args`.
// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:290 add_main
function add_main(cx: TestCtxt, c: ast.Crate): void {
  const sp = cx.def_site;
  const ecx = cx.ext_cx;
  // `sp` has def-site hygiene so should not clash with user-defined names.
  const test_ident = Ident.new(sym.test, sp);

  // test::test_main_env_args(...)
  let test_runner: ast.Path;
  if (cx.test_runner !== undefined) {
    test_runner = ast.clone_Path(cx.test_runner);
  } else {
    // Built-in runner name depends on panic strategy.
    const runner_name = PanicStrategy.unwinds(cx.panic_strategy) ? "test_main_env_args" : "test_main_env_args_abort";
    test_runner = ecx.path(sp, [test_ident, Ident.from_str_and_span(runner_name, sp)]);
  }

  test_runner.span = sp;

  const test_main_path_expr = ecx.expr_path(test_runner);
  const call_test_main_ = ecx.expr_call(sp, test_main_path_expr, [mk_tests_slice(cx, sp)]);
  const call_test_main = ecx.stmt_expr(call_test_main_);

  // extern crate test
  const test_extern_stmt = ecx.item(sp, [], { $: "ExternCrate", _0: undefined, _1: test_ident });

  // #[rustc_main]
  const main_attr = ecx.attr_word(sym.rustc_main, sp);
  // #[coverage(off)]
  const coverage_attr = ecx.attr_nested_word(sym.coverage, sym.off, sp);
  // #[doc(hidden)]
  const doc_hidden_attr = ecx.attr_nested_word(sym.doc, sym.hidden, sp);

  // pub fn main() -> ExitCode { ... }
  let main_ret_ty: ast.Ty;
  if (cx.test_runner === undefined) {
    // Built-in runner has return type `ExitCode`.
    const exit_code_path = [test_ident, Ident.new(sym.ExitCode, sp)];
    main_ret_ty = ecx.ty(sp, { $: "Path", _0: undefined, _1: ecx.path(sp, exit_code_path) });
  } else {
    // User-defined runners have return type `()`.
    main_ret_ty = ecx.ty(sp, { $: "Tup", _0: [] });
  }

  const main_body = ecx.block(sp, [call_test_main]);

  const decl = ecx.fn_decl([], { $: "Ty", _0: main_ret_ty });
  const sig = new ast.FnSig(ast.FnHeader.default(), decl, sp);
  const defaultness = ast.Defaultness.Implicit;

  // Honor the reexport_test_harness_main attribute
  const main_ident =
    cx.reexport_test_harness_main !== undefined
      ? Ident.new(cx.reexport_test_harness_main, Span.with_ctxt(sp, SyntaxContext.root()))
      : Ident.new(sym.main, sp);

  const main_: ast.ItemKind = {
    $: "Fn",
    _0: new ast.Fn(defaultness, main_ident, generics_default(), sig, undefined, undefined, main_body, undefined),
  };

  const main = new ast.Item(
    [main_attr, coverage_attr, doc_hidden_attr],
    ast.DUMMY_NODE_ID,
    sp,
    { span: sp, kind: ast.VisibilityKind.Public },
    main_,
    undefined,
  );

  // Integrate the new item into existing module structures.
  // `extern crate test;` is only needed with the default runner.
  const items: AstFragment = { $: "Items", _0: cx.test_runner === undefined ? [test_extern_stmt, main] : [main] };
  c.items.push(...AstFragment.make_items(cx.ext_cx.monotonic_expander().fully_expand_fragment(items)));
}

/// Creates a slice containing every test like so:
/// &[&test1, &test2]
// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:378 mk_tests_slice
function mk_tests_slice(cx: TestCtxt, sp: Span): ast.Expr {
  // debug!("building test vector from {} tests", cx.test_cases.len());
  const ecx = cx.ext_cx;

  const tests = cx.test_cases.map((t): Test => ({ ...t }));
  // Note that this sort is load-bearing: the libtest harness uses binary search to find tests by
  // name.
  // PORT: `sort_by` is stable, as is `Array.prototype.sort`; `str::cmp` is code point order.
  tests.sort((a, b) => str_cmp(Symbol.as_str(a.name), Symbol.as_str(b.name)));

  return ecx.expr_array_ref(
    sp,
    tests.map((test) => ecx.expr_addr_of(test.span, ecx.expr_path(ecx.path(test.span, [test.ident])))),
  );
}

// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:398 get_test_name
function get_test_name(i: ast.Item): Symbol | undefined {
  return attr.first_attr_value_str_by_name(i.attrs, sym.rustc_test_marker);
}

// rustc: compiler/rustc_builtin_macros/src/test_harness.rs:402 get_test_runner
function get_test_runner(sess: Session, krate: ast.Crate): ast.Path | undefined {
  const parsed = AttributeParser.parse_limited_sym(sess, krate.attrs, [sym.test_runner]);
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "TestRunner") {
    return parsed._0._0;
  }
  return undefined;
}

/** PORT: `Generics::default()` (`#[derive(Default)]` on `Generics` and `WhereClause`, ast.rs), as in alloc_error_handler.ts. */
function generics_default(): ast.Generics {
  return { params: [], where_clause: new ast.WhereClause(false, [], DUMMY_SP), span: DUMMY_SP };
}
