# Reading Room

A static reader for desktop and mobile. Open a classic from the shelf or import a DRM-free EPUB or UTF-8 TXT file up to 24 MB. Tap a word to look it up in place, or use **Look up a word** with a keyboard. **Listen** starts browser narration from the first visible paragraph. Use **Contents** to jump to a different section and **Aa** to adjust the text size, theme, or voice.

Use **Find** to search every chapter in a book and jump to a matching passage. **Bookmarks** saves the current paragraph with an optional note. The reader and library show your position as a percentage of the book. **Save for offline reading** in the library caches the app, three classics, and English dictionary on supported browsers.

## Host on GitHub Pages

1. Create a public GitHub repository and upload the contents of this folder to its default branch. Keep the `books/` directory intact and place `index.html` at the repository root.
2. Open **Settings → Pages**. Select **Deploy from a branch**, choose the default branch and **/(root)**, then save.
3. Open the live URL shown in Pages after deployment.

There is no build step. To preview locally, run `python -m http.server 8000` in this folder and visit `http://localhost:8000`.

## Books and data

- The built-in editions come from Project Gutenberg via GITenberg. The unmodified source text, credits, and terms are included in each file. [The Secret Garden](https://www.gutenberg.org/ebooks/113), [Alice’s Adventures in Wonderland](https://www.gutenberg.org/ebooks/11), and [The Adventures of Sherlock Holmes](https://www.gutenberg.org/ebooks/1661).
- Imported books, reading positions, bookmarks, preferences, and saved words are stored in the current browser. They do not automatically sync. Clear site data to remove them.
- English lookup uses the bundled dictionary. It needs no external service and sends no words or passages to one. The standalone HTML contains the data, and the GitHub version loads `dictionary.json.gz` from the same site.
- Dictionary data adapted from [Open English WordNet](https://github.com/globalwordnet/english-wordnet) (noun definitions, CC BY 4.0) and [Princeton WordNet 3.0](https://wordnet.princeton.edu/) (verb, adjective, and adverb definitions and inflected forms). The reader selects and compresses entries from these projects and adds a few plain-language definitions for common words in the included books. See the included [licenses](licenses/).
- Narration uses the browser’s speech engine. Voice availability and whether narration continues while the phone is locked depend on the browser and operating system.
- EPUB imports extract readable text in spine order. Text-to-speech and word lookups require selectable text. PDF, scanned pages, and DRM-protected content are outside this version’s supported formats.
