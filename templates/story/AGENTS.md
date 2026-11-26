# {{title}}

This folder is a local workspace for the Literary Universe story "{{title}}"
(id `{{id}}`), set up by `lu init story`. The author owns the story; you help
with their writing.

## Files

- `Story.md`: the story's details. The body is the description; `title`,
  `genres`, `tags`, `rating` and `license` in the frontmatter can be edited.
- `01 Title.md`, `02 Title.md`, ...: one note per chapter, in reading order.
  A translation is `01 Title.<language>.md`, for example `01 Title.cs.md`. The
  body is the chapter text. Changing `title` renames the chapter; changing
  `sequence` (from 1) moves it.
- `.lu/vault.json`: which story and deployment this folder syncs with. Never
  edit it.
- `.claude/skills/`: writing skills (story review, continuity check, world
  rules). Stylistic and editorial guidance belongs there, not here.

Notes without `lu_kind` in their frontmatter are not synced; the author can
keep their own notes here.

## Working loop

For every CLI command below, append `--url` with the deployment URL in the
`literary-universe` server's arguments in `.mcp.json`, even when `LU_BASE_URL`
is set. The MCP server already includes this option.

1. `lu sync` before you start, so the notes match Literary Universe.
2. Edit the notes.
3. `lu status` lists what the next sync will push, without contacting the
   server.
4. `lu sync` again when you are done. It saves your edits on Literary
   Universe as drafts and brings in changes made there.

## Editing notes

- Edit the body and the frontmatter fields without the `lu_` prefix. Never
  edit, add or remove a `lu_*` field; sync keeps its state there.
- A new chapter is a new note in this folder with `lu_kind: chapter` and a
  `title` in its frontmatter and the text as its body. The next sync appends
  it to the story and renames the note.
- When a note was edited here while its chapter also changed on Literary
  Universe, sync keeps the note and writes the Literary Universe version beside
  it as `<name> (Literary Universe).md`. Merge the two into the note by hand
  (ask the author when the changes overlap), then delete the copy. The note is
  not pushed while the copy exists.
- Deleting a note deletes nothing on Literary Universe; the next sync brings
  it back. Removing a chapter needs `lu chapter remove` and the author's
  go-ahead.

## Overview notes

The author's intent for the story lives in its overview notes, the Overview
page of the workshop: `concept`, `settings`, `theme`, `impact`, `outcome`,
`audience`, `audienceAgeGroup`, `audienceSex`, `pitch` and `notes`. The
in-app AI Assistant reads them too. They are not notes in this folder and
`lu sync` does not carry them.

- `lu story notes {{id}}` prints them as JSON; each note is Markdown, `null`
  when empty.
- `lu story notes update {{id}} --concept "..." --theme "..."` changes the
  notes given and leaves the others. Every note has an option
  (`--audience-age-group`, `--audience-sex`, ...). An empty text empties a
  note. A text that starts with a dash, such as a Markdown list, needs the
  `--option=value` form or the file below.
- For longer text, save the printed JSON to a file, edit it, and send it with
  `lu story notes update {{id}} --file notes.json`. Its `version` guards
  against notes changed on Literary Universe meanwhile (`VERSION_CONFLICT`:
  read again and merge).

Read them before giving feedback or planning. Change them only when the
author settled the wording with you; they are the author's own statement of
intent.

## AI disclosure

Readers see which texts an AI wrote. Whenever you write or rewrite text in a
chapter note or in `Story.md`, set `ai_model: <your exact model id>` (for
example `ai_model: claude-opus-5-5`) in that note's frontmatter before you run
`lu sync`. Never remove an `ai_model` that is already there. When you write
through the CLI or the MCP server instead, pass `--ai-model <your model id>`
(`lu save`, `lu create`, `lu story update`) or `aiModel` with every write.

## Rules

- Never publish or release anything without the author's explicit go-ahead in
  this conversation. `lu sync` saves drafts, and saving a draft is not
  publishing.
- The `literary-universe` MCP server (`.mcp.json`) offers the same operations
  as the CLI, plus story, universe and encyclopedia lookups. Its publish tools
  need `confirm: true`; without it they only report what would be published.
- Keep the author's voice. Diagnose and suggest; rewrite only when asked.
