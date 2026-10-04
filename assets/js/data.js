// Loading papers/explanations and the paper model (parts, questions, grading).

const cache = new Map();

async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  });
  cache.set(url, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(url);
    throw e;
  }
}

export const loadIndex = () => getJSON('data/index.json');
export const loadPaper = (id) => getJSON(`data/papers/${id}.json`);
export async function loadExplanations(id) {
  try {
    return await getJSON(`data/explanations/${id}.json`);
  } catch {
    return null;
  }
}

export const OBJECTIVE = new Set(['cloze', 'reading', 'partB']);

export const SUBTYPE_CN = {
  gap_fill: '七选五',
  ordering: '段落排序',
  heading: '小标题匹配',
  matching: '观点匹配',
};

const PART_LABEL = {
  cloze: ['Use of English', '完形填空', '完形'],
  text1: ['Text 1', '阅读 Text 1', 'Text 1'],
  text2: ['Text 2', '阅读 Text 2', 'Text 2'],
  text3: ['Text 3', '阅读 Text 3', 'Text 3'],
  text4: ['Text 4', '阅读 Text 4', 'Text 4'],
  partB: ['Part B', '新题型', '新题型'],
  partC: ['Translation', '翻译', '翻译'],
  writingA: ['Writing A', '小作文', '小作文'],
  writingB: ['Writing B', '大作文', '大作文'],
};

/** A "part" is one navigable unit (a group): cloze, each reading text, Part B, Part C, each writing task. */
export function allParts(paper) {
  const parts = [];
  for (const sec of paper.sections) {
    for (const g of sec.groups) {
      const [en, cn, nav] = PART_LABEL[g.id] || [g.title, g.title, g.title];
      parts.push({
        id: g.id,
        section: sec,
        group: g,
        en,
        cn,
        nav,
        qNums: g.questions.map((q) => q.n),
      });
    }
  }
  return parts;
}

export function partsFor(paper, attempt) {
  const all = allParts(paper);
  return attempt.parts ? all.filter((p) => attempt.parts.includes(p.id)) : all;
}

export function sectionsFor(paper, attempt) {
  const parts = partsFor(paper, attempt);
  const ids = new Set(parts.map((p) => p.section.id));
  return paper.sections.filter((s) => ids.has(s.id));
}

export function questionMap(paper) {
  const m = new Map();
  for (const sec of paper.sections) for (const g of sec.groups) for (const q of g.questions) m.set(q.n, { q, g, sec });
  return m;
}

export function isAnswered(val) {
  return val != null && String(val).trim() !== '';
}

/** Grades one section for the parts included in the attempt. */
export function gradeSection(paper, attempt, sectionId) {
  const sec = paper.sections.find((s) => s.id === sectionId);
  const parts = partsFor(paper, attempt).filter((p) => p.section.id === sectionId);
  const qs = parts.flatMap((p) => p.group.questions);
  const objective = OBJECTIVE.has(sec.type);
  let score = 0;
  let max = 0;
  let correct = 0;
  let answered = 0;
  let pending = 0;
  for (const q of qs) {
    max += q.score;
    const a = attempt.answers[q.n];
    if (isAnswered(a)) answered++;
    if (objective) {
      if (a && a === q.answer) {
        score += q.score;
        correct++;
      }
    } else {
      const s = attempt.selfScores?.[q.n];
      if (s == null) pending++;
      else score += Number(s);
    }
  }
  return { sectionId, objective, score, max, correct, total: qs.length, answered, pending };
}

export function summarize(paper, attempt) {
  const rows = sectionsFor(paper, attempt).map((s) => ({ section: s, ...gradeSection(paper, attempt, s.id) }));
  const submitted = rows.filter((r) => attempt.submitted?.[r.sectionId]);
  const total = submitted.reduce((a, r) => a + r.score, 0);
  const max = rows.reduce((a, r) => a + r.max, 0);
  const objScore = submitted.filter((r) => r.objective).reduce((a, r) => a + r.score, 0);
  const objMax = rows.filter((r) => r.objective).reduce((a, r) => a + r.max, 0);
  const pending = submitted.reduce((a, r) => a + r.pending, 0);
  return { rows, total, max, objScore, objMax, pending };
}
