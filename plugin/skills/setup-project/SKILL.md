---
name: setup-project
description: Set up a Literary Universe writing project. Connect the account, choose or create the story, and in Claude Code make a local folder that syncs with it. Use when the author wants to start working on a story, comic or universe with Claude.
---

# Set up a writing project

A project is one story or comic on Literary Universe, optionally mirrored in a
local folder. Setup is done when the author has confirmed the work and holds
the project brief.

1. **Connect.** Call `get-identity`. On a sign-in error, ask the author to
   connect the `literary-universe` server (`/mcp` in Claude Code, the
   connector settings elsewhere) and continue once it answers. Passwords and
   keys stay out of the chat.
2. **Choose the work.** `list-stories`, `list-comics` and `list-universes`
   show what the account can write. Confirm an existing work by title. For a
   new story follow "New story" in the `manuscript` skill; for a new comic,
   the `comics` skill.
3. **Choose where the text lives.** Without a shell (claude.ai, Cowork), the
   drafts on Literary Universe are the working copy: read with
   `get-chapter-draft`, save with `save-chapter-draft`. With a shell (Claude
   Code), offer the local folder below.
4. **Hand over the project brief:** title, story ID, universe ID if any,
   manuscript language, `https://literaryuniverse.com/workshop/story/<story-id>`,
   and the author's standing wishes (voice, what to leave alone). In a local
   folder, append it to `CLAUDE.md`. Elsewhere, give it as text the author
   can save as their Claude Project's instructions, so later chats start
   from it.

## Local folder

```sh
npm install --global @literary-universe/cli   # Node 26 or later
lu login                                      # opens the browser
lu init STORY_ID --directory ./my-story
```

Run these with the author's consent. `lu login` is its own sign-in, separate
from Claude's connection. `lu init` takes an existing prose story, so create a
new one first (step 2).

Then the author opens Claude in the new folder. Its `AGENTS.md` carries the
working loop: `lu refresh`, edit `chapters/*.md`, `lu status`, `lu push`. The
folder starts a second `literary-universe` server (`lu mcp`) with the same
tools plus the ones that read local files: `set-cover`, `upload-comic-pages`
and `replace-comic-page-image`. Inside the folder, change chapter text through
the files and `lu push`, so folder and server stay in step.
