# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `m3nowak/och-plugin-demo`.
Use the `gh` CLI from this repo.

## Conventions

- Create: `gh issue create --title "..." --body "..."`. Use a heredoc for multiline bodies.
- Read: `gh issue view <number> --comments`. Fetch labels when needed.
- List: `gh issue list --state open --json number,title,body,labels,comments`. Add label and state filters as needed.
- Comment: `gh issue comment <number> --body "..."`
- Add or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.

If enabled, use the equivalent `gh pr` commands. Read both PR comments
and the diff. Include external authors with authorAssociation of
CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, or NONE.

Issues and PRs share a number space. Resolve ambiguous references with
`gh pr view <number>`, falling back to `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, with Notes, Decisions-so-far, and Fog sections.
- Child ticket: link it as a GitHub sub-issue. If unavailable, add it to the map's task list and put `Part of #<map>` at the top of its body.
- Child labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Blocking: use native issue dependencies. Add an edge with `gh api --method POST repos/m3nowak/och-plugin-demo/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
- Get the blocker's database ID with `gh api repos/m3nowak/och-plugin-demo/issues/<number> --jq .id`. Use this ID, not the issue number or node ID.
- If dependencies are unavailable, put `Blocked by: #<number>` at the top of the child's body. All blockers must be closed before work starts.
- Frontier: inspect the map's open children in map order. Choose the first unassigned child with no open blockers. Native `issue_dependencies_summary.blocked_by` counts open blockers; otherwise check the fallback references.
- Claim: `gh issue edit <number> --add-assignee @me`, as the driving session's first write.
- Resolve: comment with the answer, close the child, then append a summary and link to the map's Decisions-so-far.
