"""Tiny helper for hand-correcting paper JSON files (used while proofreading)."""
import json


class Paper:
    def __init__(self, year):
        self.path = f"data/papers/{year}.json"
        self.d = json.load(open(self.path, encoding="utf-8"))
        self.sec = {s["id"]: s for s in self.d["sections"]}

    def group(self, sid, gid=None):
        s = self.sec[sid]
        return s["groups"][0] if gid is None else next(g for g in s["groups"] if g["id"] == gid)

    def q(self, n):
        for s in self.d["sections"]:
            for g in s["groups"]:
                for q in g["questions"]:
                    if q["n"] == n:
                        return q
        raise KeyError(n)

    def rep(self, sid, gid, i, old, new):
        paras = self.group(sid, gid)["passage"]
        assert old in paras[i], f"{old!r} not in paragraph {i}: {paras[i][:90]!r}"
        paras[i] = paras[i].replace(old, new, 1)

    def merge(self, sid, gid, i):
        """Merge paragraph i+1 into paragraph i."""
        paras = self.group(sid, gid)["passage"]
        paras[i] = paras[i] + " " + paras.pop(i + 1)

    def split(self, sid, gid, i, at):
        paras = self.group(sid, gid)["passage"]
        k = paras[i].index(at)
        paras[i:i + 1] = [paras[i][:k].rstrip(), paras[i][k:]]

    def opt(self, n, letter, old, new):
        q = self.q(n)
        assert old in q["options"][letter], (n, letter, q["options"][letter])
        q["options"][letter] = q["options"][letter].replace(old, new)

    def save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.d, f, ensure_ascii=False, indent=1)
            f.write("\n")
