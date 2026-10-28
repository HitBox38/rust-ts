// Port of compiler/rustc_mir_transform/src/check_enums.rs (lane mt-kpl-ubchecks).
//
// PORT: `EnumFinder` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4). `IndexVec<BasicBlock, _>` /
// `IndexVec<Local, _>` are arrays indexed by the handle (PORTING §5); `IndexVec::push` is rustc_index's
// `IndexVec.push` (returns the new index). `TyAndSize` (`#[derive(Debug, Copy, Clone)]`) is a plain interface: its
// `Debug` is never used and it is never mutated.
import { UintTy } from "../rustc_ast_ir/lib.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import { FieldsShape, Primitive, Size, type WrappingRange } from "../rustc_abi/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  CastKind,
  clone_Place,
  clone_SourceInfo,
  ConstOperand,
  ConstValue,
  type Local,
  type LocalDecl,
  LocalDecl as LocalDeclC,
  Location,
  type Operand,
  Operand as OperandC,
  type Place,
  Place_from_Local,
  type Rvalue,
  type SourceInfo,
  Statement,
  SwitchTargets,
  Terminator,
  TerminatorKind,
  UnwindAction,
} from "../rustc_middle/mir/mod.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { PrimitiveExt } from "../rustc_middle/ty/layout.ts";
import { Ty, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/// This pass inserts checks for a valid enum discriminant where they are most
/// likely to find UB, because checking everywhere like Miri would generate too
/// much MIR.
// rustc-type: compiler/rustc_mir_transform/src/check_enums.rs:16 CheckEnums
export class CheckEnums extends MirPass {
  readonly type_name = "rustc_mir_transform::check_enums::CheckEnums";

  // impl<'tcx> crate::MirPass<'tcx> for CheckEnums
  // rustc: compiler/rustc_mir_transform/src/check_enums.rs:19 policy
  policy(ctx: PassCtx): PassPolicy {
    // When UB checks are enabled this is part of their semantics, not an optimization.
    return PassPolicy.optional(ctx.deref().ub_checks());
  }

  // rustc: compiler/rustc_mir_transform/src/check_enums.rs:24 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // This pass emits new panics. If for whatever reason we do not have a panic
    // implementation, running this pass may cause otherwise-valid code to not compile.
    if (tcx.lang_items().get(LangItem.PanicImpl) === undefined) {
      return;
    }

    const typing_env = body.typing_env(tcx);
    const basic_blocks = body.basic_blocks.as_mut();
    const local_decls = body.local_decls;

    // This operation inserts new blocks. Each insertion changes the Location for all
    // statements/blocks after. Iterating or visiting the MIR in order would require updating
    // our current location after every insertion. By iterating backwards, we dodge this issue:
    // The only Locations that an insertion changes have already been handled.
    // PORT: `basic_blocks.indices().rev()` is evaluated once, before any insertion.
    for (let b = basic_blocks.length - 1; b >= 0; b--) {
      const block = BasicBlock.from_usize(b);
      for (let statement_index = basic_blocks[block]!.statements.length - 1; statement_index >= 0; statement_index--) {
        const location = new Location(block, statement_index);
        const statement = basic_blocks[block]!.statements[statement_index]!;
        // PORT: MIR aliasing (lane fix-ubchecks-alias): `SourceInfo` is `Copy`; this is the copy (each statement, local
        // decl and terminator built from it gets its own, as do the places reused below).
        const source_info = clone_SourceInfo(statement.source_info);

        const finder = EnumFinder.new(tcx, local_decls, typing_env);
        finder.visit_statement(statement, location);

        for (const check of finder.into_found_enums()) {
          // debug!("Inserting enum check");
          const new_block = split_block(basic_blocks, location);

          if ((check.$ === "Direct" || check.$ === "WithNiche") && check.op_size.bytes() === 0) {
            // It is never valid to use a ZST as a discriminant for an inhabited enum, but that will
            // have been caught by the type checker. Do nothing but ensure that a bug has been signaled.
            tcx.dcx().span_delayed_bug(source_info.span, "cannot build enum discriminant from zero-sized type");
            basic_blocks[block]!.terminator = new Terminator(clone_SourceInfo(source_info), TerminatorKind.goto(new_block));
          } else if (check.$ === "Direct") {
            const { source_op, discr, op_size, valid_discrs } = check;
            insert_direct_enum_check(
              tcx,
              local_decls,
              basic_blocks,
              block,
              source_op,
              discr,
              op_size,
              valid_discrs,
              source_info,
              new_block,
            );
          } else if (check.$ === "Uninhabited") {
            insert_uninhabited_enum_check(tcx, local_decls, basic_blocks[block]!, source_info, new_block);
          } else {
            const { source_op, discr, op_size, offset, valid_range } = check;
            insert_niche_check(
              tcx,
              local_decls,
              basic_blocks[block]!,
              source_op,
              valid_range,
              discr,
              op_size,
              offset,
              source_info,
              new_block,
            );
          }
        }
      }
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/check_enums.rs:115 EnumCheckType
/// Represent the different kind of enum checks we can insert.
type EnumCheckType =
  /// We know we try to create an uninhabited enum from an inhabited variant.
  | { readonly $: "Uninhabited" }
  /// We know the enum does no niche optimizations and can thus easily compute
  /// the valid discriminants.
  | { readonly $: "Direct"; source_op: Operand; discr: TyAndSize; op_size: Size; valid_discrs: bigint[] }
  /// We try to construct an enum that has a niche.
  | {
      readonly $: "WithNiche";
      source_op: Operand;
      discr: TyAndSize;
      op_size: Size;
      offset: Size;
      valid_range: WrappingRange;
    };

// rustc-type: compiler/rustc_mir_transform/src/check_enums.rs:137 TyAndSize
// #[derive(Debug, Copy, Clone)]
interface TyAndSize {
  ty: Ty;
  size: Size;
}

// rustc-type: compiler/rustc_mir_transform/src/check_enums.rs:144 EnumFinder
/// A [Visitor] that finds the construction of enums and evaluates which checks
/// we should apply.
class EnumFinder extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public local_decls: LocalDecl[],
    public typing_env: TypingEnv,
    public enums: EnumCheckType[],
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/check_enums.rs:152 new
  static new(tcx: TyCtxt, local_decls: LocalDecl[], typing_env: TypingEnv): EnumFinder {
    return new EnumFinder(tcx, local_decls, typing_env, []);
  }

  /// Returns the found enum creations and which checks should be inserted.
  // rustc: compiler/rustc_mir_transform/src/check_enums.rs:161 into_found_enums
  into_found_enums(): EnumCheckType[] {
    return this.enums;
  }

  // impl<'a, 'tcx> Visitor<'tcx> for EnumFinder<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/check_enums.rs:167 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    if (rvalue.$ === "Cast" && rvalue._0.$ === "Transmute") {
      const op = rvalue._1;
      const ty = rvalue._2;
      const ty_kind = ty.kind();
      if (ty_kind.$ !== "Adt") {
        return;
      }
      const adt_def = ty_kind._0;
      if (!adt_def.is_enum()) {
        return;
      }

      const enum_layout_ = this.tcx.layout_of(this.typing_env.as_query_input(ty));
      if (enum_layout_.$ !== "Ok") {
        return;
      }
      const enum_layout = enum_layout_._0;
      const op_layout_ = this.tcx.layout_of(this.typing_env.as_query_input(OperandC.ty(op, this.local_decls, this.tcx)));
      if (op_layout_.$ !== "Ok") {
        return;
      }
      const op_layout = op_layout_._0;

      const variants = enum_layout.variants;
      if (variants.$ === "Empty" && op_layout.is_uninhabited()) {
        return;
      }
      // An empty enum that tries to be constructed from an inhabited value, this
      // is never correct.
      else if (variants.$ === "Empty") {
        // The enum layout is uninhabited but we construct it from sth inhabited.
        // This is always UB.
        this.enums.push({ $: "Uninhabited" });
      }
      // Construction of Single value enums is always fine.
      else if (variants.$ === "Single") {
        // (nothing)
      }
      // Construction of an enum with multiple variants but no niche optimizations.
      else if (variants.tag_encoding.$ === "Direct" && variants.tag.$ === "Initialized") {
        const value = variants.tag.value;
        const valid_discrs = [...adt_def.discriminants(this.tcx)].map(([_, discr]) => discr.val);

        const discr: TyAndSize = { ty: PrimitiveExt.to_int_ty(value, this.tcx), size: Primitive.size(value, this.tcx) };
        this.enums.push({
          $: "Direct",
          source_op: OperandC.to_copy(op),
          discr,
          op_size: op_layout.size,
          valid_discrs,
        });
      }
      // Construction of an enum with multiple variants and niche optimizations.
      else if (variants.tag_encoding.$ === "Niche" && variants.tag.$ === "Initialized") {
        const { value, valid_range } = variants.tag;
        const tag_field = variants.tag_field;
        const discr: TyAndSize = { ty: PrimitiveExt.to_int_ty(value, this.tcx), size: Primitive.size(value, this.tcx) };
        this.enums.push({
          $: "WithNiche",
          source_op: OperandC.to_copy(op),
          discr,
          op_size: op_layout.size,
          offset: FieldsShape.offset(enum_layout.fields, FieldIdx.as_usize(tag_field)),
          valid_range,
        });
      } else {
        return;
      }

      this.super_rvalue(rvalue, location);
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/check_enums.rs:240 split_block
function split_block(basic_blocks: BasicBlockData[], location: Location): BasicBlock {
  const block_data = basic_blocks[location.block]!;

  // Drain every statement after this one and move the current terminator to a new basic block.
  // `block_data.terminator.take()`
  const terminator = block_data.terminator;
  block_data.terminator = undefined;
  const new_block = BasicBlockData.new_stmts(
    block_data.statements.splice(location.statement_index),
    terminator,
    block_data.is_cleanup,
  );

  return IndexVec.push<BasicBlock, BasicBlockData>(basic_blocks, new_block);
}

// PORT: `local_decls.push(LocalDecl::with_source_info(ty, source_info)).into()` (not an upstream fn). `source_info` is
// `Copy`: the decl gets its own copy (MIR aliasing, see `run_pass`).
function push_local_place(local_decls: LocalDecl[], ty: Ty, source_info: SourceInfo): Place {
  return Place_from_Local(IndexVec.push<Local, LocalDecl>(local_decls, LocalDeclC.with_source_info(ty, clone_SourceInfo(source_info))));
}

/// Inserts the cast of an operand (any type) to a u128 value that holds the discriminant value.
// rustc: compiler/rustc_mir_transform/src/check_enums.rs:257 insert_discr_cast_to_u128
function insert_discr_cast_to_u128(
  tcx: TyCtxt,
  local_decls: LocalDecl[],
  block_data: BasicBlockData,
  source_op: Operand,
  discr: TyAndSize,
  op_size: Size,
  offset_: Size | undefined,
  source_info: SourceInfo,
): Place {
  const get_ty_for_size = (tcx: TyCtxt, size: Size): Ty => {
    const invalid = size.bytes();
    switch (invalid) {
      case 1:
        return tcx.types.u8;
      case 2:
        return tcx.types.u16;
      case 4:
        return tcx.types.u32;
      case 8:
        return tcx.types.u64;
      case 16:
        return tcx.types.u128;
      default:
        return bug(`Found discriminant with invalid size, has ${invalid} bytes`);
    }
  };

  let cast_kind: CastKind;
  let discr_ty_bits: Operand;
  if (discr.size.bytes() < op_size.bytes()) {
    // The discriminant is less wide than the operand, cast the operand into
    // [MaybeUninit; N] and then index into it.
    const mu = Ty.new_maybe_uninit(tcx, tcx.types.u8);
    const array_len = op_size.bytes();
    const mu_array_ty = Ty.new_array(tcx, mu, array_len);
    const mu_array = push_local_place(local_decls, mu_array_ty, source_info);
    const rvalue: Rvalue = { $: "Cast", _0: CastKind.Transmute, _1: source_op, _2: mu_array_ty };
    block_data.statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [mu_array, rvalue] }));

    // Index into the array of MaybeUninit to get something that is actually
    // as wide as the discriminant.
    const offset = offset_ ?? Size.ZERO;
    const smaller_mu_array = mu_array.project_deeper(
      [
        {
          $: "Subslice",
          from: offset.bytes(),
          to: offset.bytes() + discr.size.bytes(),
          from_end: false,
        },
      ],
      tcx,
    );

    cast_kind = CastKind.Transmute;
    discr_ty_bits = { $: "Copy", _0: clone_Place(smaller_mu_array) };
  } else {
    const operand_int_ty = get_ty_for_size(tcx, op_size);

    const op_as_int = push_local_place(local_decls, operand_int_ty, source_info);
    const rvalue: Rvalue = { $: "Cast", _0: CastKind.Transmute, _1: source_op, _2: operand_int_ty };
    block_data.statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [op_as_int, rvalue] }));

    cast_kind = CastKind.IntToInt;
    discr_ty_bits = { $: "Copy", _0: clone_Place(op_as_int) };
  }

  // Cast the resulting value to the actual discriminant integer type.
  let rvalue: Rvalue = { $: "Cast", _0: cast_kind, _1: discr_ty_bits, _2: discr.ty };
  const discr_in_discr_ty = push_local_place(local_decls, discr.ty, source_info);
  block_data.statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [discr_in_discr_ty, rvalue] }));

  // Cast the discriminant to a u128 (base for comparisons of enum discriminants).
  const const_u128 = Ty.new_uint(tcx, UintTy.U128);
  rvalue = { $: "Cast", _0: CastKind.IntToInt, _1: { $: "Copy", _0: clone_Place(discr_in_discr_ty) }, _2: const_u128 };
  const discr_ = push_local_place(local_decls, const_u128, source_info);
  block_data.statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [discr_, rvalue] }));

  return discr_;
}

