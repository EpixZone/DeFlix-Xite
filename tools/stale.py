import json, os, sys
from collections import Counter
x = sys.argv[1]
apply = len(sys.argv) > 2 and sys.argv[2] == "--delete"
c = json.load(open(os.path.join(x, "content.json")))
declared = set(c.get("files", {})) | set(c.get("files_optional", {}))
declared |= {"content.json", "dbschema.json"}
# Included content.json files are signed separately and are NOT listed in the
# root files map; everything under a user directory belongs to that user and is
# signed by them. Neither is ours to delete.
declared |= set(c.get("includes", {}))
PROTECT = ("data/users/",)
stale, total = [], 0
for root, dirs, files in os.walk(x):
    for f in files:
        p = os.path.relpath(os.path.join(root, f), x)
        if p in declared or p.startswith("meta/") or p.startswith(PROTECT):
            continue
        stem = os.path.splitext(os.path.basename(p))[0]
        # a freshly fetched film/poster is not stale: its manifest exists
        if p.startswith(("video/", "poster/")) and os.path.exists(
                os.path.join(x, "meta", stem + ".json")):
            continue
        stale.append(p)
        total += os.path.getsize(os.path.join(x, p))
print(f"undeclared: {len(stale)} files, {total/1e6:.0f} MB")
print("by area:", dict(Counter(p.split('/')[0] if '/' in p else '(root)' for p in stale)))
for p in sorted(stale)[:10]:
    print("   ", p)
if apply:
    for p in stale:
        os.remove(os.path.join(x, p))
    for root, dirs, files in os.walk(x, topdown=False):
        for d in dirs:
            try: os.rmdir(os.path.join(root, d))
            except OSError: pass
    print(f"deleted {len(stale)} files")
