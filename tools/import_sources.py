#!/usr/bin/env python3
"""One-off importer: converts public source datasets into this app's paper schema.

The generated files under data/papers/ are the source of truth afterwards and are
hand-corrected (typos, OCR errors, missing text). Re-running this script would
overwrite those corrections, so it refuses to overwrite existing files unless
--force is given.

Sources (clone them into $SRC, default ./_sources):
  - structured-kaoyan-english  https://github.com/LIziak112/structured-kaoyan-english
      2010-2025 English I question text and answer keys (question layer: free use).
      Its explanation layer (CC BY-NC) is NOT imported.
  - kaoyan-english             https://github.com/XixiGod7/kaoyan-english  (MIT)
      2026 English I question text, answer key, translation underline offsets.
  - esq/e1                     https://github.com/wssfk12138/english-question-banks
      Only used for paragraph boundaries of the 2026 paper and for cross-checking
      answer keys (see tools/crosscheck_answers.py). No text is copied from it.
"""
import argparse
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PAPERS = os.path.join(ROOT, "data", "papers")
OUT_IMG = os.path.join(ROOT, "data", "img")

# Verified against independent sources; see README "数据来源与校对".
ANSWER_FIXES = {
    2013: {6: "D"},  # "wary of appearing too soft on crime"
}

SECTION_META = {
    "cloze": ("Section I  Use of English", "完形填空", 10, 20),
    "readingA": ("Section II  Reading Comprehension · Part A", "阅读理解 A 节", 40, 70),
    "readingB": ("Section II  Reading Comprehension · Part B", "阅读理解 B 节（新题型）", 10, 20),
    "translation": ("Section II  Reading Comprehension · Part C", "英译汉", 10, 25),
    "writingA": ("Section III  Writing · Part A", "小作文（应用文）", 10, 15),
    "writingB": ("Section III  Writing · Part B", "大作文（图画/图表作文）", 20, 30),
}

DEFAULT_DIRECTIONS = {
    "cloze": "Read the following text. Choose the best word(s) for each numbered blank and mark A, B, C or D on the ANSWER SHEET. (10 points)",
    "readingA": "Read the following four texts. Answer the questions below each text by choosing A, B, C or D. Mark your answers on the ANSWER SHEET. (40 points)",
    "gap_fill": "In the following text, some sentences have been removed. For Questions 41-45, choose the most suitable one from the list A-G to fit into each of the numbered blanks. There are two extra choices which do not fit in any of the blanks. Mark your answers on the ANSWER SHEET. (10 points)",
    "translation": "Read the following text carefully and then translate the underlined segments into Chinese. Write your answers on the ANSWER SHEET. (10 points)",
}


def clean_inline(s):
    s = s.replace("　", " ").replace("\xa0", " ")
    s = re.sub(r"\(\s*\{\{(\d+)\}\}\s*\)", r"{{\1}}", s)
    s = re.sub(r"\{\{(\d+)\}\}\s*_{2,}", r"{{\1}}", s)
    s = re.sub(r"_{2,}\s*\{\{(\d+)\}\}", r"{{\1}}", s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def join_wrapped(s):
    """Join PDF hard-wraps inside a paragraph."""
    s = re.sub(r"(\w)-\n(\w)", r"\1-\2", s)
    s = re.sub(r"\s*\n\s*", " ", s)
    return clean_inline(s)


def clean_directions(s):
    s = s or ""
    s = re.sub(r"^\s*(Part [ABC]\s*)?", "", s)
    s = re.sub(r"^\s*Directions\s*[:：]\s*", "", s)
    return join_wrapped(s)


def clean_writing_prompt(s):
    s = s.replace("　", " ").replace("\xa0", " ")
    s = re.sub(r"^\s*5[12]\s*[.．]\s*", "", s)
    s = re.sub(r"^\s*Directions\s*[:：]\s*", "", s)
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in s.split("\n")]
    return "\n".join(l for l in lines if l)


def opts(o):
    return {k: clean_inline(v) for k, v in sorted(o.items())}


def section(sid, groups, directions=None, subtype=None):
    title, cn, score, minutes = SECTION_META[sid]
    sec = {
        "id": sid,
        "type": {"cloze": "cloze", "readingA": "reading", "readingB": "partB",
                 "translation": "translation", "writingA": "writing", "writingB": "writing"}[sid],
        "title": title,
        "cn": cn,
        "score": score,
        "minutes": minutes,
        "directions": directions or DEFAULT_DIRECTIONS.get(sid, ""),
        "groups": groups,
    }
    if subtype:
        sec["subtype"] = subtype
    return sec


