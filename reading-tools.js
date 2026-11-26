const progressIndexes = new WeakMap();

export function readingPercent(book, position, fraction = 0) {
  if (!progressIndexes.has(book)) {
    let total = 0;
    const sections = book.sections.map(section => section.paragraphs.map(text => {
      const start = total;
      total += text.length;
      return start;
    }));
    progressIndexes.set(book, { sections, total });
  }
  const { sections, total } = progressIndexes.get(book);
  const start = sections[position.chapter]?.[position.index];
  const length = book.sections[position.chapter]?.paragraphs[position.index]?.length;
  return start === undefined || !total ? 0 : Math.round((start + length * fraction) * 100 / total);
}

function normalizeQuotes(text) { return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); }

export function findPassages(book, query, limit = 50) {
  const literal = normalizeQuotes(query.trim()).replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  if (!literal) return { results: [], more: false };
  const matcher = new RegExp(literal, "iu");
  const results = [];
  for (const [chapter, section] of book.sections.entries()) {
    for (const [index, text] of section.paragraphs.entries()) {
      const hit = matcher.exec(normalizeQuotes(text));
      if (!hit) continue;
      if (results.length === limit) return { results, more: true };
      const start = hit.index;
      const end = start + hit[0].length;
      const head = Math.max(0, start - 58);
      const tail = Math.min(text.length, end + 76);
      results.push({
        chapter, index, start, end, title: section.title,
        before: (head ? "…" : "") + text.slice(head, start),
        match: text.slice(start, end),
        after: text.slice(end, tail) + (tail < text.length ? "…" : "")
      });
    }
  }
  return { results, more: false };
}
