// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-sb`
// (plan-m6 wave 36). Its types are generated into diagnostics.gen.ts (tools/codegen set `miri`); this module re-exports
// them.
//
// PORT: `AllocRange` is `Copy` and never mutated in place by this crate (a new one is built wherever upstream assigns a
// field), so copies of it share the object; `RetagOp` / `Creation` / `Item` copies are `clone_*`.
// PORT: `err_machine_stop!(TerminationInfo::..)` is miri-driver's `TerminationInfo_into_machine_stop(info)` (diagnostics.ts);
// `impl fmt::Display for AccessKind` is lane miri-alloc's `display_AccessKind` (borrow_tracker/mod.ts). Both are read
// through the namespace imports at call time (C10: never at load).
import * as borrow_tracker from "../mod.ts";
import { type AccessKind, type BorTag, debug_AccessKind, debug_BorTag, type GlobalStateInner, type ProtectorKind } from "../mod.ts";
import {
  AllocHistory,
  clone_Creation,
  clone_RetagOp,
  Creation,
  debug_Operation,
  DiagnosticCx,
  DiagnosticCxBuilder,
  Invalidation,
  type InvalidationCause,
  type Operation,
  RetagInfo,
  type TagHistory,
} from "./diagnostics.gen.ts";
import { clone_Item, debug_Item, type Item, Permission } from "./item.ts";
import { type Stack } from "./stack.ts";
import * as miri_diagnostics from "../../diagnostics.ts";
import { debug_ProvenanceExtra, type MiriMachine, ProvenanceExtra } from "../../machine.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { alloc_range, type AllocRange, display_AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, display_AllocId, type InterpErrorKind } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, unreachable } from "../../../std/panic.ts";
export * from "./diagnostics.gen.ts";

/// Error reporting
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:12 err_sb_ub
export function err_sb_ub(msg: string, help: string[], history: TagHistory | undefined): InterpErrorKind {
  // err_machine_stop!(TerminationInfo::StackedBorrowsUb { msg, help, history })
  return miri_diagnostics.TerminationInfo_into_machine_stop({ $: "StackedBorrowsUb", msg, help, history });
}

declare module "./diagnostics.gen.ts" {
  interface Creation {
    // borrow_tracker/stacked_borrows/diagnostics.rs:36
    generate_diagnostic(): [string, Span];
  }
}
declare module "./diagnostics.gen.ts" {
  interface Invalidation {
    // borrow_tracker/stacked_borrows/diagnostics.rs:71
    generate_diagnostic(): [string, Span];
  }
}
declare module "./diagnostics.gen.ts" {
  interface DiagnosticCxBuilder {
    // borrow_tracker/stacked_borrows/diagnostics.rs:128
    build(history: AllocHistory, offset: Size): DiagnosticCx;
  }
  namespace DiagnosticCxBuilder {
    // borrow_tracker/stacked_borrows/diagnostics.rs:136
    export let retag: (machine: MiriMachine, info: RetagInfo, new_tag: BorTag, orig_tag: ProvenanceExtra, range: AllocRange) => DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:149
    export let read: (machine: MiriMachine, tag: ProvenanceExtra, range: AllocRange) => DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:154
    export let write: (machine: MiriMachine, tag: ProvenanceExtra, range: AllocRange) => DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:163
    export let dealloc: (machine: MiriMachine, tag: ProvenanceExtra) => DiagnosticCxBuilder;
  }
}
declare module "./diagnostics.gen.ts" {
  interface DiagnosticCx {
    // borrow_tracker/stacked_borrows/diagnostics.rs:170
    unbuild(): DiagnosticCxBuilder;
    // borrow_tracker/stacked_borrows/diagnostics.rs:235
    start_grant(perm: Permission): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:262
    log_creation(): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:271
    log_invalidation(tag: BorTag): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:291
    log_protector(): void;
    // borrow_tracker/stacked_borrows/diagnostics.rs:300
    get_logs_relevant_to(tag: BorTag, protector_tag: BorTag | undefined): TagHistory | undefined;
    // borrow_tracker/stacked_borrows/diagnostics.rs:375
    grant_error(stack: Stack): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:398
    access_error(stack: Stack): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:420
    protector_error(item: Item, kind: ProtectorKind): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:445
    dealloc_error(stack: Stack): InterpErrorKind;
    // borrow_tracker/stacked_borrows/diagnostics.rs:462
    check_tracked_tag_popped(item: Item, global: GlobalStateInner): void;
  }
}
declare module "./diagnostics.gen.ts" {
  interface AllocHistory {
    // borrow_tracker/stacked_borrows/diagnostics.rs:227
    retain(live_tags: Set<BorTag>): void;
  }
  namespace AllocHistory {
    // borrow_tracker/stacked_borrows/diagnostics.rs:217
    function new_(id: AllocId, item: Item, machine: MiriMachine): AllocHistory;
    export { new_ as new };
  }
}
declare module "./diagnostics.gen.ts" {
  interface RetagInfo {
    // borrow_tracker/stacked_borrows/diagnostics.rs:503
    summary(): string;
  }
}

