import shutil, os, sys, signal

signal.signal(signal.SIGINT, signal.SIG_IGN)  # Ignore stale Ctrl+C

src = r"c:\DevTools\C0de stuff\klaimswift\antigravity-awesome-skills\skills"
dst = r"C:\Users\Administrator\.gemini\antigravity\skills"

dirs = sorted([d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))])
total = len(dirs)
copied = skipped = 0

for d in dirs:
    s = os.path.join(src, d)
    t = os.path.join(dst, d)
    try:
        if os.path.exists(t):
            shutil.copytree(s, t, dirs_exist_ok=True)
        else:
            shutil.copytree(s, t)
        copied += 1
    except Exception as e:
        skipped += 1
    if copied % 200 == 0 and copied > 0:
        print(f"{copied}/{total}...", flush=True)

print(f"DONE: {copied} copied, {skipped} skipped, {total} total", flush=True)