// rustc: compiler/rustc_mir_transform/src/check_enums.rs:338 insert_direct_enum_check
function insert_direct_enum_check(
  tcx: TyCtxt,
  local_decls: LocalDecl[],
  basic_blocks: BasicBlockData[],
  current_block: BasicBlock,
  source_op: Operand,
  discr: TyAndSize,
  op_size: Size,
  discriminants: bigint[],
  source_info: SourceInfo,
  new_block: BasicBlock,
): void {
  // Insert a new target block that is branched to in case of an invalid discriminant.
  const invalid_discr_block_data = BasicBlockData.new(undefined, false);
  const invalid_discr_block = IndexVec.push<BasicBlock, BasicBlockData>(basic_blocks, invalid_discr_block_data);
  const block_data = basic_blocks[current_block]!;
  const discr_place = insert_discr_cast_to_u128(
    tcx,
    local_decls,
    block_data,
    source_op,
    discr,
    op_size,
    undefined,
    source_info,
  );

  // Mask out the bits of the discriminant type.
  const mask = discr.size.unsigned_int_max();
  const discr_masked = push_local_place(local_decls, tcx.types.u128, source_info);
  const rvalue: Rvalue = {
    $: "BinaryOp",
    _0: "BitAnd",
    _1: [
      { $: "Copy", _0: clone_Place(discr_place) },
      {
        $: "Constant",
        _0: new ConstOperand(source_info.span, undefined, {
          $: "Val",
          _0: ConstValue.from_u128(mask),
          _1: tcx.types.u128,
        }),
      },
    ],
  };
  block_data.statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [discr_masked, rvalue] }));

  // Branch based on the discriminant value.
  block_data.terminator = new Terminator(clone_SourceInfo(source_info), {
    $: "SwitchInt",
    discr: { $: "Copy", _0: clone_Place(discr_masked) },
    targets: SwitchTargets.new(
      discriminants.map((discr_val): [bigint, BasicBlock] => [discr.size.truncate(discr_val), new_block]),
      invalid_discr_block,
    ),
  });

  // Abort in case of an invalid enum discriminant.
  basic_blocks[invalid_discr_block]!.terminator = new Terminator(clone_SourceInfo(source_info), {
    $: "Assert",
    cond: {
      $: "Constant",
      _0: new ConstOperand(source_info.span, undefined, {
        $: "Val",
        _0: ConstValue.from_bool(false),
        _1: tcx.types.bool,
      }),
    },
    expected: true,
    target: new_block,
    msg: { $: "InvalidEnumConstruction", _0: { $: "Copy", _0: clone_Place(discr_masked) } },
    // This calls panic_invalid_enum_construction, which is #[rustc_nounwind].
    // We never want to insert an unwind into unsafe code, because unwinding could
    // make a failing UB check turn into much worse UB when we start unwinding.
    unwind: UnwindAction.Unreachable,
  });
}

