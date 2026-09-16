# Decode a drive.ts pty log: join the JSON-quoted OUT chunks, strip ANSI, print tail.
import json, re, sys

path = sys.argv[1]
tail = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
out = []
for l in open(path, encoding="utf8").read().splitlines():
    m = re.search(r'OUT ("(?:[^"\\]|\\.)*")', l)
    if m:
        out.append(json.loads(m.group(1)))
text = "".join(out)
text = re.sub(r"\x1b\[[0-9;?]*[ ]?[A-Za-z]", "", text)
text = re.sub(r"\x1b.", "", text)
text = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+\n", "\n", text))
print(text[-tail:])
