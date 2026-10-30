# {{title}}

This folder is a local workspace for the Literary Universe story "{{title}}"
(id `{{id}}`), created by `lu init`. The author owns the story; you help with
their writing.

## Files

- `chapters/*.md`: the chapter drafts, one per chapter and language. These are
  the files to edit. The YAML frontmatter (`id`, `title`, `language`,
  `version`) is managed; edit only the text below it.
- `chapters/chapter-*.json` and `.lu/`: managed copies and the project
  manifest. Never edit them by hand.
- `.claude/skills/`: writing skills (story review, continuity check, world
  rules). Stylistic and editorial guidance belongs there, not here.

## Working loop

For every CLI command below, append `--url` with the deployment URL in the
`literary-universe` server's arguments in `.mcp.json`, even when `LU_BASE_URL`
is set. The MCP server already includes this option.

1. `lu refresh` before starting work, so the drafts match the server.
2. `lu status` to see which chapters changed locally and in which form.
3. Edit the Markdown files.
4. `lu push` to save the drafts as new versions on Literary Universe.

A chapter whose `.md` and `.json` both changed is ambiguous and is not pushed;
revert one of the two files first.

## Rules

- Never publish anything without the author's explicit go-ahead in this
  conversation. Saving a draft is not publishing.
- The `literary-universe` MCP server (`.mcp.json`) offers the same operations
  as the CLI, plus story, universe and encyclopedia lookups. Its
  `publish-chapter` tool needs `confirm: true`; without it the tool only reports
  what would be published.
- Keep the author's voice. Diagnose and suggest; rewrite only when asked.
