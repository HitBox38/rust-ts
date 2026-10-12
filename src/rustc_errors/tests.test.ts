// rust-ts scenario tests for rustc_errors (no upstream `#[cfg(test)]` tests exist in
// compiler/rustc_errors/src/{lib,diagnostic,...}.rs or rustc_error_messages). Every assertion cites
// the upstream line whose behaviour it checks.
import { expect, test } from "bun:test";
import { BytePos, create_default_session_globals_then, ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { DefIndex } from "../rustc_span/def_id.ts";
import { drop_compiler_dcx } from "../rust_ts/driver.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { Panic, panicking, Unported } from "../std/panic.ts";
import {
  a_or_an,
  as_substr,
  Diag,
  DiagCtxt,
  DiagCtxtFlags_default,
  DiagInner,
  DiagStyledString,
  display_ErrCode,
  E0001,
  E0308,
  IntoDiagArg,
  Level,
  MultiSpan,
  try_find_description,
  ErrCode,
} from "./lib.ts";
import { format_diag_messages } from "./formatting.ts";
import { Emitter } from "./emitter.ts";
import { number_into_diag_arg as numberArg } from "../rustc_error_messages/lib.ts";

interface Recorded {
  level: string;
  msg: string;
  children: string[];
  code: string | undefined;
}

class RecordingEmitter extends Emitter {
  readonly out: Recorded[] = [];
  emit_diagnostic(diag: DiagInner): void {
    this.out.push({
      level: Level.to_str(diag.level),
      msg: format_diag_messages(diag.messages, diag.args),
      children: diag.children.map((c) => `${c.level}: ${format_diag_messages(c.messages, diag.args)}`),
      code: diag.code === undefined ? undefined : display_ErrCode(diag.code),
    });
  }
  source_map(): undefined {
    return undefined;
  }
}

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));

function setup(dedup = true): { em: RecordingEmitter; dcx: DiagCtxt } {
  const em = new RecordingEmitter();
  const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true, deduplicate_diagnostics: dedup });
  return { em, dcx };
}

test_("errors and warnings are counted", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  // lib.rs:754 has_errors: no errors yet.
  expect(h.has_errors()).toBeUndefined();
  h.struct_span_err(sp(0, 3), "first").emit();
  h.struct_span_err(sp(4, 7), "second").with_code(E0308).emit();
  h.struct_span_warn(sp(8, 9), "careful").emit();
  // lib.rs:1348 every non-duplicate diagnostic reaches the emitter.
  expect(em.out.map((r) => `${r.level}: ${r.msg}`)).toEqual(["error: first", "error: second", "warning: careful"]);
  // lib.rs:716 err_count = err_guars + lint_err_guars + stashed errors; warnings are not counted.
  expect(h.err_count()).toBe(2);
  // lib.rs:1411 has_errors returns the first error's guarantee.
  expect(h.has_errors()).toBeDefined();
  // lib.rs:1341-1344 deduplicated counts.
  expect(dcx.inner.deduplicated_err_count).toBe(2);
  expect(dcx.inner.deduplicated_warn_count).toBe(1);
  // lib.rs:1300-1301 codes are recorded for `--explain`.
  expect([...dcx.inner.emitted_diagnostic_codes]).toEqual([E0308]);
});

test_("print_error_count summary and --explain notes", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  h.struct_span_err(sp(0, 1), "a").with_code(E0308).emit();
  h.struct_span_err(sp(1, 2), "b").emit();
  h.struct_warn("w").emit();
  em.out.length = 0;
  h.print_error_count();
  // lib.rs:780-804 errors and warnings are combined into one error; lib.rs:837-841 a single code.
  expect(em.out.map((r) => `${r.level}: ${r.msg}`)).toEqual([
    "error: aborting due to 2 previous errors; 1 warning emitted",
    "failure-note: For more information about this error, try `rustc --explain E0308`.",
  ]);
});

test_("print_error_count with several codes and only warnings", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  h.struct_err("x").with_code(E0308).emit();
  h.struct_err("y").with_code(E0001).emit();
  em.out.length = 0;
  h.print_error_count();
  // lib.rs:822-835 codes sorted, "Some errors have detailed explanations".
  expect(em.out.map((r) => r.msg)).toEqual([
    "aborting due to 2 previous errors",
    "Some errors have detailed explanations: E0001, E0308.",
    "For more information about an error, try `rustc --explain E0001`.",
  ]);

  const w = setup();
  w.dcx.handle().struct_warn("only").emit();
  w.dcx.handle().struct_warn("only 2").emit();
  w.em.out.length = 0;
  w.dcx.handle().print_error_count();
  // lib.rs:788-795 warnings only: a forced warning.
  expect(w.em.out.map((r) => `${r.level}: ${r.msg}`)).toEqual(["warning: 2 warnings emitted"]);
});

