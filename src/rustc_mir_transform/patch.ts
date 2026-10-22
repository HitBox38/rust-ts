// Port of compiler/rustc_mir_transform/src/patch.rs (lane mt-skeleton).
//
// PORT: `MirPatch::apply(self, ..)` consumes the patch; here the patch must not be used after `apply`. A queued
// `Location` is copied before `apply` shifts it (`Location` is `Copy`; the caller's object is not edited).
// PORT: method/field name clash (mir-contract decision 2): the methods `resume_block`, `unreachable_cleanup_block`,
// `unreachable_no_cleanup_block` and `terminate_block` are `resume_block_()`, ..., `terminate_block_()`.
// PORT: `SourceInfo` is `Copy`: `source_info_for_index` returns a copy (`clone_SourceInfo`, PORTING §8).
import type { Span } from "../rustc_span/lib.ts";
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  ClearCrossCrate,
  clone_SourceInfo,
  Local,
  LocalDecl,
  type LocalInfo,
  Location,
  Location_cmp,
  type Place,
  type Rvalue,
  SourceInfo,
  START_BLOCK,
  Statement,
  type StatementKind,
  Terminator,
  type TerminatorKind,
  type UnwindTerminateReason,
} from "../rustc_middle/mir/mod.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import { assert } from "../std/panic.ts";

// rustc-type: compiler/rustc_mir_transform/src/patch.rs:12 MirPatch
/// This struct lets you "patch" a MIR body, i.e. modify it. You can queue up
/// various changes, such as the addition of new statements and basic blocks
/// and replacement of terminators, and then apply the queued changes all at
/// once with `apply`. This is useful for MIR transformation passes.
export class MirPatch {
  constructor(
    public term_patch_map: Map<BasicBlock, TerminatorKind>,
    /// Set of statements that should be replaced by `Nop`.
    public nop_statements: Location[],
    public new_blocks: BasicBlockData[],
    public new_statements: [Location, StatementKind][],
    public new_locals: LocalDecl[],
    public resume_block: BasicBlock | undefined,
    // Only for unreachable in cleanup path.
    public unreachable_cleanup_block: BasicBlock | undefined,
    // Only for unreachable not in cleanup path.
    public unreachable_no_cleanup_block: BasicBlock | undefined,
    // Cached block for UnwindTerminate (with reason)
    public terminate_block: [BasicBlock, UnwindTerminateReason] | undefined,
    public body_span: Span,
    /// The number of locals at the start of the transformation. New locals
    /// get appended at the end.
    public next_local: number,
    /// The number of blocks at the start of the transformation. New blocks
    /// get appended at the end.
    public next_block: number,
  ) {}

  /// Creates a new, empty patch.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:37 new
  static new(body: Body): MirPatch {
    const result = new MirPatch(
      new Map(),
      [],
      [],
      [],
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      body.span,
      body.local_decls.length,
      body.basic_blocks.deref().length,
    );

    const blocks = body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb = BasicBlock.new(i);
      const block = blocks[i]!;
      // Check if we already have a resume block
      if (block.terminator_().kind.$ === "UnwindResume" && block.statements.length === 0) {
        result.resume_block = bb;
        continue;
      }

      // Check if we already have an unreachable block
      if (block.terminator_().kind.$ === "Unreachable" && block.statements.length === 0) {
        if (block.is_cleanup) {
          result.unreachable_cleanup_block = bb;
        } else {
          result.unreachable_no_cleanup_block = bb;
        }
        continue;
      }

      // Check if we already have a terminate block
      const kind = block.terminator_().kind;
      if (kind.$ === "UnwindTerminate" && block.statements.length === 0) {
        result.terminate_block = [bb, kind._0];
        continue;
      }
    }

