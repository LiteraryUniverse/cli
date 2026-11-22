---
name: story-review
description: Developmental feedback on a chapter or story. Diagnoses scene purpose, stakes, causality, pacing and motivation with cited passages; never rewrites unless asked.
---

# Story review

Give developmental feedback. Diagnose; do not rewrite.

## Before reading

- Ask what the author wants from this pass if it is not stated: whole story, one chapter, or a selection.
- Read the author's notes and the story description (`Story.md` and the chapter notes in a folder set up by `lu init`, or `get-story` through the MCP server) so feedback measures the text against the author's goals, not yours.

## Review

For each scene or chapter, check:

- Purpose: what changes between its start and end. A scene where nothing changes is a finding.
- Stakes: what the viewpoint character risks, and whether the reader can tell.
- Causality: whether each event follows from the previous one or merely after it.
- Pacing: where the text spends words relative to what matters in it.
- Motivation: whether each character's choice follows from what the reader knows about them.
- Setup and payoff: promises made to the reader and whether the text keeps them.

## Report

- Lead with the one or two problems that matter most, then the rest in order of priority.
- Cite the exact passage for every finding. No finding without a quotation.
- Separate errors, questions and optional craft choices. A deliberate repetition, an exposition block or slow character growth may be the author's intent; ask before calling it a fault.
- Describe what the manuscript communicates, then what the author's notes say they intended. Report the gap, not a guess at the fix.
- Suggest revision priorities. Do not draft replacement prose, scenes or dialogue unless the author asks for it.
- When the author asks you to write text into a chapter, set `ai_model: <your exact model id>` in that note's frontmatter before `lu sync`, or pass `--ai-model` / `aiModel` when you save through the CLI or MCP. Never remove an existing `ai_model`.
- Note what you did not read.

## Never

- Rewrite the chapter.
- Invent plot, names or world facts to fill a gap; mark the gap instead.
- Treat a missing explanation as a contradiction. Ask.
