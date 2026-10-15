// Unit tests for rustc_middle hir/place.ts (lane typeck-euv; not an upstream test file).
// `Ty` values are stand-in objects: the methods under test only compare and return them.
import { expect, test } from "bun:test";
import { CRATE_OWNER_ID, HirId, ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import type { FieldIdx, VariantIdx } from "../ty/decls.ts";
import type { Ty } from "../ty/mod.ts";
import {
  clone_Place,
  clone_PlaceWithHirId,
  debug_PlaceBase,
  debug_ProjectionKind,
  Place,
  Place_eq,
  PlaceBase,
  PlaceBase_eq,
  PlaceWithHirId,
  type Projection,
  ProjectionKind,
  ProjectionKind_eq,
} from "./place.ts";

const t = (name: string): Ty => ({ name }) as unknown as Ty;
const T0 = t("&*const u32");
const T1 = t("*const u32");
const T2 = t("u32");
const T3 = t("(u32,)");

function hir_id(local: number): HirId {
  return new HirId(CRATE_OWNER_ID, ItemLocalId.from_u32(local));
}

test("Place::ty / ty_before_projection / deref_tys follow place.rs", () => {
  // `**x` with `x: &*const u32`
  const p = new Place(T0, PlaceBase.Rvalue, [
    { ty: T1, kind: ProjectionKind.Deref },
    { ty: T2, kind: ProjectionKind.Deref },
  ]);
  expect(p.ty()).toBe(T2);
  expect(p.ty_before_projection(0)).toBe(T0);
  expect(p.ty_before_projection(1)).toBe(T1);
  // reverse order of application: `*const u32` then `&*const u32`
  expect([...p.deref_tys()]).toEqual([T1, T0]);
  expect(() => p.ty_before_projection(2)).toThrow("projection_index < self.projections.len()");

  const empty = new Place(T3, PlaceBase.StaticItem, []);
  expect(empty.ty()).toBe(T3);
  expect([...empty.deref_tys()]).toEqual([]);

  // a field projection is not a deref
  const f = new Place(T3, PlaceBase.Rvalue, [{ ty: T2, kind: { $: "Field", _0: 0 as FieldIdx, _1: 0 as VariantIdx } }]);
  expect([...f.deref_tys()]).toEqual([]);
});

test("PlaceWithHirId::new, Clone and PartialEq", () => {
  const projections: Projection[] = [{ ty: T2, kind: ProjectionKind.Index }];
  const p = PlaceWithHirId.new(hir_id(3), T0, { $: "Local", _0: hir_id(1) }, projections);
  expect(p.place.base_ty).toBe(T0);
  expect(p.place.projections).toBe(projections);
  const c = clone_PlaceWithHirId(p);
  expect(c.place.projections).not.toBe(p.place.projections);
  expect(Place_eq(c.place, p.place)).toBe(true);
  c.place.projections.push({ ty: T1, kind: ProjectionKind.Subslice });
  expect(p.place.projections.length).toBe(1);
  expect(Place_eq(c.place, p.place)).toBe(false);
  expect(Place_eq(clone_Place(p.place), p.place)).toBe(true);
  expect(PlaceBase_eq({ $: "Local", _0: hir_id(1) }, { $: "Local", _0: hir_id(1) })).toBe(true);
  expect(PlaceBase_eq({ $: "Local", _0: hir_id(1) }, { $: "Local", _0: hir_id(2) })).toBe(false);
  expect(PlaceBase_eq(PlaceBase.Rvalue, PlaceBase.StaticItem)).toBe(false);
  expect(ProjectionKind_eq({ $: "Field", _0: 1 as FieldIdx, _1: 0 as VariantIdx }, { $: "Field", _0: 1 as FieldIdx, _1: 0 as VariantIdx })).toBe(true);
  expect(ProjectionKind_eq({ $: "Field", _0: 1 as FieldIdx, _1: 0 as VariantIdx }, { $: "Field", _0: 1 as FieldIdx, _1: 1 as VariantIdx })).toBe(false);
});

test("derived Debug of PlaceBase / ProjectionKind", () => {
  expect(debug_PlaceBase(PlaceBase.Rvalue, PLAIN)).toBe("Rvalue");
  expect(debug_PlaceBase(PlaceBase.StaticItem, PLAIN)).toBe("StaticItem");
  expect(debug_ProjectionKind(ProjectionKind.OpaqueCast, PLAIN)).toBe("OpaqueCast");
  expect(debug_ProjectionKind({ $: "Field", _0: 2 as FieldIdx, _1: 1 as VariantIdx }, PLAIN)).toBe("Field(2, 1)");
  expect(debug_ProjectionKind({ $: "Field", _0: 2 as FieldIdx, _1: 1 as VariantIdx }, PRETTY)).toBe("Field(\n    2,\n    1,\n)");
});
