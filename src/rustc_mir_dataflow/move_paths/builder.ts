// Port of compiler/rustc_mir_dataflow/src/move_paths/builder.rs (declared by lane dataflow-contract, filled by lane
// dataflow-move-paths, plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it):
// - `MoveDataBuilder<'a, 'tcx, F>` is a class with its fields in declaration order; `F: Fn(Ty) -> bool` is the closure
//   `filter`. Its three `impl` blocks are one class body (PORTING §8), markers keep the upstream lines.
// - `G: FnMut(&mut Self, MovePathIndex)` / `impl FnOnce(TyCtxt) -> Place` are closures (`on_move(this, mpi)`).
// - `IndexVec::push` returns the new index (`arr.push(x) - 1`); `mem::replace(&mut a, b)` reads then writes;
//   `projections.entry((base, elem)).or_insert_with(..)` keys `MovePathLookup.projections` by `MoveSubPath_key`.
// - `pub(super) fn gather_moves` is called by `MoveData.gather_moves` (mod.ts).
// - PORT: `debug!` calls (compiled out of release rustc) are comments; `finalize`'s `debug!` block is one.
// - PORT: the `ProjectionIter` borrowed from `rev_lookup.un_derefer` is the JS iterator; `iter.all(..)` drains it
//   up to the first `false` as upstream; `drop(iter)` is a comment.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, unreachable, unwrap } from "../../std/panic.ts";
import {
  BasicBlock,
  type Body,
  debug_Local,
  Local,
  Location,
  type Operand,
  type Place,
  Place_from_Local,
  type PlaceElem,
  type PlaceRef,
  PlaceTy,
  ProjectionElem,
  type Rvalue,
  type Statement,
  type Terminator,
} from "../../rustc_middle/mir/mod.ts";
import { UnDerefer } from "../un_derefer.ts";
import {
  type Init,
  type InitIndex,
  type InitKind,
  LocationMap,
  MoveData,
  type MoveOut,
  type MoveOutIndex,
  MovePath,
  MovePathIndex,
  MovePathLookup,
  MoveSubPath,
  MoveSubPath_key,
} from "./mod.ts";

// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:16 MoveDataBuilder
class MoveDataBuilder {
  constructor(
    public body: Body,
    public loc: Location,
    public tcx: TyCtxt,
    public data: MoveData,
    public filter: (ty: Ty) => boolean,
  ) {}

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:25 new
  static new(body: Body, tcx: TyCtxt, filter: (ty: Ty) => boolean): MoveDataBuilder {
    const move_paths: MovePath[] = [];
    const move_out_path_map: MoveOutIndex[][] = [];
    const init_path_map: InitIndex[][] = [];

    const locals = body.local_decls.map((l, i): MovePathIndex | undefined => {
      if (l.is_deref_temp()) {
        return undefined;
      }
      if (filter(l.ty)) {
        return new_move_path(move_paths, move_out_path_map, init_path_map, undefined, Place_from_Local(Local.new(i)));
      } else {
        return undefined;
      }
    });

    return new MoveDataBuilder(
      body,
      Location.START,
      tcx,
      new MoveData(
        move_paths,
        [],
        LocationMap.new(body, (): MoveOutIndex[] => []),
        move_out_path_map,
        new MovePathLookup(locals, new Map(), new UnDerefer(new Map())),
        [],
        LocationMap.new(body, (): InitIndex[] => []),
        init_path_map,
      ),
      filter,
    );
  }

