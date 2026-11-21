# Literary Universe CLI

Command line tools for authors and local agents using [Literary Universe](https://literaryuniverse.com).
Sign in from the browser, turn a story or a whole universe into a folder of
Markdown notes that `lu sync` keeps in step with Literary Universe in both
directions, create chapters, stories and universes, and publish or schedule an
edition. The folder is the same format the Obsidian plugin uses, and
`lu init` sets it up for Claude Code, Codex or T3 Code too, with writing skills
and an MCP server (`lu mcp`) for the same operations. Image preparation and authorized
uploads are also supported. Blog pages and menus can be read and authored with JSON requests. Document
imports remain to build.

The CLI uses the [TypeScript SDK](https://github.com/LiteraryUniverse/sdk-typescript)
and the same permissions as the web workshop. It targets Node 26 or later and Bun
on Linux, macOS and Windows.

Read the [documentation in our feedback knowledge base](https://literaryuniverse.com/feedback/help)
for Literary Universe help. The command examples below describe the implemented CLI.
Report CLI bugs in [this repository](https://github.com/LiteraryUniverse/cli/issues).

## Install

The CLI is published to npm as
[`@literary-universe/cli`](https://www.npmjs.com/package/@literary-universe/cli)
under the MIT license. Install it globally to get the `lu` command:

```sh
npm install --global @literary-universe/cli
lu --help
```

With Bun, use `bun add --global @literary-universe/cli`. To try it without
installing, run `npx @literary-universe/cli --help`. The package brings the
[SDK](https://www.npmjs.com/package/@literary-universe/sdk) and the image engine
with it; no Literary Universe source checkout is needed.

The CLI uses the published `@literary-universe/sdk` 0.6.0 package.

To build from source instead, clone this repository, run `npm ci && npm pack`,
and install the resulting tarball with `npm install --global`.

During development, run `npm run build`, then use `node dist/main.js` or
`bun dist/main.js` in place of `lu`.

If your Windows installation path contains `&`, use `lu.ps1` from PowerShell.
npm's generated `lu.cmd` wrapper does not quote that path correctly. Running the
installed `dist/main.js` directly with Node also works.

## Authentication and first sync

Sign in from the browser:

```sh
lu login
lu identity
```

`lu login` opens Literary Universe in your browser and prints the URL in case
the browser does not open. Allow the CLI there and it stores a session in the
OS credential store for the selected deployment. The access token lasts
a day and is refreshed on demand; the session itself lasts 90 days of use. The
CLI appears under Settings → API keys as a connected app, where you can revoke
it. `lu logout` revokes the session and removes it locally. Set `LU_BROWSER`
(or `BROWSER`) to a command that should receive the URL instead of the system
opener.

Concurrent CLI commands and MCP calls share a deployment-specific refresh lock.
The lock contains only the owner's process ID. If a process is force-killed
while refreshing, later calls report `AUTH_BUSY` with the lock path. Check its
`pid` file and remove the lock only after confirming that no LU process owns it.

API keys still work and suit automation. Create a personal API key in your Literary Universe account. Reads need
`story:read`; saving or creating chapters also needs `story:write`. Publication
requires the separate `story:publish` scope. Scopes do not grant access beyond
your current permissions or the key's selected resources.

An organization admin can instead create an organization key in the
organization's settings. With work scopes it acts as the organization on the
organization's own stories and universes, as an organization admin would, and
on nothing else; with `organization:read` alone it only reads the public
catalogue. Store it the same way.

Supply LU_TOKEN for automation. For interactive use, lu auth store reads a key
from that environment variable or stdin and saves it in the selected deployment's
OS credential store. Keys never belong in command arguments or project files.
Linux uses Secret Service through secret-tool, macOS uses Keychain, and Windows
uses Credential Manager. A missing/locked store reports KEYSTORE_UNAVAILABLE;
there is no automatic plaintext fallback. lu auth remove removes the local
entry; revoke the key on LU to invalidate it server-side.

In Windows PowerShell, use `$env:LU_BASE_URL` for the deployment. Read a key
without putting it in command history:

```powershell
$env:LU_BASE_URL = 'https://literaryuniverse.com'
$key = Read-Host 'LU API key' -AsSecureString
[System.Net.NetworkCredential]::new('', $key).Password | lu auth store
Remove-Variable key
lu identity
```

Save JSON as UTF-8. UTF-8 BOM and CRLF files are accepted. For a policy file in
Windows PowerShell, use `lu image policy | Out-File -Encoding utf8 .\policy.json`.

```sh
export LU_BASE_URL=https://literaryuniverse.com
lu identity
lu stories
lu init story STORY_ID --directory ./my-story
lu status --directory ./my-story
lu sync --directory ./my-story
```

Run `lu` after installing the package, or substitute
`node dist/main.js` or `bun dist/main.js` during development. Output is
JSON on stdout. Change summaries and errors use newline-delimited JSON on stderr;
failed or partially successful commands exit with status 1.

## Local folders

```sh
lu init story STORY_ID --directory ./my-story
lu init universe UNIVERSE_ID --directory ./my-universe
cd my-universe
claude        # or codex, or open the folder in T3 Code or Obsidian
```

`lu init story` sets up a folder for one story; `lu init universe` for a whole
universe: its details and translations, every story in it with all chapters in
every language, the encyclopedia with its translations, the series and the
comics. `--directory` defaults to the current folder and `--language` syncs
only that language's editions. A bare `lu init` or `lu init ID` asks in a
terminal whether to set up a story or a universe; without a terminal it fails
with `INIT_KIND_REQUIRED`.

`lu init` works in a folder that already has files, such as an Obsidian vault.
It writes `.lu/vault.json` (the deployment and the story or universe), runs the
first sync, and then writes the agent files below that are missing. It refuses
a folder bound to another story, universe or deployment. Running it again
syncs and writes only what is still missing; the report lists the sync result
and the files written.

A universe folder looks like this. A story folder is the content of one
`Stories/<title>/` folder at the root.

| Path | Content |
| --- | --- |
| `Universe.md`, `Universe.<lang>.md` | Universe details: frontmatter `title`, `genre`, `rating`, `license`; the body is the description. One file per translation. |
| `Series.md` | The reading orders. Read only. |
| `Stories/<title>/Story.md` | Story details: `title`, `genres`, `tags`, `rating`, `license`; the body is the description. |
| `Stories/<title>/01 Title.md`, `01 Title.<lang>.md` | One note per chapter and language. `title` renames the chapter, `sequence` (from 1) moves it. |
| `Encyclopedia/<category>/<name>.md`, `<name>.<lang>.md` | Entries: the summary, then a `## Field` section per text field (`## Field (private)` for private ones). `parent` and `related` are `[[wikilinks]]`; the folder is the category. |
| `Comics/<title>.md` | Comic details. Read only. |

Notes keep their sync state in `lu_*` frontmatter fields, which nobody should
edit; the body and the other fields are the author's. Notes can be renamed and
moved. Notes without `lu_kind` are left alone.

```sh
lu sync [--directory FOLDER]
lu status [--directory FOLDER]
```

`lu sync` pulls, then pushes, and prints `{created, updated, pushed,
conflicts, failures}` as JSON. Every write names the version it was based on,
so a sync never replaces work saved on Literary Universe meanwhile. It exits
with status 1 when the report holds conflicts or failures. `lu status` lists
what the next sync will push (`edited`, `new`, or `conflict`) without
contacting the server.

- A new note with `lu_kind: chapter` and a `title` in a story folder becomes a
  new chapter; one with `lu_kind: entry` in `Encyclopedia/<category>/` becomes
  a new draft entry.
- A note edited locally while its item changed on Literary Universe stays as
  it is; the server's version is written beside it as
  `<name> (Literary Universe).md`. Merge by hand and delete the copy; the note
  is not pushed while the copy exists.
- Deleting a note deletes nothing on Literary Universe; the next sync brings
  it back.
- `ai_model` in a note's frontmatter is sent with every write of that note and
  marks the text as written by that model.
- Syncing never publishes or releases anything.

`lu init` also writes the files a writing agent needs:

| File | Purpose |
| --- | --- |
| `AGENTS.md` | The folder layout, the sync, edit, status, sync loop, the AI disclosure rule (set `ai_model` in every note the agent writes), and the rule that the agent publishes nothing without the author's go-ahead. There is one version for story folders and one for universe folders. |
| `CLAUDE.md` | `@AGENTS.md`, so Claude Code reads the same instructions. |
| `.claude/skills/*/SKILL.md` | The `story-review`, `continuity-check` and `world-rules` writing skills. |
| `.mcp.json` | Starts `lu mcp` for Claude Code and T3 Code. |
| `.claude/settings.json` | Pre-approves the `literary-universe` MCP server for Claude Code (merged into an existing file). |
| `.codex/config.toml` | The same MCP server for Codex in a trusted folder. |
| `.gitignore` | Ignores `.lu/lock`. |

The folder becomes a git repository with an initial commit when `git` is
available and it is not already inside one. Both generated MCP configurations
include the deployment selected by `--url` or `LU_BASE_URL`. `lu sync` refuses
a folder set up for another deployment, so use that same option for CLI
commands in the folder. For existing configurations, include
`--url <deployment>` in the `lu mcp` arguments.

Agent setup:

- Claude Code and T3 Code read `.mcp.json`. Claude Code asks once to trust the
  folder; `.claude/settings.json` then enables the server without a prompt.
- Codex reads `.codex/config.toml` once the folder is trusted. For an untrusted
  folder, register the server globally: `codex mcp add literary-universe -- lu mcp`.
- For any other MCP client, run `lu mcp` as a stdio server. `--tools` or
  `LU_MCP_TOOLS` selects categories and tools, for example
  `lu mcp --tools stories,stories-write,publish`; `publish` is opt-in. The server
  logs to stderr only and answers tool calls with a sign-in hint until
  `lu login` has run (or `LU_TOKEN` is set).

## Claude plugin

The `plugin/` folder is a Claude plugin for writing on Literary Universe from
Claude: on claude.ai, in the desktop app and in Claude Code. It needs neither
the CLI nor a local folder. It connects Claude to the hosted MCP server at
`https://literaryuniverse.com/mcp` and adds these skills:

| Skill | Use |
| --- | --- |
| `setup-project` | Connect the account, choose or create the story or universe, and in Claude Code make a local folder with `lu init story` or `lu init universe`. |
| `manuscript` | Create a story, bring text in as chapter drafts, save revisions, reorder chapters, publish. |
| `encyclopedia-edit` | Create universes; add, change, translate and release encyclopedia entries; universe translations and series. |
| `comics` | Comics, manga and webtoons: chapters, page order, alt text, lettering. |
| `blog` | Blog pages, menus, translations and page publication, through the `lu` CLI in Claude Code. |
| `writing-feedback` | Proofreading, tone, consistency, developmental, dialogue and worldbuilding feedback. |
| `encyclopedia-check` | An entry checked against your chapters. Needs a plan that includes the universe assistant. |

The two feedback skills load the in-app assistant's instructions and context
from the server (`load-writing-skill`, `load-universe-skill`), so they follow
its changes without a plugin update. The others show you each change and wait
for your approval before saving it.

Install in Claude Code:

```
/plugin marketplace add LiteraryUniverse/cli
/plugin install literary-universe@literary-universe
```

On claude.ai or in the desktop app, open Customize → Plugins, add the
marketplace `LiteraryUniverse/cli` and install Literary Universe.

Then sign in: in Claude Code run `/mcp` and choose `literary-universe`;
elsewhere connect the plugin's Literary Universe connector. Literary Universe
opens in the browser and lists what Claude may do. The connection appears
under Settings → Integrations → API & Service Keys, where you can revoke it.

The plugin asks the server for every tool it has (`?tools=all,assistant`),
including `publish-chapter` and `publish-comic-chapter`. Those do nothing
without `confirm: true`, and the skills call them only on your go-ahead for
that chapter. Story creation and comic tools appear once the hosted server
runs an SDK release that has them.

For a local project, ask Claude Code to set one up (the `setup-project` skill
runs `lu login` and `lu init story` or `lu init universe`). In that folder the plugin's hosted server and
the folder's `lu mcp` server run side by side: the hosted one has the feedback
skills, the local one reads files for covers and comic pages.

Whenever the skills write text for you, they pass the AI disclosure with it.

## Legacy `lu pull` folders

```sh
lu pull STORY_ID --directory ./my-story
lu status --directory ./my-story
lu push --directory ./my-story
lu refresh --directory ./my-story
```

Folders made by `lu pull`, or by an earlier version of `lu init`, keep working with these
commands. In a folder set up for `lu sync`, `lu pull`, `lu push` and
`lu refresh` fail with `VAULT_FOLDER`; `lu status` shows the sync status there.
To switch a `lu pull` folder to notes, push its changes, then run
`lu init story STORY_ID` in it. The old `chapters/` folder stays and is no
longer synced; delete the old `AGENTS.md` first to get the new one.

The Markdown files are the server's own Markdown form of each draft. Pushing a
changed `.md` sends Markdown and the server converts it with the editor's
extensions; pushing a changed `.json` sends Tiptap JSON as before. A chapter
whose `.md` and `.json` both changed is reported with `source: "both"` by
`lu status` and refused by `lu push` as `AMBIGUOUS_CHANGE`; revert one file.
`lu refresh` re-pulls every chapter into an existing project and reports
added, updated and removed chapters; it refuses with `LOCAL_CHANGES` while
anything is unpushed.

Chapters contain canonical Tiptap JSON in chapters/chapter-ID.LOCALE.json and
their Markdown mirror in chapters/SEQ-TITLE.LOCALE.md.
The .lu directory holds the manifest, pulled snapshots and pending write intents.
Chapter filenames must be distinct ignoring case. Pull and project validation
reject collisions that would overwrite files on Windows or macOS.
Pull uses a new directory so it cannot overwrite existing local edits. Status is
offline and does not require credentials. Select the same deployment for push
that was used for pull; project metadata cannot silently redirect credentials.

Push validates every changed draft before writing. Each save uses its last-pulled
version and an operation ID persisted before dispatch. A lost response can be
resumed with the same command. Known rejected inputs can be corrected locally;
stale remote versions require another pull and resolution. The command reports
each successful save and any failure, preserving successful work and local edits.
Edits made locally while a request is in flight are retained for the next push.

For a single explicit edit:

```sh
lu draft CHAPTER_ID
lu save CHAPTER_ID --file chapter.json --expected-version VERSION --operation-id UNIQUE_ID [--ai-model MODEL]
lu recovery CHAPTER_ID --recovery-id RECOVERY_ID
```

The default draft write ceiling is 900,000 serialized UTF-8 bytes and the HTTP
request ceiling is 1 MiB. Larger drafts remain readable within SDK read limits.
Ordinary edit pushes use summaries/version checks; future import replacements
will use the separately approved replacement-plan workflow.

## Creation and publication

```sh
lu create STORY_ID --title "New chapter" --file chapter.json --operation-id CREATE_ID
lu publish CHAPTER_ID --expected-version VERSION --operation-id PUBLISH_ID
lu publish CHAPTER_ID --expected-version VERSION --operation-id PUBLISH_ID --at 2027-01-01T12:00:00Z
lu publish CHAPTER_ID --expected-version VERSION --operation-id BETA_ID --audience beta
```

Create appends a draft; the source file stays untouched. Omit --file to create an
empty draft and --title to use LU's localized title. --ai-generated marks the
new chapter; `--ai-model MODEL` marks it as written by that model. New translations are a later workflow; publication can select an
existing edition with --language.

Publishing requires a separately granted story:publish scope. It uses the exact
server version and a caller-supplied operation ID. Retry lost replies with the
same arguments and ID. Reader publication respects account/work restrictions;
beta publication preserves existing reader release dates. --at requires a time
with an explicit timezone. Chapter creation never publishes content.

The first original chapter publishes/schedules its story. Publish the parent
universe separately in LU; a story credential does not change universe visibility.
Revisions, listing updates and durable notification jobs commit together.
Publication uses the key's scope and the author's current work permissions.
Organization keys also require the organization's API feature and plan; no
deployment settings or actor allowlist is required.

## Curation

```sh
lu universe create --title "Deep Sea" --slug deep-sea --genre fantasy --rating teen --license cc-by --language en --description "An ocean world." [--ai-model MODEL]
lu story update STORY_ID --license cc-by-sa --universe UNIVERSE_ID
lu story update STORY_ID --title "Title" --genres fantasy,myth --standalone
lu story hide STORY_ID
lu story show STORY_ID
lu chapter rename CHAPTER_ID --title "Chapter One" [--language cs]
lu chapter reorder STORY_ID --chapters ID3,ID1,ID2
lu chapter remove CHAPTER_ID
lu universe update UNIVERSE_ID --title "Title" --slug title --genre myth
lu entries UNIVERSE_ID [--after CURSOR]
lu entry ENTRY_ID [--language en]
lu entry create UNIVERSE_ID --file entry.json
lu entry update ENTRY_ID --file changes.json --expected-version VERSION
lu entry translate ENTRY_ID --language en --file translation.json --expected-version VERSION
lu entry publish ENTRY_ID [--audience readers|beta] [--language cs] [--at 2027-01-01T12:00:00Z] [--expected-version VERSION] [--operation-id ID]
lu entry unpublish|delete ENTRY_ID
lu series UNIVERSE_ID
lu series save UNIVERSE_ID --title "Reading order" --stories ID1,ID2 --expected-version 0 [--series SERIES_ID]
```

Story and chapter changes need `story:write`; universe, encyclopedia and series
changes need `universe:write`, translations `universe:translate`.

`lu universe create` needs a verified account and a personal key without
resource restrictions; it creates an unpublished universe and returns its ID
and slug. Read the choices with `lu story creation-options`. It is never
retried: after a lost response, look for the slug with `lu universes` before
trying again.

`--ai-model MODEL` on `lu save`, `lu create`, `lu story update`,
`lu universe update`, `lu entry create` and `lu entry update` marks the text as
written by that model; readers see the disclosure. The API only sets the mark;
removing it is done in the workshop. Agents must pass it whenever they wrote
the text.

`--expected-version` on `lu story update`, `lu universe update`,
`lu entry update` and `lu entry translate` takes the `version` from `lu story`,
`lu universe` or `lu entry` (an entry has one per edition, listed in
`editions`). The write fails with `VERSION_CONFLICT` when the item changed
since. Only the
options you give change. Renames and reordering reach readers at once;
`--chapters` lists every chapter exactly once. Only a chapter that was never
published can be removed.
A story whose arcs or free preview count chapters keeps its structure.

Encyclopedia input is a JSON object, as the SDK's encyclopedia methods take it:

```json
{
  "name": "Captain Nemo",
  "categoryTitle": "Characters",
  "summary": "Commander of the Nautilus.",
  "fields": [{ "title": "Biography", "text": "Born a prince in India." }],
  "relatedAdd": ["Nautilus"]
}
```

Readers see released revisions of an entry, not the draft. `lu entry publish`
releases one edition (the original, or the translation given by `--language`)
to readers or, with `--audience beta`, to beta readers, now or at `--at`, which
needs a time with a timezone. Without `--expected-version` it reads the entry
and releases the edition's current version; the printed plan says so. Without
`--operation-id` it makes a new one and prints it in the plan; retry a lost
response with that ID. `lu entry unpublish` returns the entry and all its
translations to a draft.

New entries are drafts until released. A taken name fails with
CONFLICT. A translation names fields by their original titles and needs the
universe translated into that language first. `lu series save` takes the
version `lu series` reported, 0 for a new series, and fails with
VERSION_CONFLICT when the series changed meanwhile.

Every write prints its plan as JSON on stderr before sending it. Removals,
deletions, entry creation and series saves are never retried; run them again
only after checking the result.

## Development

```sh
npm ci
npm run typecheck
npm test
bun test test
```

The tests exercise CLI subprocesses, local files, lost replies, rejected/stale
writes, deployment/path guards, browser sign-in against a fake OAuth server
(`LU_BROWSER` points at a script that follows the authorization URL),
`lu init story` and `lu init universe` in a non-empty temporary folder,
`lu sync` and `lu status` against a fake server, the `lu mcp` handshake over stdio, and
installation into a clean packed consumer.
Live LU checks run from the [monorepo](https://github.com/StorytellerCZ/Literary-Universe)
with `node --experimental-strip-types app/scripts/testApiReadContract.mjs` and a
separate local replica-set database ending in `_test`. Draft writes use the
[SDK permission checks](https://github.com/LiteraryUniverse/sdk-typescript#versioned-draft-writes)
without deployment settings or an actor allowlist.

## Images

```sh
lu image policy > current-policy.json
lu image prepare --file original.png --purpose story-cover --output prepared.png --policy-file current-policy.json
lu image prepare --file original.png --purpose universe-cover --output square.webp --crop 0,100,800,800 --format webp
lu image upload CHAPTER_ID --file scene.png --purpose chapter-image --policy-version 1 --operation-id ASSET_ID
lu image cover story STORY_ID --file prepared.png
```

Preparation can run offline without a key, using the bundled policy when
--policy-file is omitted. It emits inspectable JSON with size, dimensions, digest
and warnings. The output path must be new; existing outputs and original files
are never overwritten. Crop coordinates refer to the oriented source image. A
required ratio mismatch fails until an explicit crop is supplied. Sharp runs in
a bounded subprocess on Node/Bun and preserves transparency.

Upload sends the exact prepared bytes. Keep that file, policy version, target and
operation ID to resume an interrupted upload. LU checks the current policy and
authorization; fetch a changed policy and prepare a new operation when required.
Uploads create public assets; changing published content is a separate
operation. `lu image cover story|universe|comic` replaces a cover directly; the server
crops it to the cover shape. Purpose/target mapping and finite quotas are documented in
the [SDK image reference](https://github.com/LiteraryUniverse/sdk-typescript#images). Body/decode limits apply in addition to the HTTP request timeout.

## Create a story

Read the deployment's supported languages, genres, ratings and licenses before
choosing metadata:

```sh
lu story creation-options
lu story create --title "Voyages" --slug voyages --description "At sea." --language en --genres fantasy --rating universal --license cc-by
```

Creation needs unrestricted personal `story:write` access and a verified account.
It creates an unpublished story and returns its ID and slug. Add `--universe ID`
to place it in a universe you may write into. AI-generated text requires
`--ai-generated --ai-model MODEL`; without `--ai-generated`, the story is recorded
as human-written. The deployment validates the metadata and placement rules.

Creation is never automatically retried. If the response is lost, find the chosen
slug with `lu stories` or in the workshop before trying again. `lu create STORY_ID`
still creates a chapter; use it with a stable operation ID to add manuscript text.
Publishing remains a separate command.

MCP clients can select `lu mcp --tools creation,stories,stories-write` for the
`get-story-creation-options` and `create-story` tools alongside chapter authoring.

## Comics

Comics, manga and webtoons need a key with `comic:read`, `comic:write` and,
to publish, `comic:publish`. Sign in again with `lu login` if your session
predates these permissions.

```sh
lu comic create --title "Skyward" --description "A girl climbs the tower." --format webtoon --license cc-by --genres fantasy
lu comic chapter create COMIC_ID --title "Chapter 1"
lu comic upload CHAPTER_ID --directory ./chapter-1
lu comic upload CHAPTER_ID cover-page.png 01.png 02.png
lu comic pages CHAPTER_ID
lu comic page replace PAGE_ID --chapter CHAPTER_ID --file corrected-page.png
lu comic page alt PAGE_ID --alt "A tower rising above the clouds"
lu comic layer create PAGE_ID --file bubbles.json
lu image cover comic COMIC_ID --file cover.png
lu comic publish CHAPTER_ID --audience beta
```

`--format` is `manga` (right to left), `webtoon` (vertical) or `comic` (left to
right). `--license` is `lu-e`, `lu-ne` or a Creative Commons license such as
`cc-by`. Pages of `lu-e`, `lu-ne`, paid and private comics are stored securely
and served only to readers with access.

`lu comic upload` fits each image to the comic page limits (5 MB, at most 8192
wide and 20000 tall), uploads it, and appends the pages in order. Listed files
keep their order. A `--directory` uploads its PNG, JPEG and WebP files by name,
with numbers in natural order, so `2.png` comes before `10.png`. Running it
again appends the pages again. Upload at most 300 pages per command; each source
image must be a regular file of at most 50 MB.

`lu comic page replace` uploads corrected art to the page's chapter and replaces
its image, keeping its order, alt text and layers. Supply the chapter the page
belongs to. After a lost response, inspect the page before retrying.

For additional SDK metadata, `lu comic create --file metadata.json` accepts fields
such as `contentWarnings`, `relatedStoryIds` and `aiModel` alongside the required
creation flags. `lu comic update COMIC_ID --file changes.json` accepts the SDK's
comic update fields; flags override file fields. Use
`lu comic chapter update CHAPTER_ID --file changes.json` for chapter metadata,
for example `{"isAIGenerated": true, "aiModel": "model-name"}`. JSON input must
be an object no larger than 1 MiB. The deployment validates allowed fields.

A layer file holds `kind` (`text`, `sfx` or `encyclopedia`), `language` for
text and sound effects, and `items` positioned in fractions of the page:

```json
{ "kind": "text", "language": "en", "items": [{ "x": 0.1, "y": 0.05, "w": 0.4, "h": 0.1, "text": "Up we go!" }] }
```

`lu mcp` offers the same through the `comics` and `comics-write` tools, and
`publish-comic-chapter` with `--tools publish`.

## Blog pages and menus

Use `blog:read` to read private pages (including drafts and translations) and
menus of blogs you manage. Writes need `blog:write` and current blog-management
permission. Organization keys are limited to their own enabled organization blog;
story/universe-restricted keys cannot access blogs.

```sh
lu blog pages BLOG_ID --first 25
lu blog pages BLOG_ID --first 25 --after LAST_PAGE_ID
lu blog menus BLOG_ID
lu blog mutate BLOG_ID --file mutation.json
```

Read commands return JSON documents with `id`, opaque `version` and stored `data`.
Page listing sorts by ID; continue with the last ID until a short or empty batch.
The mutation file holds the action and its inputs; `blogId` comes from the command.
Create a page with this file:

```json
{
  "action": "savePage",
  "operationId": "author-page-1",
  "expectedVersion": null,
  "page": {"title": "Author", "slug": "author", "language": "en"}
}
```

Supported actions are:

| Action | Additional fields |
| --- | --- |
| `savePage` | `page: {title, slug, content?, language?}`; `pageId` for edits |
| `translatePage` | `pageId`, `language`, `page: {title, slug, content?}` |
| `publishPage` | `pageId`, `published: true` |
| `saveMenu` | `location`, `items`, optional `settings` |
| `translateMenu` | `location`, `language`, `entries` keyed by item/child IDs |

Every write needs an `operationId` and an explicit `expectedVersion`. Use null
only for a new page/menu. For edits, translations and publication, copy the latest
returned version into the next request and use a new operation ID. Preserve the
entire file unchanged for a lost-response retry. `VERSION_CONFLICT` means read
again and review the changes before writing.

Content uses the editor's Puck JSON format. Translation languages use content codes
such as `cs`, not UI locales such as `cs-CZ`. Menus use `top`, `left` or `right`;
retain readback item/child IDs to preserve their translations. Page and post
links must target published content in the same blog. Empty `items` clears a menu.
Use the existing `lu image policy`, `prepare` and `upload` commands for `blog-image`
and `blog-logo` assets; use the returned file ID as the image handle.

Menus and edits to published pages are live immediately. System pages, deletion,
unpublishing and homepage changes remain web-editor actions. Mutation plans go to
stderr and results go to stdout; the plan omits the file's page/menu content.
