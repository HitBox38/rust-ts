// Oracle probe of lane miri-shims-e: libc's x86_64-linux-gnu pthread static initializers and constants, and the
// return codes of the pthread mutex kinds under the pinned Miri.
#![feature(rustc_private)]
extern crate libc;
use std::mem::{size_of, MaybeUninit};

fn bytes<T>(x: &T) -> String {
    let s = unsafe { std::slice::from_raw_parts(x as *const T as *const u8, size_of::<T>()) };
    s.iter().map(|b| format!("{b}")).collect::<Vec<_>>().join(",")
}

fn main() {
    println!("PTHREAD_MUTEX_INITIALIZER={}", bytes(&libc::PTHREAD_MUTEX_INITIALIZER));
    println!("PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP={}", bytes(&libc::PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP));
    println!("PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP={}", bytes(&libc::PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP));
    println!("PTHREAD_ADAPTIVE_MUTEX_INITIALIZER_NP={}", bytes(&libc::PTHREAD_ADAPTIVE_MUTEX_INITIALIZER_NP));
    println!("PTHREAD_RWLOCK_INITIALIZER={}", bytes(&libc::PTHREAD_RWLOCK_INITIALIZER));
    println!("PTHREAD_COND_INITIALIZER={}", bytes(&libc::PTHREAD_COND_INITIALIZER));
    println!("size pthread_mutexattr_t={} pthread_condattr_t={} timespec={} clockid_t={}",
        size_of::<libc::pthread_mutexattr_t>(), size_of::<libc::pthread_condattr_t>(), size_of::<libc::timespec>(), size_of::<libc::clockid_t>());
    println!("PTHREAD_MUTEX_NORMAL={} PTHREAD_MUTEX_RECURSIVE={} PTHREAD_MUTEX_ERRORCHECK={} PTHREAD_MUTEX_DEFAULT={}",
        libc::PTHREAD_MUTEX_NORMAL, libc::PTHREAD_MUTEX_RECURSIVE, libc::PTHREAD_MUTEX_ERRORCHECK, libc::PTHREAD_MUTEX_DEFAULT);
    println!("EINVAL={} EBUSY={} EDEADLK={} EPERM={} ETIMEDOUT={} EAGAIN={} EFAULT={} CLOCK_REALTIME={} CLOCK_MONOTONIC={}",
        libc::EINVAL, libc::EBUSY, libc::EDEADLK, libc::EPERM, libc::ETIMEDOUT, libc::EAGAIN, libc::EFAULT, libc::CLOCK_REALTIME, libc::CLOCK_MONOTONIC);
    println!("FUTEX_WAIT={} FUTEX_WAKE={} FUTEX_WAIT_BITSET={} FUTEX_WAKE_BITSET={} FUTEX_PRIVATE_FLAG={} FUTEX_CLOCK_REALTIME={} SYS_futex={} SYS_getrandom={} SYS_eventfd2={} SYS_gettid={}",
        libc::FUTEX_WAIT, libc::FUTEX_WAKE, libc::FUTEX_WAIT_BITSET, libc::FUTEX_WAKE_BITSET, libc::FUTEX_PRIVATE_FLAG, libc::FUTEX_CLOCK_REALTIME, libc::SYS_futex, libc::SYS_getrandom, libc::SYS_eventfd2, libc::SYS_gettid);
    println!("EPOLLIN={:#x} EPOLLOUT={:#x} EPOLLRDHUP={:#x} EPOLLHUP={:#x} EPOLLERR={:#x} EPOLLET={:#x} EPOLL_CTL_ADD={} EPOLL_CTL_MOD={} EPOLL_CTL_DEL={} EFD_NONBLOCK={:#x} EFD_CLOEXEC={:#x} EFD_SEMAPHORE={:#x}",
        libc::EPOLLIN, libc::EPOLLOUT, libc::EPOLLRDHUP, libc::EPOLLHUP, libc::EPOLLERR, libc::EPOLLET as u32, libc::EPOLL_CTL_ADD, libc::EPOLL_CTL_MOD, libc::EPOLL_CTL_DEL, libc::EFD_NONBLOCK, libc::EFD_CLOEXEC, libc::EFD_SEMAPHORE);

    unsafe {
        // Mutex kinds (sync.rs:549/589/614): relock and trylock by the owner, unlock when not locked.
        for (name, kind) in [("errorcheck", libc::PTHREAD_MUTEX_ERRORCHECK), ("recursive", libc::PTHREAD_MUTEX_RECURSIVE), ("normal", libc::PTHREAD_MUTEX_NORMAL)] {
            let mut attr = MaybeUninit::<libc::pthread_mutexattr_t>::uninit();
            libc::pthread_mutexattr_init(attr.as_mut_ptr());
            let st = libc::pthread_mutexattr_settype(attr.as_mut_ptr(), kind);
            let mut m = MaybeUninit::<libc::pthread_mutex_t>::uninit();
            libc::pthread_mutex_init(m.as_mut_ptr(), attr.as_ptr());
            let l1 = libc::pthread_mutex_lock(m.as_mut_ptr());
            let l2 = if name == "normal" { -999 } else { libc::pthread_mutex_lock(m.as_mut_ptr()) };
            let t = libc::pthread_mutex_trylock(m.as_mut_ptr());
            let u1 = libc::pthread_mutex_unlock(m.as_mut_ptr());
            let u2 = if name == "normal" { -999 } else { libc::pthread_mutex_unlock(m.as_mut_ptr()) };
            let u3 = if name == "normal" { -999 } else { libc::pthread_mutex_unlock(m.as_mut_ptr()) };
            let u4 = if name == "recursive" { libc::pthread_mutex_unlock(m.as_mut_ptr()) } else { -999 };
            println!("{name}: settype={st} lock={l1} relock={l2} trylock={t} unlock={u1},{u2},{u3},{u4}");
        }
        let st = libc::pthread_mutexattr_settype(MaybeUninit::<libc::pthread_mutexattr_t>::zeroed().as_mut_ptr(), 1234);
        println!("settype(1234)={st}");
        // Static initializers.
        let mut r = libc::PTHREAD_RECURSIVE_MUTEX_INITIALIZER_NP;
        println!("recursive-static: {} {} {} {}", libc::pthread_mutex_lock(&mut r), libc::pthread_mutex_lock(&mut r), libc::pthread_mutex_unlock(&mut r), libc::pthread_mutex_unlock(&mut r));
        let mut e = libc::PTHREAD_ERRORCHECK_MUTEX_INITIALIZER_NP;
        println!("errorcheck-static: {} {} {} {}", libc::pthread_mutex_lock(&mut e), libc::pthread_mutex_lock(&mut e), libc::pthread_mutex_unlock(&mut e), libc::pthread_mutex_unlock(&mut e));
        // rwlock
        let mut rw = libc::PTHREAD_RWLOCK_INITIALIZER;
        println!("rwlock: rd={} tryrd={} trywr={} un={} un={} trywr={} tryrd={} un={}",
            libc::pthread_rwlock_rdlock(&mut rw), libc::pthread_rwlock_tryrdlock(&mut rw), libc::pthread_rwlock_trywrlock(&mut rw),
            libc::pthread_rwlock_unlock(&mut rw), libc::pthread_rwlock_unlock(&mut rw), libc::pthread_rwlock_trywrlock(&mut rw),
            libc::pthread_rwlock_tryrdlock(&mut rw), libc::pthread_rwlock_unlock(&mut rw));
        // condattr clocks
        let mut ca = MaybeUninit::<libc::pthread_condattr_t>::uninit();
        libc::pthread_condattr_init(ca.as_mut_ptr());
        let mut clk: libc::clockid_t = -1;
        libc::pthread_condattr_getclock(ca.as_ptr(), &mut clk);
        let s1 = libc::pthread_condattr_setclock(ca.as_mut_ptr(), libc::CLOCK_MONOTONIC);
        let mut clk2: libc::clockid_t = -1;
        libc::pthread_condattr_getclock(ca.as_ptr(), &mut clk2);
        let s2 = libc::pthread_condattr_setclock(ca.as_mut_ptr(), 77);
        println!("condattr: default={clk} set_mono={s1} now={clk2} set77={s2}");
        // cond timedwait (monotonic clock, virtual time) times out.
        let mut c = MaybeUninit::<libc::pthread_cond_t>::uninit();
        libc::pthread_cond_init(c.as_mut_ptr(), ca.as_ptr());
        let mut m = libc::PTHREAD_MUTEX_INITIALIZER;
        libc::pthread_mutex_lock(&mut m);
        let mut now = MaybeUninit::<libc::timespec>::uninit();
        libc::clock_gettime(libc::CLOCK_MONOTONIC, now.as_mut_ptr());
        let mut ts = now.assume_init();
        ts.tv_nsec += 1_000_000;
        if ts.tv_nsec >= 1_000_000_000 { ts.tv_nsec -= 1_000_000_000; ts.tv_sec += 1; }
        let tw = libc::pthread_cond_timedwait(c.as_mut_ptr(), &mut m, &ts);
        let bad = libc::timespec { tv_sec: 0, tv_nsec: 1_000_000_000 };
        let tw2 = libc::pthread_cond_timedwait(c.as_mut_ptr(), &mut m, &bad);
        println!("cond_timedwait: {tw} invalid={tw2}");
        // futex: value mismatch, wake with no waiters, timeout.
        let word = std::sync::atomic::AtomicU32::new(5);
        let r1 = libc::syscall(libc::SYS_futex, word.as_ptr(), libc::FUTEX_WAIT, 4u32, std::ptr::null::<libc::timespec>());
        let e1 = *libc::__errno_location();
        let r2 = libc::syscall(libc::SYS_futex, word.as_ptr(), libc::FUTEX_WAKE, 10u32);
        let to = libc::timespec { tv_sec: 0, tv_nsec: 2_000 };
        let r3 = libc::syscall(libc::SYS_futex, word.as_ptr(), libc::FUTEX_WAIT | libc::FUTEX_PRIVATE_FLAG, 5u32, &to as *const libc::timespec);
        let e3 = *libc::__errno_location();
        let r4 = libc::syscall(libc::SYS_futex, word.as_ptr(), libc::FUTEX_WAIT_BITSET, 5u32, std::ptr::null::<libc::timespec>(), std::ptr::null::<u32>(), 0u32);
        let e4 = *libc::__errno_location();
        println!("futex: mismatch={r1}/{e1} wake={r2} timeout={r3}/{e3} bitset0={r4}/{e4}");
    }
}
