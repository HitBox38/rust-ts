// Port of ena =0.14.4 `src/lib.rs` (the version in upstream's Cargo.lock; rustc_data_structures
// re-exports `ena::{snapshot_vec, undo_log, unify}`). Built with no features: `bench` and
// `persistent` (dogged) are off.
//
//! An implementation of union-find. See the `unify` module for more
//! details.

export * as snapshot_vec from "./snapshot_vec.ts";
export * as undo_log from "./undo_log.ts";
export * as unify from "./unify/mod.ts";

// src/bitvec.rs is in the published package but lib.rs declares no `mod bitvec`: it is never compiled.
// crate-skip: ena-0.14.4/src/bitvec.rs:17 new not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:22 contains not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:28 insert not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:37 insert_all not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:50 grow not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:57 iter not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:74 next not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:107 new not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:118 range not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:124 add not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:138 contains not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:148 intersection not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:174 merge not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:189 u64s not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:193 word_mask not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:200 bitvec_iter_works not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:216 bitvec_iter_works_2 not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:231 bitvec_iter_works_3 not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:242 union_two_vecs not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:259 grow not a module of the crate (lib.rs has no `mod bitvec`)
// crate-skip: ena-0.14.4/src/bitvec.rs:273 matrix_intersection not a module of the crate (lib.rs has no `mod bitvec`)
