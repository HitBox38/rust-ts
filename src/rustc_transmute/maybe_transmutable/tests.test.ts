// compiler/rustc_transmute/src/maybe_transmutable/tests.rs.
//
// PORT: `assert_eq!` on answers compares their `Debug` output (`Answer_eq` agrees with it here: the regions are
// numbers and the types `()` / `!`). `R = !` / `T = !` are `never`, `T = ()` is `null`. The `#[bench]` functions run
// their measured body once. `itertools::Itertools::powerset` is a local `powerset` (same order: by size, then
// lexicographically).
import { describe, expect, test } from "bun:test";
// Init order: rustc_middle's crate root first (as the driver loads it), then this crate.
import "../../rustc_middle/lib.ts";
import { type Answer, Answer as AnswerC, Assume, clone_Answer, type Condition, debug_Answer, debug_Assume } from "../lib.ts";
import { clone_Dfa, Dfa, Dfa_eq, State } from "../layout/dfa.ts";
import { clone_Tree, debug_Tree, Tree, type Tree as TreeT } from "../layout/tree.ts";
import { Endian } from "../layout/tree.ts";
import { AnswerExt, MaybeTransmutableQuery, Quantifier } from "./mod.ts";
import { test as qc_test } from "./query_context.ts";
import { debug_int, PLAIN, type Debug } from "../../std/fmt.ts";

type Def = qc_test.Def;
const Def = qc_test.Def;
const UltraMinimal = qc_test.UltraMinimal;

type Layout = TreeT<Def, never, never>;
type Dfa_ = Dfa<never, never>;

const never_debug: Debug<never> = () => "!";
const unit_debug: Debug<null> = () => "()";
const show = (a: Answer<never, never>): string => debug_Answer(a, PLAIN, never_debug, never_debug);
const show_u = (a: Answer<number, null>): string => debug_Answer(a, PLAIN, debug_int, unit_debug);

/** `Assume { .., ..Assume::default() }` */
function assume_with(fields: Partial<{ alignment: boolean; lifetimes: boolean; safety: boolean; validity: boolean }>): Assume {
  const d = Assume.default_();
  return new Assume(fields.alignment ?? d.alignment, fields.lifetimes ?? d.lifetimes, fields.safety ?? d.safety, fields.validity ?? d.validity);
}

// trait Representation { fn is_transmutable(src: Self, dst: Self, assume: Assume) -> Answer<!, !>; }
interface Representation<X> {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:12 is_transmutable
  is_transmutable(src: X, dst: X, assume: Assume): Answer<never, never>;
  clone(x: X): X;
}

// impl Representation for Tree
const Representation_Tree: Representation<Layout> = {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:16 is_transmutable
  is_transmutable(src: Layout, dst: Layout, assume: Assume): Answer<never, never> {
    return MaybeTransmutableQuery.new(src, dst, assume, UltraMinimal.default_()).answer_tree(qc_test.QueryContext_UltraMinimal<never, never>());
  },
  clone: clone_Tree,
};

// impl Representation for Dfa
const Representation_Dfa: Representation<Dfa_> = {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:28 is_transmutable
  is_transmutable(src: Dfa_, dst: Dfa_, assume: Assume): Answer<never, never> {
    return MaybeTransmutableQuery.new(src, dst, assume, UltraMinimal.default_()).answer_dfa();
  },
  clone: clone_Dfa,
};

// rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:39 is_transmutable
function is_transmutable<X>(R: Representation<X>, src: X, dst: X, assume: Assume): Answer<never, never> {
  const src_ = R.clone(src);
  const dst_ = R.clone(dst);
  return R.is_transmutable(src_, dst_, assume);
}
const is_transmutable_tree = (src: Layout, dst: Layout, assume: Assume): string => show(is_transmutable(Representation_Tree, src, dst, assume));

const YES = show(AnswerC.Yes);
const no = (r: "DstIsBitIncompatible" | "DstIsTooBig" | "DstMayHaveSafetyInvariants"): string => show({ $: "No", _0: { $: r } });

