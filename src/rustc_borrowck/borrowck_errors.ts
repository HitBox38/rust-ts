// Port of compiler/rustc_borrowck/src/borrowck_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// `impl crate::MirBorrowckCtxt` (augments lib.gen.ts) and the free fn `borrowed_data_escapes_closure`.
import type { Diag, DiagCtxtHandle } from "../rustc_errors/lib.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";

declare module "./lib.gen.ts" {
  interface MirBorrowckCtxt {
    // borrowck_errors.rs:8 (lane bck-diag-f)
    dcx(): DiagCtxtHandle;
    // borrowck_errors.rs:12 (lane bck-diag-f)
    cannot_move_when_borrowed(span: Span, borrow_span: Span, place: string, borrow_place: string, value_place: string): Diag;
    // borrowck_errors.rs:29 (lane bck-diag-f)
    cannot_use_when_mutably_borrowed(span: Span, desc: string, borrow_span: Span, borrow_desc: string): Diag;
    // borrowck_errors.rs:47 (lane bck-diag-f)
    cannot_mutably_borrow_multiply(new_loan_span: Span, desc: string, opt_via: string, old_loan_span: Span, old_opt_via: string, old_load_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:96 (lane bck-diag-f)
    cannot_uniquely_borrow_by_two_closures(new_loan_span: Span, desc: string, old_loan_span: Span, old_load_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:125 (lane bck-diag-f)
    cannot_uniquely_borrow_by_one_closure(new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, old_loan_span: Span, noun_old: string, old_opt_via: string, previous_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:156 (lane bck-diag-f)
    cannot_reborrow_already_uniquely_borrowed(new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, kind_new: string, old_loan_span: Span, old_opt_via: string, previous_end_span: Span | undefined, second_borrow_desc: string): Diag;
    // borrowck_errors.rs:188 (lane bck-diag-f)
    cannot_reborrow_already_borrowed(span: Span, desc_new: string, msg_new: string, kind_new: string, old_span: Span, noun_old: string, kind_old: string, msg_old: string, old_load_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:235 (lane bck-diag-f)
    cannot_assign_to_borrowed(span: Span, borrow_span: Span, desc: string): Diag;
    // borrowck_errors.rs:252 (lane bck-diag-f)
    cannot_reassign_immutable(span: Span, desc: string, is_arg: boolean): Diag;
    // borrowck_errors.rs:262 (lane bck-diag-f)
    cannot_assign(span: Span, desc: string): Diag;
    // borrowck_errors.rs:266 (lane bck-diag-f)
    cannot_move_out_of(move_from_span: Span, move_from_desc: string): Diag;
    // borrowck_errors.rs:283 (lane bck-diag-f)
    cannot_move_out_of_interior_noncopy(move_from_span: Span, ty: Ty, is_index: boolean | undefined): Diag;
    // borrowck_errors.rs:305 (lane bck-diag-f)
    cannot_move_out_of_interior_of_drop(move_from_span: Span, container_ty: Ty): Diag;
    // borrowck_errors.rs:320 (lane bck-diag-f)
    cannot_act_on_moved_value(use_span: Span, verb: string, optional_adverb_for_moved: string, moved_path: string | undefined, primary_message: string | undefined): Diag;
    // borrowck_errors.rs:345 (lane bck-diag-f)
    cannot_borrow_path_as_mutable_because(span: Span, path: string, reason: string): Diag;
    // borrowck_errors.rs:361 (lane bck-diag-f)
    cannot_mutate_in_immutable_section(mutate_span: Span, immutable_span: Span, immutable_place: string, immutable_section: string, action: string): Diag;
    // borrowck_errors.rs:382 (lane bck-diag-f)
    cannot_borrow_across_coroutine_yield(span: Span, yield_span: Span): Diag;
    // borrowck_errors.rs:420 (lane bck-diag-f)
    cannot_borrow_across_destructor(borrow_span: Span): Diag;
    // borrowck_errors.rs:429 (lane bck-diag-f)
    path_does_not_live_long_enough(span: Span, path: string): Diag;
    // borrowck_errors.rs:433 (lane bck-diag-f)
    cannot_return_reference_to_local(span: Span, return_kind: string, reference_desc: string, path_desc: string): Diag;
    // borrowck_errors.rs:455 (lane bck-diag-f)
    cannot_capture_in_long_lived_closure(closure_span: Span, closure_kind: string, borrowed_path: string, capture_span: Span, scope: string): Diag;
    // borrowck_errors.rs:474 (lane bck-diag-f)
    thread_local_value_does_not_live_long_enough(span: Span): Diag;
    // borrowck_errors.rs:483 (lane bck-diag-f)
    temporary_value_borrowed_for_too_long(span: Span): Diag;
  }
}

// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:8 dcx (lane bck-diag-f)
MirBorrowckCtxt.prototype.dcx = function (this: MirBorrowckCtxt): DiagCtxtHandle {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::dcx");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:12 cannot_move_when_borrowed (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_move_when_borrowed = function (this: MirBorrowckCtxt, span: Span, borrow_span: Span, place: string, borrow_place: string, value_place: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_move_when_borrowed");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:29 cannot_use_when_mutably_borrowed (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_use_when_mutably_borrowed = function (this: MirBorrowckCtxt, span: Span, desc: string, borrow_span: Span, borrow_desc: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_use_when_mutably_borrowed");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:47 cannot_mutably_borrow_multiply (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_mutably_borrow_multiply = function (this: MirBorrowckCtxt, new_loan_span: Span, desc: string, opt_via: string, old_loan_span: Span, old_opt_via: string, old_load_end_span: Span | undefined): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_mutably_borrow_multiply");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:96 cannot_uniquely_borrow_by_two_closures (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_uniquely_borrow_by_two_closures = function (this: MirBorrowckCtxt, new_loan_span: Span, desc: string, old_loan_span: Span, old_load_end_span: Span | undefined): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_uniquely_borrow_by_two_closures");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:125 cannot_uniquely_borrow_by_one_closure (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_uniquely_borrow_by_one_closure = function (this: MirBorrowckCtxt, new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, old_loan_span: Span, noun_old: string, old_opt_via: string, previous_end_span: Span | undefined): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_uniquely_borrow_by_one_closure");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:156 cannot_reborrow_already_uniquely_borrowed (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_reborrow_already_uniquely_borrowed = function (this: MirBorrowckCtxt, new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, kind_new: string, old_loan_span: Span, old_opt_via: string, previous_end_span: Span | undefined, second_borrow_desc: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_reborrow_already_uniquely_borrowed");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:188 cannot_reborrow_already_borrowed (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_reborrow_already_borrowed = function (this: MirBorrowckCtxt, span: Span, desc_new: string, msg_new: string, kind_new: string, old_span: Span, noun_old: string, kind_old: string, msg_old: string, old_load_end_span: Span | undefined): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_reborrow_already_borrowed");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:235 cannot_assign_to_borrowed (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_assign_to_borrowed = function (this: MirBorrowckCtxt, span: Span, borrow_span: Span, desc: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_assign_to_borrowed");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:252 cannot_reassign_immutable (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_reassign_immutable = function (this: MirBorrowckCtxt, span: Span, desc: string, is_arg: boolean): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_reassign_immutable");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:262 cannot_assign (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_assign = function (this: MirBorrowckCtxt, span: Span, desc: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_assign");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:266 cannot_move_out_of (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_move_out_of = function (this: MirBorrowckCtxt, move_from_span: Span, move_from_desc: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_move_out_of");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:283 cannot_move_out_of_interior_noncopy (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_move_out_of_interior_noncopy = function (this: MirBorrowckCtxt, move_from_span: Span, ty: Ty, is_index: boolean | undefined): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_move_out_of_interior_noncopy");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:305 cannot_move_out_of_interior_of_drop (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_move_out_of_interior_of_drop = function (this: MirBorrowckCtxt, move_from_span: Span, container_ty: Ty): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_move_out_of_interior_of_drop");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:320 cannot_act_on_moved_value (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_act_on_moved_value = function (this: MirBorrowckCtxt, use_span: Span, verb: string, optional_adverb_for_moved: string, moved_path: string | undefined, primary_message: string | undefined): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_act_on_moved_value");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:345 cannot_borrow_path_as_mutable_because (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_borrow_path_as_mutable_because = function (this: MirBorrowckCtxt, span: Span, path: string, reason: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_borrow_path_as_mutable_because");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:361 cannot_mutate_in_immutable_section (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_mutate_in_immutable_section = function (this: MirBorrowckCtxt, mutate_span: Span, immutable_span: Span, immutable_place: string, immutable_section: string, action: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_mutate_in_immutable_section");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:382 cannot_borrow_across_coroutine_yield (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_borrow_across_coroutine_yield = function (this: MirBorrowckCtxt, span: Span, yield_span: Span): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_borrow_across_coroutine_yield");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:420 cannot_borrow_across_destructor (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_borrow_across_destructor = function (this: MirBorrowckCtxt, borrow_span: Span): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_borrow_across_destructor");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:429 path_does_not_live_long_enough (lane bck-diag-f)
MirBorrowckCtxt.prototype.path_does_not_live_long_enough = function (this: MirBorrowckCtxt, span: Span, path: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::path_does_not_live_long_enough");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:433 cannot_return_reference_to_local (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_return_reference_to_local = function (this: MirBorrowckCtxt, span: Span, return_kind: string, reference_desc: string, path_desc: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_return_reference_to_local");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:455 cannot_capture_in_long_lived_closure (lane bck-diag-f)
MirBorrowckCtxt.prototype.cannot_capture_in_long_lived_closure = function (this: MirBorrowckCtxt, closure_span: Span, closure_kind: string, borrowed_path: string, capture_span: Span, scope: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::cannot_capture_in_long_lived_closure");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:474 thread_local_value_does_not_live_long_enough (lane bck-diag-f)
MirBorrowckCtxt.prototype.thread_local_value_does_not_live_long_enough = function (this: MirBorrowckCtxt, span: Span): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::thread_local_value_does_not_live_long_enough");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:483 temporary_value_borrowed_for_too_long (lane bck-diag-f)
MirBorrowckCtxt.prototype.temporary_value_borrowed_for_too_long = function (this: MirBorrowckCtxt, span: Span): Diag {
  return unported("rustc_borrowck::borrowck_errors::MirBorrowckCtxt::temporary_value_borrowed_for_too_long");
};
// stub: compiler/rustc_borrowck/src/borrowck_errors.rs:488 borrowed_data_escapes_closure (lane bck-diag-f)
export function borrowed_data_escapes_closure(dcx: DiagCtxtHandle, escape_span: Span, escapes_from: string): Diag {
  return unported("rustc_borrowck::borrowck_errors::borrowed_data_escapes_closure");
}
