---
name: setup-project
description: Set up a Literary Universe writing project. Connect the account, choose or create the story or universe, and in Claude Code make a local folder that syncs with it. Use when the author wants to start working on a story, comic or universe with Claude.
---

# Set up a writing project

A project is one story, comic or universe on Literary Universe, optionally
mirrored in a local folder. Setup is done when the author has confirmed the
work and holds the project brief.

1. **Connect.** Call `get-identity`. On a sign-in error, ask the author to
   connect the `literary-universe` server (`/mcp` in Claude Code, the
   connector settings elsewhere) and continue once it answers. Passwords and
   keys stay out of the chat.
2. **Choose the work.** `list-stories`, `list-comics` and `list-universes`
   show what the account can write. Confirm an existing work by title. For a
   new story follow "New story" in the `manuscript` skill; for a new
   universe, "New universe" in the `encyclopedia-edit` skill; for a new
   comic, the `comics` skill.
3. **Choose where the text lives.** Without a shell (claude.ai, Cowork), the
   drafts on Literary Universe are the working copy: read with
   `get-chapter-draft`, save with `save-chapter-draft`. With a shell (Claude
   Code), offer the local folder below.
4. **Hand over the project brief:** title, story or universe ID, manuscript
   language, the workshop link
   (`https://literaryuniverse.com/workshop/story/<story-id>` for a story),
   and the author's standing wishes (voice, what to leave alone). In a local
   folder, append it to `CLAUDE.md`. Elsewhere, give it as text the author
   can save as their Claude Project's instructions, so later chats start
   from it.

## Local folder

```sh
npm install --global @literary-universe/cli   # Node 26 or later
lu login                                      # opens the browser
lu init story STORY_ID --directory ./my-story
lu init universe UNIVERSE_ID --directory ./my-universe
```

Run these with the author's consent. `lu login` is its own sign-in, separate
from Claude's connection. Use `lu init story` for one story and
`lu init universe` for a whole universe: its details, every story with its
chapters and translations, the encyclopedia, series and comics. `lu init`
takes an existing work, so create a new one first (step 2). It also works in
a folder that already has files, such as an Obsidian vault: it leaves other
notes alone and writes only the files that are missing. Add `--language`
to sync only one language's editions.

The folder holds Markdown notes, the same format the Obsidian plugin uses:

- Story folder: `Story.md` and one note per chapter, `01 Title.md`, with
  translations as `01 Title.cs.md`.
- Universe folder: `Universe.md`, `Series.md`, `Stories/<title>/` with a
  story folder for each story, `Encyclopedia/<category>/<name>.md` and
  `Comics/<title>.md`.

Then the author opens Claude in the folder. Its `AGENTS.md` carries the
working loop: `lu sync`, edit the notes, `lu status`, `lu sync`; how to add
chapters and entries; how to resolve a conflict copy; and the AI disclosure:
whenever Claude writes or rewrites text in a note, it sets `ai_model` to its
exact model id in that note's frontmatter before syncing. The folder starts a
second `literary-universe` server (`lu mcp`) with the same tools plus the ones
that read local files: `set-cover`, `upload-comic-pages` and
`replace-comic-page-image`. Inside the folder, change text through the notes
and `lu sync`, so folder and server stay in step.

A folder made by an older `lu init` or by `lu pull` (with a `chapters/`
folder) keeps working with `lu refresh`, `lu status` and `lu push`. Running
`lu init story` for the same story there switches it to the notes format once
everything is pushed.