def classify_part_b(g):
    if g.get("order"):
        return "ordering"
    if any(q.get("stem") for q in g["questions"]):
        return "matching"
    options = list(g.get("options", {}).values())
    avg = sum(len(o) for o in options) / max(1, len(options))
    return "heading" if avg < 70 else "gap_fill"


def from_struct(year, src):
    path = os.path.join(src, "structured-kaoyan-english", "data", f"{year}-1", f"{year}-1.json")
    d = json.load(open(path, encoding="utf-8"))
    fixes = ANSWER_FIXES.get(year, {})
    out = []
    for s in d["sections"]:
        t = s["title"]
        groups = s["groups"]
        if "Use of English" in t:
            g = groups[0]
            qs = [{"n": q["number"], "options": opts(q["options"]),
                   "answer": fixes.get(q["number"], q["answer"]), "score": 0.5} for q in g["questions"]]
            out.append(section("cloze", [{"id": "cloze", "title": "Use of English",
                                          "passage": [join_wrapped(p) for p in g["passage"]],
                                          "questions": qs}], clean_directions(s.get("instructions"))))
        elif "Part A" in t and "Reading" in t:
            gs = []
            for i, g in enumerate(groups, 1):
                qs = [{"n": q["number"], "stem": join_wrapped(q.get("stem", "")), "options": opts(q["options"]),
                       "answer": fixes.get(q["number"], q["answer"]), "score": 2} for q in g["questions"]]
                gs.append({"id": f"text{i}", "title": f"Text {i}",
                           "passage": [join_wrapped(p) for p in g["passage"]], "questions": qs})
            out.append(section("readingA", gs, clean_directions(s.get("instructions"))))
        elif "Part B" in t and "Reading" in t:
            g = groups[0]
            sub = classify_part_b(g)
            grp = {"id": "partB", "title": "Part B", "options": opts(g.get("options", {})), "questions": []}
            if g.get("passage"):
                grp["passage"] = [join_wrapped(p) for p in g["passage"]]
            if sub == "ordering":
                grp["order"] = [{"n": o["number"]} if "number" in o else {"given": o["given"]} for o in g["order"]]
            for q in g["questions"]:
                item = {"n": q["number"], "answer": fixes.get(q["number"], q["answer"]), "score": 2}
                if q.get("stem"):
                    item["stem"] = q["stem"].strip()
                grp["questions"].append(item)
            directions = clean_directions(s.get("instructions"))
            out.append(section("readingB", [grp], directions, sub))
        elif "Part C" in t:
            g = groups[0]
            qs = [{"n": q["number"], "text": join_wrapped(q.get("stem", "")), "score": 2} for q in g["questions"]]
            out.append(section("translation", [{"id": "partC", "title": "Part C",
                                                "passage": [join_wrapped(p) for p in g["passage"]],
                                                "questions": qs}], clean_directions(s.get("instructions"))))
        elif "Writing" in t:
            sid = "writingA" if "Part A" in t else "writingB"
            g = groups[0]
            q = g["questions"][0]
            item = {"n": q["number"], "prompt": clean_writing_prompt(q.get("stem", "")), "score": q.get("score", 10 if sid == "writingA" else 20)}
            imgs = []
            for rel in g.get("images", []) or []:
                srcimg = os.path.join(os.path.dirname(path), rel)
                name = f"{year}-q{q['number']}{os.path.splitext(rel)[1]}"
                os.makedirs(OUT_IMG, exist_ok=True)
                shutil.copyfile(srcimg, os.path.join(OUT_IMG, name))
                imgs.append(f"data/img/{name}")
            if imgs:
                item["images"] = imgs
            out.append(section(sid, [{"id": sid, "title": "Writing", "questions": [item]}]))
    return out


def split_sentences_into_paragraphs(sentences, block_starts):
    """Group xixi sentence lines into paragraphs using the ESQ block start fingerprints."""
    def fp(s):
        return re.sub(r"[^a-z]", "", s.lower())[:24]
    starts = [fp(b) for b in block_starts]
    paras, cur = [], []
    for sent in sentences:
        f = fp(sent)
        if cur and any(f and (f.startswith(st[:16]) or st.startswith(f[:16])) for st in starts if st):
            paras.append(" ".join(cur))
            cur = []
        cur.append(sent.strip())
    if cur:
        paras.append(" ".join(cur))
    return paras


