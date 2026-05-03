---
inclusion: auto
---

# Markdown File Changes

When changes are made exclusively to markdown files (*.md), there is no need to:
- Recompile TypeScript (`npx tsc`)
- Run tests (`npm test`)

Markdown files are documentation only and do not affect the compiled code or test results.

This applies to:
- README.md
- InitialInstructions.md
- Files in docs/ folder
- Files in bugs/ folder
- Any other *.md files

If changes include both markdown files AND code files (*.ts, *.js), then compilation and testing are still required.
