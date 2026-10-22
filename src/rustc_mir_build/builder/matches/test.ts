// Port of compiler/rustc_mir_build/src/builder/matches/test.rs (lane mb-matches-c; declared by builder-contract).
// `impl Builder` methods go on its prototype (builder/mod.ts header).
// Testing candidates
//
// After candidates have been simplified, the only match pairs that
// remain are those that require some sort of test. The functions here
// identify what tests are needed, perform the tests, and then filter
// the candidates based on the result.
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import {
  type BasicBlock,
  type BinOp,
  CastKind,
  Const,
  ConstOperand,
  clone_Operand,
  type Operand,
  type Place,
  type SourceInfo,
  SwitchTargets,
  TerminatorKind,
  UnwindAction,
} from "../../../rustc_middle/mir/mod.ts";
import { PatRangeBoundary } from "../../../rustc_middle/thir.ts";
import { type Value, debug_Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import { Value as ValueC } from "../../../rustc_middle/ty/consts/valtree.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { AssocItem, AssocItems } from "../../../rustc_middle/ty/assoc.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { IntTypeExt } from "../../../rustc_middle/ty/util.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type MatchPairTree, type Test, type TestKind } from "./mod.gen.ts";
import { type TestBranch } from "./mod.ts";
import { ref_pat_borrow_kind } from "./util.ts";
import { Builder } from "../mod.ts";
import { type DefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../../rustc_span/lib.ts";
import { type Symbol, sym } from "../../../rustc_span/symbol.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, panic } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // test.rs:30 (lane mb-matches-c)
    pick_test_for_match_pair(match_pair: MatchPairTree): Test;
    // test.rs:66 (lane mb-matches-c)
    perform_test(match_start_span: Span, scrutinee_span: Span, block: BasicBlock, otherwise_block: BasicBlock, place: Place, test: Test, target_blocks: Map<TestBranch, BasicBlock>): void;
    // test.rs:335 (lane mb-matches-c)
    call_deref(block: BasicBlock, target_block: BasicBlock, place: Place, mutability: Mutability, ty: Ty, temp: Place, span: Span): void;
    // test.rs:385 (lane mb-matches-c)
    compare(block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, op: BinOp, left: Operand, right: Operand): void;
    // test.rs:415 (lane mb-matches-c)
    string_compare(block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, expect: Operand, val: Operand): void;
  }
}

/// Identifies what test is needed to decide if `match_pair` is applicable.
///
/// It is a bug to call this with a not-fully-simplified pattern.
// rustc: compiler/rustc_mir_build/src/builder/matches/test.rs:30 pick_test_for_match_pair
Builder.prototype.pick_test_for_match_pair = function (this: Builder, match_pair: MatchPairTree): Test {
  // Or-patterns are not tested directly; instead they are expanded into subcandidates,
  // which are then distinguished by testing whatever non-or patterns they contain.
  if (match_pair.kind.$ !== "Testable") {
    return bug("or-patterns should have already been handled");
  }
  const testable_case = match_pair.kind.testable_case;
  let kind: TestKind;
  switch (testable_case.$) {
    case "Variant":
      kind = { $: "Switch", adt_def: testable_case.adt_def };
      break;

    case "Constant": {
      const value = testable_case.value;
      switch (testable_case.kind) {
        case "Bool":
          kind = { $: "If" };
          break;
        case "IntOrChar":
          kind = { $: "SwitchInt" };
          break;
        case "String":
          kind = { $: "StringEq", value };
          break;
        case "Float":
        case "Other":
          kind = { $: "ScalarEq", value };
          break;
      }
      break;
    }

    case "Range":
      // PORT: `Arc::clone(range)` shares the `PatRange`.
      kind = { $: "Range", _0: testable_case._0 };
      break;

    case "Slice":
      kind = { $: "SliceLen", len: testable_case.len, op: testable_case.op };
      break;

    case "Deref":
      kind = { $: "Deref", temp: testable_case.temp, mutability: testable_case.mutability };
      break;

    case "Never":
      kind = { $: "Never" };
      break;
  }

  return { span: match_pair.pattern_span, kind };
};

