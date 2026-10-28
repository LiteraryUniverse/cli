# Literary Universe CLI

Command line tools for authors and local agents using [Literary Universe](https://literaryuniverse.com).
Pull a story into local Tiptap JSON files, inspect changes offline, validate and
push versioned drafts, create chapters, and publish or schedule an edition.
Image preparation and authorized uploads are also supported. Broader blog editing
and document imports remain to build.

The CLI uses the [TypeScript SDK](https://github.com/LiteraryUniverse/sdk-typescript)
and the same permissions as the web workshop. It targets Node 22 or later and Bun
on Linux, macOS and Windows.

Read the [documentation in our feedback knowledge base](https://literaryuniverse.com/feedback/help)
for Literary Universe help. The command examples below describe the implemented CLI.
Report CLI bugs in [this repository](https://github.com/LiteraryUniverse/cli/issues).

## Install

The source is MIT licensed. The package is still marked private and has not been
released to npm. Build and install it from this repository:

```sh
git clone https://github.com/LiteraryUniverse/cli.git
cd cli
npm ci
npm pack
npm install --global ./literary-universe-cli-0.1.0.tgz
lu --help
```

Git must be available during `npm ci`. The CLI pins its SDK dependency to a
commit in the SDK repository; npm builds it automatically. No sibling SDK clone
or Meteor application is needed. The CLI tarball bundles that built SDK and can
be installed in a separate project or globally.

During development, run `npm run build`, then use `node dist/main.js` or
`bun dist/main.js` in place of `lu`.

If your Windows installation path contains `&`, use `lu.ps1` from PowerShell.
npm's generated `lu.cmd` wrapper does not quote that path correctly. Running the
installed `dist/main.js` directly with Node also works.

## Authentication and first pull

Create a personal API key in your Literary Universe account. Reads need
`story:read`; saving or creating chapters also needs `story:write`. Publication
requires the separate `story:publish` scope. Scopes do not grant access beyond
your current permissions or the key's selected resources.

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
lu pull STORY_ID --directory ./my-story
lu status --directory ./my-story
lu push --directory ./my-story
```

Run `lu` after installing the tarball, or substitute
`node dist/main.js` or `bun dist/main.js` during development. Output is
JSON on stdout. Change summaries and errors use newline-delimited JSON on stderr;
failed or partially successful commands exit with status 1.

## Managed projects

Chapters contain canonical Tiptap JSON in chapters/chapter-ID.LOCALE.json.
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
lu save CHAPTER_ID --file chapter.json --expected-version VERSION --operation-id UNIQUE_ID
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
new chapter. New translations are a later workflow; publication can select an
existing edition with --language.

Publishing requires a separately granted story:publish scope. It uses the exact
server version and a caller-supplied operation ID. Retry lost replies with the
same arguments and ID. Reader publication respects account/work restrictions;
beta publication preserves existing reader release dates. --at requires a time
with an explicit timezone. Chapter creation never publishes content.

The first original chapter publishes/schedules its story. Publish the parent
universe separately in LU; a story credential does not change universe visibility.
Revisions, listing updates and durable notification jobs commit together.
Production also requires authorApi.publicationEnabled on the server.

## Development

```sh
npm ci
npm run typecheck
npm test
bun test test
```

The tests exercise CLI subprocesses, local files, lost replies, rejected/stale
writes, deployment/path guards, and installation into a clean packed consumer.
Live LU checks run from the [monorepo](https://github.com/StorytellerCZ/Literary-Universe)
with `node --experimental-strip-types app/scripts/testApiReadContract.mjs` and a
separate local replica-set database ending in `_test`. Production draft writes require explicit
server rollout configuration documented in the [SDK README](https://github.com/LiteraryUniverse/sdk-typescript#versioned-draft-writes).

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
operation. `lu image cover story|universe` replaces a cover directly; the server
crops it to the cover shape. Purpose/target mapping and finite quotas are documented in
the [SDK image reference](https://github.com/LiteraryUniverse/sdk-typescript#images). Body/decode limits apply in addition to the HTTP request timeout.
