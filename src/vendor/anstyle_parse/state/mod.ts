// Port of anstyle-parse =0.2.7 `src/state/mod.rs`.
//
//! ANSI escape code parsing state machine
//
// PORT: `#[cfg(test)] mod codegen;` is ported as `codegen.test.ts`.

import { unpack, type Action, type State, State_discriminant } from "./definitions.ts";
import { STATE_CHANGES } from "./table.ts";

export { pack, unpack, Action, State, Action_discriminant, State_discriminant, debug_Action, debug_State } from "./definitions.ts";

/// Transition to next [`State`]
///
/// Note: This does not directly support UTF-8.
/// - If the data is validated as UTF-8 (e.g. `str`) or single-byte C1 control codes are
///   unsupported, then treat [`Action::BeginUtf8`] and [`Action::Execute`] for UTF-8 continuations
///   as [`Action::Print`].
/// - If the data is not validated, then a UTF-8 state machine will need to be implemented on top,
///   starting with [`Action::BeginUtf8`].
///
/// Note: When [`State::Anywhere`] is returned, revert back to the prior state.
// crate: anstyle-parse-0.2.7/src/state/mod.rs:25 state_change
export function state_change(state: State, byte: number): [State, Action] {
  // Handle state changes in the anywhere state before evaluating changes
  // for current state.
  let change = state_change_("Anywhere", byte);
  if (change === 0) {
    change = state_change_(state, byte);
  }

  // Unpack into a state and action
  return unpack(change);
}

// crate: anstyle-parse-0.2.7/src/state/mod.rs:38 state_change_
function state_change_(state: State, byte: number): number {
  const state_idx = State_discriminant[state];
  const byte_idx = byte;

  return STATE_CHANGES[state_idx]![byte_idx]!;
}