// rustc: compiler/rustc_mir_transform/src/check_enums.rs:418 insert_uninhabited_enum_check
function insert_uninhabited_enum_check(
  tcx: TyCtxt,
  local_decls: LocalDecl[],
  block_data: BasicBlockData,
  source_info: SourceInfo,
  new_block: BasicBlock,
): void {
  const is_ok: Place = push_local_place(local_decls, tcx.types.bool, source_info);
  block_data.statements.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [
        is_ok,
        {
          $: "Use",
          _0: {
            $: "Constant",
            _0: new ConstOperand(source_info.span, undefined, {
              $: "Val",
              _0: ConstValue.from_bool(false),
              _1: tcx.types.bool,
            }),
          },
          _1: "Yes", // it's a bool, retag doesn't matter
        },
      ],
    }),
  );

  block_data.terminator = new Terminator(clone_SourceInfo(source_info), {
    $: "Assert",
    cond: { $: "Copy", _0: clone_Place(is_ok) },
    expected: true,
    target: new_block,
    msg: {
      $: "InvalidEnumConstruction",
      _0: {
        $: "Constant",
        _0: new ConstOperand(source_info.span, undefined, {
          $: "Val",
          _0: ConstValue.from_u128(0n),
          _1: tcx.types.u128,
        }),
      },
    },
    // This calls panic_invalid_enum_construction, which is #[rustc_nounwind].
    // We never want to insert an unwind into unsafe code, because unwinding could
    // make a failing UB check turn into much worse UB when we start unwinding.
    unwind: UnwindAction.Unreachable,
  });
}

