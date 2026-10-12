// Port of icu_list 2.3.0 `src/lazy_automaton.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { utf8 } from "../../std/str.ts";
import type { DFA } from "../regex_automata/dfa/sparse.ts";
import { Config as StartConfig } from "../regex_automata/util/start.ts";
import { Anchored } from "../regex_automata/util/search.ts";
import { FMT_ERR, FMT_OK, type FmtWrite, type fmt_Result, type Writeable } from "../writeable/lib.ts";

// pub trait LazyAutomaton: Automaton {
//     // Like Automaton::try_search_fwd, but doesn't require a materialized string.
//     fn matches_earliest_fwd_lazy<S: Writeable + ?Sized>(&self, haystack: &S) -> bool;
// }
// crate-skip: icu_list-2.3.0/src/lazy_automaton.rs:12 matches_earliest_fwd_lazy trait method declaration (the impl below)

class DFAStepper implements FmtWrite {
  constructor(
    public dfa: DFA,
    public state: number,
  ) {}

  // impl core::fmt::Write for DFAStepper<'_>
  // crate: icu_list-2.3.0/src/lazy_automaton.rs:23 write_str
  write_str(s: string): fmt_Result {
    for (const byte of utf8(s)) {
      this.state = this.dfa.next_state(this.state, byte);
      if (this.dfa.is_match_state(this.state) || this.dfa.is_dead_state(this.state)) {
        // We matched or are in a no-match-cycle, return early
        return FMT_ERR;
      }
    }
    return FMT_OK;
  }

  write_char(c: number): fmt_Result {
    return this.write_str(String.fromCodePoint(c));
  }
}

// impl<T: AsRef<[u8]>> LazyAutomaton for DFA<T>
// crate: icu_list-2.3.0/src/lazy_automaton.rs:16 matches_earliest_fwd_lazy
export function matches_earliest_fwd_lazy(self: DFA, haystack: Writeable): boolean {
  const start_state = self.start_state(StartConfig.new().anchored(Anchored.Yes));
  if (start_state.$ === "Err") {
    // This will not happen, because we're not using look-behind, and our DFA support anchored
    return false;
  }

  const stepper = new DFAStepper(self, start_state._0);

  if (haystack.write_to(stepper).$ === "Ok") {
    stepper.state = self.next_eoi_state(stepper.state);
  }

  return self.is_match_state(stepper.state);
}

// crate-skip: icu_list-2.3.0/src/lazy_automaton.rs:57 test #[cfg(test)]: builds a DFA with `SerdeDFA::new` (datagen)
// crate-skip: icu_list-2.3.0/src/lazy_automaton.rs:81 write_to #[cfg(test)] helper of `test`