test_("identical diagnostics are deduplicated", () => {
  const { em, dcx } = setup(true);
  const h = dcx.handle();
  h.struct_span_err(sp(0, 3), "same").emit();
  h.struct_span_err(sp(0, 3), "same").emit();
  h.struct_span_err(sp(0, 4), "same").emit();
  // lib.rs:1304 + 1318-1319 the second identical error is not printed; a different span is.
  expect(em.out.length).toBe(2);
  // lib.rs:1351-1373 but every error still gets an ErrorGuaranteed.
  expect(h.err_count()).toBe(3);
  // lib.rs:1342 only printed errors count towards the summary.
  expect(dcx.inner.deduplicated_err_count).toBe(2);
});

test_("deduplication disabled adds a note", () => {
  const { em, dcx } = setup(false);
  const h = dcx.handle();
  h.struct_span_err(sp(0, 3), "same").emit();
  h.struct_span_err(sp(0, 3), "same").emit();
  // lib.rs:1336-1339 the duplicate is printed with an extra note.
  expect(em.out.length).toBe(2);
  expect(em.out[0]!.children).toEqual([]);
  expect(em.out[1]!.children).toEqual(["Note: duplicate diagnostic emitted due to `-Z deduplicate-diagnostics=no`"]);
});

test_("once-notes are emitted once", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  h.struct_span_err(sp(0, 1), "one").with_note("plain").note_once("only once").emit();
  h.struct_span_err(sp(1, 2), "two").with_note("plain").note_once("only once").emit();
  // lib.rs:1326-1335 OnceNote children are kept only the first time their hash is seen.
  expect(em.out[0]!.children).toEqual(["Note: plain", "OnceNote: only once"]);
  expect(em.out[1]!.children).toEqual(["Note: plain"]);
});

test_("warnings can be disabled", () => {
  const em = new RecordingEmitter();
  const dcx = DiagCtxt.new(em).disable_warnings();
  dcx.handle().struct_warn("hidden").emit();
  // lib.rs:1263-1270 warnings without an override are dropped when `can_emit_warnings` is false.
  expect(em.out.length).toBe(0);
  expect(dcx.inner.deduplicated_warn_count).toBe(0);
});

test_("stash and steal an error", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  const span = sp(10, 12);
  const guar = h.struct_span_err(span, "stashed error").stash(span, "ItemNoType");
  // lib.rs:610 stashing an error returns a guarantee (via a delayed bug).
  expect(guar).toBeDefined();
  expect(dcx.inner.delayed_bugs.length).toBe(1);
  // lib.rs:720-724 stashed errors count; lib.rs:1416-1419 and has_errors sees them.
  expect(h.err_count()).toBe(1);
  expect(h.has_errors()).toBeDefined();
  // lib.rs:698-706
  expect(h.has_stashed_diagnostic(span, "ItemNoType")).toBe(true);
  expect(h.has_stashed_diagnostic(span, "ExprInPat")).toBe(false);
  expect(em.out.length).toBe(0);

  // lib.rs:649-670 steal, modify, emit.
  const g2 = h.try_steal_modify_and_emit_err(span, "ItemNoType", (err) => {
    err.note("improved");
  });
  expect(g2).toBeDefined();
  expect(em.out.map((r) => [r.msg, r.children])).toEqual([["stashed error", ["Note: improved"]]]);
  expect(h.has_stashed_diagnostic(span, "ItemNoType")).toBe(false);
  // lib.rs:1356-1359 emitting an error discards recorded delayed bugs.
  expect(dcx.inner.delayed_bugs.length).toBe(0);
  expect(h.err_count()).toBe(1);
  // lib.rs:649 nothing left to steal.
  expect(h.try_steal_modify_and_emit_err(span, "ItemNoType", () => {})).toBeUndefined();
});

test_("stash and steal a warning", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  const span = sp(3, 4);
  // lib.rs:614 non-errors stash without a guarantee.
  expect(h.struct_span_warn(span, "w").stash(span, "EarlySyntaxWarning")).toBeUndefined();
  expect(h.err_count()).toBe(0);
  // lib.rs:634-643 steal_non_err returns the diagnostic.
  const d = h.steal_non_err(span, "EarlySyntaxWarning");
  expect(d).toBeDefined();
  d!.cancel();
  expect(em.out.length).toBe(0);
  expect(h.steal_non_err(span, "EarlySyntaxWarning")).toBeUndefined();
});