// impl Creation
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:36 generate_diagnostic
Creation.prototype.generate_diagnostic = function (this: Creation): [string, Span] {
  const tag = this.retag.new_tag;
  const perm = this.retag.permission;
  if (perm !== undefined) {
    return [`${debug_BorTag(tag, PLAIN)} was created by a ${perm} retag at offsets ${display_AllocRange(this.retag.range)}`, this.span];
  } else {
    assert(this.retag.range.size.bytes_u64() === Size.ZERO.bytes_u64(), "assertion failed: self.retag.range.size == Size::ZERO");
    return [
      `${debug_BorTag(tag, PLAIN)} would have been created here, but this is a zero-size retag (${display_AllocRange(this.retag.range)}) so the tag in question does not exist anywhere`,
      this.span,
    ];
  }
};

// impl Invalidation
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:71 generate_diagnostic
Invalidation.prototype.generate_diagnostic = function (this: Invalidation): [string, Span] {
  let message: string;
  if (this.cause.$ === "Retag" && this.cause._1.cause === "FnEntry") {
    // For a FnEntry retag, our Span points at the caller.
    // See `DiagnosticCx::log_invalidation`.
    message = `${debug_BorTag(this.tag, PLAIN)} was later invalidated at offsets ${display_AllocRange(this.range)} by a ${display_InvalidationCause(this.cause)} inside this call`;
  } else {
    message = `${debug_BorTag(this.tag, PLAIN)} was later invalidated at offsets ${display_AllocRange(this.range)} by a ${display_InvalidationCause(this.cause)}`;
  }
  return [message, this.span];
};

// impl fmt::Display for InvalidationCause
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:93 fmt
export function display_InvalidationCause(self: InvalidationCause): string {
  switch (self.$) {
    case "Access":
      return borrow_tracker.display_AccessKind(self._0);
    case "Retag":
      return `${self._0} ${self._1.summary()}`;
  }
}

