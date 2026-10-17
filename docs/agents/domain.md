# Domain docs

This repo uses a single-context layout.

## Before exploring

- Read root `CONTEXT.md` for domain terms.
- Read ADRs in `docs/adr/` that touch the area being explored.

If these files do not exist, proceed silently. The domain-modeling skill
creates them when terms or decisions get resolved.

## Layout

- `CONTEXT.md`: the repo's domain glossary.
- `docs/adr/`: numbered architecture decision records.

## Use the glossary's vocabulary

Use terms from `CONTEXT.md` in issue titles, proposals, hypotheses, and
test names. Follow its terminology rather than introducing synonyms.

If a needed concept is missing, reconsider whether it belongs or note
the gap for domain-modeling.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain
why the decision should be reopened.
