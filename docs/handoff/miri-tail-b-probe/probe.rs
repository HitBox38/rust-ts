// Oracle program of lane miri-tail-b (docs/handoff/miri-tail-b.md): virtual sockets under the isolated Miri.
// Its stdout is src/miri/shims/unix/virtual_socket.oracle.txt (run.sh).
#![feature(rustc_private)]
extern crate libc;

use std::cell::UnsafeCell;
use std::thread;

fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap()
}

fn rd(fd: i32, n: usize) -> (isize, i32, Vec<u8>) {
    let mut b = vec![0u8; n];
    let r = unsafe { libc::read(fd, b.as_mut_ptr().cast(), n) };
    let e = if r < 0 { errno() } else { 0 };
    b.truncate(r.max(0) as usize);
    (r, e, b)
}

fn wr(fd: i32, b: &[u8]) -> (isize, i32) {
    let r = unsafe { libc::write(fd, b.as_ptr().cast(), b.len()) };
    (r, if r < 0 { errno() } else { 0 })
}

fn pipe(flags: i32) -> [i32; 2] {
    let mut p = [-1; 2];
    assert_eq!(unsafe { libc::pipe2(p.as_mut_ptr(), flags) }, 0);
    p
}

fn sockpair(ty: i32) -> [i32; 2] {
    let mut p = [-1; 2];
    assert_eq!(unsafe { libc::socketpair(libc::AF_UNIX, ty, 0, p.as_mut_ptr()) }, 0);
    p
}

fn close(fd: i32) {
    assert_eq!(unsafe { libc::close(fd) }, 0);
}

fn getfl(fd: i32) -> i32 {
    unsafe { libc::fcntl(fd, libc::F_GETFL) }
}

/// (events, data) of up to `MAX` ready interests.
fn ep_wait(ep: i32) -> Vec<(u32, u64)> {
    let mut ev = [libc::epoll_event { events: 0, u64: 0 }; 8];
    let n = unsafe { libc::epoll_wait(ep, ev.as_mut_ptr(), 8, 0) };
    assert!(n >= 0);
    ev[..n as usize].iter().map(|e| ({ e.events }, { e.u64 })).collect()
}

fn ep_add(ep: i32, fd: i32, events: u32, data: u64) {
    let mut e = libc::epoll_event { events, u64: data };
    assert_eq!(unsafe { libc::epoll_ctl(ep, libc::EPOLL_CTL_ADD, fd, &mut e) }, 0);
}

struct Racy(UnsafeCell<u64>);
unsafe impl Sync for Racy {}
static VAL: Racy = Racy(UnsafeCell::new(0));