test_("emit_stashed_diagnostics skips unforced warnings once there are errors", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  h.struct_span_warn(sp(0, 1), "stashed warning").stash(sp(0, 1), "EarlySyntaxWarning");
  h.struct_span_err(sp(2, 3), "real error").emit();
  em.out.length = 0;
  // lib.rs:1190-1195 stashed unforced warnings are skipped when errors exist.
  expect(h.emit_stashed_diagnostics()).toBeUndefined();
  expect(em.out.length).toBe(0);
  expect(dcx.inner.stashed_diagnostics.size).toBe(0);

  const w = setup();
  w.dcx.handle().struct_span_warn(sp(0, 1), "stashed warning").stash(sp(0, 1), "EarlySyntaxWarning");
  w.dcx.handle().emit_stashed_diagnostics();
  // lib.rs:1196 otherwise they are emitted.
  expect(w.em.out.map((r) => r.msg)).toEqual(["stashed warning"]);
});

test_("delayed bugs", () => {
  const { dcx } = setup();
  const h = dcx.handle();
  const g = h.delayed_bug("later");
  // lib.rs:1242-1257 a delayed bug is recorded when no error exists.
  expect(g).toBeDefined();
  expect(h.has_errors()).toBeUndefined();
  expect(h.has_errors_or_delayed_bugs()).toBeDefined();
  h.err("real");
  // lib.rs:1356-1359 emitting the error discarded the delayed bug.
  expect(dcx.inner.delayed_bugs.length).toBe(0);
  // lib.rs:1242-1243 with an error present, a new delayed bug just returns it.
  h.delayed_bug("again");
  expect(dcx.inner.delayed_bugs.length).toBe(0);
});

test_("flush_delayed does nothing once an error exists", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  h.delayed_bug("later");
  expect(dcx.inner.delayed_bugs.length).toBe(1);
  // Emitting an error would clear `delayed_bugs` (lib.rs:1356-1359), so record the error's
  // guarantee directly: the state is then "delayed bugs present, errors present".
  dcx.inner.err_guars.push([ErrorGuaranteed.unchecked_error_guaranteed(), 1]);
  // lib.rs:1433-1436 early return: nothing emitted, nothing taken, no panic.
  h.flush_delayed();
  expect(em.out.length).toBe(0);
  expect(dcx.inner.delayed_bugs.length).toBe(1);
});

test_("flushing delayed bugs needs Fluent (unported)", () => {
  const { em, dcx } = setup();
  dcx.handle().span_delayed_bug(sp(0, 1), "oops");
  // lib.rs:1456-1459 the two notes are emitted, then lib.rs:1475 `decorate` formats an inline
  // message, which needs the Fluent bundle (unported).
  expect(() => dcx.handle().flush_delayed()).toThrow(Unported);
  expect(em.out.map((r) => r.msg)).toEqual([
    "no errors encountered even though delayed bugs were created",
    "those delayed bugs will now be shown as internal compiler errors",
  ]);
});

test_("fatal, bug and treat-err-as-bug", () => {
  const { em, dcx } = setup();
  // diagnostic.rs:1188 Fatal emits then raises FatalError.
  expect(() => dcx.handle().fatal("stop")).toThrow(FatalErrorMarker);
  expect(em.out.at(-1)!.level).toBe("error");
  // diagnostic.rs:1187 Bug emits then panics with ExplicitBug.
  expect(() => dcx.handle().bug("ice")).toThrow(Panic);
  expect(em.out.at(-1)!.level).toBe("error: internal compiler error");

  const t = setup();
  t.dcx.inner.flags.treat_err_as_bug = 1;
  // lib.rs:1222-1225 the error is promoted to Bug; lib.rs:1503-1504 then the panic.
  expect(() => t.dcx.handle().err("e")).toThrow("aborting due to `-Z treat-err-as-bug=1`");
  expect(t.em.out[0]!.level).toBe("error: internal compiler error");
});

