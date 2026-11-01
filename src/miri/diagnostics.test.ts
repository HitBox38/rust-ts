// Unit tests of src/miri/diagnostics.ts (lane miri-driver) for what is testable without a Miri run: `TerminationInfo`'s
// Display (the error titles of `report_result`), its `MachineStopType` box, the validation path, `SpanDedupDiagnostic`.
// The expected texts are the format strings of diagnostics.rs:71-103 at the pin. Not an upstream port.
import { expect, test } from "bun:test";
import "./lib.ts";
import { Size } from "../rustc_abi/lib.ts";
import { display_InterpErrorKind, Pointer, type AllocId } from "../rustc_middle/mir/interpret/mod.ts";
import { create_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { DEFAULT_EDITION } from "../rustc_span/edition.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import {
  debug_TerminationInfo,
  display_TerminationInfo,
  SpanDedupDiagnostic,
  type TerminationInfo,
  TerminationInfo_into_machine_stop,
  TerminationInfoStop,
} from "./diagnostics.ts";
import { EXTRA_SYMBOLS } from "./sym.ts";

test("TerminationInfo: Display / Debug", () => {
  create_session_globals_then(DEFAULT_EDITION, EXTRA_SYMBOLS, undefined, () => {
    const cases: [TerminationInfo, string][] = [
      [{ $: "Exit", code: 3, leak_check: true }, "the evaluated program completed with exit code 3"],
      [{ $: "Abort", _0: "the program aborted execution" }, "the program aborted execution"],
      [{ $: "Interrupted" }, "interpretation was interrupted"],
      [{ $: "UnsupportedInIsolation", _0: "`open` not available when isolation is enabled" }, "`open` not available when isolation is enabled"],
      [
        { $: "Int2PtrWithStrictProvenance" },
        "integer-to-pointer casts and `ptr::with_exposed_provenance` are not supported with `-Zmiri-strict-provenance`",
      ],
      [{ $: "StackedBorrowsUb", msg: "attempting a read access", help: [], history: undefined }, "attempting a read access"],
      [{ $: "GlobalDeadlock" }, "the evaluated program deadlocked"],
      [{ $: "LocalDeadlock" }, "a thread deadlocked"],
      [{ $: "GenmcMoot" }, "GenMC wants to skip this execution"],
      [
        { $: "MultipleSymbolDefinitions", link_name: Symbol.intern("foo"), first: DUMMY_SP, first_crate: Symbol.intern("a"), second: DUMMY_SP, second_crate: Symbol.intern("b") },
        "multiple definitions of symbol `foo`",
      ],
      [{ $: "SymbolShimClashing", link_name: Symbol.intern("malloc"), span: DUMMY_SP }, "found `malloc` symbol definition that clashes with a built-in shim"],
      [
        {
          $: "DataRace",
          involves_non_atomic: true,
          ptr: new Pointer<AllocId>(Size.from_bytes(16), 5 as AllocId),
          op1: { action: "non-atomic write", thread_info: "thread `unnamed-1`", span: DUMMY_SP },
          op2: { action: "non-atomic read", thread_info: "thread `main`", span: DUMMY_SP },
          extra: undefined,
          retag_explain: false,
        },
        "Data race detected between (1) non-atomic write on thread `unnamed-1` and (2) non-atomic read on thread `main` at alloc5+0x10",
      ],
      [{ $: "UnsupportedForeignItem", _0: "can't call foreign function `foo` on OS `linux`" }, "can't call foreign function `foo` on OS `linux`"],
    ];
    for (const [info, text] of cases) {
      expect(display_TerminationInfo(info)).toBe(text);
      expect(debug_TerminationInfo(info, PLAIN)).toBe(text);
    }
  });
});

test("TerminationInfo as a MachineStop payload: downcast, Display through InterpErrorKind, with_validation_path", () => {
  const info: TerminationInfo = { $: "StackedBorrowsUb", msg: "m", help: ["h"], history: undefined };
  const kind = TerminationInfo_into_machine_stop(info);
  expect(kind.$).toBe("MachineStop");
  if (kind.$ !== "MachineStop") return;
  expect(TerminationInfoStop.downcast_ref(kind._0)).toBe(info);
  expect(display_InterpErrorKind(kind)).toBe("m");
  kind._0.with_validation_path(".0.x");
  expect(info.$ === "StackedBorrowsUb" && info.help).toEqual(["h", "while retagging field .0.x"]);
  // Other variants ignore the path.
  const exit = TerminationInfoStop.new({ $: "Exit", code: 0, leak_check: false });
  exit.with_validation_path(".y");
  expect(exit.info).toEqual({ $: "Exit", code: 0, leak_check: false });
  // A foreign `MachineStopType` does not downcast.
  expect(TerminationInfoStop.downcast_ref({ display: () => "", debug: () => "", with_validation_path: () => {} })).toBeUndefined();
});

test("SpanDedupDiagnostic::new is empty and per-instance", () => {
  const a = SpanDedupDiagnostic.new();
  const b = SpanDedupDiagnostic.new();
  expect(a._0.size).toBe(0);
  expect(a._0).not.toBe(b._0);
});
