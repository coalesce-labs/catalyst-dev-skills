#!/usr/bin/env python3
# hold-lease.py: hold a Linux write lease on a regular file, so another process's plain open() of it
# blocks until the kernel breaks the lease (/proc/sys/fs/lease-break-time). The path comes on stdin,
# never in argv, so the prune's process scan does not see this process naming the tree.
#   --probe   take and drop a lease on a temp file; exit 0 when leases work here
import fcntl, os, signal, sys, tempfile, time

F_SETLEASE = getattr(fcntl, "F_SETLEASE", 1024)

def take(path):
    fd = os.open(path, os.O_RDONLY)
    fcntl.fcntl(fd, F_SETLEASE, fcntl.F_WRLCK)
    return fd

if len(sys.argv) > 1 and sys.argv[1] == "--probe":
    handle, name = tempfile.mkstemp()
    os.close(handle)
    try:
        fd = take(name)
        fcntl.fcntl(fd, F_SETLEASE, fcntl.F_UNLCK)
        os.close(fd)
    finally:
        os.unlink(name)
    sys.exit(0)

signal.signal(signal.SIGIO, signal.SIG_IGN)
path = sys.stdin.readline().strip()
fd = take(path)
print("lease held", flush=True)
while True:
    time.sleep(3600)