  /// This creates a MovePath for a given place, calling `on_move`
  /// if it can be moved from. If theres a union in the path, its
  /// move place will be given to `on_move`. If there's a subslice
  /// projection, `on_move` will be called for each element.
  ///
  /// NOTE: places behind references *do not* get a move path, which is
  /// problematic for borrowck.
  ///
  /// Maybe we should have separate "borrowck" and "moveck" modes.
  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:108 move_path_for
  move_path_for(place: Place, on_move: (this_: MoveDataBuilder, mpi: MovePathIndex) => void): void {
    const data = this.data;

    // debug!("lookup({:?})", place);
    let base = data.rev_lookup.find_local(place.local);
    if (base === undefined) {
      return;
    }

    // The move path index of the first union that we find. Once this is
    // some we stop creating child move paths, since moves from unions
    // move the whole thing.
    // We continue looking for other move errors though so that moving
    // from `*(u.f: &_)` isn't allowed.
    let union_path: MovePathIndex | undefined = undefined;

    const iter = data.rev_lookup.un_derefer.iter_projections(place.as_ref());
    for (let it = iter.next(); !it.done; it = iter.next()) {
      const [place_ref, elem] = it.value;
      const body = this.body;
      const tcx = this.tcx;
      const place_ty = place_ref.ty(body, tcx).ty;
      if (TypeVisitableExt.references_error(place_ty, fold_Ty)) {
        return;
      }

      const res = MoveSubPath.of(ProjectionElem.kind(elem));

      let move_elem: MoveSubPath;
      switch (res.$) {
        case "One": {
          move_elem = res._0;
          switch (move_elem.$) {
            case "Deref": {
              const k = place_ty.kind();
              switch (k.$) {
                case "Ref":
                case "RawPtr":
                  return;
                case "Adt": {
                  const adt = k._0;
                  if (!adt.is_box()) {
                    bug("Adt should be a box type when Place is deref");
                  }
                  break;
                }
                case "Bool":
                case "Char":
                case "Int":
                case "Uint":
                case "Float":
                case "Foreign":
                case "Str":
                case "Array":
                case "Pat":
                case "Slice":
                case "FnDef":
                case "FnPtr":
                case "Dynamic":
                case "Closure":
                case "CoroutineClosure":
                case "Coroutine":
                case "CoroutineWitness":
                case "Never":
                case "Tuple":
                case "UnsafeBinder":
                case "Alias":
                case "Param":
                case "Bound":
                case "Infer":
                case "Error":
                case "Placeholder":
                  bug(`When Place is Deref it's type shouldn't be ${format_debug(place_ty, debug_Ty, PRETTY)}`);
              }
              break;
            }
            case "Field": {
              const k = place_ty.kind();
              switch (k.$) {
                case "Adt": {
                  const adt = k._0;
                  if (adt.has_dtor(tcx)) {
                    return;
                  }
                  if (adt.is_union()) {
                    if (union_path === undefined) union_path = base;
                  }
                  break;
                }
                case "Closure":
                case "CoroutineClosure":
                case "Coroutine":
                case "Tuple":
                  break;
                case "Bool":
                case "Char":
                case "Int":
                case "Uint":
                case "Float":
                case "Foreign":
                case "Str":
                case "Array":
                case "Pat":
                case "Slice":
                case "RawPtr":
                case "Ref":
                case "FnDef":
                case "FnPtr":
                case "Dynamic":
                case "CoroutineWitness":
                case "Never":
                case "UnsafeBinder":
                case "Alias":
                case "Param":
                case "Bound":
                case "Infer":
                case "Error":
                case "Placeholder":
                  bug(`When Place contains ProjectionElem::Field its type shouldn't be ${format_debug(place_ty, debug_Ty, PRETTY)}`);
              }
              break;
            }
            case "ConstantIndex": {
              const k = place_ty.kind();
              switch (k.$) {
                case "Slice":
                  return;
                case "Array":
                  break;
                default:
                  bug(`Unexpected type ${place_ty.is_array() ? "true" : "false"}`);
              }
              break;
            }
            case "Downcast":
              break;
            case "UnwrapUnsafeBinder":
              break;
          }
          break;
        }

        // Split `Subslice` patterns into the corresponding list of
        // `ConstIndex` patterns. This is done to ensure that all move paths
        // are disjoint, which is expected by drop elaboration.
        case "Subslice": {
          const { from, to } = res;
          let all = true;
          for (let it2 = iter.next(); !it2.done; it2 = iter.next()) {
            const [, elem2] = it2.value;
            if (!(MoveSubPath.of(ProjectionElem.kind(elem2)).$ === "Skip")) {
              all = false;
              break;
            }
          }
          assert(all, "assertion failed: iter.all(|(_, elem)| MoveSubPath::of(elem.kind()) == MoveSubPathResult::Skip)");
          // drop(iter); // drop for borrowck

          let elem_ty: Ty;
          let len: number;
          const k = place_ty.kind();
          if (k.$ === "Array") {
            const [ty, size] = [k._0, k._1];
            elem_ty = ty;
            len = unwrap(size.try_to_target_usize(this.tcx), "expected subslice projection on fixed-size array");
          } else {
            bug("from_end: false slice pattern of non-array type");
          }

          if (!this.filter(elem_ty)) {
            return;
          }

          for (let offset = from; offset < to; offset++) {
            const place_elem: PlaceElem = { $: "ConstantIndex", offset, min_length: len, from_end: false };
            const subpath_elem: MoveSubPath = { $: "ConstantIndex", _0: offset };

            const mpi = this.add_move_path(base, subpath_elem, (tcx) => place_ref.project_deeper([place_elem], tcx));
            on_move(this, mpi);
          }

          return;
        }

        case "Skip":
          continue;
        case "Stop":
          return;
      }

      const elem_ty = PlaceTy.from_ty(place_ty).projection_ty(tcx, elem, debug_Local).ty;
      if (!this.filter(elem_ty)) {
        return;
      }
      if (union_path === undefined) {
        // inlined from add_move_path because of a borrowck conflict with the iterator
        const key = MoveSubPath_key(base, move_elem);
        let entry = data.rev_lookup.projections.get(key);
        if (entry === undefined) {
          entry = new_move_path(data.move_paths, data.move_out_path_map, data.init_path_map, base, place_ref.project_deeper([elem], tcx));
          data.rev_lookup.projections.set(key, entry);
        }
        base = entry;
      }
    }

    // drop(iter); // drop for borrowck

    if (union_path !== undefined) {
      const base = union_path;
      // Move out of union - always move the entire union.
      on_move(this, base);
    } else {
      on_move(this, base);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:302 add_move_path
  add_move_path(base: MovePathIndex, elem: MoveSubPath, mk_place: (tcx: TyCtxt) => Place): MovePathIndex {
    const { rev_lookup, move_paths, move_out_path_map, init_path_map } = this.data;
    const tcx = this.tcx;
    const key = MoveSubPath_key(base, elem);
    let entry = rev_lookup.projections.get(key);
    if (entry === undefined) {
      entry = new_move_path(move_paths, move_out_path_map, init_path_map, base, mk_place(tcx));
      rev_lookup.projections.set(key, entry);
    }
    return entry;
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:318 create_move_path
  create_move_path(place: Place): void {
    // This is an non-moving access (such as an overwrite or
    // drop), so this not being a valid move path is OK.
    this.move_path_for(place, (_, _mpi) => {});
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:324 finalize
  finalize(): MoveData {
    // debug!("{}", {
    //     debug!("moves for {:?}:", self.body.span);
    //     for (j, mo) in self.data.move_outs.iter_enumerated() {
    //         debug!("    {:?} = {:?}", j, mo);
    //     }
    //     debug!("move paths for {:?}:", self.body.span);
    //     for (j, path) in self.data.move_paths.iter_enumerated() {
    //         debug!("    {:?} = {:?}", j, path);
    //     }
    //     "done dumping moves"
    // });

    return this.data;
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:364 gather_args
  gather_args(): void {
    for (const arg of this.body.args_iter()) {
      const path = this.data.rev_lookup.find_local(arg);
      if (path !== undefined) {
        const init = (this.data.inits.push({ path, kind: "Deep", location: { $: "Argument", _0: arg } } satisfies Init) - 1) as InitIndex;

        // debug!("gather_args: adding init {:?} of {:?} for argument {:?}", init, path, arg);

        this.data.init_path_map[path]!.push(init);
      }
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:380 gather_statement
  gather_statement(stmt: Statement): void {
    // debug!("gather_statement({:?}, {:?})", self.loc, stmt);
    const kind = stmt.kind;
    switch (kind.$) {
      case "Assign": {
        const [place, rval] = kind._0;
        if (rval.$ === "CopyForDeref") {
          const reffed = rval._0;
          const local = unwrap(place.as_local());
          assert(this.body.local_decls[local]!.is_deref_temp(), "assertion failed: self.body.local_decls[local].is_deref_temp()");

          const rev_lookup = this.data.rev_lookup;

          rev_lookup.un_derefer.insert(local, reffed.as_ref());
          const base_local = unwrap(rev_lookup.un_derefer.deref_chain(local)[0]).local;
          rev_lookup.locals[local] = rev_lookup.locals[base_local];
        } else {
          this.create_move_path(place);
          this.gather_init(place.as_ref(), "Deep");
          this.gather_rvalue(rval);
        }
        break;
      }
      case "FakeRead": {
        const place = kind._0[1];
        this.create_move_path(place);
        break;
      }
      case "StorageLive":
        break;
      case "StorageDead": {
        const local = kind._0;
        // DerefTemp locals (results of CopyForDeref) don't actually move anything.
        if (!this.body.local_decls[local]!.is_deref_temp()) {
          this.gather_move(Place_from_Local(local));
        }
        break;
      }
      case "SetDiscriminant":
        span_bug(stmt.source_info.span, "SetDiscriminant/Deinit should not exist during borrowck");
      case "AscribeUserType":
      case "PlaceMention":
      case "Coverage":
      case "Intrinsic":
      case "ConstEvalCounter":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:424 gather_rvalue
  gather_rvalue(rvalue: Rvalue): void {
    switch (rvalue.$) {
      case "ThreadLocalRef":
        break; // not-a-move
      case "Use":
      case "Repeat":
      case "WrapUnsafeBinder":
        this.gather_operand(rvalue._0);
        break;
      case "Cast":
      case "UnaryOp":
        this.gather_operand(rvalue._1);
        break;
      case "BinaryOp": {
        const [lhs, rhs] = rvalue._1;
        this.gather_operand(lhs);
        this.gather_operand(rhs);
        break;
      }
      case "Aggregate": {
        const operands = rvalue._1;
        for (const operand of operands) {
          this.gather_operand(operand);
        }
        break;
      }
      case "CopyForDeref":
        unreachable();
      case "Ref":
      case "Reborrow":
      case "RawPtr":
      case "Discriminant":
        break;
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:449 gather_terminator
  gather_terminator(term: Terminator): void {
    // debug!("gather_terminator({:?}, {:?})", self.loc, term);
    const kind = term.kind;
    switch (kind.$) {
      case "Goto":
      case "FalseEdge":
      case "FalseUnwind":
        break;
      // In some sense returning moves the return place into the current
      // call's destination, however, since there are no statements after
      // this that could possibly access the return place, this doesn't
      // need recording.
      case "Return":
      case "UnwindResume":
      case "UnwindTerminate":
      case "CoroutineDrop":
      case "Unreachable":
      case "Drop":
        break;

      case "Assert": {
        this.gather_operand(kind.cond);
        break;
      }

      case "SwitchInt": {
        this.gather_operand(kind.discr);
        break;
      }

      case "Yield": {
        const place = kind.resume_arg;
        this.gather_operand(kind.value);
        this.create_move_path(place);
        this.gather_init(place.as_ref(), "Deep");
        break;
      }
      case "Call": {
        const { func, args, destination, target } = kind;
        this.gather_operand(func);
        for (const arg of args) {
          this.gather_operand(arg.node);
        }
        if (target !== undefined) {
          this.create_move_path(destination);
          this.gather_init(destination.as_ref(), "NonPanicPathOnly");
        }
        break;
      }
      case "TailCall": {
        const { func, args } = kind;
        this.gather_operand(func);
        for (const arg of args) {
          this.gather_operand(arg.node);
        }
        break;
      }
      case "InlineAsm": {
        const operands = kind.operands;
        for (const op of operands) {
          switch (op.$) {
            case "In": {
              this.gather_operand(op.value);
              break;
            }
            case "Out": {
              const place = op.place;
              if (place !== undefined) {
                this.create_move_path(place);
                this.gather_init(place.as_ref(), "Deep");
              }
              break;
            }
            case "InOut": {
              const { in_value, out_place } = op;
              this.gather_operand(in_value);
              if (out_place !== undefined) {
                this.create_move_path(out_place);
                this.gather_init(out_place.as_ref(), "Deep");
              }
              break;
            }
            case "Const":
            case "SymFn":
            case "SymStatic":
            case "Label":
              break;
          }
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:540 gather_operand
  gather_operand(operand: Operand): void {
    switch (operand.$) {
      // not-a-move
      case "Constant":
      case "Copy":
      case "RuntimeChecks":
        break;
      // a move
      case "Move": {
        const place = operand._0;
        this.gather_move(place);
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:551 gather_move
  gather_move(place: Place): void {
    // debug!("gather_move({:?}, {:?})", self.loc, place);
    this.move_path_for(place, (this_, mpi) => this_.record_move(place, mpi));
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:556 record_move
  record_move(_place: Place, path: MovePathIndex): void {
    const move_out = (this.data.move_outs.push({ path, source: this.loc } satisfies MoveOut) - 1) as MoveOutIndex;
    // debug!(
    //     "gather_move({:?}, {:?}): adding move {:?} of {:?}",
    //     self.loc, place, move_out, path
    // );
    this.data.move_out_path_map[path]!.push(move_out);
    this.data.move_out_loc_map.index_mut(this.loc).value.push(move_out);
  }

  // rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:566 gather_init
  gather_init(place: PlaceRef, kind: InitKind): void {
    // debug!("gather_init({:?}, {:?})", self.loc, place);

    // Check if we are assigning into a field of a union, if so, lookup the place
    // of the union so it is marked as initialized again.
    const last = place.last_projection();
    if (last !== undefined && last[1].$ === "Field") {
      const place_base = last[0];
      if (place_base.ty(this.body, this.tcx).ty.is_union()) {
        place = place_base;
      }
    }

    const r = this.data.rev_lookup.find(place);
    if (r.$ === "Exact") {
      const path = r._0;
      const init = (this.data.inits.push({ location: { $: "Statement", _0: this.loc }, path, kind } satisfies Init) - 1) as InitIndex;

      // debug!(
      //     "gather_init({:?}, {:?}): adding init {:?} of {:?}",
      //     self.loc, place, init, path
      // );

      this.data.init_path_map[path]!.push(init);
      this.data.init_loc_map.index_mut(this.loc).value.push(init);
    }
  }
}

// rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:74 new_move_path
function new_move_path(
  move_paths: MovePath[],
  move_out_path_map: MoveOutIndex[][],
  init_path_map: InitIndex[][],
  parent: MovePathIndex | undefined,
  place: Place,
): MovePathIndex {
  const move_path = MovePathIndex.new(move_paths.push(new MovePath(undefined, undefined, parent, place)) - 1);

  if (parent !== undefined) {
    const next_sibling = move_paths[parent]!.first_child;
    move_paths[parent]!.first_child = move_path;
    move_paths[move_path]!.next_sibling = next_sibling;
  }

  const path_map_ent = MovePathIndex.new(move_out_path_map.push([]) - 1);
  assert_eq(path_map_ent, move_path, (v) => MovePathIndex.debug(v, PLAIN));

  const init_path_map_ent = MovePathIndex.new(init_path_map.push([]) - 1);
  assert_eq(init_path_map_ent, move_path, (v) => MovePathIndex.debug(v, PLAIN));

  return move_path;
}

// rustc: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:341 gather_moves
export function gather_moves(body: Body, tcx: TyCtxt, filter: (ty: Ty) => boolean): MoveData {
  const builder = MoveDataBuilder.new(body, tcx, filter);

  builder.gather_args();

  const blocks = body.basic_blocks.deref();
  for (let bb_ = 0; bb_ < blocks.length; bb_++) {
    const bb = BasicBlock.new(bb_);
    const block = blocks[bb_]!;
    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i]!;
      builder.loc = new Location(bb, i);
      builder.gather_statement(stmt);
    }

    builder.loc = new Location(bb, block.statements.length);
    builder.gather_terminator(block.terminator_());
  }

  return builder.finalize();
}
