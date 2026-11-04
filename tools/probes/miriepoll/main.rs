// Oracle source for src/miri/shims/unix/linux_like/{epoll,eventfd}.ts (lane harness-w38; queued by the miri-shims-e
// review). A program for the pinned Miri, not a native probe: epoll and eventfd exist only on the Linux target Miri
// interprets for, so scripts/probes.ts runs this file with the isolated Miri (`PROBE_FIXTURES` `miri: true`) and its
// stdout is tools/probes/miriepoll/epoll.oracle.txt, byte for byte (tools/probes/fixtures.test.ts). One `name: values`
// line per step: a call's result, with `/<errno>` when it failed. Only paths that return: an unsupported flag or
// operation, or a null event on EPOLL_CTL_ADD (UB), stops Miri, so those texts are not here.
#![feature(rustc_private)]
extern crate libc;
use std::thread;

fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap()
}

/// A call's result, with errno when it failed.
fn r(x: isize) -> String {
    if x < 0 { format!("{x}/{}", errno()) } else { format!("{x}") }
}

fn efd(init: u32, flags: i32) -> i32 {
    unsafe { libc::eventfd(init, flags) }
}

fn read_u64(fd: i32) -> String {
    let mut v = 0u64;
    let n = unsafe { libc::read(fd, &mut v as *mut u64 as *mut libc::c_void, 8) };
    if n < 0 { r(n) } else { format!("{n}:{v}") }
}

fn write_u64(fd: i32, v: u64) -> String {
    r(unsafe { libc::write(fd, &v as *const u64 as *const libc::c_void, 8) })
}

fn ctl(epfd: i32, op: i32, fd: i32, events: u32, data: u64) -> String {
    let mut ev = libc::epoll_event { events, u64: data };
    r(unsafe { libc::epoll_ctl(epfd, op, fd, &mut ev) } as isize)
}

/// `epoll_wait` with room for `room` events, asked for `max`: the count and each `events:u64`.
fn wait(epfd: i32, room: usize, max: i32, timeout: i32) -> String {
    let mut evs = vec![libc::epoll_event { events: 0, u64: 0 }; room];
    let n = unsafe { libc::epoll_wait(epfd, evs.as_mut_ptr(), max, timeout) };
    if n < 0 {
        return r(n as isize);
    }
    let mut s = format!("{n}");
    for e in &evs[..n as usize] {
        let (events, data) = (e.events, e.u64);
        s.push_str(&format!(" {events:#x}:{data}"));
    }
    s
}

fn eventfd_steps() {
    let fd = efd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC);
    println!("eventfd nonblock cloexec: {}", r(fd as isize));
    println!("read empty: {}", read_u64(fd));
    println!("write 1: {}", write_u64(fd, 1));
    println!("write 2: {}", write_u64(fd, 2));
    println!("read sum: {}", read_u64(fd));
    println!("read cleared: {}", read_u64(fd));
    let mut small = [0u8; 4];
    println!("read 4 bytes: {}", r(unsafe { libc::read(fd, small.as_mut_ptr() as *mut libc::c_void, 4) }));
    let mut big = [0xffu8; 16];
    println!("write 7 before a long read: {}", write_u64(fd, 7));
    println!("read 16 bytes: {} {:?}", r(unsafe { libc::read(fd, big.as_mut_ptr() as *mut libc::c_void, 16) }), big);
    println!("write 4 bytes: {}", r(unsafe { libc::write(fd, small.as_ptr() as *const libc::c_void, 4) }));
    let wide = [1u8, 0, 0, 0, 0, 0, 0, 0, 9, 9, 9, 9];
    println!("write 12 bytes: {}", r(unsafe { libc::write(fd, wide.as_ptr() as *const libc::c_void, 12) }));
    println!("read after 12: {}", read_u64(fd));
    println!("write u64::MAX: {}", write_u64(fd, u64::MAX));
    println!("write MAX-1: {}", write_u64(fd, u64::MAX - 1));
    println!("write over: {}", write_u64(fd, 1));
    println!("read MAX-1: {}", read_u64(fd));
    println!("close: {}", r(unsafe { libc::close(fd) } as isize));
    println!("read closed: {}", read_u64(fd));

    let fd = efd(5, libc::EFD_NONBLOCK);
    println!("initval read: {}", read_u64(fd));
    unsafe { libc::close(fd) };

    // A blocking read woken by another thread's write, and a blocking write woken by a read.
    let fd = efd(0, 0);
    let t = thread::spawn(move || {
        thread::yield_now();
        write_u64(fd, 3)
    });
    println!("blocking read: {}", read_u64(fd));
    println!("woken write: {}", t.join().unwrap());
    println!("write MAX-1 blocking: {}", write_u64(fd, u64::MAX - 1));
    let t = thread::spawn(move || write_u64(fd, 1));
    thread::yield_now();
    println!("read wakes writer: {}", read_u64(fd));
    println!("blocked write: {}", t.join().unwrap());
    println!("read after: {}", read_u64(fd));
    unsafe { libc::close(fd) };
}