// impl DiagnosticCxBuilder
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:128 build
DiagnosticCxBuilder.prototype.build = function (this: DiagnosticCxBuilder, history: AllocHistory, offset: Size): DiagnosticCx {
  return new DiagnosticCx(this.operation, this.machine, history, offset);
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:136 retag
DiagnosticCxBuilder.retag = function (machine: MiriMachine, info: RetagInfo, new_tag: BorTag, orig_tag: ProvenanceExtra, range: AllocRange): DiagnosticCxBuilder {
  const operation: Operation = { $: "Retag", _0: { info, new_tag, orig_tag, range, permission: undefined } };

  return new DiagnosticCxBuilder(operation, machine);
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:149 read
DiagnosticCxBuilder.read = function (machine: MiriMachine, tag: ProvenanceExtra, range: AllocRange): DiagnosticCxBuilder {
  const operation: Operation = { $: "Access", _0: { kind: "Read", tag, range } };
  return new DiagnosticCxBuilder(operation, machine);
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:154 write
DiagnosticCxBuilder.write = function (machine: MiriMachine, tag: ProvenanceExtra, range: AllocRange): DiagnosticCxBuilder {
  const operation: Operation = { $: "Access", _0: { kind: "Write", tag, range } };
  return new DiagnosticCxBuilder(operation, machine);
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:163 dealloc
DiagnosticCxBuilder.dealloc = function (machine: MiriMachine, tag: ProvenanceExtra): DiagnosticCxBuilder {
  const operation: Operation = { $: "Dealloc", _0: { tag } };
  return new DiagnosticCxBuilder(operation, machine);
};

// impl DiagnosticCx
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:170 unbuild
DiagnosticCx.prototype.unbuild = function (this: DiagnosticCx): DiagnosticCxBuilder {
  return new DiagnosticCxBuilder(this.operation, this.machine);
};

// impl AllocHistory
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:217 new
(AllocHistory as unknown as { new: (id: AllocId, item: Item, machine: MiriMachine) => AllocHistory }).new = function (id: AllocId, item: Item, machine: MiriMachine): AllocHistory {
  return new AllocHistory(id, [clone_Item(item), machine.current_user_relevant_span()], [], [], []);
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:227 retain
AllocHistory.prototype.retain = function (this: AllocHistory, live_tags: Set<BorTag>): void {
  this.invalidations = this.invalidations.filter((event) => live_tags.has(event.tag));
  this.creations = this.creations.filter((event) => live_tags.has(event.retag.new_tag));
  this.protectors = this.protectors.filter((event) => live_tags.has(event.tag));
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:235 start_grant
DiagnosticCx.prototype.start_grant = function (this: DiagnosticCx, perm: Permission): void {
  if (this.operation.$ !== "Retag") {
    return unreachable(`start_grant must only be called during a retag, this is: ${debug_Operation(this.operation, PLAIN)}`);
  }
  const op = this.operation._0;
  op.permission = perm;

  const creations = this.history.creations;
  const last_creation = creations[creations.length - 1];
  if (last_creation === undefined) return unreachable("called `Option::unwrap()` on a `None` value");
  const previous = last_creation.retag.permission;
  if (previous === undefined) {
    last_creation.retag.permission = perm;
  } else if (previous !== perm) {
    // 'Split up' the creation event.
    const previous_range = last_creation.retag.range;
    last_creation.retag.range = alloc_range(previous_range.start, this.offset);
    const new_event = clone_Creation(last_creation);
    new_event.retag.range = alloc_range(this.offset, previous_range.end());
    new_event.retag.permission = perm;
    this.history.creations.push(new_event);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:262 log_creation
DiagnosticCx.prototype.log_creation = function (this: DiagnosticCx): void {
  if (this.operation.$ !== "Retag") {
    return unreachable("log_creation must only be called during a retag");
  }
  const op = this.operation._0;
  this.history.creations.push(new Creation(clone_RetagOp(op), this.machine.current_user_relevant_span()));
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:271 log_invalidation
DiagnosticCx.prototype.log_invalidation = function (this: DiagnosticCx, tag: BorTag): void {
  let span = this.machine.current_user_relevant_span();
  let range: AllocRange;
  let cause: InvalidationCause;
  switch (this.operation.$) {
    case "Retag": {
      const { info, range: range_, permission } = this.operation._0;
      if (info.cause === "FnEntry") {
        span = this.machine.caller_span();
      }
      if (permission === undefined) return unreachable("called `Option::unwrap()` on a `None` value");
      range = range_;
      cause = { $: "Retag", _0: permission, _1: new RetagInfo(info.cause) };
      break;
    }
    case "Access": {
      const { kind, range: range_ } = this.operation._0;
      range = range_;
      cause = { $: "Access", _0: kind };
      break;
    }
    case "Dealloc": {
      // This can be reached, but never be relevant later since the entire allocation is
      // gone now.
      return;
    }
  }
  this.history.invalidations.push(new Invalidation(tag, range, span, cause));
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:291 log_protector
DiagnosticCx.prototype.log_protector = function (this: DiagnosticCx): void {
  if (this.operation.$ !== "Retag") {
    return unreachable("Protectors can only be created during a retag");
  }
  const op = this.operation._0;
  this.history.protectors.push({ tag: op.new_tag, span: this.machine.current_user_relevant_span() });
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:300 get_logs_relevant_to
DiagnosticCx.prototype.get_logs_relevant_to = function (this: DiagnosticCx, tag: BorTag, protector_tag: BorTag | undefined): TagHistory | undefined {
  const creations = this.history.creations;
  let created: [string, Span] | undefined = undefined;
  // First, look for a Creation event where the tag and the offset matches. This
  // ensures that we pick the right Creation event when a retag isn't uniform due to
  // Freeze.
  const offset = this.offset.bytes();
  for (let i = creations.length - 1; i >= 0; i--) {
    const event = creations[i]!;
    const range = event.retag.range;
    if (event.retag.new_tag === tag && offset >= range.start.bytes() && offset < range.start.add(range.size).bytes()) {
      created = event.generate_diagnostic();
      break;
    }
  }
  if (created === undefined) {
    // If we didn't find anything with a matching offset, just return the event where
    // the tag was created. This branch is hit when we use a tag at an offset that
    // doesn't have the tag.
    for (let i = creations.length - 1; i >= 0; i--) {
      const event = creations[i]!;
      if (event.retag.new_tag === tag) {
        created = event.generate_diagnostic();
        break;
      }
    }
  }
  if (created === undefined) {
    // If we didn't find a retag that created this tag, it might be the root tag of
    // this allocation.
    if (this.history.root[0].tag() === tag) {
      created = [`${debug_BorTag(tag, PLAIN)} was created here, as the root tag for ${display_AllocId(this.history.id)}`, this.history.root[1]];
    }
  }
  if (created === undefined) {
    // But if we don't have a creation event, this is related to a wildcard, and there
    // is really nothing we can do to help.
    return undefined;
  }

  let invalidated: [string, Span] | undefined = undefined;
  const invalidations = this.history.invalidations;
  for (let i = invalidations.length - 1; i >= 0; i--) {
    const event = invalidations[i]!;
    if (event.tag === tag) {
      invalidated = event.generate_diagnostic();
      break;
    }
  }

  let protected_: [string, Span] | undefined = undefined;
  if (protector_tag !== undefined) {
    const protection = this.history.protectors.find((protection) => protection.tag === protector_tag);
    if (protection !== undefined) {
      const protected_tag = protection.tag;
      protected_ = [`${debug_BorTag(protected_tag, PLAIN)} is this argument`, protection.span];
    }
  }

  return { created, invalidated, protected: protected_ };
};

/** `{:#x}` of a `u64`. */
function hex_alt(n: bigint): string {
  return `0x${n.toString(16)}`;
}

/// Report a descriptive error when `new` could not be granted from `derived_from`.
// #[inline(never)] // This is only called on fatal code paths
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:375 grant_error
DiagnosticCx.prototype.grant_error = function (this: DiagnosticCx, stack: Stack): InterpErrorKind {
  if (this.operation.$ !== "Retag") {
    return unreachable("grant_error should only be called during a retag");
  }
  const op = this.operation._0;
  const perm = op.permission;
  if (perm === undefined) return unreachable("`start_grant` must be called before calling `grant_error`");
  const action = `trying to retag from ${debug_ProvenanceExtra(op.orig_tag, PLAIN)} for ${perm} permission at ${display_AllocId(this.history.id)}[${hex_alt(this.offset.bytes_u64())}]`;
  const helps = [operation_summary(op.info.summary(), this.history.id, op.range)];
  return err_sb_ub(
    `${action}${error_cause(stack, op.orig_tag)}`,
    helps,
    ProvenanceExtra.and_then(op.orig_tag, (orig_tag) => this.get_logs_relevant_to(orig_tag, undefined)),
  );
};

/// Report a descriptive error when `access` is not permitted based on `tag`.
// #[inline(never)] // This is only called on fatal code paths
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:398 access_error
DiagnosticCx.prototype.access_error = function (this: DiagnosticCx, stack: Stack): InterpErrorKind {
  // Deallocation and retagging also do an access as part of their thing, so handle that here, too.
  let op;
  switch (this.operation.$) {
    case "Access":
      op = this.operation._0;
      break;
    case "Retag":
      return this.grant_error(stack);
    case "Dealloc":
      return this.dealloc_error(stack);
  }
  const action = `attempting a ${borrow_tracker.display_AccessKind(op.kind)} using ${debug_ProvenanceExtra(op.tag, PLAIN)} at ${display_AllocId(this.history.id)}[${hex_alt(this.offset.bytes_u64())}]`;
  return err_sb_ub(
    `${action}${error_cause(stack, op.tag)}`,
    [operation_summary("an access", this.history.id, op.range)],
    ProvenanceExtra.and_then(op.tag, (tag) => this.get_logs_relevant_to(tag, undefined)),
  );
};

// #[inline(never)] // This is only called on fatal code paths
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:420 protector_error
DiagnosticCx.prototype.protector_error = function (this: DiagnosticCx, item: Item, kind: ProtectorKind): InterpErrorKind {
  let protected_: string;
  switch (kind) {
    case "WeakProtector":
      protected_ = "weakly protected";
      break;
    case "StrongProtector":
      protected_ = "strongly protected";
      break;
  }
  switch (this.operation.$) {
    case "Dealloc":
      return err_sb_ub(`deallocating while item ${debug_Item(item, PLAIN)} is ${protected_}`, [], undefined);
    case "Retag":
    case "Access": {
      const tag = this.operation.$ === "Retag" ? this.operation._0.orig_tag : this.operation._0.tag;
      return err_sb_ub(
        `not granting access to tag ${debug_ProvenanceExtra(tag, PLAIN)} because that would remove ${debug_Item(item, PLAIN)} which is ${protected_}`,
        [],
        ProvenanceExtra.and_then(tag, (tag) => this.get_logs_relevant_to(tag, item.tag())),
      );
    }
  }
};

// #[inline(never)] // This is only called on fatal code paths
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:445 dealloc_error
DiagnosticCx.prototype.dealloc_error = function (this: DiagnosticCx, stack: Stack): InterpErrorKind {
  if (this.operation.$ !== "Dealloc") {
    return unreachable("dealloc_error should only be called during a deallocation");
  }
  const op = this.operation._0;
  return err_sb_ub(
    `attempting deallocation using ${debug_ProvenanceExtra(op.tag, PLAIN)} at ${display_AllocId(this.history.id)}${error_cause(stack, op.tag)}`,
    [],
    ProvenanceExtra.and_then(op.tag, (tag) => this.get_logs_relevant_to(tag, undefined)),
  );
};

// #[inline(never)]
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:462 check_tracked_tag_popped
DiagnosticCx.prototype.check_tracked_tag_popped = function (this: DiagnosticCx, item: Item, global: GlobalStateInner): void {
  if (!global.tracked_pointer_tags.has(item.tag())) {
    return;
  }
  let cause: string;
  switch (this.operation.$) {
    case "Dealloc":
      cause = ` due to deallocation`;
      break;
    case "Access": {
      const { kind, tag } = this.operation._0;
      cause = ` due to ${debug_AccessKind(kind, PLAIN)} access for ${debug_ProvenanceExtra(tag, PLAIN)}`;
      break;
    }
    case "Retag": {
      const { orig_tag, permission, new_tag } = this.operation._0;
      if (permission === undefined) return unreachable("start_grant should set the current permission before popping a tag");
      cause = ` due to ${permission} retag from ${debug_ProvenanceExtra(orig_tag, PLAIN)} (that retag created ${debug_BorTag(new_tag, PLAIN)})`;
      break;
    }
  }

  this.machine.emit_diagnostic({ $: "PoppedPointerTag", _0: clone_Item(item), _1: cause });
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:483 operation_summary
function operation_summary(operation: string, alloc_id: AllocId, alloc_range: AllocRange): string {
  return `this error occurs as part of ${operation} at ${display_AllocId(alloc_id)}${display_AllocRange(alloc_range)}`;
}

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:487 error_cause
export function error_cause(stack: Stack, prov_extra: ProvenanceExtra): string {
  if (prov_extra.$ === "Concrete") {
    const tag = prov_extra._0;
    let any = false;
    for (let i = 0; i < stack.len(); i++) {
      const item = stack.get(i)!;
      if (item.tag() === tag && item.perm() !== Permission.Disabled) {
        any = true;
        break;
      }
    }
    if (any) {
      return ", but that tag only grants SharedReadOnly permission for this location";
    } else {
      return ", but that tag does not exist in the borrow stack for this location";
    }
  } else {
    return ", but no exposed tags have suitable permission in the borrow stack for this location";
  }
}

// impl RetagInfo
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/diagnostics.rs:503 summary
RetagInfo.prototype.summary = function (this: RetagInfo): string {
  switch (this.cause) {
    case "Normal":
      return "retag";
    case "FnEntry":
      return "function-entry retag";
    case "InPlaceFnPassing":
      return "in-place function argument/return passing protection";
    case "TwoPhase":
      return "two-phase retag";
  }
};
