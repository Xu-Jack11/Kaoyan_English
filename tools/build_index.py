#!/usr/bin/env python3
"""Validates data/papers/*.json + data/explanations/*.json and writes data/index.json.

Run after editing any paper or explanation file:
    python3 tools/build_index.py          # validate + write index
    python3 tools/build_index.py --check  # validate only (non-zero exit on problems)
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAPERS = os.path.join(ROOT, "data", "papers")
EXPL = os.path.join(ROOT, "data", "explanations")

EXPECTED = {"cloze": range(1, 21), "readingA": range(21, 41), "readingB": range(41, 46),
            "translation": range(46, 51), "writingA": [51], "writingB": [52]}
SECTION_SCORE = {"cloze": 10, "readingA": 40, "readingB": 10, "translation": 10, "writingA": 10, "writingB": 20}


def validate_paper(p, problems):
    y = p["year"]
    seen = []
    total = 0
    for sec in p["sections"]:
        sid = sec["id"]
        nums = [q["n"] for g in sec["groups"] for q in g["questions"]]
        if list(nums) != list(EXPECTED[sid]):
            problems.append(f"{y} {sid}: question numbers {nums}")
        score = sum(q["score"] for g in sec["groups"] for q in g["questions"])
        if abs(score - SECTION_SCORE[sid]) > 1e-9:
            problems.append(f"{y} {sid}: score {score} != {SECTION_SCORE[sid]}")
        total += score
        seen += nums
        for g in sec["groups"]:
            text = " ".join(g.get("passage", []))
            if sec["type"] == "cloze":
                blanks = [int(x) for x in re.findall(r"\{\{(\d+)\}\}", text)]
                if blanks != nums:
                    problems.append(f"{y} cloze blanks {blanks}")
            for q in g["questions"]:
                if sec["type"] in ("cloze", "reading"):
                    if sorted(q["options"]) != ["A", "B", "C", "D"]:
                        problems.append(f"{y} Q{q['n']}: options {sorted(q['options'])}")
                    if q["answer"] not in q["options"]:
                        problems.append(f"{y} Q{q['n']}: answer {q['answer']}")
                    for k, v in q["options"].items():
                        if not v.strip():
                            problems.append(f"{y} Q{q['n']}: empty option {k}")
                if sec["type"] == "reading" and not q.get("stem", "").strip():
                    problems.append(f"{y} Q{q['n']}: empty stem")
                if sec["type"] == "partB":
                    if q["answer"] not in g["options"]:
                        problems.append(f"{y} Q{q['n']}: answer {q['answer']} not in options")
                    if sec.get("subtype") == "matching" and not q.get("stem", "").strip():
                        problems.append(f"{y} Q{q['n']}: matching item without text")
            if sec["type"] == "partB":
                sub = sec.get("subtype")
                answers = [q["answer"] for q in g["questions"]]
                if len(set(answers)) != len(answers):
                    problems.append(f"{y} Part B duplicate answers {answers}")
                if sub in ("gap_fill", "heading"):
                    slots = [int(x) for x in re.findall(r"\{\{(\d+)\}\}", text)]
                    if slots != nums:
                        problems.append(f"{y} Part B slots {slots}")
                if sub == "ordering":
                    order_nums = [o["n"] for o in g["order"] if "n" in o]
                    givens = [o["given"] for o in g["order"] if "given" in o]
                    if order_nums != nums:
                        problems.append(f"{y} Part B order slots {order_nums}")
                    if set(givens) & set(answers):
                        problems.append(f"{y} Part B given/answer overlap")
            if sec["type"] == "translation":
                u = len(re.findall(r"<u>", text))
                if u != len(nums):
                    problems.append(f"{y} translation underlines {u}")
                segs = re.findall(r"<u>(.*?)</u>", text)
                for q, sgm in zip(g["questions"], segs):
                    if re.sub(r"\W", "", sgm)[:30] != re.sub(r"\W", "", q["text"])[:30]:
                        problems.append(f"{y} Q{q['n']}: underline text differs from question text")
            if sec["type"] == "writing":
                for q in g["questions"]:
                    for img in q.get("images", []):
                        if not os.path.exists(os.path.join(ROOT, img)):
                            problems.append(f"{y} Q{q['n']}: missing image {img}")
    if seen != list(range(1, 53)):
        problems.append(f"{y}: question sequence incomplete")
    if abs(total - 100) > 1e-9:
        problems.append(f"{y}: total score {total}")


def validate_expl(p, e, problems):
    y = p["year"]
    nums = {q["n"]: sec for sec in p["sections"] for g in sec["groups"] for q in g["questions"]}
    count = 0
    for k, v in e.get("questions", {}).items():
        n = int(k)
        if n not in nums:
            problems.append(f"{y} explanation for unknown Q{n}")
            continue
        sec = nums[n]
        if sec["type"] == "translation":
            ok = isinstance(v, dict) and v.get("ref") and v.get("analysis")
        elif sec["type"] == "writing":
            ok = isinstance(v, dict) and v.get("sample") and v.get("analysis")
        else:
            ok = isinstance(v, str) and len(v) > 20
        if not ok:
            problems.append(f"{y} Q{n}: incomplete explanation")
        else:
            count += 1
    return count


def main():
    check_only = "--check" in sys.argv
    problems = []
    papers = []
    for name in sorted(os.listdir(PAPERS), reverse=True):
        if not name.endswith(".json"):
            continue
        p = json.load(open(os.path.join(PAPERS, name), encoding="utf-8"))
        validate_paper(p, problems)
        ep = os.path.join(EXPL, name)
        explained = 0
        topics = []
        if os.path.exists(ep):
            e = json.load(open(ep, encoding="utf-8"))
            explained = validate_expl(p, e, problems)
            topics = e.get("topics", [])
        partb = next(s for s in p["sections"] if s["id"] == "readingB")["subtype"]
        papers.append({"id": p["id"], "year": p["year"], "title": p["title"], "partB": partb,
                       "questions": 52, "explained": explained, "topics": topics})
    for pr in problems:
        print("PROBLEM:", pr)
    if not check_only:
        with open(os.path.join(ROOT, "data", "index.json"), "w", encoding="utf-8") as f:
            json.dump({"papers": papers}, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"wrote data/index.json ({len(papers)} papers, {sum(p['explained'] for p in papers)} explanations)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
