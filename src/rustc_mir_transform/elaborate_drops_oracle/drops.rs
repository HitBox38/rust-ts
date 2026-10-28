// Fixture of elaborate_drops.oracle.test.ts (lane mt-drops): bodies whose drops `ElaborateDrops` turns into static,
// dead, conditional (drop flags) and open drops (struct / tuple / enum / closure / box / array ladders), drops in cleanup
// blocks, replace-drops behind references, unions, `ManuallyDrop`, generics, slices, `dyn`, a coroutine and std types.
#![allow(unused)]
#![feature(coroutines, coroutine_trait, stmt_expr_attributes)]
use std::mem::ManuallyDrop;
pub struct Nest { pub p: Pair, pub q: Option<D>, pub s: String }
pub fn enum_partial(e: E, k: bool) { if let E::B(x, _) = e { if k { consume(x) } } }
pub fn enum_partial2(e: E) { match e { E::F { x, .. } => consume(x), _ => {} } }
pub fn nested(n: Nest, k: bool) { if k { consume(n.p.a); } else { consume(n.s); } }
pub fn nested_replace(mut n: Nest) { consume(n.p.b); n.p.b = D(3); }
pub fn field_assign(p: &mut Pair) { p.a = D(9); }
pub fn deref_assign(r: &mut D) { *r = D(1); }
pub union U { pub a: ManuallyDrop<D>, pub b: u32 }
pub fn union_drop(u: U) {}
pub fn md(m: ManuallyDrop<D>) {}
pub fn generic<T>(t: T, k: bool) { if k { consume(t) } }
pub fn generic_pair<T, V>(t: (T, V), k: bool) { if k { consume(t.0) } }
pub fn opt(o: Option<String>, k: bool) { if let Some(s) = o { if k { consume(s) } } }
pub fn slice_ref(s: &[D]) {}
pub fn boxed_box(b: Box<Box<D>>, k: bool) { if k { consume(*b) } }
pub fn arr_part(a: [D; 4], k: bool) { let [x, y, ..] = a; if k { consume(y) } }
pub fn arr_big(a: [D; 40]) { let [x, ..] = a; }
pub fn vecs(v: Vec<Vec<D>>, k: bool) { for x in v { if k { consume(x) } } }
pub fn many(a: D, b: String, c: Vec<u8>, k: bool) { if k { consume(a); consume(c) } else { consume(b) } }
pub fn closure_partial(p: Pair, k: bool) { let c = move || consume(p.a); if k { c() } }
pub fn coro(d: D) { let mut c = #[coroutine] move || { yield 1u8; consume(d); }; }
pub fn tuple_nest(t: ((D, D), D), k: bool) { if k { consume((t.0).1) } }
pub fn dyn_drop(b: Box<dyn Fn()>, k: bool) { if k { consume(b) } }
pub fn string_ops(mut s: String) -> usize { let t = s.clone(); s.push('a'); t.len() + s.len() }
pub fn early_ret(a: D, b: D, k: bool) -> u8 { if k { return 1 } consume(a); 2 }
pub fn ref_mut_opt(o: &mut Option<D>) { *o = None; }
pub fn swap_like(mut a: D, mut b: D) { let t = a; a = b; b = t; }
pub fn rc(r: std::rc::Rc<D>, k: bool) { if k { consume(r.clone()); } }
pub fn c1_cond_move(d: D, b: bool) { if b { consume(d) } }
pub fn c1_static_drop(d: D) {}
pub fn c1_moved(d: D) { consume(d) }
pub fn c1_field_move(p: Pair, b: bool) { if b { consume(p.a) } }
pub fn c1_field_move_always(p: Pair) { consume(p.b) }
pub fn c1_tuple_move(t: (D, D, u8), b: bool) { if b { consume(t.1) } }
pub fn c1_boxed(x: Box<D>, b: bool) { if b { consume(*x) } }
pub fn c1_boxed_always(x: Box<D>) { consume(*x) }
pub fn c1_enum_drop(e: E) {}
pub fn c1_vec_drop(v: Vec<D>, b: bool) { if b { drop(v) } }
pub fn c1_reinit(mut d: D, b: bool) { if b { consume(d); d = D(1); } }
pub fn c1_arr(a: [D; 3]) {}
pub fn c1_slice_box(a: Box<[D]>) {}
pub fn c1_call_ret(b: bool) { let x = c1_make(); if b { consume(x) } }
pub fn c1_make() -> D { D(0) }
pub fn c1_loopy(mut d: D, n: u8) { let mut i = 0; while i < n { consume(d); d = D(i); i += 1; } }
pub fn c1_matcher(e: E) -> u8 { match e { E::A(d) => { consume(d); 1 } E::B(x, _) => { consume(x); 2 } E::C => 3, E::F { .. } => 4 } }
pub fn c1_arr_pat(a: [D; 3]) { let [x, _, z] = a; consume(x); }
pub struct D(u8);
impl Drop for D { fn drop(&mut self) {} }
pub struct Pair { pub a: D, pub b: D, pub c: u8 }
pub fn consume<T>(_d: T) {}
pub enum E { A(D), B(D, D), C, F { x: D, y: String } }
pub fn closure_upvar(d: D, b: bool) { let c = move || consume(d); if b { c() } }
pub fn dynbox(x: Box<dyn Send>, b: bool) { if b { drop(x) } }
