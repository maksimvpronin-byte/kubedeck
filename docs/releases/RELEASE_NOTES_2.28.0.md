# KubeDeck 2.28.0 release notes

About shows what a new version changes before it is installed, the buttons in
Settings and About are one size, and an age past a year is written in years.

## What's new, before you update

A check that found a newer version said only its number. The Updates card in
About now shows it in a panel of its own:

- the version on offer and the one installed now;
- what changes, taken from the notes of the GitHub release - for every version
  skipped, newest first, not only the latest;
- the one step that gets it: Download, then Restart and install. A portable
  build, which cannot replace itself, is sent to the releases page instead;
- download progress as a bar.

Check for updates and Open releases moved to the card's title line. A
development run said why it cannot update twice, in two rows; it says it once.

The notes are HTML from GitHub, and are rebuilt from a short list of tags
rather than inserted as they are: no script runs, no image or link comes
through, and a wrapped line of the Markdown is not a line break.

## Buttons in Settings and About

Nothing set a font size for the page, so a button nobody sized was drawn at
16px beside 13px ones, and every card brought its own height - 30, 32, 34 and
36px - border and radius.

- Every button in Settings and About is 32px high, 13px, in one style, with one
  primary, one danger and one disabled look.
- Remove on a cluster is drawn as the destructive action it is.
- Each entry of the activity log offered "Copy error", successful ones too. It
  copies the whole entry, and says "Copy JSON".
- The log's limit and Refresh stay on one line beside its title.

## Ages in years

An age past a year was written in days: 400d. It is written the way kubectl
writes it, from the first year: 1y35d, and 2y for two years exactly. Sorting by
age is unchanged.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **300 tests**, up from 296: release notes keep only
  allowed tags and drop the Verification section; a new version is offered with
  its notes and the button that gets it; a build that cannot install says why
  once and is sent to the releases; ages past a year are written in years
- `npm --workspace apps/desktop run test:gateway` - **186 tests**, up from 185:
  release notes reach the window as one list, whichever shape they arrive in
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.28.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.28.0.md](./REGRESSION_CHECKLIST_2.28.0.md).
