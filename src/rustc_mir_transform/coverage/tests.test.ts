// Port of compiler/rustc_mir_transform/src/coverage/tests.rs (lane mt-coverage).
//
// PORT: the mock blocks are real `BasicBlockData`s; `Span::with_root_ctxt` needs the span session globals, so each test
// runs inside `create_default_session_globals_then` like upstream's doc comment recommends. `println!` is
// `console.log`; `#[track_caller]` is dropped. `assert_eq!` on the successor lists is `expect(..).toEqual(..)`.
//! This crate hosts a selection of "unit tests" for components of the `InstrumentCoverage` MIR
//! pass.
//!
//! ```shell
//! ./x.py test --keep-stage 1 compiler/rustc_mir --test-args '--show-output coverage'
//! ```
//!
//! The tests construct a few "mock" objects, as needed, to support the `InstrumentCoverage`
//! functions and algorithms. Mocked objects include instances of `mir::Body`; including
//! `Terminator`s of various `kind`s, and `Span` objects. Some functions used by or used on
//! real, runtime versions of these mocked-up objects have constraints (such as cross-thread
//! limitations) and deep dependencies on other elements of the full Rust compiler (which is
//! *not* constructed or mocked for these tests).
//!
//! Of particular note, attempting to simply print elements of the `mir::Body` with default
//! `Debug` formatting can fail because some `Debug` format implementations require the
//! `TyCtxt`, obtained via a static global variable that is *not* set for these tests.
//! Initializing the global type context is prohibitively complex for the scope and scale of these
//! tests (essentially requiring initializing the entire compiler).
//!
//! Also note, some basic features of `Span` also rely on the `Span`s own "session globals", which
//! are unrelated to the `TyCtxt` global. Without initializing the `Span` session globals, some
//! basic, coverage-specific features would be impossible to test, but thankfully initializing these
//! globals is comparatively simpler. The easiest way is to wrap the test in a closure argument
//! to: `rustc_span::create_default_session_globals_then(|| { test_here(); })`.
import { expect, test } from "bun:test";
import "../../rustc_middle/lib.ts";
import {
  BasicBlock,
  BasicBlockData,
  Body,
  clone_Place,
  debug_BasicBlock,
  debug_SwitchTargets,
  Local,
  Place,
  RETURN_PLACE,
  SourceInfo,
  SwitchTargets,
  Terminator,
  TerminatorKind,
  UnwindAction,
} from "../../rustc_middle/mir/mod.ts";
import { Place_from_Local } from "../../rustc_middle/mir/statement.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { BytePos, create_default_session_globals_then, DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import * as graph from "./graph.ts";
import { BasicCoverageBlock, debug_BasicCoverageBlock, debug_BasicCoverageBlockData } from "./graph.ts";

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:36 bcb
function bcb(index: number): BasicCoverageBlock {
  return BasicCoverageBlock.from_u32(index);
}

// All `TEMP_BLOCK` targets should be replaced before calling `to_body() -> mir::Body`.
const TEMP_BLOCK: BasicBlock = BasicBlock.MAX;