test_("drop bomb and cancel", () => {
  const { em, dcx } = setup();
  const d = dcx.handle().struct_err("forgotten");
  // diagnostic.rs:1283-1292 dropping an unemitted Diag emits a bug and panics.
  expect(() => d.drop()).toThrow("error was constructed but not emitted");
  expect(em.out.map((r) => r.msg)).toEqual(["the following error was constructed but not emitted", "forgotten"]);
  // diagnostic.rs:1245-1248 cancel defuses it.
  const c = dcx.handle().struct_err("cancelled");
  c.cancel();
  // diagnostic.rs:1251-1255
  expect(dcx.handle().struct_err("m").cancel_into_message()).toBe("m");
  // diagnostic.rs:1252 the `?` on `messages.get(0)` drops `self` with `diag` still `Some`: bomb.
  const e = setup();
  const empty = DiagInner.new(Level.Error, "no messages");
  empty.messages.length = 0;
  expect(() => Diag.new_diagnostic(e.dcx.handle(), empty).cancel_into_message()).toThrow(
    "error was constructed but not emitted",
  );
  expect(e.em.out.map((r) => r.msg)).toEqual(["the following error was constructed but not emitted", ""]);
  expect(e.dcx.inner.live_diags?.size).toBe(0);
});

test_("DiagCtxtInner::drop drops surviving Diags (drop bomb registry)", () => {
  const { em, dcx } = setup();
  const h = dcx.handle();
  // Consumed diagnostics leave the registry (emit -> take_diag, cancel, stash, with_dcx).
  h.struct_err("emitted").emit();
  h.struct_err("cancelled").cancel();
  const s = h.struct_span_warn(sp(0, 1), "stashed");
  s.stash(sp(0, 1), "EarlySyntaxWarning");
  const other = setup();
  const moved = h.struct_err("moved").with_dcx(other.dcx.handle());
  expect([...dcx.inner.live_diags!]).toEqual([]);
  expect([...other.dcx.inner.live_diags!]).toEqual([moved]);
  moved.cancel();
  // Two forgotten diagnostics: the first one created is dropped first and fires the bomb
  // (diagnostic.rs:1283-1292); lib.rs:427 runs after every `Diag` borrowing the context is gone.
  h.struct_err("forgotten 1");
  h.struct_err("forgotten 2");
  em.out.length = 0;
  expect(() => dcx.inner.drop()).toThrow("error was constructed but not emitted");
  expect(em.out.map((r) => r.msg)).toEqual(["the following error was constructed but not emitted", "forgotten 1"]);
});

test_("drop while unwinding: no bomb (std::thread::panicking)", () => {
  const { em, dcx } = setup();
  dcx.handle().struct_err("forgotten");
  // diagnostic.rs:1285 `Some(diag) if !panicking()`; driver hook for the unwinding path.
  drop_compiler_dcx(dcx, true);
  expect(em.out.length).toBe(0);
  expect(dcx.inner.live_diags?.size).toBe(0);
  expect(panicking()).toBe(false);
  // Normal path: same drop, bomb armed.
  const n = setup();
  n.dcx.handle().struct_err("forgotten");
  expect(() => drop_compiler_dcx(n.dcx, false)).toThrow("error was constructed but not emitted");
});

test_("assert_eq! texts (core panicking.rs assert_failed_inner)", () => {
  const { dcx } = setup();
  const h = dcx.handle();
  // diagnostic.rs:1197 `assert_eq!(self.level, Level::Bug)` on an error.
  const d = h.struct_err("not a bug");
  expect(() => d.emit_bug()).toThrow("assertion `left == right` failed\n  left: Error\n right: Bug");
  d.cancel();
  // lib.rs:663 `assert_eq!(err.level, Error)` on a stolen warning.
  const span = sp(3, 4);
  h.struct_span_warn(span, "w").stash(span, "EarlySyntaxWarning");
  expect(() => h.try_steal_modify_and_emit_err(span, "EarlySyntaxWarning", () => {})).toThrow(
    "assertion `left == right` failed\n  left: Warning(None)\n right: Error",
  );
});

test_("taint is set on error", () => {
  const { dcx } = setup();
  const cell = { value: undefined as unknown };
  const h = dcx.handle().into_taintable(cell as never);
  h.struct_warn("w").emit();
  expect(cell.value).toBeUndefined();
  // lib.rs:1370-1372
  h.err("e");
  expect(cell.value).toBeDefined();
});

