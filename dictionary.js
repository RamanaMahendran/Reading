const partsOfSpeech = ["noun", "verb", "adjective", "adverb"];
let dictionaryPromise;

async function readDictionary() {
  const embedded = document.getElementById("embedded-dictionary");
  let bytes;
  if (embedded) {
    const binary = atob(embedded.textContent.trim());
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  } else {
    const response = await fetch("./dictionary.json.gz");
    if (!response.ok) throw new Error("Could not open the bundled dictionary.");
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const zipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const stream = new Blob([bytes]).stream();
  return new Response(zipped ? stream.pipeThrough(new DecompressionStream("gzip")) : stream).json();
}

function getDictionary() {
  dictionaryPromise ??= readDictionary().catch(error => {
    dictionaryPromise = null;
    throw error;
  });
  return dictionaryPromise;
}

function baseForms(word) {
  const candidates = new Set();
  const appendSuffix = (suffix, replacements) => {
    if (!word.endsWith(suffix)) return;
    const stem = word.slice(0, -suffix.length);
    for (const ending of replacements) candidates.add(stem + ending);
    if ((suffix === "ing" || suffix === "ed") && /([^aeiou])\1$/.test(stem)) {
      candidates.add(stem.slice(0, -1));
    }
  };
  if (word.includes("-")) candidates.add(word.replaceAll("-", " "));
  if (word.endsWith("'s")) candidates.add(word.slice(0, -2));
  appendSuffix("ies", ["y", "ie"]);
  appendSuffix("ves", ["f", "fe"]);
  appendSuffix("es", ["", "e"]);
  appendSuffix("s", [""]);
  appendSuffix("ing", ["", "e"]);
  appendSuffix("ied", ["y", "ie"]);
  appendSuffix("ed", ["", "e"]);
  appendSuffix("est", ["", "e"]);
  appendSuffix("er", ["", "e"]);
  return candidates;
}

export async function lookupOffline(word) {
  const { terms, glosses, forms } = await getDictionary();
  const entriesAt = (headword, part) => {
    if (!Object.hasOwn(terms, headword)) return [];
    return terms[headword].filter(id => part === undefined || id % 4 === part).slice(0, 6).map(id => ({
      part: partsOfSpeech[id % 4],
      text: glosses[Math.floor(id / 4)]
    }));
  };
  const inflections = Object.hasOwn(forms, word) ? forms[word] : [];
  const candidates = [[word], ...inflections, ...Array.from(baseForms(word), form => [form])];
  for (const [headword, part] of candidates) {
    const definitions = entriesAt(headword, part);
    if (definitions.length) return { word, headword, definitions };
  }
  return null;
}
