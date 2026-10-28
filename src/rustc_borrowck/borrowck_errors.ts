// Port of compiler/rustc_borrowck/src/borrowck_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// `impl crate::MirBorrowckCtxt` (augments lib.gen.ts) and the free fn `borrowed_data_escapes_closure`.
import {
  Applicability,
  type Diag,
  type DiagCtxtHandle,
  E0373,
  E0382,
  E0384,
  E0499,
  E0500,
  E0501,
  E0502,
  E0503,
  E0506,
  E0507,
  E0508,
  E0509,
  E0510,
  E0515,
  E0521,
  E0524,
  E0594,
  E0596,
  E0597,
  E0626,
  E0712,
  E0713,
  E0716,
  struct_span_code_err,
} from "../rustc_errors/lib.ts";
import { display_CoroutineKind, Node } from "../rustc_hir/hir.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { unwrap } from "../std/panic.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";
import { MoveBorrow_diagnostic } from "./session_diagnostics.gen.ts";

declare module "./lib.gen.ts" {
  interface MirBorrowckCtxt {
    // borrowck_errors.rs:8
    dcx(): DiagCtxtHandle;
    // borrowck_errors.rs:12
    cannot_move_when_borrowed(span: Span, borrow_span: Span, place: string, borrow_place: string, value_place: string): Diag;
    // borrowck_errors.rs:29
    cannot_use_when_mutably_borrowed(span: Span, desc: string, borrow_span: Span, borrow_desc: string): Diag;
    // borrowck_errors.rs:47
    cannot_mutably_borrow_multiply(new_loan_span: Span, desc: string, opt_via: string, old_loan_span: Span, old_opt_via: string, old_load_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:96
    cannot_uniquely_borrow_by_two_closures(new_loan_span: Span, desc: string, old_loan_span: Span, old_load_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:125
    cannot_uniquely_borrow_by_one_closure(new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, old_loan_span: Span, noun_old: string, old_opt_via: string, previous_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:156
    cannot_reborrow_already_uniquely_borrowed(new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, kind_new: string, old_loan_span: Span, old_opt_via: string, previous_end_span: Span | undefined, second_borrow_desc: string): Diag;
    // borrowck_errors.rs:188
    cannot_reborrow_already_borrowed(span: Span, desc_new: string, msg_new: string, kind_new: string, old_span: Span, noun_old: string, kind_old: string, msg_old: string, old_load_end_span: Span | undefined): Diag;
    // borrowck_errors.rs:235
    cannot_assign_to_borrowed(span: Span, borrow_span: Span, desc: string): Diag;
    // borrowck_errors.rs:252
    cannot_reassign_immutable(span: Span, desc: string, is_arg: boolean): Diag;
    // borrowck_errors.rs:262
    cannot_assign(span: Span, desc: string): Diag;
    // borrowck_errors.rs:266
    cannot_move_out_of(move_from_span: Span, move_from_desc: string): Diag;
    // borrowck_errors.rs:283
    cannot_move_out_of_interior_noncopy(move_from_span: Span, ty: Ty, is_index: boolean | undefined): Diag;
    // borrowck_errors.rs:305
    cannot_move_out_of_interior_of_drop(move_from_span: Span, container_ty: Ty): Diag;
    // borrowck_errors.rs:320
    cannot_act_on_moved_value(use_span: Span, verb: string, optional_adverb_for_moved: string, moved_path: string | undefined, primary_message: string | undefined): Diag;
    // borrowck_errors.rs:345
    cannot_borrow_path_as_mutable_because(span: Span, path: string, reason: string): Diag;
    // borrowck_errors.rs:361
    cannot_mutate_in_immutable_section(mutate_span: Span, immutable_span: Span, immutable_place: string, immutable_section: string, action: string): Diag;
    // borrowck_errors.rs:382
    cannot_borrow_across_coroutine_yield(span: Span, yield_span: Span): Diag;
    // borrowck_errors.rs:420
    cannot_borrow_across_destructor(borrow_span: Span): Diag;
    // borrowck_errors.rs:429
    path_does_not_live_long_enough(span: Span, path: string): Diag;
    // borrowck_errors.rs:433
    cannot_return_reference_to_local(span: Span, return_kind: string, reference_desc: string, path_desc: string): Diag;
    // borrowck_errors.rs:455
    cannot_capture_in_long_lived_closure(closure_span: Span, closure_kind: string, borrowed_path: string, capture_span: Span, scope: string): Diag;
    // borrowck_errors.rs:474
    thread_local_value_does_not_live_long_enough(span: Span): Diag;
    // borrowck_errors.rs:483
    temporary_value_borrowed_for_too_long(span: Span): Diag;
  }
}

// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:8 dcx
MirBorrowckCtxt.prototype.dcx = function (this: MirBorrowckCtxt): DiagCtxtHandle {
  return this.root_cx.dcx();
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:12 cannot_move_when_borrowed
MirBorrowckCtxt.prototype.cannot_move_when_borrowed = function (this: MirBorrowckCtxt, span: Span, borrow_span: Span, place: string, borrow_place: string, value_place: string): Diag {
  return this.dcx().create_err(
    MoveBorrow_diagnostic({
      place,
      span,
      borrow_place,
      value_place,
      borrow_span,
    }),
  );
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:29 cannot_use_when_mutably_borrowed
MirBorrowckCtxt.prototype.cannot_use_when_mutably_borrowed = function (this: MirBorrowckCtxt, span: Span, desc: string, borrow_span: Span, borrow_desc: string): Diag {
  return struct_span_code_err(this.dcx(), span, E0503, `cannot use ${desc} because it was mutably borrowed`)
    .with_span_label(borrow_span, `${borrow_desc} is borrowed here`)
    .with_span_label(span, `use of borrowed ${borrow_desc}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:47 cannot_mutably_borrow_multiply
MirBorrowckCtxt.prototype.cannot_mutably_borrow_multiply = function (this: MirBorrowckCtxt, new_loan_span: Span, desc: string, opt_via: string, old_loan_span: Span, old_opt_via: string, old_load_end_span: Span | undefined): Diag {
  const via = (msg: string): string => (msg === "" ? "" : ` (via ${msg})`);
  const err = struct_span_code_err(this.dcx(), new_loan_span, E0499, `cannot borrow ${desc}${via(opt_via)} as mutable more than once at a time`);
  if (old_loan_span === new_loan_span) {
    // Both borrows are happening in the same place
    // Meaning the borrow is occurring in a loop
    err.span_label(new_loan_span, `${desc}${via(opt_via)} was mutably borrowed here in the previous iteration of the loop${opt_via}`);
    if (old_load_end_span !== undefined) {
      err.span_label(old_load_end_span, "mutable borrow ends here");
    }
  } else {
    err.span_label(old_loan_span, `first mutable borrow occurs here${via(old_opt_via)}`);
    err.span_label(new_loan_span, `second mutable borrow occurs here${via(opt_via)}`);
    if (old_load_end_span !== undefined) {
      err.span_label(old_load_end_span, "first borrow ends here");
    }
  }
  return err;
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:96 cannot_uniquely_borrow_by_two_closures
MirBorrowckCtxt.prototype.cannot_uniquely_borrow_by_two_closures = function (this: MirBorrowckCtxt, new_loan_span: Span, desc: string, old_loan_span: Span, old_load_end_span: Span | undefined): Diag {
  const err = struct_span_code_err(this.dcx(), new_loan_span, E0524, `two closures require unique access to ${desc} at the same time`);
  if (old_loan_span === new_loan_span) {
    err.span_label(old_loan_span, "closures are constructed here in different iterations of loop");
  } else {
    err.span_label(old_loan_span, "first closure is constructed here");
    err.span_label(new_loan_span, "second closure is constructed here");
  }
  if (old_load_end_span !== undefined) {
    err.span_label(old_load_end_span, "borrow from first closure ends here");
  }
  return err;
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:125 cannot_uniquely_borrow_by_one_closure
MirBorrowckCtxt.prototype.cannot_uniquely_borrow_by_one_closure = function (this: MirBorrowckCtxt, new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, old_loan_span: Span, noun_old: string, old_opt_via: string, previous_end_span: Span | undefined): Diag {
  const err = struct_span_code_err(
    this.dcx(),
    new_loan_span,
    E0500,
    `closure requires unique access to ${desc_new} but ${noun_old} is already borrowed${old_opt_via}`,
  );
  err.span_label(new_loan_span, `${container_name} construction occurs here${opt_via}`);
  err.span_label(old_loan_span, `borrow occurs here${old_opt_via}`);
  if (previous_end_span !== undefined) {
    err.span_label(previous_end_span, "borrow ends here");
  }
  return err;
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:156 cannot_reborrow_already_uniquely_borrowed
MirBorrowckCtxt.prototype.cannot_reborrow_already_uniquely_borrowed = function (this: MirBorrowckCtxt, new_loan_span: Span, container_name: string, desc_new: string, opt_via: string, kind_new: string, old_loan_span: Span, old_opt_via: string, previous_end_span: Span | undefined, second_borrow_desc: string): Diag {
  const err = struct_span_code_err(
    this.dcx(),
    new_loan_span,
    E0501,
    `cannot borrow ${desc_new}${opt_via} as ${kind_new} because previous closure requires unique access`,
  );
  err.span_label(new_loan_span, `${second_borrow_desc}borrow occurs here${opt_via}`);
  err.span_label(old_loan_span, `${container_name} construction occurs here${old_opt_via}`);
  if (previous_end_span !== undefined) {
    err.span_label(previous_end_span, "borrow from closure ends here");
  }
  return err;
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:188 cannot_reborrow_already_borrowed
MirBorrowckCtxt.prototype.cannot_reborrow_already_borrowed = function (this: MirBorrowckCtxt, span: Span, desc_new: string, msg_new: string, kind_new: string, old_span: Span, noun_old: string, kind_old: string, msg_old: string, old_load_end_span: Span | undefined): Diag {
  const via = (msg: string): string => (msg === "" ? "" : ` (via ${msg})`);
  const err = struct_span_code_err(
    this.dcx(),
    span,
    E0502,
    `cannot borrow ${desc_new}${via(msg_new)} as ${kind_new} because ${noun_old} is also borrowed as ${kind_old}${via(msg_old)}`,
  );

  if (msg_new === "") {
    // If `msg_new` is empty, then this isn't a borrow of a union field.
    err.span_label(span, `${kind_new} borrow occurs here`);
    err.span_label(old_span, `${kind_old} borrow occurs here`);
  } else {
    // If `msg_new` isn't empty, then this a borrow of a union field.
    err.span_label(span, `${kind_new} borrow of ${msg_new} -- which overlaps with ${msg_old} -- occurs here`);
    err.span_label(old_span, `${kind_old} borrow occurs here${via(msg_old)}`);
  }

  if (old_load_end_span !== undefined) {
    err.span_label(old_load_end_span, `${kind_old} borrow ends here`);
  }
  return err;
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:235 cannot_assign_to_borrowed
MirBorrowckCtxt.prototype.cannot_assign_to_borrowed = function (this: MirBorrowckCtxt, span: Span, borrow_span: Span, desc: string): Diag {
  return struct_span_code_err(this.dcx(), span, E0506, `cannot assign to ${desc} because it is borrowed`)
    .with_span_label(borrow_span, `${desc} is borrowed here`)
    .with_span_label(span, `${desc} is assigned to here but it was already borrowed`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:252 cannot_reassign_immutable
MirBorrowckCtxt.prototype.cannot_reassign_immutable = function (this: MirBorrowckCtxt, span: Span, desc: string, is_arg: boolean): Diag {
  const msg = is_arg ? "to immutable argument" : "twice to immutable variable";
  return struct_span_code_err(this.dcx(), span, E0384, `cannot assign ${msg} ${desc}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:262 cannot_assign
MirBorrowckCtxt.prototype.cannot_assign = function (this: MirBorrowckCtxt, span: Span, desc: string): Diag {
  return struct_span_code_err(this.dcx(), span, E0594, `cannot assign to ${desc}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:266 cannot_move_out_of
MirBorrowckCtxt.prototype.cannot_move_out_of = function (this: MirBorrowckCtxt, move_from_span: Span, move_from_desc: string): Diag {
  return struct_span_code_err(this.dcx(), move_from_span, E0507, `cannot move out of ${move_from_desc}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:283 cannot_move_out_of_interior_noncopy
MirBorrowckCtxt.prototype.cannot_move_out_of_interior_noncopy = function (this: MirBorrowckCtxt, move_from_span: Span, ty: Ty, is_index: boolean | undefined): Diag {
  const kind = ty.kind();
  let type_name: string;
  if ((kind.$ === "Array" && is_index === true) || (kind.$ === "Array" && is_index === undefined)) {
    type_name = "array";
  } else if (kind.$ === "Slice") {
    type_name = "slice";
  } else {
    return span_bug(move_from_span, "this path should not cause illegal move");
  }
  return struct_span_code_err(this.dcx(), move_from_span, E0508, `cannot move out of type \`${display_Ty(ty)}\`, a non-copy ${type_name}`).with_span_label(
    move_from_span,
    "cannot move out of here",
  );
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:305 cannot_move_out_of_interior_of_drop
MirBorrowckCtxt.prototype.cannot_move_out_of_interior_of_drop = function (this: MirBorrowckCtxt, move_from_span: Span, container_ty: Ty): Diag {
  return struct_span_code_err(
    this.dcx(),
    move_from_span,
    E0509,
    `cannot move out of type \`${display_Ty(container_ty)}\`, which implements the \`Drop\` trait`,
  ).with_span_label(move_from_span, "cannot move out of here");
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:320 cannot_act_on_moved_value
MirBorrowckCtxt.prototype.cannot_act_on_moved_value = function (this: MirBorrowckCtxt, use_span: Span, verb: string, optional_adverb_for_moved: string, moved_path: string | undefined, primary_message: string | undefined): Diag {
  if (primary_message !== undefined) {
    return struct_span_code_err(this.dcx(), use_span, E0382, `${primary_message}`);
  } else {
    const moved_path_ = moved_path !== undefined ? `: \`${moved_path}\`` : "";

    return struct_span_code_err(this.dcx(), use_span, E0382, `${verb} of ${optional_adverb_for_moved}moved value${moved_path_}`);
  }
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:345 cannot_borrow_path_as_mutable_because
MirBorrowckCtxt.prototype.cannot_borrow_path_as_mutable_because = function (this: MirBorrowckCtxt, span: Span, path: string, reason: string): Diag {
  return struct_span_code_err(this.dcx(), span, E0596, `cannot borrow ${path} as mutable${reason}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:361 cannot_mutate_in_immutable_section
MirBorrowckCtxt.prototype.cannot_mutate_in_immutable_section = function (this: MirBorrowckCtxt, mutate_span: Span, immutable_span: Span, immutable_place: string, immutable_section: string, action: string): Diag {
  return struct_span_code_err(this.dcx(), mutate_span, E0510, `cannot ${action} ${immutable_place} in ${immutable_section}`)
    .with_span_label(mutate_span, `cannot ${action}`)
    .with_span_label(immutable_span, `value is immutable in ${immutable_section}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:382 cannot_borrow_across_coroutine_yield
MirBorrowckCtxt.prototype.cannot_borrow_across_coroutine_yield = function (this: MirBorrowckCtxt, span: Span, yield_span: Span): Diag {
  const coroutine_kind = unwrap(this.body.coroutine).coroutine_kind;
  const diag = struct_span_code_err(this.dcx(), span, E0626, `borrow may still be in use when ${display_CoroutineKind(coroutine_kind, true)} yields`);
  diag.span_label(this.infcx.tcx.def_span(this.body.source.def_id()), `within this ${display_CoroutineKind(coroutine_kind, true)}`);
  diag.span_label(yield_span, "possible yield occurs here");
  if (coroutine_kind.$ === "Coroutine") {
    const { capture_clause, fn_decl_span } = Node.expect_closure(this.infcx.tcx.hir_node_by_def_id(this.body.source.def_id().expect_local()));
    let span: Span;
    switch (capture_clause.$) {
      case "Value":
        span = Span.shrink_to_lo(capture_clause.move_kw);
        break;
      case "Use":
        span = Span.shrink_to_lo(capture_clause.use_kw);
        break;
      case "Ref":
        span = Span.shrink_to_lo(fn_decl_span);
        break;
    }
    diag.span_suggestion_verbose(span, "add `static` to mark this coroutine as unmovable", "static ", Applicability.MaybeIncorrect);
  }
  return diag;
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:420 cannot_borrow_across_destructor
MirBorrowckCtxt.prototype.cannot_borrow_across_destructor = function (this: MirBorrowckCtxt, borrow_span: Span): Diag {
  return struct_span_code_err(this.dcx(), borrow_span, E0713, "borrow may still be in use when destructor runs");
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:429 path_does_not_live_long_enough
MirBorrowckCtxt.prototype.path_does_not_live_long_enough = function (this: MirBorrowckCtxt, span: Span, path: string): Diag {
  return struct_span_code_err(this.dcx(), span, E0597, `${path} does not live long enough`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:433 cannot_return_reference_to_local
MirBorrowckCtxt.prototype.cannot_return_reference_to_local = function (this: MirBorrowckCtxt, span: Span, return_kind: string, reference_desc: string, path_desc: string): Diag {
  return struct_span_code_err(this.dcx(), span, E0515, `cannot ${return_kind} ${reference_desc} ${path_desc}`).with_span_label(
    span,
    `${return_kind}s a ${reference_desc} data owned by the current function`,
  );
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:455 cannot_capture_in_long_lived_closure
MirBorrowckCtxt.prototype.cannot_capture_in_long_lived_closure = function (this: MirBorrowckCtxt, closure_span: Span, closure_kind: string, borrowed_path: string, capture_span: Span, scope: string): Diag {
  return struct_span_code_err(
    this.dcx(),
    closure_span,
    E0373,
    `${closure_kind} may outlive the current ${scope}, but it borrows ${borrowed_path}, which is owned by the current ${scope}`,
  )
    .with_span_label(capture_span, `${borrowed_path} is borrowed here`)
    .with_span_label(closure_span, `may outlive borrowed value ${borrowed_path}`);
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:474 thread_local_value_does_not_live_long_enough
MirBorrowckCtxt.prototype.thread_local_value_does_not_live_long_enough = function (this: MirBorrowckCtxt, span: Span): Diag {
  return struct_span_code_err(this.dcx(), span, E0712, "thread-local variable borrowed past end of function");
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:483 temporary_value_borrowed_for_too_long
MirBorrowckCtxt.prototype.temporary_value_borrowed_for_too_long = function (this: MirBorrowckCtxt, span: Span): Diag {
  return struct_span_code_err(this.dcx(), span, E0716, "temporary value dropped while borrowed");
};
// rustc: compiler/rustc_borrowck/src/borrowck_errors.rs:488 borrowed_data_escapes_closure
export function borrowed_data_escapes_closure(dcx: DiagCtxtHandle, escape_span: Span, escapes_from: string): Diag {
  return struct_span_code_err(dcx, escape_span, E0521, `borrowed data escapes outside of ${escapes_from}`);
}