fn epoll_ctl_steps() {
    let ep = unsafe { libc::epoll_create1(0) };
    println!("epoll_create1 0: {}", r(ep as isize));
    let ep2 = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) };
    println!("epoll_create1 cloexec: {}", r(ep2 as isize));
    let fd = efd(0, libc::EFD_NONBLOCK);
    let (add, m0d, del) = (libc::EPOLL_CTL_ADD, libc::EPOLL_CTL_MOD, libc::EPOLL_CTL_DEL);
    let inn = libc::EPOLLIN as u32;
    println!("ctl bad epfd: {}", ctl(999, add, fd, inn, 1));
    println!("ctl bad fd: {}", ctl(ep, add, 999, inn, 1));
    println!("ctl epfd as fd: {}", ctl(ep, add, ep, inn, 1));
    println!("ctl mod unregistered: {}", ctl(ep, m0d, fd, inn, 1));
    println!("ctl del unregistered: {}", ctl(ep, del, fd, inn, 1));
    println!("ctl add: {}", ctl(ep, add, fd, inn, 1));
    println!("ctl add again: {}", ctl(ep, add, fd, inn, 2));
    println!("ctl mod: {}", ctl(ep, m0d, fd, inn | libc::EPOLLOUT as u32, 3));
    println!("wait after mod: {}", wait(ep, 4, 4, 0));
    println!("ctl del: {}", ctl(ep, del, fd, 0, 0));
    println!("ctl del again: {}", ctl(ep, del, fd, 0, 0));
    println!("wait after del: {}", wait(ep, 4, 4, 0));
    println!("ctl del null event: {}", r(unsafe { libc::epoll_ctl(ep, del, fd, std::ptr::null_mut()) } as isize));
    println!("close epoll: {}", r(unsafe { libc::close(ep2) } as isize));
    println!("wait closed epfd: {}", wait(ep2, 4, 4, 0));
    println!("wait bad epfd: {}", wait(999, 4, 4, 0));
    println!("wait max 0: {}", wait(ep, 4, 0, 0));
    println!("wait max -1: {}", wait(ep, 4, -1, 0));
    unsafe {
        libc::close(fd);
        libc::close(ep);
    }
}