// #[instrument(skip(self, target_blocks, place), level = "debug")]
// PORT: `target_blocks` is an `FxIndexMap<TestBranch, BasicBlock>`: the caller passes a `KeyedMap` keyed by
// `intern_key` (`TestBranch`'s derived `Eq`), so `get` of a fresh `TestBranch` finds its entry.
// rustc: compiler/rustc_mir_build/src/builder/matches/test.rs:66 perform_test
Builder.prototype.perform_test = function (this: Builder, match_start_span: Span, scrutinee_span: Span, block: BasicBlock, otherwise_block: BasicBlock, place: Place, test: Test, target_blocks: Map<TestBranch, BasicBlock>): void {
  const place_ty = place.ty(this.local_decls, this.tcx);
  // debug!(?place, ?place_ty);
  const target_block = (branch: TestBranch): BasicBlock => target_blocks.get(branch) ?? otherwise_block;

  const source_info = this.source_info(test.span);
  const test_kind = test.kind;
  switch (test_kind.$) {
    case "Switch": {
      const adt_def = test_kind.adt_def;
      const otherwise_block = target_block({ $: "Failure" });
      const tcx = this.tcx;
      const switch_targets = SwitchTargets.new(
        (function* (): Generator<[bigint, BasicBlock]> {
          for (const [idx, discr] of adt_def.discriminants(tcx)) {
            const block = target_blocks.get({ $: "Variant", _0: idx });
            if (block !== undefined) {
              yield [discr.val, block];
            }
          }
        })(),
        otherwise_block,
      );
      // debug!("num_enum_variants: {}", adt_def.variants().len());
      const discr_ty = IntTypeExt.to_ty(adt_def.repr().discr_type(), this.tcx);
      const discr = this.temp(discr_ty, test.span);
      this.cfg.push_assign(block, this.source_info(scrutinee_span), discr, { $: "Discriminant", _0: place });
      this.cfg.terminate(block, this.source_info(match_start_span), {
        $: "SwitchInt",
        discr: { $: "Move", _0: discr },
        targets: switch_targets,
      });
      break;
    }

    case "SwitchInt": {
      // The switch may be inexhaustive so we have a catch-all block
      const otherwise_block = target_block({ $: "Failure" });
      const switch_targets = SwitchTargets.new(
        (function* (): Generator<[bigint, BasicBlock]> {
          for (const [branch, block] of target_blocks) {
            if (branch.$ === "Constant") {
              const value = branch._0;
              const bits = ValueC.to_leaf(value).to_bits_unchecked();
              yield [bits, block];
            }
          }
        })(),
        otherwise_block,
      );
      const terminator: TerminatorKind = {
        $: "SwitchInt",
        discr: { $: "Copy", _0: place },
        targets: switch_targets,
      };
      this.cfg.terminate(block, this.source_info(match_start_span), terminator);
      break;
    }

    case "If": {
      const success_block = target_block({ $: "Success" });
      const fail_block = target_block({ $: "Failure" });
      const terminator = TerminatorKind.if_({ $: "Copy", _0: place }, success_block, fail_block);
      this.cfg.terminate(block, this.source_info(match_start_span), terminator);
      break;
    }

    case "StringEq": {
      const value = test_kind.value;
      const tcx = this.tcx;
      const success_block = target_block({ $: "Success" });
      const fail_block = target_block({ $: "Failure" });

      const ref_str_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, tcx.types.str_);
      // PORT: `assert!(cond, fmt..)` formats its message only when it fails.
      if (!ref_str_ty.is_imm_ref_str()) panic(debug_Ty(ref_str_ty, PLAIN));

      // The string constant we're testing against has type `str`, but
      // calling `<str as PartialEq>::eq` requires `&str` operands.
      //
      // Because `str` and `&str` have the same valtree representation,
      // we can "cast" to the desired type by just replacing the type.
      if (!value.ty.is_str()) panic(`unexpected value type for StringEq test: ${debug_Value(value, PLAIN)}`);
      const expected_value: Value = { ty: ref_str_ty, valtree: value.valtree };
      const expected_value_operand = this.literal_operand(test.span, Const.from_ty_value(tcx, expected_value));

      // Similarly, the scrutinized place has type `str`, but we need `&str`.
      // Get a reference by doing `let actual_value_ref_place: &str = &place`.
      const actual_value_ref_place = this.temp(ref_str_ty, test.span);
      this.cfg.push_assign(block, this.source_info(test.span), actual_value_ref_place, {
        $: "Ref",
        _0: tcx.lifetimes.re_erased,
        _1: { $: "Shared" },
        _2: place,
      });

      // Compare two strings using `<str as std::cmp::PartialEq>::eq`.
      // (Interestingly this means that exhaustiveness analysis relies, for soundness,
      // on the `PartialEq` impl for `str` to be correct!)
      this.string_compare(block, success_block, fail_block, source_info, expected_value_operand, {
        $: "Copy",
        _0: actual_value_ref_place,
      });
      break;
    }

    case "ScalarEq": {
      const value = test_kind.value;
      const tcx = this.tcx;
      const success_block = target_block({ $: "Success" });
      const fail_block = target_block({ $: "Failure" });

      let expected_value_ty = value.ty;
      let expected_value_operand = this.literal_operand(test.span, Const.from_ty_value(tcx, value));

      let actual_value_place = place;

      const value_ty_kind = value.ty.kind();
      switch (value_ty_kind.$) {
        case "Pat": {
          const base = value_ty_kind._0;
          assert(base.is_trivially_pure_clone_copy(), "assertion failed: base.is_trivially_pure_clone_copy()");

          const transmuted_place = this.temp(base, test.span);
          this.cfg.push_assign(block, this.source_info(scrutinee_span), transmuted_place, {
            $: "Cast",
            _0: CastKind.Transmute,
            _1: { $: "Copy", _0: actual_value_place },
            _2: base,
          });

          const transmuted_expect = this.temp(base, test.span);
          this.cfg.push_assign(block, this.source_info(test.span), transmuted_expect, {
            $: "Cast",
            _0: CastKind.Transmute,
            _1: expected_value_operand,
            _2: base,
          });

          actual_value_place = transmuted_place;
          expected_value_operand = { $: "Copy", _0: transmuted_expect };
          expected_value_ty = base;
          break;
        }
        default:
          break;
      }

      assert(expected_value_ty.is_scalar(), "assertion failed: expected_value_ty.is_scalar()");

      this.compare(block, success_block, fail_block, source_info, "Eq", expected_value_operand, {
        $: "Copy",
        _0: actual_value_place,
      });
      break;
    }

    case "Range": {
      const range = test_kind._0;
      const success = target_block({ $: "Success" });
      const fail = target_block({ $: "Failure" });
      // Test `val` by computing `lo <= val && val <= hi`, using primitive comparisons.
      const val: Operand = { $: "Copy", _0: place };

      const intermediate_block = !PatRangeBoundary.is_finite(range.lo)
        ? block
        : !PatRangeBoundary.is_finite(range.hi)
          ? success
          : this.cfg.start_new_block();

      const lo_ = PatRangeBoundary.as_finite(range.lo);
      if (lo_ !== undefined) {
        const lo_value: Value = { ty: range.ty, valtree: lo_ };
        const lo = this.literal_operand(test.span, Const.from_ty_value(this.tcx, lo_value));
        this.compare(block, intermediate_block, fail, source_info, "Le", lo, clone_Operand(val));
      }

      const hi_ = PatRangeBoundary.as_finite(range.hi);
      if (hi_ !== undefined) {
        const hi_value: Value = { ty: range.ty, valtree: hi_ };
        const hi = this.literal_operand(test.span, Const.from_ty_value(this.tcx, hi_value));
        let op: BinOp;
        switch (range.end) {
          case "Included":
            op = "Le";
            break;
          case "Excluded":
            op = "Lt";
            break;
        }
        this.compare(intermediate_block, success, fail, source_info, op, val, hi);
      }
      break;
    }

    case "SliceLen": {
      const { len, op } = test_kind;
      const usize_ty = this.tcx.types.usize;
      const actual = this.temp(usize_ty, test.span);

      // actual = len(place)
      const length_op = this.len_of_slice_or_array(block, place, test.span, source_info);
      this.cfg.push_assign(block, source_info, actual, { $: "Use", _0: length_op, _1: "Yes" });

      // expected = <N>
      const expected = this.push_usize(block, source_info, len);

      const success_block = target_block({ $: "Success" });
      const fail_block = target_block({ $: "Failure" });
      // result = actual == expected OR result = actual < expected
      // branch based on result
      let bin_op: BinOp;
      switch (op) {
        case "Equal":
          bin_op = "Eq";
          break;
        case "GreaterOrEqual":
          bin_op = "Ge";
          break;
      }
      this.compare(block, success_block, fail_block, source_info, bin_op, { $: "Move", _0: actual }, { $: "Move", _0: expected });
      break;
    }

    case "Deref": {
      const { temp, mutability } = test_kind;
      const ty = place_ty.ty;
      const target = target_block({ $: "Success" });
      this.call_deref(block, target, place, mutability, ty, temp, test.span);
      break;
    }

    case "Never": {
      // Check that the place is initialized.
      // FIXME(never_patterns): Also assert validity of the data at `place`.
      this.cfg.push_fake_read(block, source_info, { $: "ForMatchedPlace", _0: undefined }, place);
      // A never pattern is only allowed on an uninhabited type, so validity of the data
      // implies unreachability.
      this.cfg.terminate(block, source_info, TerminatorKind.Unreachable);
      break;
    }
  }
};

