# assign-gingerly AI coding guidelines

This file captures the repository-specific guidance that should be followed when editing this project. It is informed by the steering notes in [.kiro/steering](../.kiro/steering) and the product documentation in [README.md](../README.md) and [docs](../docs).

## Project overview

assign-gingerly is a small ES module library that extends object assignment with a few distinctive capabilities:

- Deep, recursive merging via dotted paths such as `?.style?.height`
- Dependency injection and registry-based behavior using symbols
- Optional runtime extension modules that augment native objects and DOM APIs
- Companion utilities such as assignTentatively and assignFrom/assignFromAsync

The package is documented primarily in [README.md](../README.md) and the docs under [docs](../docs). Prefer those sources when behavior is unclear.

## Architecture and main modules

- [assignGingerly.ts](../assignGingerly.ts) and [assignGingerly.js](../assignGingerly.js): core merge and registry behavior
- [assignTentatively.ts](../assignTentatively.ts): reversible, limited-assignment behavior
- [assignFrom.ts](../assignFrom.ts) and [assignFromAsync.ts](../assignFromAsync.ts): path-resolution and declarative assignment flows
- [object-extension.ts](../object-extension.ts), [assignFrom-extension.ts](../assignFrom-extension.ts), and [assignFromAsync-extension.ts](../assignFromAsync-extension.ts): runtime augmentation modules
- [inferencer](../inferencer): a git submodule and should stay self-contained

## Documentation to consult

When changing behavior, read the relevant docs before editing:

- [docs/assignFrom.md](../docs/assignFrom.md)
- [docs/defineWithFeatures.md](../docs/defineWithFeatures.md)
- [docs/inferred-assignments.md](../docs/inferred-assignments.md)
- [docs/paths-dx.md](../docs/paths-dx.md)
- [docs/manage-template-list.md](../docs/manage-template-list.md)
- [docs/inter-feature-communication.md](../docs/inter-feature-communication.md)
- [docs/ternary-assignment.md](../docs/ternary-assignment.md)

## Repository conventions

- Keep changes aligned with the behavior described in [README.md](../README.md) and the docs above.
- Source files are authored in TypeScript and emitted to sibling JavaScript files; preserve that pattern.
- Follow existing naming and export conventions rather than introducing new patterns unless the change clearly requires it.
- For public API changes, update the exported types in [types/assign-gingerly/types.d.ts](../types/assign-gingerly/types.d.ts).

## Steering rules from .kiro

- Prefer `element.localName` over `element.tagName.toLowerCase()` when comparing element tag names.
- Keep the inferencer submodule isolated: it must not import runtime code from the parent package, and should remain independently publishable.
- Keep exported interfaces and types in [types/assign-gingerly/types.d.ts](../types/assign-gingerly/types.d.ts); module files should import those types rather than defining exported types inline.
- Treat markdown-only changes as documentation-only; they do not require compilation or tests.

## Implementation guidance

- Preserve the package’s nested-path semantics: keys that start with `?.` should create or merge into nested objects rather than behaving like flat assignments.
- Preserve the existing distinction between plain objects and arrays; arrays should generally be treated as leaf values rather than recursively traversed.
- Keep registry and symbol-based behavior consistent with the existing implementation and tests.
- When implementing async resolution in [resolveValues.ts](../resolveValues.ts), import any synchronous helper that already exists in [getValues.ts](../getValues.ts) rather than duplicating the logic.
- When a change affects public behavior, add or update tests in [tests](../tests) to cover the new case.

## Validation expectations

- Run `npm test` after code changes that affect runtime behavior.
- Run `npx tsc` when a TypeScript change may affect compilation or type declarations.
- If the change is markdown-only, compilation and tests are not required.
