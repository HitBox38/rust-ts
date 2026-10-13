// Port of compiler/rustc_ast_ir/src/visit.rs
//
// PORT: trait `VisitorResult` -> the interface `VisitorResult<Self, Residual>` plus one impl object per
// upstream impl (`VisitorResult.unit` for `()`, `VisitorResult.ControlFlow()`, `VisitorResult.Result()`).
// A visitor names its `type Result` by carrying the impl object in its `Result` property (see
// rustc_ast/visit.ts `Visitor`), so `V::Result::output()` is `visitor.Result.output()`.
// PORT: the two encodings of `()` (review w456a ast-visit L4, recorded decision): a fn or hook *returning*
// `()` returns `undefined` (JS `void`), which is what the `()` impl models; `()` as a *stored value*
// (a field, a `Result`/`Option` payload, a type argument) is `null`, the tools/codegen mapping, which
// keeps `Some(())` (`null`) distinct from `None` (`undefined`). So `Result<(), E>` is `Result<null, E>` and
// `ControlFlow<B>` (`C = ()`) continues with `Continue(null)`.
import { panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

// PORT: `core::ops::ControlFlow<B, C = ()>`, encoded like every ported enum. Pending a home in src/std
// (root): move it to `src/std/ops.ts` and re-export it from here.
export type ControlFlow<B, C = null> = { readonly $: "Continue"; readonly _0: C } | { readonly $: "Break"; readonly _0: B };
export const ControlFlow = {
  /** `ControlFlow::Continue(())`, a shared frozen singleton (`()` payload: `null`). */
  CONTINUE: Object.freeze({ $: "Continue" as const, _0: null }),
  Continue<C>(c: C): { readonly $: "Continue"; readonly _0: C } {
    return { $: "Continue", _0: c };
  },
  Break<B>(b: B): { readonly $: "Break"; readonly _0: B } {
    return { $: "Break", _0: b };
  },
};

// rustc-trait: compiler/rustc_ast_ir/src/visit.rs:4 VisitorResult
/// Similar to the `Try` trait, but also implemented for `()`.
export interface VisitorResult<Self, Residual> {
  // rustc: compiler/rustc_ast_ir/src/visit.rs:6 output
  output(): Self;
  // rustc: compiler/rustc_ast_ir/src/visit.rs:7 from_residual
  from_residual(residual: Residual): Self;
  // rustc: compiler/rustc_ast_ir/src/visit.rs:8 from_branch
  from_branch(b: ControlFlow<Residual>): Self;
  // rustc: compiler/rustc_ast_ir/src/visit.rs:9 branch
  branch(self: Self): ControlFlow<Residual>;
}

// PORT: `impl VisitorResult for ()`: `type Residual = !` -> `never`.
// PORT: rustc rejects at compile time a visitor whose hooks return `ControlFlow`/`Result` while its
// `type Result` is still the `()` default. TS cannot: a visitor that forgot `override Result = ...`
// would inherit this impl, whose `branch` turns every `Break`/`Err` into `Continue`, silently
// dropping it (review w456a ast-visit M1). So `branch` and `from_branch` panic (ICE) on anything but
// `()` (`undefined`) / `Continue`, which upstream makes unrepresentable.
export const UNIT_RESULT_MISMATCH =
  "visitor returned a value but its `Result` is `()`: set `override Result = VisitorResult.ControlFlow<T>()` (or `.Result<E>()`)";
const VisitorResult_unit: VisitorResult<undefined, never> = {
  // rustc: compiler/rustc_ast_ir/src/visit.rs:19 output
  output(): undefined {
    return undefined;
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:20 from_residual
  from_residual(_: never): undefined {
    return undefined;
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:21 from_branch
  from_branch(b: ControlFlow<never>): undefined {
    if (b.$ !== "Continue") panic(UNIT_RESULT_MISMATCH);
    return undefined;
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:22 branch
  branch(self: undefined): ControlFlow<never> {
    if (self !== undefined) panic(UNIT_RESULT_MISMATCH);
    return ControlFlow.CONTINUE;
  },
};

// PORT: `impl<T> VisitorResult for ControlFlow<T>`; `T` is erased, so one object serves every `T`.
const VisitorResult_ControlFlow: VisitorResult<ControlFlow<unknown>, unknown> = {
  // rustc: compiler/rustc_ast_ir/src/visit.rs:30 output
  output(): ControlFlow<unknown> {
    return ControlFlow.CONTINUE;
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:33 from_residual
  from_residual(residual: unknown): ControlFlow<unknown> {
    return ControlFlow.Break(residual);
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:36 from_branch
  from_branch(b: ControlFlow<unknown>): ControlFlow<unknown> {
    return b;
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:39 branch
  branch(self: ControlFlow<unknown>): ControlFlow<unknown> {
    return self;
  },
};

// PORT: `impl<E> VisitorResult for Result<(), E>`; `E` is erased, so one object serves every `E`.
const VisitorResult_Result: VisitorResult<Result<null, unknown>, unknown> = {
  // rustc: compiler/rustc_ast_ir/src/visit.rs:47 output
  output(): Result<null, unknown> {
    return Ok(null);
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:50 from_residual
  from_residual(residual: unknown): Result<null, unknown> {
    return Err(residual);
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:53 from_branch
  from_branch(b: ControlFlow<unknown>): Result<null, unknown> {
    switch (b.$) {
      case "Continue":
        return Ok(null);
      case "Break":
        return Err(b._0);
    }
  },
  // rustc: compiler/rustc_ast_ir/src/visit.rs:59 branch
  branch(self: Result<null, unknown>): ControlFlow<unknown> {
    switch (self.$) {
      case "Ok":
        return ControlFlow.CONTINUE;
      case "Err":
        return ControlFlow.Break(self._0);
    }
  },
};

/** The `VisitorResult` impls, by implementing type. */
export const VisitorResult = {
  /** `impl VisitorResult for ()` */
  unit: VisitorResult_unit,
  /** `impl<T> VisitorResult for ControlFlow<T>` */
  ControlFlow<T>(): VisitorResult<ControlFlow<T>, T> {
    return VisitorResult_ControlFlow as VisitorResult<ControlFlow<T>, T>;
  },
  /** `impl<E> VisitorResult for Result<(), E>` */
  Result<E>(): VisitorResult<Result<null, E>, E> {
    return VisitorResult_Result as VisitorResult<Result<null, E>, E>;
  },
};

// PORT: `try_visit!($e)` is a macro that `return`s from the enclosing fn:
//     match VisitorResult::branch($e) { Continue(()) => (), Break(r) => return VisitorResult::from_residual(r) }
// TS cannot return from a callee, so `try_visit(R, e)` returns the value to return early with
// (`from_residual(r)`) on `Break`, and `undefined` on `Continue`. No impl's `from_residual` yields
// `undefined` (`()` never breaks), so the expansion at every call site is:
//     let r: R | undefined;
//     if ((r = try_visit(visitor.Result, e)) !== undefined) return r;
export function try_visit<R, Residual>(R_: VisitorResult<R, Residual>, e: R): R | undefined {
  const b = R_.branch(e);
  if (b.$ === "Break") return R_.from_residual(b._0);
  return undefined;
}

// PORT: `visit_opt!`, `walk_list!` and `walk_visitable_list!` are expanded inline at their call sites
// (a `for` loop / `if` around `try_visit`).