fn epoll_ready_steps() {
    let et = libc::EPOLLET as u32;
    let (inn, out) = (libc::EPOLLIN as u32, libc::EPOLLOUT as u32);
    let add = libc::EPOLL_CTL_ADD;

    // Edge-triggered: each edge is reported once; a write is an edge even if the fd was already readable.
    let ep = unsafe { libc::epoll_create1(0) };
    let fd = efd(0, libc::EFD_NONBLOCK);
    println!("et add: {}", ctl(ep, add, fd, inn | out | et, 11));
    println!("et first: {}", wait(ep, 4, 4, 0));
    println!("et none: {}", wait(ep, 4, 4, 0));
    println!("et write: {}", write_u64(fd, 1));
    println!("et after write: {}", wait(ep, 4, 4, 0));
    println!("et none again: {}", wait(ep, 4, 4, 0));
    println!("et write 2: {}", write_u64(fd, 1));
    println!("et after write 2: {}", wait(ep, 4, 4, 0));
    println!("et read: {}", read_u64(fd));
    println!("et after read: {}", wait(ep, 4, 4, 0));
    unsafe { libc::close(fd) };
    println!("et after close: {}", wait(ep, 4, 4, 0));

    // Level-triggered: reported until the state changes.
    let fd = efd(1, libc::EFD_NONBLOCK);
    println!("lt add: {}", ctl(ep, add, fd, inn, 12));
    println!("lt first: {}", wait(ep, 4, 4, 0));
    println!("lt second: {}", wait(ep, 4, 4, 0));
    println!("lt read: {}", read_u64(fd));
    println!("lt drained: {}", wait(ep, 4, 4, 0));
    unsafe { libc::close(fd) };

    // Several fds: the ready order, and `maxevents` leaving the rest for the next call.
    let fds = [efd(0, libc::EFD_NONBLOCK), efd(0, libc::EFD_NONBLOCK), efd(0, libc::EFD_NONBLOCK)];
    for (i, &f) in fds.iter().enumerate() {
        println!("many add {i}: {}", ctl(ep, add, f, inn | et, 20 + i as u64));
    }
    println!("many none: {}", wait(ep, 4, 4, 0));
    for &f in fds.iter().rev() {
        write_u64(f, 1);
    }
    println!("many max 1: {}", wait(ep, 4, 1, 0));
    println!("many rest: {}", wait(ep, 4, 4, 0));
    println!("many empty: {}", wait(ep, 4, 4, 0));
    for &f in &fds {
        unsafe { libc::close(f) };
    }

    // A dup keeps the description, and so the interest, alive; the same description under two fds is two interests.
    let fd = efd(0, libc::EFD_NONBLOCK);
    let dup = unsafe { libc::dup(fd) };
    println!("dup: {}", r(dup as isize));
    println!("dup add fd: {}", ctl(ep, add, fd, inn | out | et, 31));
    println!("dup add dup: {}", ctl(ep, add, dup, inn | out | et, 32));
    println!("dup both: {}", wait(ep, 4, 4, 0));
    unsafe { libc::close(fd) };
    println!("dup write: {}", write_u64(dup, 1));
    println!("dup after close of fd: {}", wait(ep, 4, 4, 0));
    unsafe { libc::close(dup) };
    println!("dup all closed: {}", wait(ep, 4, 4, 0));

    // Two epoll instances watching one fd; one epoll watching another.
    let ep2 = unsafe { libc::epoll_create1(0) };
    let fd = efd(0, libc::EFD_NONBLOCK);
    println!("two add 1: {}", ctl(ep, add, fd, inn | out | et, 41));
    println!("two add 2: {}", ctl(ep2, add, fd, inn | out | et, 42));
    println!("two wait 1: {}", wait(ep, 4, 4, 0));
    println!("two wait 2: {}", wait(ep2, 4, 4, 0));
    println!("two wait 1 again: {}", wait(ep, 4, 4, 0));
    unsafe {
        libc::close(fd);
        libc::close(ep2);
    }

    // Blocking: a timeout on the virtual clock, and a wait woken by another thread's write.
    let fd = efd(0, libc::EFD_NONBLOCK);
    println!("block add: {}", ctl(ep, add, fd, inn | et, 51));
    println!("block timeout: {}", wait(ep, 4, 4, 5));
    let t = thread::spawn(move || {
        thread::yield_now();
        write_u64(fd, 2)
    });
    println!("block woken: {}", wait(ep, 4, 4, -1));
    println!("block writer: {}", t.join().unwrap());
    unsafe {
        libc::close(fd);
        libc::close(ep);
    }
}

fn main() {
    println!(
        "constants: EPOLLIN={:#x} EPOLLOUT={:#x} EPOLLRDHUP={:#x} EPOLLHUP={:#x} EPOLLERR={:#x} EPOLLET={:#x} EFD_NONBLOCK={:#x} EFD_CLOEXEC={:#x} EBADF={} EEXIST={} ENOENT={} EINVAL={} EFAULT={} EAGAIN={} sizeof(epoll_event)={}",
        libc::EPOLLIN, libc::EPOLLOUT, libc::EPOLLRDHUP, libc::EPOLLHUP, libc::EPOLLERR, libc::EPOLLET as u32, libc::EFD_NONBLOCK, libc::EFD_CLOEXEC,
        libc::EBADF, libc::EEXIST, libc::ENOENT, libc::EINVAL, libc::EFAULT, libc::EAGAIN, std::mem::size_of::<libc::epoll_event>(),
    );
    eventfd_steps();
    epoll_ctl_steps();
    epoll_ready_steps();
}