fn main() {
    println!("constants O_RDONLY={} O_WRONLY={} O_RDWR={} O_NONBLOCK={} O_CLOEXEC={} SOCK_NONBLOCK={} SOCK_CLOEXEC={} SOCK_STREAM={} AF_UNIX={} AF_LOCAL={} EPIPE={} EAGAIN={} EBADF={} S_IFIFO={} S_IFSOCK={} EPOLLIN={} EPOLLOUT={} EPOLLRDHUP={} EPOLLHUP={} EPOLLERR={} EPOLLET={}",
        libc::O_RDONLY, libc::O_WRONLY, libc::O_RDWR, libc::O_NONBLOCK, libc::O_CLOEXEC, libc::SOCK_NONBLOCK, libc::SOCK_CLOEXEC, libc::SOCK_STREAM, libc::AF_UNIX, libc::AF_LOCAL,
        libc::EPIPE, libc::EAGAIN, libc::EBADF, libc::S_IFIFO, libc::S_IFSOCK,
        libc::EPOLLIN, libc::EPOLLOUT, libc::EPOLLRDHUP, libc::EPOLLHUP, libc::EPOLLERR, libc::EPOLLET as u32);

    // pipe(): the fd numbers and both ends' flags.
    let mut p = [-1; 2];
    println!("pipe ret={} fds={:?}", unsafe { libc::pipe(p.as_mut_ptr()) }, p);
    println!("pipe flags r={} w={}", getfl(p[0]), getfl(p[1]));
    println!("pipe write {:?}", wr(p[1], b"hello"));
    println!("pipe read {:?}", rd(p[0], 3));
    println!("pipe read {:?}", rd(p[0], 16));
    println!("pipe zero read {:?} zero write {:?}", rd(p[0], 0), wr(p[1], b""));
    // Wrong ends: write on the read end is EBADF.
    println!("pipe write on read end {:?}", wr(p[0], b"x"));
    close(p[1]);
    println!("pipe read after writer closed {:?}", rd(p[0], 4));
    println!("pipe write on read end after writer closed {:?}", wr(p[0], b"x"));
    close(p[0]);

    // Reader closed: EPIPE, with zero-length still succeeding.
    let p = pipe(0);
    close(p[0]);
    println!("pipe write after reader closed {:?} zero {:?}", wr(p[1], b"x"), wr(p[1], b""));
    close(p[1]);

    // Buffered data survives the writer's close.
    let p = pipe(libc::O_CLOEXEC);
    println!("cloexec flags {} {}", getfl(p[0]), getfl(p[1]));
    wr(p[1], b"tail");
    close(p[1]);
    println!("buffered {:?} {:?}", rd(p[0], 16), rd(p[0], 16));
    close(p[0]);

    // Non-blocking.
    let p = pipe(libc::O_NONBLOCK | libc::O_CLOEXEC);
    println!("nonblock flags {} {} read {:?}", getfl(p[0]), getfl(p[1]), rd(p[0], 1));
    // F_SETFL: only O_NONBLOCK sticks, access mode bits are ignored by fcntl itself.
    println!("setfl {} flags {}", unsafe { libc::fcntl(p[0], libc::F_SETFL, 0) }, getfl(p[0]));
    println!("setfl {} flags {}", unsafe { libc::fcntl(p[0], libc::F_SETFL, libc::O_NONBLOCK | libc::O_RDWR) }, getfl(p[0]));
    close(p[0]);
    close(p[1]);

    // The ring buffer: `read` returns only the front slice of the VecDeque, so a wrapped buffer gives a short read.
    let p = pipe(0);
    wr(p[1], b"abcdefgh"); // capacity 8
    println!("wrap read {:?}", rd(p[0], 4));
    wr(p[1], b"ijk"); // wraps
    println!("wrap short read {:?}", rd(p[0], 16));
    println!("wrap rest {:?}", rd(p[0], 16));
    // An emptied deque resets the head: this fits without wrapping.
    wr(p[1], b"12345678");
    println!("reset read {:?}", rd(p[0], 16));
    // handle_capacity_increase case B (head_len > tail_len): grown with a wrapped buffer.
    wr(p[1], b"abcdefgh");
    println!("case B read {:?}", rd(p[0], 2));
    wr(p[1], b"ij"); // head 2, len 8, wrapped, tail 2
    wr(p[1], b"klm"); // capacity 16: the two tail bytes move behind the old end
    println!("case B after grow {:?}", rd(p[0], 32));
    // handle_capacity_increase case C (head_len <= tail_len): the head moves to the end.
    wr(p[1], b"abcdefgh"); // head 0 again, capacity 16: fill, consume so the head is high
    wr(p[1], b"ijklmnop"); // full (16)
    println!("case C read {:?}", rd(p[0], 13)); // head 13, len 3
    wr(p[1], b"qrstuvwxyzABC"); // len 16, wrapped: head_len 3, tail_len 13
    wr(p[1], b"D"); // capacity 32: head_len 3 <= tail_len 13
    println!("case C after grow {:?}", rd(p[0], 64));
    println!("case C rest {:?}", rd(p[0], 64));
    close(p[0]);
    close(p[1]);

    // Full buffer: a partial write, then EAGAIN.
    let p = pipe(libc::O_NONBLOCK);
    let big = vec![7u8; 0x34000 - 5];
    println!("big write {:?}", wr(p[1], &big));
    println!("partial write {:?}", wr(p[1], &[1u8; 16]));
    println!("full write {:?}", wr(p[1], b"x"));
    let (r, e, _) = rd(p[0], 0x40000);
    println!("drain read {:?}", (r, e));
    println!("after drain write {:?}", wr(p[1], b"y"));
    close(p[0]);
    close(p[1]);

    // Blocking read, woken by a writer on another thread. The non-atomic store is synchronized by the pipe's clock.
    let p = pipe(0);
    let (r, w) = (p[0], p[1]);
    let t = thread::spawn(move || {
        unsafe { *VAL.0.get() = 42 };
        wr(w, b"wake")
    });
    println!("blocked read {:?} val={}", rd(r, 16), unsafe { *VAL.0.get() });
    println!("writer {:?}", t.join().unwrap());
    close(r);
    close(w);

    // Blocking write on a full pipe, woken by a reader on another thread.
    let p = pipe(0);
    let (r, w) = (p[0], p[1]);
    println!("fill {:?}", wr(w, &vec![1u8; 0x34000]));
    let t = thread::spawn(move || wr(w, b"late"));
    thread::yield_now();
    println!("reader {:?}", { let (a, b, _) = rd(r, 0x10); (a, b) });
    println!("blocked write {:?}", t.join().unwrap());
    close(r);
    close(w);

    // socketpair: both directions, flags.
    let s = sockpair(libc::SOCK_STREAM);
    println!("socketpair fds={:?} flags {} {}", s, getfl(s[0]), getfl(s[1]));
    println!("sp write {:?} {:?}", wr(s[0], b"ping"), wr(s[1], b"pong!"));
    println!("sp read {:?} {:?}", rd(s[1], 16), rd(s[0], 16));
    close(s[1]);
    println!("sp after peer close read {:?} write {:?}", rd(s[0], 4), wr(s[0], b"x"));
    close(s[0]);

    let s = sockpair(libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC);
    println!("sp nonblock flags {} {} read {:?}", getfl(s[0]), getfl(s[1]), rd(s[0], 1));
    // FIONBIO on a socket: clear, then set.
    let mut off: i32 = 0;
    println!("fionbio off {} flags {}", unsafe { libc::ioctl(s[0], libc::FIONBIO, &mut off) }, getfl(s[0]));
    let mut on: i32 = 1;
    println!("fionbio on {} flags {}", unsafe { libc::ioctl(s[0], libc::FIONBIO, &mut on) }, getfl(s[0]));
    close(s[0]);
    close(s[1]);

    // Blocking on a socketpair across threads, both directions.
    let s = sockpair(libc::SOCK_STREAM);
    let (a, b) = (s[0], s[1]);
    let t = thread::spawn(move || {
        let got = rd(b, 16);
        wr(b, b"reply");
        got
    });
    println!("sp to thread {:?}", wr(a, b"request"));
    println!("sp from thread {:?}", rd(a, 16));
    println!("sp thread got {:?}", t.join().unwrap());
    close(a);
    close(b);

    // epoll on a pipe (level-triggered), then the peer's close.
    let p = pipe(0);
    let ep = unsafe { libc::epoll_create1(0) };
    ep_add(ep, p[0], libc::EPOLLIN as u32 | libc::EPOLLRDHUP as u32, 1);
    ep_add(ep, p[1], libc::EPOLLOUT as u32, 2);
    println!("ep pipe initial {:?}", ep_wait(ep));
    wr(p[1], b"z");
    println!("ep pipe written {:?}", ep_wait(ep));
    rd(p[0], 1);
    println!("ep pipe drained {:?}", ep_wait(ep));
    close(p[1]);
    println!("ep pipe writer closed {:?}", ep_wait(ep));
    close(p[0]);
    close(ep);

    // Writer's end watched when the reader closes.
    let p = pipe(0);
    let ep = unsafe { libc::epoll_create1(0) };
    ep_add(ep, p[1], libc::EPOLLOUT as u32, 3);
    println!("ep pipe w {:?}", ep_wait(ep));
    close(p[0]);
    println!("ep pipe reader closed {:?}", ep_wait(ep));
    close(p[1]);
    close(ep);

    // Edge-triggered on a socketpair: the write and the read that empties notify; the peer's close with unread data
    // sets EPOLLERR (peer_lost_data).
    let s = sockpair(libc::SOCK_STREAM);
    let ep = unsafe { libc::epoll_create1(0) };
    ep_add(ep, s[0], (libc::EPOLLIN | libc::EPOLLOUT | libc::EPOLLRDHUP | libc::EPOLLET) as u32, 4);
    println!("ep et initial {:?} {:?}", ep_wait(ep), ep_wait(ep));
    wr(s[1], b"abc");
    println!("ep et written {:?} {:?}", ep_wait(ep), ep_wait(ep));
    wr(s[1], b"d");
    println!("ep et written again {:?}", ep_wait(ep));
    rd(s[0], 1);
    println!("ep et partial read {:?}", ep_wait(ep));
    rd(s[0], 3);
    println!("ep et emptied {:?}", ep_wait(ep));
    wr(s[0], b"unread");
    println!("ep et own write {:?}", ep_wait(ep));
    rd(s[1], 2);
    println!("ep et peer partial read {:?}", ep_wait(ep));
    close(s[1]); // unread data in s[1]'s buffer: s[0] loses data
    println!("ep et peer closed {:?} {:?}", ep_wait(ep), ep_wait(ep));
    close(s[0]);
    close(ep);

    // Blocking epoll_wait woken by a write on another thread.
    let p = pipe(0);
    let ep = unsafe { libc::epoll_create1(0) };
    ep_add(ep, p[0], libc::EPOLLIN as u32, 5);
    let w = p[1];
    let t = thread::spawn(move || wr(w, b"!"));
    let mut ev = [libc::epoll_event { events: 0, u64: 0 }; 2];
    let n = unsafe { libc::epoll_wait(ep, ev.as_mut_ptr(), 2, -1) };
    println!("ep blocking {} {:?}", n, ev[..n as usize].iter().map(|e| ({ e.events }, { e.u64 })).collect::<Vec<_>>());
    t.join().unwrap();
    close(p[0]);
    close(p[1]);
    close(ep);

    // poll on a pipe.
    let p = pipe(0);
    let mut fds = [libc::pollfd { fd: p[0], events: libc::POLLIN, revents: 0 }, libc::pollfd { fd: p[1], events: libc::POLLOUT, revents: 0 }];
    println!("poll {} {} {}", unsafe { libc::poll(fds.as_mut_ptr(), 2, 0) }, fds[0].revents, fds[1].revents);
    wr(p[1], b"q");
    close(p[1]);
    println!("poll {} {}", unsafe { libc::poll(fds.as_mut_ptr(), 1, 0) }, fds[0].revents);
    close(p[0]);

    // dup: the description stays open until the last descriptor closes.
    let p = pipe(0);
    let d = unsafe { libc::dup(p[1]) };
    close(p[1]);
    println!("dup write {:?}", wr(d, b"dup"));
    println!("dup read {:?}", rd(p[0], 8));
    close(d);
    println!("dup eof {:?}", rd(p[0], 8));
    close(p[0]);

    println!("done");
}