// rustc: compiler/rustc_mir_transform/src/check_enums.rs:463 insert_niche_check
function insert_niche_check(
  tcx: TyCtxt,
  local_decls: LocalDecl[],
  block_data: BasicBlockData,
  source_op: Operand,
  valid_range: WrappingRange,
  discr_: TyAndSize,
  op_size: Size,
  offset: Size,
  source_info: SourceInfo,
  new_block: BasicBlock,
): void {
  const discr = insert_discr_cast_to_u128(tcx, local_decls, block_data, source_op, discr_, op_size, offset, source_info);

  // Compare the discriminant against the valid_range.
  const start_const: Operand = {
    $: "Constant",
    _0: new ConstOperand(source_info.span, undefined, {
      $: "Val",
      _0: ConstValue.from_u128(valid_range.start),
      _1: tcx.types.u128,
    }),
  };
  const end_start_diff_const: Operand = {
    $: "Constant",
    _0: new ConstOperand(source_info.span, undefined, {
      $: "Val",
      // `u128::wrapping_sub(valid_range.end, valid_range.start)`
      _0: ConstValue.from_u128(BigInt.asUintN(128, valid_range.end - valid_range.start)),
      _1: tcx.types.u128,
    }),
  };

  const discr_diff: Place = push_local_place(local_decls, tcx.types.u128, source_info);
  block_data.statements.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [discr_diff, { $: "BinaryOp", _0: "Sub", _1: [{ $: "Copy", _0: clone_Place(discr) }, start_const] }],
    }),
  );

  const is_ok: Place = push_local_place(local_decls, tcx.types.bool, source_info);
  block_data.statements.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [
        is_ok,
        {
          $: "BinaryOp",
          // This is a `WrappingRange`, so make sure to get the wrapping right.
          _0: "Le",
          _1: [{ $: "Copy", _0: clone_Place(discr_diff) }, end_start_diff_const],
        },
      ],
    }),
  );

  block_data.terminator = new Terminator(clone_SourceInfo(source_info), {
    $: "Assert",
    cond: { $: "Copy", _0: clone_Place(is_ok) },
    expected: true,
    target: new_block,
    msg: { $: "InvalidEnumConstruction", _0: { $: "Copy", _0: clone_Place(discr) } },
    // This calls panic_invalid_enum_construction, which is #[rustc_nounwind].
    // We never want to insert an unwind into unsafe code, because unwinding could
    // make a failing UB check turn into much worse UB when we start unwinding.
    unwind: UnwindAction.Unreachable,
  });
}
