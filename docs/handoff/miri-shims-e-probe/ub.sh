#!/bin/sh
# The one-line oracle programs of sync.oracle.txt ("ub" lines), as run by lane miri-shims-e (MIRI = the isolated Miri binary).
# adaptive
cat > ub_adaptive.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut m = libc::PTHREAD_ADAPTIVE_MUTEX_INITIALIZER_NP; libc::pthread_mutex_lock(&mut m); } }
EOF
# default_relock
cat > ub_default_relock.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut m = libc::PTHREAD_MUTEX_INITIALIZER; libc::pthread_mutex_lock(&mut m); libc::pthread_mutex_lock(&mut m); } }
EOF
# default_unlock
cat > ub_default_unlock.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut m = libc::PTHREAD_MUTEX_INITIALIZER; libc::pthread_mutex_unlock(&mut m); } }
EOF
# destroy_locked
cat > ub_destroy_locked.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut m = libc::PTHREAD_MUTEX_INITIALIZER; libc::pthread_mutex_lock(&mut m); libc::pthread_mutex_destroy(&mut m); } }
EOF
# double_destroy
cat > ub_double_destroy.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut m = libc::PTHREAD_MUTEX_INITIALIZER; libc::pthread_mutex_destroy(&mut m); libc::pthread_mutex_destroy(&mut m); } }
EOF
# futex_badop
cat > ub_futex_badop.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let w = std::sync::atomic::AtomicU32::new(0); libc::syscall(libc::SYS_futex, w.as_ptr(), 5i32, 0u32); } }
EOF
# futex_bitset_uaddr2
cat > ub_futex_bitset_uaddr2.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let w = std::sync::atomic::AtomicU32::new(0); libc::syscall(libc::SYS_futex, w.as_ptr(), libc::FUTEX_WAIT_BITSET, 0u32, std::ptr::null::<libc::timespec>(), 8usize as *const u32, 1u32); } }
EOF
# moved
cat > ub_moved.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut m = libc::PTHREAD_MUTEX_INITIALIZER; libc::pthread_mutex_lock(&mut m); libc::pthread_mutex_unlock(&mut m); let mut m2 = std::ptr::read(&m); libc::pthread_mutex_lock(&mut m2); } }
EOF
# normal_relock
cat > ub_normal_relock.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut a = std::mem::MaybeUninit::<libc::pthread_mutexattr_t>::uninit(); libc::pthread_mutexattr_init(a.as_mut_ptr()); libc::pthread_mutexattr_settype(a.as_mut_ptr(), libc::PTHREAD_MUTEX_NORMAL); let mut m = std::mem::MaybeUninit::<libc::pthread_mutex_t>::uninit(); libc::pthread_mutex_init(m.as_mut_ptr(), a.as_ptr()); libc::pthread_mutex_lock(m.as_mut_ptr()); libc::pthread_mutex_lock(m.as_mut_ptr()); } }
EOF
# rwlock_unlock
cat > ub_rwlock_unlock.rs <<'EOF'
#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut l = libc::PTHREAD_RWLOCK_INITIALIZER; libc::pthread_rwlock_unlock(&mut l); } }
EOF
for f in ub_*.rs; do "$MIRI" --target x86_64-unknown-linux-gnu --sysroot "$MIRI_SYSROOT" --edition 2021 "$f" 2>&1 | grep -m1 "^error"; done