def from_2026(src):
    x = json.load(open(os.path.join(src, "kaoyan-english", "public", "data", "papers", "2026.json"), encoding="utf-8"))
    esq = json.load(open(os.path.join(src, "esq", "e1", "papers", "2026.json"), encoding="utf-8"))
    tasks = x["tasks"]
    units = esq["units"]

    def esq_starts(i):
        return [re.sub(r"\{\{blank:\d+\}\}", "", b["text"]).strip() for b in units[i]["passage"]["blocks"]]

    def xopts(q):
        o = {}
        for item in q["options"]:
            m = re.match(r"\s*([A-H])\)\s*(.*)", item, re.S)
            if m:
                o[m.group(1)] = clean_inline(m.group(2))
        return o

    out = []
    # Cloze
    t = tasks[0]["detail"]
    lines = [l for l in t["cloze_formatted_article"].split("\n") if l.strip()]
    lines = [re.sub(r"\[\s*(\d+)\s*\]", r"{{\1}}", l) for l in lines]
    paras = split_sentences_into_paragraphs(lines, esq_starts(0))
    qs = [{"n": q["id"], "options": xopts(q), "answer": q["answer"], "score": 0.5} for q in t["questions"]]
    out.append(section("cloze", [{"id": "cloze", "title": "Use of English",
                                  "passage": [clean_inline(p) for p in paras], "questions": qs}]))
    # Reading A
    gs = []
    for i in range(1, 5):
        t = tasks[i]["detail"]
        lines = [l for l in t["article"].split("\n") if l.strip()]
        paras = split_sentences_into_paragraphs(lines, esq_starts(i))
        qs = [{"n": q["id"], "stem": clean_inline(q["text"]), "options": xopts(q), "answer": q["answer"], "score": 2}
              for q in t["questions"]]
        gs.append({"id": f"text{i}", "title": f"Text {i}", "passage": [clean_inline(p) for p in paras], "questions": qs})
    out.append(section("readingA", gs))
    # Part B (ordering)
    t = tasks[5]["detail"]
    options = {}
    for line in t["article"].split("\n"):
        m = re.match(r"\s*([A-H])\)\s*(.*)", line)
        if m:
            options[m.group(1)] = clean_inline(m.group(2))
    order = []
    for slot in units[5]["fixed_slots"]:
        order.append({"given": slot["label"]} if slot["type"] == "fixed" else {"n": slot["number"]})
    grp = {"id": "partB", "title": "Part B", "options": options, "order": order,
           "questions": [{"n": q["id"], "answer": q["answer"], "score": 2} for q in t["questions"]]}
    out.append(section("readingB", [grp], join_wrapped(t["directions"]), "ordering"))
    # Translation: underline offsets from the translation passage file
    tp = json.load(open(os.path.join(src, "kaoyan-english", "public", "data", "translation", "passages", "2026.json"), encoding="utf-8"))
    content, segs = tp["content"], json.loads(tp["segments"])
    marked, last = "", 0
    for sg in sorted(segs, key=lambda s: s["start"]):
        marked += content[last:sg["start"]] + "<u>" + content[sg["start"]:sg["end"]] + "</u>"
        last = sg["end"]
    marked += content[last:]
    paras = [clean_inline(p) for p in marked.split("\n\n") if p.strip()]
    qs = [{"n": sg["no"], "text": clean_inline(content[sg["start"]:sg["end"]]) + ".", "score": 2}
          for sg in sorted(segs, key=lambda s: s["no"])]
    out.append(section("translation", [{"id": "partC", "title": "Part C", "passage": paras, "questions": qs}]))
    # Writing
    wa = tasks[7]["detail"]["question_prompt"]
    out.append(section("writingA", [{"id": "writingA", "title": "Writing", "questions": [
        {"n": 51, "prompt": clean_writing_prompt(wa), "score": 10}]}]))
    wb = tasks[8]["detail"]["question_prompt"]
    out.append(section("writingB", [{"id": "writingB", "title": "Writing", "questions": [
        {"n": 52, "prompt": clean_writing_prompt(wb), "score": 20}]}]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.environ.get("SRC", os.path.join(ROOT, "_sources")))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("years", nargs="*", type=int)
    a = ap.parse_args()
    years = a.years or list(range(2010, 2027))
    os.makedirs(OUT_PAPERS, exist_ok=True)
    for y in years:
        dest = os.path.join(OUT_PAPERS, f"{y}.json")
        if os.path.exists(dest) and not a.force:
            print(f"skip {y}: {dest} exists (use --force)")
            continue
        sections = from_2026(a.src) if y == 2026 else from_struct(y, a.src)
        paper = {
            "id": str(y),
            "year": y,
            "title": f"{y}年全国硕士研究生招生考试 英语（一）",
            "duration": 180,
            "sections": sections,
        }
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(paper, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("wrote", dest)


if __name__ == "__main__":
    sys.exit(main())