describe("answers", () => {
  // type Answer = crate::Answer<usize, ()>;
  type A = Answer<number, null>;
  // const OUTLIVES / IMMUTABLE / TRANSMUTABLE (a Rust `const` is a fresh value at every use)
  const OUTLIVES = (): Condition<number, null> => ({ $: "Outlives", long: 1, short: 0 });
  const IMMUTABLE = (): Condition<number, null> => ({ $: "Immutable", ty: null });
  const TRANSMUTABLE = (): Condition<number, null> => ({ $: "Transmutable", src: null, dst: null });
  const Yes = (): A => AnswerC.Yes;
  const No = (r: "DstIsTooBig" | "DstIsBitIncompatible"): A => ({ $: "No", _0: { $: r } });
  const If = (c: Condition<number, null>): A => ({ $: "If", _0: c });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:60 and_yes_is_identity
  test("and_yes_is_identity", () => {
    for (const answer of [Yes(), No("DstIsTooBig"), If(IMMUTABLE())]) {
      expect(show_u(AnswerExt.and(Yes(), clone_Answer(answer)))).toBe(show_u(answer));
      expect(show_u(AnswerExt.and(clone_Answer(answer), Yes()))).toBe(show_u(answer));
    }
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:68 and_no_absorbs_conditions
  test("and_no_absorbs_conditions", () => {
    const no = No("DstIsTooBig");
    const conditional = If(IMMUTABLE());
    expect(show_u(AnswerExt.and(clone_Answer(no), clone_Answer(conditional)))).toBe(show_u(no));
    expect(show_u(AnswerExt.and(conditional, clone_Answer(no)))).toBe(show_u(no));
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:76 or_bit_incompatibility_is_identity
  test("or_bit_incompatibility_is_identity", () => {
    for (const answer of [Yes(), No("DstIsTooBig"), If(IMMUTABLE())]) {
      const no = No("DstIsBitIncompatible");
      expect(show_u(AnswerExt.or(clone_Answer(no), clone_Answer(answer)))).toBe(show_u(answer));
      expect(show_u(AnswerExt.or(clone_Answer(answer), no))).toBe(show_u(answer));
    }
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:85 or_yes_preserves_conditions
  test("or_yes_preserves_conditions", () => {
    const conditional = If(IMMUTABLE());
    expect(show_u(AnswerExt.or(Yes(), clone_Answer(conditional)))).toBe(show_u(conditional));
    expect(show_u(AnswerExt.or(clone_Answer(conditional), Yes()))).toBe(show_u(conditional));
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:92 and_flattens_condition_groups
  test("and_flattens_condition_groups", () => {
    const pair = AnswerExt.and(If(OUTLIVES()), If(IMMUTABLE()));
    expect(show_u(pair)).toBe(show_u(If({ $: "IfAll", _0: [OUTLIVES(), IMMUTABLE()] })));

    const expected = show_u(If({ $: "IfAll", _0: [OUTLIVES(), IMMUTABLE(), TRANSMUTABLE()] }));
    expect(show_u(AnswerExt.and(clone_Answer(pair), If(TRANSMUTABLE())))).toBe(expected);
    expect(show_u(AnswerExt.and(If(TRANSMUTABLE()), clone_Answer(pair)))).toBe(expected);
    expect(show_u(AnswerExt.and(pair, If({ $: "IfAll", _0: [TRANSMUTABLE()] })))).toBe(expected);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:103 or_flattens_condition_groups
  test("or_flattens_condition_groups", () => {
    const pair = AnswerExt.or(If(OUTLIVES()), If(IMMUTABLE()));
    expect(show_u(pair)).toBe(show_u(If({ $: "IfAny", _0: [OUTLIVES(), IMMUTABLE()] })));

    const expected = show_u(If({ $: "IfAny", _0: [OUTLIVES(), IMMUTABLE(), TRANSMUTABLE()] }));
    expect(show_u(AnswerExt.or(clone_Answer(pair), If(TRANSMUTABLE())))).toBe(expected);
    expect(show_u(AnswerExt.or(If(TRANSMUTABLE()), clone_Answer(pair)))).toBe(expected);
    expect(show_u(AnswerExt.or(pair, If({ $: "IfAny", _0: [TRANSMUTABLE()] })))).toBe(expected);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:114 specific_errors_take_precedence_over_bit_incompatibility
  test("specific_errors_take_precedence_over_bit_incompatibility", () => {
    const combinators: ((a: A, b: A) => A)[] = [AnswerExt.and, AnswerExt.or];
    for (const combine of combinators) {
      const generic = No("DstIsBitIncompatible");
      const specific = No("DstIsTooBig");
      expect(show_u(combine(clone_Answer(generic), clone_Answer(specific)))).toBe(show_u(specific));
      expect(show_u(combine(clone_Answer(specific), generic))).toBe(show_u(specific));
    }
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:125 empty_quantifiers
  test("empty_quantifiers", () => {
    expect(show_u(Quantifier.apply<number, null>("ForAll", []))).toBe(show_u(Yes()));
    expect(show_u(Quantifier.apply<number, null>("ThereExists", []))).toBe(show_u(No("DstIsBitIncompatible")));
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:131 quantifiers_short_circuit_after_a_decisive_answer
  test("quantifiers_short_circuit_after_a_decisive_answer", () => {
    const no = No("DstIsTooBig");
    let answers = [If(IMMUTABLE()), clone_Answer(no), Yes()][Symbol.iterator]();
    expect(show_u(Quantifier.apply("ForAll", answers))).toBe(show_u(no));
    let next = answers.next();
    expect(next.done ? "None" : show_u(next.value)).toBe(show_u(Yes()));

    answers = [no, Yes(), If(IMMUTABLE())][Symbol.iterator]();
    expect(show_u(Quantifier.apply("ThereExists", answers))).toBe(show_u(Yes()));
    next = answers.next();
    expect(next.done ? "None" : show_u(next.value)).toBe(show_u(If(IMMUTABLE())));
  });
});

describe("safety", () => {
  const DST_HAS_SAFETY_INVARIANTS = no("DstMayHaveSafetyInvariants");

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:151 src_safe_dst_safe
  test("src_safe_dst_safe", () => {
    const src: Layout = Tree.then({ $: "Def", _0: Def.NoSafetyInvariants }, Tree.u8());
    const dst: Layout = Tree.then({ $: "Def", _0: Def.NoSafetyInvariants }, Tree.u8());
    expect(is_transmutable_tree(src, dst, Assume.default_())).toBe(YES);
    expect(is_transmutable_tree(src, dst, assume_with({ safety: true }))).toBe(YES);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:162 src_safe_dst_unsafe
  test("src_safe_dst_unsafe", () => {
    const src: Layout = Tree.then({ $: "Def", _0: Def.NoSafetyInvariants }, Tree.u8());
    const dst: Layout = Tree.then({ $: "Def", _0: Def.HasSafetyInvariants }, Tree.u8());
    expect(is_transmutable_tree(src, dst, Assume.default_())).toBe(DST_HAS_SAFETY_INVARIANTS);
    expect(is_transmutable_tree(src, dst, assume_with({ safety: true }))).toBe(YES);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:173 src_unsafe_dst_safe
  test("src_unsafe_dst_safe", () => {
    const src: Layout = Tree.then({ $: "Def", _0: Def.HasSafetyInvariants }, Tree.u8());
    const dst: Layout = Tree.then({ $: "Def", _0: Def.NoSafetyInvariants }, Tree.u8());
    expect(is_transmutable_tree(src, dst, Assume.default_())).toBe(YES);
    expect(is_transmutable_tree(src, dst, assume_with({ safety: true }))).toBe(YES);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:184 src_unsafe_dst_unsafe
  test("src_unsafe_dst_unsafe", () => {
    const src: Layout = Tree.then({ $: "Def", _0: Def.HasSafetyInvariants }, Tree.u8());
    const dst: Layout = Tree.then({ $: "Def", _0: Def.HasSafetyInvariants }, Tree.u8());
    expect(is_transmutable_tree(src, dst, Assume.default_())).toBe(DST_HAS_SAFETY_INVARIANTS);
    expect(is_transmutable_tree(src, dst, assume_with({ safety: true }))).toBe(YES);
  });
});

/** Every `Assume` (the four nested `for .. in [false, true]` loops). */
function* all_assumes(): Generator<Assume> {
  for (const alignment of [false, true]) {
    for (const lifetimes of [false, true]) {
      for (const safety of [false, true]) {
        for (const validity of [false, true]) {
          yield new Assume(alignment, lifetimes, safety, validity);
        }
      }
    }
  }
}

describe("size", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:199 size
  test("size", () => {
    const small: Layout = Tree.number(1);
    const large: Layout = Tree.number(2);

    for (const assume of all_assumes()) {
      const ctx = `assume: ${debug_Assume(assume, PLAIN)}`;
      expect([ctx, is_transmutable_tree(small, large, assume)]).toEqual([ctx, no("DstIsTooBig")]);
      expect([ctx, is_transmutable_tree(large, small, assume)]).toEqual([ctx, YES]);
    }
  });
});

/** `itertools::Itertools::powerset` */
function powerset<X>(xs: readonly X[]): X[][] {
  const out: X[][] = [];
  const combos = (k: number, from: number, acc: X[]): void => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = from; i < xs.length; i++) combos(k, i + 1, [...acc, xs[i]!]);
  };
  for (let k = 0; k <= xs.length; k++) combos(k, 0, []);
  return out;
}

describe("bool", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:229 should_permit_identity_transmutation_tree
  test("should_permit_identity_transmutation_tree", () => {
    const src: Layout = Tree.bool();
    expect(is_transmutable_tree(src, src, Assume.default_())).toBe(YES);
    expect(is_transmutable_tree(src, src, assume_with({ validity: true }))).toBe(YES);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:239 should_permit_identity_transmutation_dfa
  test("should_permit_identity_transmutation_dfa", () => {
    const src: Dfa_ = Dfa.bool();
    expect(show(is_transmutable(Representation_Dfa, src, src, Assume.default_()))).toBe(YES);
    expect(show(is_transmutable(Representation_Dfa, src, src, assume_with({ validity: true })))).toBe(YES);
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:249 transmute_u8
  test("transmute_u8", () => {
    const bool: Layout = Tree.bool();
    const u8: Layout = Tree.u8();
    for (const [src, dst, assume_validity, answer] of [
      [bool, u8, false, YES],
      [bool, u8, true, YES],
      [u8, bool, false, no("DstIsBitIncompatible")],
      [u8, bool, true, YES],
    ] as const) {
      expect(is_transmutable_tree(src, dst, assume_with({ validity: assume_validity }))).toBe(answer);
    }
  });

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:270 should_permit_validity_expansion_and_reject_contraction
  test("should_permit_validity_expansion_and_reject_contraction", () => {
    const b0: Layout = Tree.byte(0);
    const b1: Layout = Tree.byte(1);
    const b2: Layout = Tree.byte(2);

    const alts = [b0, b1, b2];

    const into_layout = (alts: Layout[]): Layout => alts.reduce((acc, t) => Tree.or(acc, t), Tree.uninhabited<Def, never, never>());

    // `FxIndexSet<Tree>`: the trees compare by their `Debug` text here (single bytes).
    const key = (t: Layout): string => debug_Tree(t, PLAIN, qc_test.debug_Def, never_debug, never_debug);
    const into_set = (alts: Layout[]): Set<string> => new Set(alts.map(key));

    for (const src_alts of powerset(alts)) {
      const src_layout = into_layout(src_alts.map(clone_Tree));
      const src_set = into_set(src_alts);

      for (const dst_alts of powerset(alts).filter((alts) => alts.length !== 0)) {
        const dst_layout = into_layout(dst_alts.map(clone_Tree));
        const dst_set = into_set(dst_alts);

        for (const validity of [false, true]) {
          let permitted: boolean;
          if (validity) {
            permitted = src_set.size === 0 || [...src_set].some((x) => dst_set.has(x));
          } else {
            permitted = [...src_set].every((x) => dst_set.has(x));
          }
          const expected = permitted ? YES : no("DstIsBitIncompatible");
          const assume = assume_with({ validity });
          const ctx = `src: ${key(src_layout)}, dst: ${key(dst_layout)}, validity: ${validity}`;
          expect([ctx, is_transmutable_tree(src_layout, dst_layout, assume)]).toEqual([ctx, expected]);
        }
      }
    }
  });
});

describe("uninit", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:326 size
  test("size", () => {
    const mu: Layout = Tree.uninit();
    const u8: Layout = Tree.u8();

    for (const assume of all_assumes()) {
      const want = assume.validity ? YES : no("DstIsBitIncompatible");
      const ctx = `assume: ${debug_Assume(assume, PLAIN)}`;
      expect([ctx, is_transmutable_tree(mu, u8, assume)]).toEqual([ctx, want]);
      expect([ctx, is_transmutable_tree(u8, mu, assume)]).toEqual([ctx, YES]);
    }
  });
});

describe("alt", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:360 should_permit_identity_transmutation
  test("should_permit_identity_transmutation", () => {
    const x: Layout = { $: "Seq", _0: [Tree.byte(0), Tree.byte(0)] };
    const y: Layout = { $: "Seq", _0: [Tree.bool(), Tree.byte(1)] };
    const layout: Layout = { $: "Alt", _0: [x, y] };

    const answer = MaybeTransmutableQuery.new(clone_Tree(layout), clone_Tree(layout), Assume.default_(), UltraMinimal.default_()).answer_tree(
      qc_test.QueryContext_UltraMinimal<never, never>(),
    );
    expect(show(answer)).toBe(YES);
  });
});

describe("union", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:382 union
  test("union", () => {
    const [a, b, c, d] = [0, 1, 2, 3];
    const s: Dfa_ = Dfa.from_edges(a, d, [
      [a, 0, b],
      [b, 0, d],
      [a, 1, c],
      [c, 1, d],
    ]);

    const t: Dfa_ = Dfa.from_edges(a, c, [
      [a, 1, b],
      [b, 0, c],
    ]);

    let ctr = 0;
    const new_state = (): State => {
      const state = State.of(ctr);
      ctr += 1;
      return state;
    };

    const u = clone_Dfa(s).union(clone_Dfa(t), new_state);

    const expected_u: Dfa_ = Dfa.from_edges(b, a, [
      [b, [0, 0], c],
      [b, [1, 1], d],
      [d, [0, 1], a],
      [c, [0, 0], a],
    ]);

    expect(Dfa_eq(u, expected_u)).toBe(true);

    expect(show(is_transmutable(Representation_Dfa, s, u, Assume.default_()))).toBe(YES);
    expect(show(is_transmutable(Representation_Dfa, t, u, Assume.default_()))).toBe(YES);
  });
});

describe("char", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:412 should_permit_valid_transmutation
  test("should_permit_valid_transmutation", () => {
    for (const order of [Endian.Big, Endian.Little]) {
      const char_layout: Layout = Tree.char(order);

      // `char`s can be in the following ranges:
      // - [0, 0xD7FF]
      // - [0xE000, 10FFFF]
      //
      // This loop synthesizes a singleton-validity type for the extremes
      // of each range, and for one past the end of the extremes of each
      // range.
      const no_ = no("DstIsBitIncompatible");
      for (const [src, answer] of [
        [0, YES],
        [0xd7ff, YES],
        [0xd800, no_],
        [0xdfff, no_],
        [0xe000, YES],
        [0x10ffff, YES],
        [0x110000, no_],
        [0xffff0000, no_],
        [0xffffffff, no_],
      ] as const) {
        // `src.to_be_bytes()` (u32)
        const be = [(src >>> 24) & 0xff, (src >>> 16) & 0xff, (src >>> 8) & 0xff, src & 0xff];
        const src_layout: Layout = Tree.from_big_endian(order, be);

        const a = is_transmutable_tree(src_layout, char_layout, Assume.default_());
        const ctx = `endian:${order},\nsrc:${src.toString(16)}`;
        expect([ctx, a]).toEqual([ctx, answer]);
      }
    }
  });
});

describe("nonzero", () => {
  const NONZERO_BYTE_WIDTHS = [1, 2, 4, 8, 16];

  // PORT (perf): width 16 builds a 65535-state DFA (about 260k states through `Dfa::union`); several seconds here, so
  // the test gets a 60s timeout instead of bun's 5s default.
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:453 should_permit_identity_transmutation
  test("should_permit_identity_transmutation", () => {
    for (const width of NONZERO_BYTE_WIDTHS) {
      const layout: Layout = Tree.nonzero(width);
      expect(is_transmutable_tree(layout, layout, Assume.default_())).toBe(YES);
    }
  }, 60_000);

  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:461 should_permit_valid_transmutation
  test("should_permit_valid_transmutation", () => {
    for (const width of NONZERO_BYTE_WIDTHS) {
      const num: Layout = Tree.number(width);
      const nz: Layout = Tree.nonzero(width);

      let a = is_transmutable_tree(num, nz, Assume.default_());
      expect([`width:${width}`, a]).toEqual([`width:${width}`, no("DstIsBitIncompatible")]);

      a = is_transmutable_tree(nz, num, Assume.default_());
      expect([`width:${width}`, a]).toEqual([`width:${width}`, YES]);
    }
  });
});

describe("ref", () => {
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:482 should_permit_identity_transmutation
  test("should_permit_identity_transmutation", () => {
    type Tree = TreeT<Def, number, null>;

    for (const validity of [false, true]) {
      const layout: Tree = {
        $: "Seq",
        _0: [
          Tree.byte(0x00),
          {
            $: "Ref",
            _0: {
              region: 42,
              is_mut: false,
              referent: null,
              referent_size: 0,
              referent_align: 1,
            },
          },
        ],
      };

      const assume = assume_with({ validity });

      const answer = MaybeTransmutableQuery.new(clone_Tree(layout), layout, assume, UltraMinimal.default_<number, null>()).answer_tree(
        qc_test.QueryContext_UltraMinimal<number, null>(),
      );
      expect(show_u(answer)).toBe(
        show_u({
          $: "If",
          _0: {
            $: "IfAll",
            _0: [
              { $: "Transmutable", src: null, dst: null },
              { $: "Outlives", long: 42, short: 42 },
              { $: "Immutable", ty: null },
            ],
          },
        }),
      );
    }
  });
});

describe("benches", () => {
  // #[bench]
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:526 bench_dfa_from_tree
  test("bench_dfa_from_tree", () => {
    const num = Tree.prune(Tree.number<Def, never, never>(8), (_) => false);

    // b.iter(|| { let _ = black_box(Dfa::from_tree(num.clone())); })
    expect(Dfa.from_tree(clone_Tree(num)).$).toBe("Ok");
  });

  // #[bench]
  // rustc: compiler/rustc_transmute/src/maybe_transmutable/tests.rs:536 bench_transmute
  test("bench_transmute", () => {
    const num = Tree.prune(Tree.number<Def, never, never>(8), (_) => false);
    const dfa_r = Dfa.from_tree(num);
    if (dfa_r.$ !== "Ok") throw new Error("called `Result::unwrap()` on an `Err` value");
    const dfa = dfa_r._0;

    const answer = MaybeTransmutableQuery.new(clone_Dfa(dfa), clone_Dfa(dfa), Assume.default_(), UltraMinimal.default_()).answer_dfa();
    expect(show(answer)).toBe(YES);
  });
});