test_("suggestions and args", () => {
  const { dcx } = setup();
  const d = dcx.handle().struct_span_err(sp(0, 5), "msg");
  d.span_suggestion(sp(0, 5), "try", "x", "MachineApplicable");
  // diagnostic.rs:787-788 duplicate parts are dropped.
  d.multipart_suggestion("both", [[sp(0, 1), "a"], [sp(0, 1), "a"], [sp(2, 3), "b"]], "MaybeIncorrect");
  d.arg("n", IntoDiagArg.String("v"));
  const inner = d.deref();
  expect(inner.suggestions.$).toBe("Enabled");
  const s = inner.suggestions.$ === "Enabled" ? inner.suggestions._0 : [];
  expect(s.length).toBe(2);
  expect(s[1]!.substitutions[0]!.parts.length).toBe(2);
  expect(s[0]!.style).toBe("ShowCode");
  // diagnostic.rs:724-726 disabled suggestions ignore new ones.
  d.disable_suggestions().span_suggestion(sp(0, 1), "no", "y", "Unspecified");
  expect(d.deref().suggestions.$).toBe("Disabled");
  expect(d.deref().args.get("n")).toEqual({ $: "Str", _0: "v" });
  d.cancel();
});

test_("MultiSpan labels", () => {
  const a = sp(0, 1);
  const b = sp(5, 6);
  const ms = MultiSpan.from_spans([b, a]);
  // lib.rs(rustc_error_messages):103-105 from_spans sorts by (lo, hi).
  expect(ms.primary_spans_()).toEqual([a, b]);
  ms.push_span_label(b, "label b");
  ms.push_span_label(sp(9, 9), "secondary");
  // lib.rs(rustc_error_messages):168-188 labels first, then unlabelled primary spans.
  const labels = ms.span_labels_().map((l) => [l.span, l.is_primary, l.label?._0]);
  expect(labels).toEqual([
    [b, true, "label b"],
    [sp(9, 9), false, "secondary"],
    [a, true, undefined],
  ]);
  // :146-161 replace
  expect(ms.replace(a, sp(1, 2))).toBe(true);
  expect(ms.primary_span()).toBe(sp(1, 2));
});

test("small helpers", () => {
  // lib.rs:1717-1733 a_or_an
  expect(a_or_an("error")).toBe("an");
  expect(a_or_an("`impl`")).toBe("an");
  expect(a_or_an("type")).toBe("a");
  expect(a_or_an("")).toBe("a");
  // lib.rs:239-242 doc example: `AACC` vs `AABBCC`.
  expect(as_substr("AACC", "AABBCC")).toEqual([2, "BB", 2]);
  expect(as_substr("abc", "abx")).toBeUndefined();
  // codes.rs:21-23 E{:04}
  expect(display_ErrCode(E0001)).toBe("E0001");
  expect(display_ErrCode(E0308)).toBe("E0308");
  // codes.rs:12 `#[max = 9999]`; newtype.rs:226/240 `assert!(value <= (#max as usize))` /
  // `assert!(value <= #max)`. Texts checked against the pinned nightly with the same `assert!`s.
  expect(() => ErrCode.from_u32(10000)).toThrow("assertion failed: value <= 9999");
  expect(() => ErrCode.from_usize(10000)).toThrow("assertion failed: value <= (9999 as usize)");
  expect(ErrCode.from_u32(9999)).toBe(ErrCode.MAX);
  // newtype.rs:98 default max `0xFFFF_FF00` (DefIndex has no `#[max]`).
  expect(() => DefIndex.from_u32(0xffff_ff01)).toThrow("assertion failed: value <= 0xFFFF_FF00");
  expect(() => DefIndex.from_usize(0xffff_ff01)).toThrow("assertion failed: value <= (0xFFFF_FF00 as usize)");
  // codes.rs:55-57
  expect(try_find_description(E0308).$).toBe("Ok");
  expect(try_find_description(ErrCode.from_u32(9999)).$).toBe("Err");
  // lib.rs:1629-1638
  expect(Level.to_str({ $: "DelayedBug" })).toBe("error: internal compiler error");
  expect(Level.to_str({ $: "Warning", _0: undefined })).toBe("warning");
  // diagnostic.rs:145-163 shorten keeps 6 chars on each side.
  const s = DiagStyledString.normal("abcdefghijklmnopqrstuvwxyz");
  s.shorten();
  expect(s.content()).toBe("abcdef...uvwxyz");
  const short = DiagStyledString.normal("abcdefghijklmnopqr");
  short.shorten();
  expect(short.content()).toBe("abcdefghijklmnopqr");
  // diagnostic_impls.rs(rustc_error_messages):55-62 numbers that do not fit an i32 become strings.
  expect(IntoDiagArg.of(3, (n: number, p) => numberArg(n, p)).into_diag_arg({ value: undefined })).toEqual({ $: "Number", _0: 3 });
  expect(IntoDiagArg.of(2 ** 31, (n: number, p) => numberArg(n, p)).into_diag_arg({ value: undefined })).toEqual({
    $: "Str",
    _0: "2147483648",
  });
});