// rustc-type: compiler/rustc_mir_transform/src/coverage/tests.rs:43 MockBlocks
class MockBlocks {
  constructor(
    public blocks: BasicBlockData[],
    public dummy_place: Place,
    public next_local: number,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:50 new
  static new(): MockBlocks {
    return new MockBlocks([], new Place(RETURN_PLACE, RawList.empty()), 0);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:58 new_temp
  new_temp(): Local {
    const index = this.next_local;
    this.next_local += 1;
    return Local.new(index);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:64 push
  push(kind: TerminatorKind): BasicBlock {
    const last = this.blocks.length === 0 ? undefined : this.blocks.length - 1;
    const next_lo = last !== undefined ? Span.hi(this.blocks[last]!.terminator_().source_info.span) : BytePos(1);
    const next_hi = BytePos(next_lo + 1);
    this.blocks.push(BasicBlockData.new(new Terminator(SourceInfo.outermost(Span.with_root_ctxt(next_lo, next_hi)), kind), false));
    return BasicBlock.new(this.blocks.length - 1);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:80 link
  link(from_block: BasicBlock, to_block: BasicBlock): void {
    const kind = this.blocks[from_block]!.terminator_mut().kind;
    switch (kind.$) {
      case "Assert":
      case "Drop":
      case "Goto":
        kind.target = to_block;
        break;
      case "Call":
        if (kind.target !== undefined) {
          kind.target = to_block;
          break;
        }
        return bug(`Invalid from_block: ${TerminatorKind.name(kind)}`);
      case "FalseEdge":
      case "FalseUnwind":
        kind.real_target = to_block;
        break;
      case "Yield":
        kind.resume = to_block;
        break;
      default:
        return bug(`Invalid from_block: ${TerminatorKind.name(kind)}`);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:93 add_block_from
  add_block_from(some_from_block: BasicBlock | undefined, to_kind: TerminatorKind): BasicBlock {
    const new_block = this.push(to_kind);
    if (some_from_block !== undefined) {
      this.link(some_from_block, new_block);
    }
    return new_block;
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:105 set_branch
  set_branch(switchint: BasicBlock, branch_index: number, to_block: BasicBlock): void {
    const kind = this.blocks[switchint]!.terminator_mut().kind;
    if (kind.$ !== "SwitchInt") {
      return bug(`Invalid BasicBlock kind or no to_block: ${TerminatorKind.name(kind)}`);
    }
    const targets = kind.targets;
    const branches: [bigint, BasicBlock][] = [...targets.iter()];
    let otherwise: BasicBlock;
    if (branch_index === branches.length) {
      otherwise = to_block;
    } else {
      const old_otherwise = targets.otherwise();
      if (branch_index > branches.length) {
        branches.push([BigInt(branches.length), old_otherwise]);
        while (branches.length < branch_index) {
          branches.push([BigInt(branches.length), TEMP_BLOCK]);
        }
        otherwise = to_block;
      } else {
        branches[branch_index] = [BigInt(branch_index), to_block];
        otherwise = old_otherwise;
      }
    }
    kind.targets = SwitchTargets.new(branches, otherwise);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:130 call
  call(some_from_block: BasicBlock | undefined): BasicBlock {
    return this.add_block_from(some_from_block, {
      $: "Call",
      func: { $: "Copy", _0: clone_Place(this.dummy_place) },
      args: [],
      destination: clone_Place(this.dummy_place),
      target: TEMP_BLOCK,
      unwind: UnwindAction.Continue,
      call_source: "Misc",
      fn_span: DUMMY_SP,
    });
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:145 goto
  goto(some_from_block: BasicBlock | undefined): BasicBlock {
    return this.add_block_from(some_from_block, TerminatorKind.goto(TEMP_BLOCK));
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:149 switchint
  switchint(some_from_block: BasicBlock | undefined): BasicBlock {
    const switchint_kind: TerminatorKind = {
      $: "SwitchInt",
      discr: { $: "Move", _0: Place_from_Local(this.new_temp()) },
      targets: SwitchTargets.static_if(0n, TEMP_BLOCK, TEMP_BLOCK),
    };
    return this.add_block_from(some_from_block, switchint_kind);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:157 return_
  return_(some_from_block: BasicBlock | undefined): BasicBlock {
    return this.add_block_from(some_from_block, TerminatorKind.Return);
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:161 to_body
  to_body(): Body {
    return Body.new_cfg_only(this.blocks);
  }
}

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:166 debug_basic_blocks
function debug_basic_blocks(mir_body: Body): string {
  const items = mir_body.basic_blocks.deref().map((data, i) => {
    const bb = BasicBlock.new(i);
    const term = data.terminator_();
    const kind = term.kind;
    const span = term.source_info.span;
    const sp = `(span:${Span.lo(span)},${Span.hi(span)})`;
    const head = `${sp}${debug_BasicBlock(bb, PLAIN)}:${TerminatorKind.name(kind)}`;
    switch (kind.$) {
      case "Assert":
      case "Drop":
      case "Goto":
        return `${head} -> ${debug_BasicBlock(kind.target, PLAIN)}`;
      case "Call":
        if (kind.target !== undefined) return `${head} -> ${debug_BasicBlock(kind.target, PLAIN)}`;
        return head;
      case "FalseEdge":
      case "FalseUnwind":
        return `${head} -> ${debug_BasicBlock(kind.real_target, PLAIN)}`;
      case "Yield":
        return `${head} -> ${debug_BasicBlock(kind.resume, PLAIN)}`;
      case "InlineAsm":
        return `${head} -> ${debug_vec(kind.targets, PLAIN, debug_BasicBlock)}`;
      case "SwitchInt":
        return `${head} -> ${debug_SwitchTargets(kind.targets, PLAIN)}`;
      default:
        return head;
    }
  });
  return debug_vec(items, PLAIN, (s) => JSON.stringify(s));
}

const PRINT_GRAPHS: boolean = false;

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:202 print_mir_graphviz
function print_mir_graphviz(name: string, mir_body: Body): void {
  if (PRINT_GRAPHS) {
    console.log(
      `digraph ${name} {\n${mir_body.basic_blocks
        .deref()
        .map((data, i) => {
          const bb = debug_BasicBlock(BasicBlock.new(i), PLAIN);
          return `    ${bb} [label="${bb}: ${TerminatorKind.name(data.terminator_().kind)}"];\n${[...mir_body.basic_blocks.successors(BasicBlock.new(i))]
            .map((successor) => `    ${bb} -> ${debug_BasicBlock(successor, PLAIN)};`)
            .join("\n")}`;
        })
        .join("\n")}\n}`,
    );
  }
}

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:228 print_coverage_graphviz
function print_coverage_graphviz(name: string, mir_body: Body, graph_: graph.CoverageGraph): void {
  if (PRINT_GRAPHS) {
    console.log(
      `digraph ${name} {\n${graph_
        .iter_enumerated()
        .map(([bcb_, bcb_data]) => {
          const b = debug_BasicCoverageBlock(bcb_, PLAIN);
          return `    ${b} [label="${b}: ${TerminatorKind.name(mir_body.index(bcb_data.last_bb()).terminator_().kind)}"];\n${[...graph_.successors(bcb_)]
            .map((successor) => `    ${b} -> ${debug_BasicCoverageBlock(successor, PLAIN)};`)
            .join("\n")}`;
        })
        .join("\n")}\n}`,
    );
  }
}

/// Create a mock `Body` with a simple flow.
// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:253 goto_switchint
function goto_switchint(): Body {
  const blocks = MockBlocks.new();
  const start = blocks.call(undefined);
  const goto = blocks.goto(start);
  const switchint = blocks.switchint(goto);
  const then_call = blocks.call(undefined);
  const else_call = blocks.call(undefined);
  blocks.set_branch(switchint, 0, then_call);
  blocks.set_branch(switchint, 1, else_call);
  blocks.return_(then_call);
  blocks.return_(else_call);

  const mir_body = blocks.to_body();
  print_mir_graphviz("mir_goto_switchint", mir_body);
  /* Graphviz character plots created using: `graph-easy --as=boxart`:
                        ┌────────────────┐
                        │   bb0: Call    │
                        └────────────────┘
                          │
                          │
                          ▼
                        ┌────────────────┐
                        │   bb1: Goto    │
                        └────────────────┘
                          │
                          │
                          ▼
    ┌─────────────┐     ┌────────────────┐
    │  bb4: Call  │ ◀── │ bb2: SwitchInt │
    └─────────────┘     └────────────────┘
      │                   │
      │                   │
      ▼                   ▼
    ┌─────────────┐     ┌────────────────┐
    │ bb6: Return │     │   bb3: Call    │
    └─────────────┘     └────────────────┘
                          │
                          │
                          ▼
                        ┌────────────────┐
                        │  bb5: Return   │
                        └────────────────┘
    */
  return mir_body;
}

// #[track_caller]
// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:300 assert_successors
function assert_successors(graph_: graph.CoverageGraph, bcb_: BasicCoverageBlock, expected_successors: readonly BasicCoverageBlock[]): void {
  const successors = graph_.successors_[bcb_]!.slice();
  successors.sort((a, b) => a - b);
  expect(successors).toEqual([...expected_successors]);
}

function graph_debug(graph_: graph.CoverageGraph): string {
  return debug_vec(graph_.iter_enumerated(), PLAIN, ([b, d], f) => `(${debug_BasicCoverageBlock(b, f)}, ${debug_BasicCoverageBlockData(d, f)})`);
}

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:311 test_covgraph_goto_switchint
test("test_covgraph_goto_switchint", () => {
  create_default_session_globals_then(() => {
    const mir_body = goto_switchint();
    if (false as boolean) {
      console.error(`basic_blocks = ${debug_basic_blocks(mir_body)}`);
    }
    const graph_ = graph.CoverageGraph.from_mir(mir_body);
    print_coverage_graphviz("covgraph_goto_switchint ", mir_body, graph_);
    /*
    ┌──────────────┐     ┌─────────────────┐
    │ bcb2: Return │ ◀── │ bcb0: SwitchInt │
    └──────────────┘     └─────────────────┘
                           │
                           │
                           ▼
                         ┌─────────────────┐
                         │  bcb1: Return   │
                         └─────────────────┘
    */
    expect(graph_.num_nodes(), `graph: ${graph_debug(graph_)}`).toBe(3);

    assert_successors(graph_, bcb(0), [bcb(1), bcb(2)]);
    assert_successors(graph_, bcb(1), []);
    assert_successors(graph_, bcb(2), []);
  });
});

/// Create a mock `Body` with a loop.
// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:337 switchint_then_loop_else_return
function switchint_then_loop_else_return(): Body {
  const blocks = MockBlocks.new();
  const start = blocks.call(undefined);
  const switchint = blocks.switchint(start);
  const then_call = blocks.call(undefined);
  blocks.set_branch(switchint, 0, then_call);
  const backedge_goto = blocks.goto(then_call);
  blocks.link(backedge_goto, switchint);
  const else_return = blocks.return_(undefined);
  blocks.set_branch(switchint, 1, else_return);

  const mir_body = blocks.to_body();
  print_mir_graphviz("mir_switchint_then_loop_else_return", mir_body);
  /*
                        ┌────────────────┐
                        │   bb0: Call    │
                        └────────────────┘
                          │
                          │
                          ▼
    ┌─────────────┐     ┌────────────────┐
    │ bb4: Return │ ◀── │ bb1: SwitchInt │ ◀┐
    └─────────────┘     └────────────────┘  │
                          │                 │
                          │                 │
                          ▼                 │
                        ┌────────────────┐  │
                        │   bb2: Call    │  │
                        └────────────────┘  │
                          │                 │
                          │                 │
                          ▼                 │
                        ┌────────────────┐  │
                        │   bb3: Goto    │ ─┘
                        └────────────────┘
    */
  return mir_body;
}

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:377 test_covgraph_switchint_then_loop_else_return
test("test_covgraph_switchint_then_loop_else_return", () => {
  create_default_session_globals_then(() => {
    const mir_body = switchint_then_loop_else_return();
    const graph_ = graph.CoverageGraph.from_mir(mir_body);
    print_coverage_graphviz("covgraph_switchint_then_loop_else_return", mir_body, graph_);
    /*
                       ┌─────────────────┐
                       │   bcb0: Call    │
                       └─────────────────┘
                         │
                         │
                         ▼
    ┌────────────┐     ┌─────────────────┐
    │ bcb3: Goto │ ◀── │ bcb1: SwitchInt │ ◀┐
    └────────────┘     └─────────────────┘  │
      │                  │                  │
      │                  │                  │
      │                  ▼                  │
      │                ┌─────────────────┐  │
      │                │  bcb2: Return   │  │
      │                └─────────────────┘  │
      │                                     │
      └─────────────────────────────────────┘
    */
    expect(graph_.num_nodes(), `graph: ${graph_debug(graph_)}`).toBe(4);

    assert_successors(graph_, bcb(0), [bcb(1)]);
    assert_successors(graph_, bcb(1), [bcb(2), bcb(3)]);
    assert_successors(graph_, bcb(2), []);
    assert_successors(graph_, bcb(3), [bcb(1)]);
  });
});

/// Create a mock `Body` with nested loops.
// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:409 switchint_loop_then_inner_loop_else_break
function switchint_loop_then_inner_loop_else_break(): Body {
  const blocks = MockBlocks.new();
  const start = blocks.call(undefined);
  const switchint = blocks.switchint(start);
  const then_call = blocks.call(undefined);
  blocks.set_branch(switchint, 0, then_call);
  const else_return = blocks.return_(undefined);
  blocks.set_branch(switchint, 1, else_return);

  const inner_start = blocks.call(then_call);
  const inner_switchint = blocks.switchint(inner_start);
  const inner_then_call = blocks.call(undefined);
  blocks.set_branch(inner_switchint, 0, inner_then_call);
  const inner_backedge_goto = blocks.goto(inner_then_call);
  blocks.link(inner_backedge_goto, inner_switchint);
  const inner_else_break_goto = blocks.goto(undefined);
  blocks.set_branch(inner_switchint, 1, inner_else_break_goto);

  const backedge_goto = blocks.goto(inner_else_break_goto);
  blocks.link(backedge_goto, switchint);

  const mir_body = blocks.to_body();
  print_mir_graphviz("mir_switchint_loop_then_inner_loop_else_break", mir_body);
  /*
                        ┌────────────────┐
                        │   bb0: Call    │
                        └────────────────┘
                          │
                          │
                          ▼
    ┌─────────────┐     ┌────────────────┐
    │ bb3: Return │ ◀── │ bb1: SwitchInt │ ◀─────┐
    └─────────────┘     └────────────────┘       │
                          │                      │
                          │                      │
                          ▼                      │
                        ┌────────────────┐       │
                        │   bb2: Call    │       │
                        └────────────────┘       │
                          │                      │
                          │                      │
                          ▼                      │
                        ┌────────────────┐       │
                        │   bb4: Call    │       │
                        └────────────────┘       │
                          │                      │
                          │                      │
                          ▼                      │
    ┌─────────────┐     ┌────────────────┐       │
    │  bb8: Goto  │ ◀── │ bb5: SwitchInt │ ◀┐    │
    └─────────────┘     └────────────────┘  │    │
      │                   │                 │    │
      │                   │                 │    │
      ▼                   ▼                 │    │
    ┌─────────────┐     ┌────────────────┐  │    │
    │  bb9: Goto  │ ─┐  │   bb6: Call    │  │    │
    └─────────────┘  │  └────────────────┘  │    │
                     │    │                 │    │
                     │    │                 │    │
                     │    ▼                 │    │
                     │  ┌────────────────┐  │    │
                     │  │   bb7: Goto    │ ─┘    │
                     │  └────────────────┘       │
                     │                           │
                     └───────────────────────────┘
    */
  return mir_body;
}

// rustc: compiler/rustc_mir_transform/src/coverage/tests.rs:479 test_covgraph_switchint_loop_then_inner_loop_else_break
test("test_covgraph_switchint_loop_then_inner_loop_else_break", () => {
  create_default_session_globals_then(() => {
    const mir_body = switchint_loop_then_inner_loop_else_break();
    const graph_ = graph.CoverageGraph.from_mir(mir_body);
    print_coverage_graphviz("covgraph_switchint_loop_then_inner_loop_else_break", mir_body, graph_);
    /*
                         ┌─────────────────┐
                         │   bcb0: Call    │
                         └─────────────────┘
                           │
                           │
                           ▼
    ┌──────────────┐     ┌─────────────────┐
    │ bcb2: Return │ ◀── │ bcb1: SwitchInt │ ◀┐
    └──────────────┘     └─────────────────┘  │
                           │                  │
                           │                  │
                           ▼                  │
                         ┌─────────────────┐  │
                         │   bcb3: Call    │  │
                         └─────────────────┘  │
                           │                  │
                           │                  │
                           ▼                  │
    ┌──────────────┐     ┌─────────────────┐  │
    │  bcb6: Goto  │ ◀── │ bcb4: SwitchInt │ ◀┼────┐
    └──────────────┘     └─────────────────┘  │    │
      │                    │                  │    │
      │                    │                  │    │
      │                    ▼                  │    │
      │                  ┌─────────────────┐  │    │
      │                  │   bcb5: Goto    │ ─┘    │
      │                  └─────────────────┘       │
      │                                            │
      └────────────────────────────────────────────┘
    */
    expect(graph_.num_nodes(), `graph: ${graph_debug(graph_)}`).toBe(7);

    assert_successors(graph_, bcb(0), [bcb(1)]);
    assert_successors(graph_, bcb(1), [bcb(2), bcb(3)]);
    assert_successors(graph_, bcb(2), []);
    assert_successors(graph_, bcb(3), [bcb(4)]);
    assert_successors(graph_, bcb(4), [bcb(5), bcb(6)]);
    assert_successors(graph_, bcb(5), [bcb(1)]);
    assert_successors(graph_, bcb(6), [bcb(4)]);
  });
});
