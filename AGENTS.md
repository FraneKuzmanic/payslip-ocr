# AGENTS.md

Instructions for agents working in `prototypes/payslip-ocr`.

This project is configured independently of the enclosing `doc-ai-lib` git repository.
Treat **this directory as the repo root**: its `CONTEXT.md`, `docs/` and `.scratch/`
govern payslip work. The root `doc-ai-lib/CONTEXT.md` describes the separate `doclib`
effort and is not this project's glossary.

Next you will see are behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Integrity

Push back strongly when Im wrong. Actively challenge weak reasoning. If I push back and you were right, hold the line.

## 6. System Evolution

Learn from your mistakes. Don't just patch bugs and forget. Turn failures into global rules that build institutional knowledge into the AI layer.

## 7. Git remotes

The monorepo has three remotes. Only one of them is this project's:

- `payslip-github` is **this project's** mirror: `FraneKuzmanic/payslip-ocr`, a **private**
  repository that must stay private, because `.agents/fixtures/` holds real personal data. It
  contains only the `prototypes/payslip-ocr` subtree, rooted at the repository root. Its URL is
  `git@github-FraneKuzmanic:FraneKuzmanic/payslip-ocr.git`. The `github-FraneKuzmanic` host alias
  in `~/.ssh/config` pins the personal key; plain `git@github.com:` has no key configured and would
  fail, and the student account `FraneKuzmanicFER` must never be used.
  Push from the monorepo root with
  `git subtree push --prefix=prototypes/payslip-ocr payslip-github main`. A plain `git push`
  cannot update it, because its history is a subtree split.
  Its `main` drives the live Render deploy (`payslip-ocr-api`, `payslip-ocr-client`), but only
  after the GitHub Actions CI workflow passes (`autoDeployTrigger: checksPass` in `render.yaml`).
- `origin` is Azure DevOps. Push to it only when explicitly asked.
- `github` is **receipt-ocr's** mirror (`FraneKuzmanic/receipt-ocr`), and its `main` drives
  receipt-ocr's live Render deploy. Payslip commits never go to it.

## 8. Conventions

The gotchas no config file states:

- Lint with **oxlint**. TypeScript 7 is the Go port with no JS compiler API, so
  `typescript-eslint` cannot run.
- Import routing from **`react-router`**; `react-router-dom` is not a dependency.
- In `api/` and `shared/` (`nodenext`), relative imports carry a `.js` extension; `client/`
  (`bundler`) imports without one.
- Money and hours are **decimal strings**, with `big.js` for arithmetic, so cents survive.
- Every user-facing string is an `en` + `hr` key pair; a guard test enforces the parity.
- Confidence marks a value for attention and always leaves the value in place.

## Agent skills

### Issue tracker

Local markdown: issues and specs live as files under `.scratch/<feature-slug>/` in this
directory. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name (`needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` in this directory. See
`docs/agents/domain.md`.