/// Perform `let temp = <ty as Deref>::deref(&place)`.
/// or `let temp = <ty as DerefMut>::deref_mut(&mut place)`.
// rustc: compiler/rustc_mir_build/src/builder/matches/test.rs:335 call_deref
Builder.prototype.call_deref = function (this: Builder, block: BasicBlock, target_block: BasicBlock, place: Place, mutability: Mutability, ty: Ty, temp: Place, span: Span): void {
  let trait_item_: "Deref" | "DerefMut";
  let method_: Symbol;
  switch (mutability) {
    case "Not":
      [trait_item_, method_] = ["Deref", sym.deref];
      break;
    case "Mut":
      [trait_item_, method_] = ["DerefMut", sym.deref_mut];
      break;
  }
  const borrow_kind = ref_pat_borrow_kind(mutability);
  const source_info = this.source_info(span);
  const re_erased = this.tcx.lifetimes.re_erased;
  const trait_item = this.tcx.require_lang_item(trait_item_, span);
  const method = trait_method(this.tcx, trait_item, method_, [GenericArg.from_Ty(ty)]);
  const ref_src = this.temp(Ty.new_ref(this.tcx, re_erased, ty, mutability), span);
  // `let ref_src = &src_place;`
  // or `let ref_src = &mut src_place;`
  this.cfg.push_assign(block, source_info, ref_src, { $: "Ref", _0: re_erased, _1: borrow_kind, _2: place });
  // `let temp = <Ty as Deref>::deref(ref_src);`
  // or `let temp = <Ty as DerefMut>::deref_mut(ref_src);`
  this.cfg.terminate(block, source_info, {
    $: "Call",
    func: { $: "Constant", _0: new ConstOperand(span, undefined, method) },
    args: [{ node: { $: "Move", _0: ref_src }, span }],
    destination: temp,
    target: target_block,
    unwind: UnwindAction.Continue,
    call_source: "Misc",
    fn_span: source_info.span,
  });
};

