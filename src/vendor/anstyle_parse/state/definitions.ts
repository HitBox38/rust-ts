// Port of anstyle-parse =0.2.7 `src/state/definitions.rs`.
//
// PORT: `State`/`Action` are `#[repr(u8)]` fieldless enums → string unions with companion consts
// and `<Enum>_discriminant`; `unpack`'s `mem::transmute::<u8, _>` → indexing `STATES`/`ACTIONS`
// (the same mapping: both arrays list the variants in discriminant order).

import { Err, Ok, type Result } from "../../../std/result.ts";

export type State =
  | "Anywhere"
  | "CsiEntry"
  | "CsiIgnore"
  | "CsiIntermediate"
  | "CsiParam"
  | "DcsEntry"
  | "DcsIgnore"
  | "DcsIntermediate"
  | "DcsParam"
  | "DcsPassthrough"
  | "Escape"
  | "EscapeIntermediate"
  | "Ground"
  | "OscString"
  | "SosPmApcString"
  | "Utf8";

export const State = {
  Anywhere: "Anywhere",
  CsiEntry: "CsiEntry",
  CsiIgnore: "CsiIgnore",
  CsiIntermediate: "CsiIntermediate",
  CsiParam: "CsiParam",
  DcsEntry: "DcsEntry",
  DcsIgnore: "DcsIgnore",
  DcsIntermediate: "DcsIntermediate",
  DcsParam: "DcsParam",
  DcsPassthrough: "DcsPassthrough",
  Escape: "Escape",
  EscapeIntermediate: "EscapeIntermediate",
  Ground: "Ground",
  OscString: "OscString",
  SosPmApcString: "SosPmApcString",
  Utf8: "Utf8",

  /** `#[derive(Default)]`: `#[default] Ground` */
  default_(): State {
    return "Ground";
  },

  // impl TryFrom<u8> for State
  // crate: anstyle-parse-0.2.7/src/state/definitions.rs:32 try_from
  try_from(raw: number): Result<State, number> {
    const s = STATES[raw];
    return s !== undefined ? Ok(s) : Err(raw);
  },
} as const;

export const State_discriminant: Readonly<Record<State, number>> = {
  Anywhere: 0,
  CsiEntry: 1,
  CsiIgnore: 2,
  CsiIntermediate: 3,
  CsiParam: 4,
  DcsEntry: 5,
  DcsIgnore: 6,
  DcsIntermediate: 7,
  DcsParam: 8,
  DcsPassthrough: 9,
  Escape: 10,
  EscapeIntermediate: 11,
  Ground: 12,
  OscString: 13,
  SosPmApcString: 14,
  Utf8: 15,
};

/** `#[derive(Debug)]` */
export const debug_State = (v: State): string => v;

const STATES: readonly State[] = [
  "Anywhere",
  "CsiEntry",
  "CsiIgnore",
  "CsiIntermediate",
  "CsiParam",
  "DcsEntry",
  "DcsIgnore",
  "DcsIntermediate",
  "DcsParam",
  "DcsPassthrough",
  "Escape",
  "EscapeIntermediate",
  "Ground",
  "OscString",
  "SosPmApcString",
  "Utf8",
];

export type Action =
  | "Nop"
  | "Clear"
  | "Collect"
  | "CsiDispatch"
  | "EscDispatch"
  | "Execute"
  | "Hook"
  | "Ignore"
  | "OscEnd"
  | "OscPut"
  | "OscStart"
  | "Param"
  | "Print"
  | "Put"
  | "Unhook"
  | "BeginUtf8";

export const Action = {
  Nop: "Nop",
  Clear: "Clear",
  Collect: "Collect",
  CsiDispatch: "CsiDispatch",
  EscDispatch: "EscDispatch",
  Execute: "Execute",
  Hook: "Hook",
  Ignore: "Ignore",
  OscEnd: "OscEnd",
  OscPut: "OscPut",
  OscStart: "OscStart",
  Param: "Param",
  Print: "Print",
  Put: "Put",
  Unhook: "Unhook",
  BeginUtf8: "BeginUtf8",

  /** `#[derive(Default)]`: `#[default] Nop` */
  default_(): Action {
    return "Nop";
  },

  // impl TryFrom<u8> for Action
  // crate: anstyle-parse-0.2.7/src/state/definitions.rs:83 try_from
  try_from(raw: number): Result<Action, number> {
    const a = ACTIONS[raw];
    return a !== undefined ? Ok(a) : Err(raw);
  },
} as const;

export const Action_discriminant: Readonly<Record<Action, number>> = {
  Nop: 0,
  Clear: 1,
  Collect: 2,
  CsiDispatch: 3,
  EscDispatch: 4,
  Execute: 5,
  Hook: 6,
  Ignore: 7,
  OscEnd: 8,
  OscPut: 9,
  OscStart: 10,
  Param: 11,
  Print: 12,
  Put: 13,
  Unhook: 14,
  BeginUtf8: 15,
};

/** `#[derive(Debug)]` */
export const debug_Action = (v: Action): string => v;

const ACTIONS: readonly Action[] = [
  "Nop",
  "Clear",
  "Collect",
  "CsiDispatch",
  "EscDispatch",
  "Execute",
  "Hook",
  "Ignore",
  "OscEnd",
  "OscPut",
  "OscStart",
  "Param",
  "Print",
  "Put",
  "Unhook",
  "BeginUtf8",
];

/// Unpack a u8 into a State and Action
///
/// The implementation of this assumes that there are *precisely* 16 variants for both Action and
/// State. Furthermore, it assumes that the enums are tag-only; that is, there is no data in any
/// variant.
///
/// Bad things will happen if those invariants are violated.
// crate: anstyle-parse-0.2.7/src/state/definitions.rs:115 unpack
export function unpack(delta: number): [State, Action] {
  return [
    // State is stored in bottom 4 bits
    STATES[delta & 0x0f]!,
    // Action is stored in top 4 bits
    ACTIONS[(delta & 0xff) >> 4]!,
  ];
}

// PORT: `#[cfg(test)]` upstream; ported as a plain export (used by the codegen test).
// crate: anstyle-parse-0.2.7/src/state/definitions.rs:128 pack
export function pack(state: State, action: Action): number {
  return ((Action_discriminant[action] << 4) | State_discriminant[state]) & 0xff;
}
