// Port of icu_list 2.3.0 `src/provider/serde_dfa.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { panic } from "../../../std/panic.ts";
import { DFA } from "../../regex_automata/dfa/sparse.ts";

/// A serde-compatible version of [`regex_automata::dfa::sparse::DFA`].
///
/// This does not implement
/// [`serde::Deserialize`] directly, as binary deserialization is not supported in big-endian
/// platforms. `Self::maybe_deserialize` can be used to deserialize to `Option<SerdeDFA>`.
///
/// <div class="stab unstable">
/// 🚧 This code is considered unstable; it may change at any time, in breaking or non-breaking ways,
/// including in SemVer minor releases. While the serde representation of data structs is guaranteed
/// to be stable, their Rust representation might not be. Use with caution.
/// </div>
// #[derive(Clone, Debug, yoke::Yokeable, zerofrom::ZeroFrom)]
export class SerdeDFA {
  constructor(
    // Safety: These always represent a valid DFA (DFA::from_bytes(dfa_bytes).is_ok())
    // PORT: `VarZeroCow<'data, [u8]>` is the byte array. The `serde_human` `pattern` field is cfg'd out.
    public dfa_bytes: Uint8Array,
  ) {}

  // impl PartialEq for SerdeDFA<'_>
  // crate: icu_list-2.3.0/src/provider/serde_dfa.rs:29 eq
  eq(other: SerdeDFA): boolean {
    return this.dfa_bytes.length === other.dfa_bytes.length && this.dfa_bytes.every((b, i) => b === other.dfa_bytes[i]);
  }

  // crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:36 bake feature "datagen" off
  // crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:58 borrows_size feature "datagen" off
  // crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:65 serialize feature "datagen" off
  // crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:90 maybe_deserialize feature "serde" off

  /// Creates a `SerdeDFA` from raw bytes. Used internally by databake.
  ///
  /// # Safety
  ///
  /// `dfa_bytes` has to be a valid DFA (`regex_automata::dfa::sparse::DFA::from_bytes(dfa_bytes).is_ok()`)
  // crate: icu_list-2.3.0/src/provider/serde_dfa.rs:131 from_dfa_bytes_unchecked
  static from_dfa_bytes_unchecked(dfa_bytes: Uint8Array): SerdeDFA {
    // SAFETY: safe for VarZeroCow<[u8]>
    return new SerdeDFA(dfa_bytes);
  }

  // crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:142 new features "datagen"/"serde_human" off (needs the regex-automata DFA builder)

  /// Returns the represented [`DFA`]
  // crate: icu_list-2.3.0/src/provider/serde_dfa.rs:180 deref
  deref(): DFA {
    // Safe due to struct invariant.
    const r = DFA.from_bytes_unchecked(this.dfa_bytes);
    if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
    return r._0[0];
  }
}

// crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:193 test_serde_dfa #[cfg(all(test, feature = "datagen"))]: needs the DFA builder
// crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:235 test_postcard_serialization #[cfg(all(test, feature = "datagen"))]: serde/postcard
// crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:259 test_rmp_serialization #[cfg(all(test, feature = "datagen"))]: serde/rmp
// crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:271 test_json_serialization #[cfg(all(test, feature = "datagen"))]: serde_json
// crate-skip: icu_list-2.3.0/src/provider/serde_dfa.rs:283 databake #[cfg(all(test, feature = "datagen"))]: databake
