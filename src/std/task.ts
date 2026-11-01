// `core::task::Poll` stand-in (library/core/src/task/poll.rs), created by lane miri-eval: Miri's stack-empty callbacks
// (`StackEmptyCallback`, `MainThreadState::on_main_stack_empty`, `GlobalCtorState` / `TlsDtorsState::on_stack_empty`)
// return `InterpResult<Poll<()>>`.
//
// PORT: an enum with data (PORTING §5): `{ $: "Ready", _0: T } | { $: "Pending" }`. `Poll::Pending` and
// `Poll::Ready(())` are shared frozen singletons (`Poll.Pending`, `Poll.Ready_unit`).

/// Indicates whether a value is available or if the current task has been
/// scheduled to receive a wakeup instead.
export type Poll<T> =
  /// Represents that a value is immediately ready.
  | { readonly $: "Ready"; readonly _0: T }
  /// Represents that a value is not ready yet.
  | { readonly $: "Pending" };

export const Poll = {
  Pending: Object.freeze({ $: "Pending" as const }),
  /** `Poll::Ready(())` */
  Ready_unit: Object.freeze({ $: "Ready" as const, _0: null }),
  Ready<T>(v: T): Poll<T> {
    return { $: "Ready", _0: v };
  },
};
