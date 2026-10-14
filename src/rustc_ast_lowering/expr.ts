// Port of compiler/rustc_ast_lowering/src/expr.rs (STUB, lane lower-expr: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; until then the
// `unported_methods(..)` call below installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { LoweringContext } from "./decls.ts";
import { unported_methods } from "../rust_ts/stubs.ts";

// mod closure;
import "./expr/closure.ts";

// Types of this file (PORT: `unknown` until codegen set rustc_ast_lowering generates expr.gen.ts; then
// replace these aliases with `export * from "./expr.gen.ts"`).
/** expr.rs:34 `pub(super) struct WillCreateDefIdsVisitor;` (a `Visitor` with `Result = ControlFlow<Span>`) */
export type WillCreateDefIdsVisitor = unknown;
/** expr.rs:37 `struct MoveExprInitializer<'a>` */
export type MoveExprInitializer = unknown;
/** expr.rs:46 `pub(super) struct MoveExprState<'hir>` */
export type MoveExprState = unknown;
/** expr.rs:50 `pub(super) struct MoveExprOccurrence<'hir>` */
export type MoveExprOccurrence = unknown;
/** expr.rs:57 `struct MoveExprInitializerFinder<'a>` */
export type MoveExprInitializerFinder = unknown;
/** expr.rs:2377 `enum FutureKind` */
export type FutureKind = unknown;

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::expr::LoweringContext", [
  "with_move_expr_bindings", "with_move_expr_initializer", "record_move_expr", "lower_expr_with_move_exprs",
  "lower_expr_with_move_exprs_in_block", "lower_expr_with_move_expr_initializers", "lower_exprs",
  "lower_expr", "lower_expr_mut", "lower_const_block", "lower_lit", "lower_unop", "lower_binop",
  "lower_assign_op", "lower_legacy_const_generics", "lower_expr_if", "lower_expr_while_in_loop_scope",
  "lower_expr_try_block", "wrap_in_try_constructor", "lower_arm", "lower_capture_clause",
  "make_desugared_coroutine_expr", "maybe_forward_track_caller", "lower_expr_await", "make_lowered_await",
  "lower_expr_use", "lower_expr_assign", "extract_tuple_struct_path", "extract_unit_struct_path",
  "destructure_assign", "destructure_assign_mut", "destructure_sequence", "lower_expr_range_closed",
  "lower_expr_range", "lower_label", "lower_loop_destination", "lower_jump_destination",
  "with_try_block_scope", "with_loop_scope", "with_loop_condition_scope", "lower_expr_field",
  "lower_expr_yield", "lower_expr_for", "lower_expr_try", "lower_expr_yeet", "expr_drop_temps",
  "expr_drop_temps_mut", "expr_match", "expr_break", "expr_break_alloc", "expr_mut_addr_of", "expr_unit",
  "expr_str", "expr_byte_str", "expr_call_mut", "expr_struct", "expr_enum_variant",
  "expr_enum_variant_lang_item", "expr_call", "expr_call_lang_item_fn_mut", "expr_call_lang_item_fn",
  "expr_lang_item_path", "expr_lang_item_type_relative", "expr_ident", "expr_ident_mut", "expr_unsafe",
  "expr_block_empty", "expr_block", "block_expr_block", "expr_ref", "expr_bool_literal", "expr",
  "expr_field", "arm", "unreachable_code_attr",
]);