    return result;
  }

  // rustc: compiler/rustc_mir_transform/src/patch.rs:86 resume_block
  resume_block_(): BasicBlock {
    if (this.resume_block !== undefined) {
      return this.resume_block;
    }

    const bb = this.new_block(BasicBlockData.new(new Terminator(SourceInfo.outermost(this.body_span), { $: "UnwindResume" }), true));
    this.resume_block = bb;
    return bb;
  }

  // rustc: compiler/rustc_mir_transform/src/patch.rs:102 unreachable_cleanup_block
  unreachable_cleanup_block_(): BasicBlock {
    if (this.unreachable_cleanup_block !== undefined) {
      return this.unreachable_cleanup_block;
    }

    const bb = this.new_block(BasicBlockData.new(new Terminator(SourceInfo.outermost(this.body_span), { $: "Unreachable" }), true));
    this.unreachable_cleanup_block = bb;
    return bb;
  }

  // rustc: compiler/rustc_mir_transform/src/patch.rs:118 unreachable_no_cleanup_block
  unreachable_no_cleanup_block_(): BasicBlock {
    if (this.unreachable_no_cleanup_block !== undefined) {
      return this.unreachable_no_cleanup_block;
    }

    const bb = this.new_block(BasicBlockData.new(new Terminator(SourceInfo.outermost(this.body_span), { $: "Unreachable" }), false));
    this.unreachable_no_cleanup_block = bb;
    return bb;
  }

  // rustc: compiler/rustc_mir_transform/src/patch.rs:134 terminate_block
  terminate_block_(reason: UnwindTerminateReason): BasicBlock {
    const cached = this.terminate_block;
    if (cached !== undefined) {
      const [cached_bb, cached_reason] = cached;
      if (reason === cached_reason) {
        return cached_bb;
      }
    }

    const bb = this.new_block(BasicBlockData.new(new Terminator(SourceInfo.outermost(this.body_span), { $: "UnwindTerminate", _0: reason }), true));
    this.terminate_block = [bb, reason];
    return bb;
  }

  /// Has a replacement of this block's terminator been queued in this patch?
  // rustc: compiler/rustc_mir_transform/src/patch.rs:153 is_term_patched
  is_term_patched(bb: BasicBlock): boolean {
    return this.term_patch_map.has(bb);
  }

  /// Universal getter for block data, either it is in 'old' blocks or in patched ones
  // rustc: compiler/rustc_mir_transform/src/patch.rs:158 block
  block(body: Body, bb: BasicBlock): BasicBlockData {
    // `bb.index().checked_sub(body.basic_blocks.len())`
    const len = body.basic_blocks.deref().length;
    if (BasicBlock.index(bb) >= len) {
      const new_ = BasicBlock.index(bb) - len;
      return this.new_blocks[new_]!;
    } else {
      return body.index(bb);
    }
  }

  /// Queues the addition of a new temporary with additional local info.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:170 new_local_with_info
  new_local_with_info(ty: Ty, span: Span, local_info: LocalInfo): Local {
    const index = this.next_local + this.new_locals.length;
    const new_decl = LocalDecl.new(ty, span);
    // `**new_decl.local_info.as_mut().unwrap_crate_local() = local_info;`
    // PORT: the `Box<LocalInfo>` is the `_0` of `ClearCrossCrate::Set`; writing through it replaces `_0`.
    const info = new_decl.local_info;
    ClearCrossCrate.unwrap_crate_local(info);
    (info as { $: "Set"; _0: LocalInfo })._0 = local_info;
    this.new_locals.push(new_decl);
    return Local.new(index);
  }

  /// Queues the addition of a new temporary.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:184 new_temp
  new_temp(ty: Ty, span: Span): Local {
    const index = this.next_local + this.new_locals.length;
    this.new_locals.push(LocalDecl.new(ty, span));
    return Local.new(index);
  }

  /// Returns the type of a local that's newly-added in the patch.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:191 local_ty
  local_ty(local_: Local): Ty {
    const local = Local.index(local_);
    assert(local < this.next_local + this.new_locals.length, "assertion failed: local < self.next_local + self.new_locals.len()");
    const new_local_idx = local - this.next_local;
    return this.new_locals[new_local_idx]!.ty;
  }

  /// Queues the addition of a new basic block.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:199 new_block
  new_block(data: BasicBlockData): BasicBlock {
    const block = BasicBlock.from_usize(this.next_block + this.new_blocks.length);
    // debug!("MirPatch: new_block: {:?}: {:?}", block, data);
    this.new_blocks.push(data);
    return block;
  }

  /// Queues the replacement of a block's terminator.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:207 patch_terminator
  patch_terminator(block: BasicBlock, new_: TerminatorKind): void {
    assert(!this.term_patch_map.has(block), "assertion failed: !self.term_patch_map.contains_key(&block)");
    // debug!("MirPatch: patch_terminator({:?}, {:?})", block, new);
    this.term_patch_map.set(block, new_);
  }

  /// Mark given statement to be replaced by a `Nop`.
  ///
  /// This method only works on statements from the initial body, and cannot be used to remove
  /// statements from `add_statement` or `add_assign`.
  // #[tracing::instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/patch.rs:218 nop_statement
  nop_statement(loc: Location): void {
    this.nop_statements.push(loc);
  }

  /// Queues the insertion of a statement at a given location. The statement
  /// currently at that location, and all statements that follow, are shifted
  /// down. If multiple statements are queued for addition at the same
  /// location, the final statement order after calling `apply` will match
  /// the queue insertion order.
  ///
  /// E.g. if we have `s0` at location `loc` and do these calls:
  ///
  ///   p.add_statement(loc, s1);
  ///   p.add_statement(loc, s2);
  ///   p.apply(body);
  ///
  /// then the final order will be `s1, s2, s0`, with `s1` at `loc`.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:235 add_statement
  add_statement(loc: Location, stmt: StatementKind): void {
    // debug!("MirPatch: add_statement({:?}, {:?})", loc, stmt);
    this.new_statements.push([loc, stmt]);
  }

  /// Like `add_statement`, but specialized for assignments.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:241 add_assign
  add_assign(loc: Location, place: Place, rv: Rvalue): void {
    this.add_statement(loc, { $: "Assign", _0: [place, rv] });
  }

  /// Applies the queued changes.
  // rustc: compiler/rustc_mir_transform/src/patch.rs:246 apply
  apply(body: Body): void {
    // debug!("MirPatch: {:?} new temps, starting from index {}: {:?}", self.new_locals.len(), body.local_decls.len(), self.new_locals);
    // debug!("MirPatch: {} new blocks, starting from index {}", self.new_blocks.len(), body.basic_blocks.len());
    // debug_assert_eq!(self.next_block, body.basic_blocks.len());
    const bbs = this.term_patch_map.size === 0 && this.new_blocks.length === 0 ? body.basic_blocks.as_mut_preserves_cfg() : body.basic_blocks.as_mut();
    for (const b of this.new_blocks) bbs.push(b);
    for (const l of this.new_locals) body.local_decls.push(l);

    for (const loc of this.nop_statements) {
      bbs[loc.block]!.statements[loc.statement_index]!.make_nop(true);
    }

    const new_statements = this.new_statements;

    // This must be a stable sort to provide the ordering described in the
    // comment for `add_statement`.
    new_statements.sort((a, b) => Location_cmp(a[0], b[0]));

    let delta = 0;
    let last_bb = START_BLOCK;
    for (const [loc_, stmt] of new_statements) {
      const loc = new Location(loc_.block, loc_.statement_index);
      if (loc.block !== last_bb) {
        delta = 0;
        last_bb = loc.block;
      }
      // debug!("MirPatch: adding statement {:?} at loc {:?}+{}", stmt, loc, delta);
      loc.statement_index += delta;
      const source_info = MirPatch.source_info_for_index(bbs[loc.block]!, loc);
      bbs[loc.block]!.statements.splice(loc.statement_index, 0, Statement.new(source_info, stmt));
      delta += 1;
    }

    // The order in which we patch terminators does not change the result.
    // #[allow(rustc::potential_query_instability)]
    for (const [src, patch] of this.term_patch_map) {
      // debug!("MirPatch: patching block {:?}", src);
      const bb = bbs[src]!;
      if (patch.$ === "Unreachable") {
        bb.statements.length = 0;
      }
      bb.terminator_mut().kind = patch;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/patch.rs:305 source_info_for_index
  static source_info_for_index(data: BasicBlockData, loc: Location): SourceInfo {
    const stmt = data.statements[loc.statement_index];
    if (stmt !== undefined) {
      return clone_SourceInfo(stmt.source_info);
    } else {
      return clone_SourceInfo(data.terminator_().source_info);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/patch.rs:312 source_info_for_location
  source_info_for_location(body: Body, loc: Location): SourceInfo {
    const data = this.block(body, loc.block);
    return MirPatch.source_info_for_index(data, loc);
  }
}
