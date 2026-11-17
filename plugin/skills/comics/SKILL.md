---
name: comics
description: Create and manage Literary Universe comics, manga and webtoons, covering the comic, its chapters, page order, alt text, lettering layers and publication. Use when the author works on a comic rather than a prose story.
---

# Comics

Run the `manuscript` skill's loop: read, show the change, act on approval,
read back.

- **Create:** `create-comic` takes a title, description, `format` (`manga`
  reads right to left, `webtoon` scrolls vertically, `comic` reads left to
  right) and the author's own choice of license and AI disclosure. Each call
  creates another comic, so check `list-comics` after an uncertain response.
  `create-comic-chapter` appends a draft chapter.
- **Pages:** page images upload from local files. `upload-comic-pages` and
  `replace-comic-page-image` therefore exist only in a local folder's
  `lu mcp` server, next to `lu comic upload CHAPTER_ID --directory ./pages`.
  Without a shell, the author uploads pages in the workshop on the website,
  and you order them (`reorder-comic-pages`), describe them
  (`update-comic-page` sets the alt text: what the page shows) and letter
  them.
- **Lettering:** `list-comic-pages` returns each page with its layers.
  `create-comic-layer` adds `text` (speech and captions) or `sfx` items in
  one language, positioned in fractions of the page. `update-comic-layer`
  replaces every item of a layer, so send them all, each with its id.
- **Publishing:** `publish-comic-chapter` with `confirm: true`, on the
  author's explicit go-ahead for that chapter. Publishing a live chapter
  again releases later page edits; the first chapter also publishes the
  comic.

`remove-comic-chapter`, `remove-comic-page` and `remove-comic-layer` delete
for good. Name what goes with them when you ask.
