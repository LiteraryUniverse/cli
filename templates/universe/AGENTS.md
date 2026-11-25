# {{title}}

This folder is a local workspace for the Literary Universe universe "{{title}}"
(id `{{id}}`), set up by `lu init universe`. The author owns the universe; you
help with their writing and worldbuilding.

## Files

- `Universe.md`: the universe's details. The body is the description;
  `title`, `genre`, `rating` and `license` in the frontmatter can be edited.
  `Universe.<language>.md` holds a translation's title and description.
- `Series.md`: the reading orders of the stories. Read only.
- `Stories/<title>/Story.md`: a story's details. The body is the description;
  `title`, `genres`, `tags`, `rating` and `license` can be edited.
- `Stories/<title>/01 Title.md`: one note per chapter, in reading order. A
  translation is `01 Title.<language>.md`, for example `01 Title.cs.md`. The
  body is the chapter text. Changing `title` renames the chapter; changing
  `sequence` (from 1) moves it.
- `Encyclopedia/<category>/<name>.md`: one note per encyclopedia entry; a
  translation is `<name>.<language>.md`.
- `Comics/<title>.md`: a comic's details. Read only.
- `.lu/vault.json`: which universe and deployment this folder syncs with.
  Never edit it.
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
- `Series.md` and the notes in `Comics/` are rewritten by every sync. Change
  series with `lu series save` and comics with `lu comic` commands.
- A new chapter is a new note in the story's folder, next to its `Story.md`,
  with `lu_kind: chapter` and a `title` in its frontmatter and the text as its
  body. The next sync appends it to the story and renames the note. A new
  story starts with `lu story create --universe {{id}}`, then `lu sync`.
- An entry's body is its summary, then one `## Field` section per text field;
  a private field's heading ends with `(private)`, as in
  `## Secrets (private)`. In the frontmatter, `name`, `pronunciation` and
  `tags` can be edited, and `parent` and `related` are wikilinks to other
  entries: `parent: "[[Name]]"`, `related: ["[[One]]", "[[Two]]"]`. The
  folder is the entry's category; moving the note to another category folder
  moves the entry. Fields that are not text stay on Literary Universe.
- A new entry is a new note in `Encyclopedia/<category>/` with
  `lu_kind: entry` in its frontmatter. Its file name is its name, unless
  `name` says otherwise. The category must exist in the universe. Sync creates
  it as a draft.
- When a note was edited here while its item also changed on Literary
  Universe, sync keeps the note and writes the Literary Universe version beside
  it as `<name> (Literary Universe).md`. Merge the two into the note by hand
  (ask the author when the changes overlap), then delete the copy. The note is
  not pushed while the copy exists.
- Deleting a note deletes nothing on Literary Universe; the next sync brings
  it back. Removing chapters or entries needs `lu chapter remove` or
  `lu entry delete` and the author's go-ahead.

## Universe notes and story overview notes

The author's intent lives in two sets of planning notes that the in-app AI
Assistant reads too. They are not notes in this folder and `lu sync` does not
carry them.

- Universe notes, the workshop's Universe notes page: `overview`,
  `foundation`, `society`, `conflicts`, `keyLocations`, `storyHooks` and
  `notes`. `lu universe notes {{id}}` prints them as JSON; each note is
  Markdown, `null` when empty.
  `lu universe notes update {{id}} --overview "..." --story-hooks "..."`
  changes the notes given and leaves the others.
- A story's overview notes, the workshop's Overview page: `concept`,
  `settings`, `theme`, `impact`, `outcome`, `audience`, `audienceAgeGroup`,
  `audienceSex`, `pitch` and `notes`. `lu story notes <story-id>` prints them
  and `lu story notes update <story-id> --concept "..."` changes them. The
  story's id is `lu_id` in its `Story.md`.
- Every note has an option (`--key-locations`, `--audience-age-group`, ...).
  An empty text empties a note. A text that starts with a dash, such as a
  Markdown list, needs the `--option=value` form or a file. For longer text,
  save the printed JSON to a file, edit it, and send it with
  `--file notes.json`. Its `version` guards
  against notes changed on Literary Universe meanwhile (`VERSION_CONFLICT`:
  read again and merge).

Read them before giving feedback or planning. Change them only when the
author settled the wording with you; they are the author's own statement of
intent.

## AI disclosure

Readers see which texts an AI wrote. Whenever you write or rewrite text in a
chapter, entry, story or universe note, set
`ai_model: <your exact model id>` (for example `ai_model: claude-opus-5-5`) in
that note's frontmatter before you run `lu sync`. Never remove an `ai_model`
that is already there. When you write through the CLI or the MCP server
instead, pass `--ai-model <your model id>` (`lu save`, `lu create`,
`lu story update`, `lu universe update`, `lu entry create`, `lu entry update`)
or `aiModel` with every write.

## Rules

- Never publish or release anything without the author's explicit go-ahead in
  this conversation. `lu sync` saves drafts, and saving a draft is not
  publishing. Readers see an entry only once it is released
  (`lu entry publish`); `lu_released` in its frontmatter shows what was
  released.
- The `literary-universe` MCP server (`.mcp.json`) offers the same operations
  as the CLI, plus lookups. Its publish tools need `confirm: true`; without it
  they only report what would be published.
- Keep the author's voice. Diagnose and suggest; rewrite only when asked.
