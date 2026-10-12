// Port of utf8parse =0.2.2 `src/types.rs`.
//
//! Types supporting the UTF-8 parser

/// Action to take when receiving a byte
export type Action =
  /// Unexpected byte; sequence is invalid
  | "InvalidSequence"
  /// Received valid 7-bit ASCII byte which can be directly emitted.
  | "EmitByte"
  /// Set the bottom continuation byte
  | "SetByte1"
  /// Set the 2nd-from-last continuation byte
  | "SetByte2"
  /// Set the 2nd-from-last byte which is part of a two byte sequence
  | "SetByte2Top"
  /// Set the 3rd-from-last continuation byte
  | "SetByte3"
  /// Set the 3rd-from-last byte which is part of a three byte sequence
  | "SetByte3Top"
  /// Set the top byte of a four byte sequence.
  | "SetByte4";

export const Action = {
  InvalidSequence: "InvalidSequence",
  EmitByte: "EmitByte",
  SetByte1: "SetByte1",
  SetByte2: "SetByte2",
  SetByte2Top: "SetByte2Top",
  SetByte3: "SetByte3",
  SetByte3Top: "SetByte3Top",
  SetByte4: "SetByte4",
} as const;

export const Action_discriminant: Readonly<Record<Action, number>> = {
  InvalidSequence: 0,
  EmitByte: 1,
  SetByte1: 2,
  SetByte2: 3,
  SetByte2Top: 4,
  SetByte3: 5,
  SetByte3Top: 6,
  SetByte4: 7,
};

/** `#[derive(Debug)]` */
export const debug_Action = (v: Action): string => v;

/// States the parser can be in.
///
/// There is a state for each initial input of the 3 and 4 byte sequences since
/// the following bytes are subject to different conditions than a tail byte.
export type State =
  /// Ground state; expect anything
  | "Ground"
  /// 3 tail bytes
  | "Tail3"
  /// 2 tail bytes
  | "Tail2"
  /// 1 tail byte
  | "Tail1"
  /// UTF8-3 starting with E0
  | "U3_2_e0"
  /// UTF8-3 starting with ED
  | "U3_2_ed"
  /// UTF8-4 starting with F0
  | "Utf8_4_3_f0"
  /// UTF8-4 starting with F4
  | "Utf8_4_3_f4";

export const State = {
  Ground: "Ground",
  Tail3: "Tail3",
  Tail2: "Tail2",
  Tail1: "Tail1",
  U3_2_e0: "U3_2_e0",
  U3_2_ed: "U3_2_ed",
  Utf8_4_3_f0: "Utf8_4_3_f0",
  Utf8_4_3_f4: "Utf8_4_3_f4",

  /** `#[derive(Default)]`: `#[default] Ground` */
  default_(): State {
    return "Ground";
  },

  /// Advance the parser state.
  ///
  /// This takes the current state and input byte into consideration, to determine the next state
  /// and any action that should be taken.
  // crate: utf8parse-0.2.2/src/types.rs:56 advance
  advance(self: State, byte: number): [State, Action] {
    switch (self) {
      case "Ground":
        if (byte >= 0x00 && byte <= 0x7f) return ["Ground", "EmitByte"];
        else if (byte >= 0xc2 && byte <= 0xdf) return ["Tail1", "SetByte2Top"];
        else if (byte === 0xe0) return ["U3_2_e0", "SetByte3Top"];
        else if (byte >= 0xe1 && byte <= 0xec) return ["Tail2", "SetByte3Top"];
        else if (byte === 0xed) return ["U3_2_ed", "SetByte3Top"];
        else if (byte >= 0xee && byte <= 0xef) return ["Tail2", "SetByte3Top"];
        else if (byte === 0xf0) return ["Utf8_4_3_f0", "SetByte4"];
        else if (byte >= 0xf1 && byte <= 0xf3) return ["Tail3", "SetByte4"];
        else if (byte === 0xf4) return ["Utf8_4_3_f4", "SetByte4"];
        else return ["Ground", "InvalidSequence"];
      case "U3_2_e0":
        if (byte >= 0xa0 && byte <= 0xbf) return ["Tail1", "SetByte2"];
        else return ["Ground", "InvalidSequence"];
      case "U3_2_ed":
        if (byte >= 0x80 && byte <= 0x9f) return ["Tail1", "SetByte2"];
        else return ["Ground", "InvalidSequence"];
      case "Utf8_4_3_f0":
        if (byte >= 0x90 && byte <= 0xbf) return ["Tail2", "SetByte3"];
        else return ["Ground", "InvalidSequence"];
      case "Utf8_4_3_f4":
        if (byte >= 0x80 && byte <= 0x8f) return ["Tail2", "SetByte3"];
        else return ["Ground", "InvalidSequence"];
      case "Tail3":
        if (byte >= 0x80 && byte <= 0xbf) return ["Tail2", "SetByte3"];
        else return ["Ground", "InvalidSequence"];
      case "Tail2":
        if (byte >= 0x80 && byte <= 0xbf) return ["Tail1", "SetByte2"];
        else return ["Ground", "InvalidSequence"];
      case "Tail1":
        if (byte >= 0x80 && byte <= 0xbf) return ["Ground", "SetByte1"];
        else return ["Ground", "InvalidSequence"];
    }
  },
} as const;

export const State_discriminant: Readonly<Record<State, number>> = {
  Ground: 0,
  Tail3: 1,
  Tail2: 2,
  Tail1: 3,
  U3_2_e0: 4,
  U3_2_ed: 5,
  Utf8_4_3_f0: 6,
  Utf8_4_3_f4: 7,
};

/** `#[derive(Debug)]` */
export const debug_State = (v: State): string => v;