/// Compare using the provided built-in comparison operator
// rustc: compiler/rustc_mir_build/src/builder/matches/test.rs:385 compare
Builder.prototype.compare = function (this: Builder, block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, op: BinOp, left: Operand, right: Operand): void {
  const bool_ty = this.tcx.types.bool;
  const result = this.temp(bool_ty, source_info.span);

  // result = op(left, right)
  this.cfg.push_assign(block, source_info, result, { $: "BinaryOp", _0: op, _1: [left, right] });

  // branch based on result
  this.cfg.terminate(block, source_info, TerminatorKind.if_({ $: "Move", _0: result }, success_block, fail_block));
};

/// Compare two values of type `&str` using `<str as std::cmp::PartialEq>::eq`.
// rustc: compiler/rustc_mir_build/src/builder/matches/test.rs:415 string_compare
Builder.prototype.string_compare = function (this: Builder, block: BasicBlock, success_block: BasicBlock, fail_block: BasicBlock, source_info: SourceInfo, expect: Operand, val: Operand): void {
  const str_ty = this.tcx.types.str_;
  const eq_def_id = this.tcx.require_lang_item("PartialEq", source_info.span);
  const method = trait_method(this.tcx, eq_def_id, sym.eq, [GenericArg.from_Ty(str_ty), GenericArg.from_Ty(str_ty)]);

  const bool_ty = this.tcx.types.bool;
  const eq_result = this.temp(bool_ty, source_info.span);
  const eq_block = this.cfg.start_new_block();
  this.cfg.terminate(block, source_info, {
    $: "Call",
    func: {
      $: "Constant",
      _0: new ConstOperand(
        source_info.span,

        // FIXME(#54571): This constant comes from user input (a
        // constant in a pattern). Are there forms where users can add
        // type annotations here?  For example, an associated constant?
        // Need to experiment.
        undefined,

        method,
      ),
    },
    args: [
      { node: val, span: DUMMY_SP },
      { node: expect, span: DUMMY_SP },
    ],
    destination: eq_result,
    target: eq_block,
    unwind: UnwindAction.Continue,
    call_source: "MatchCmp",
    fn_span: source_info.span,
  });
  this.diverge_from(block);

  // check the result
  this.cfg.terminate(eq_block, source_info, TerminatorKind.if_({ $: "Move", _0: eq_result }, success_block, fail_block));
};

// rustc: compiler/rustc_mir_build/src/builder/matches/test.rs:469 trait_method
export function trait_method(tcx: TyCtxt, trait_def_id: DefId, method_name: Symbol, args: readonly GenericArg[]): Const {
  // The unhygienic comparison here is acceptable because this is only
  // used on known traits.
  let item: AssocItem | undefined;
  for (const it of AssocItems.filter_by_name_unhygienic(tcx.associated_items(trait_def_id) as AssocItems, method_name)) {
    if (AssocItem.is_fn(it)) {
      item = it;
      break;
    }
  }
  if (item === undefined) return panic("trait method not found");

  return Const.zero_sized(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(item.def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty)));
}
