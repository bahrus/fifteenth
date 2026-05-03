---
inclusion: auto
---

# Coding Best Practices

## Element Tag Name Comparison

When comparing element tag names, use `element.localName` instead of `element.tagName.toLowerCase()`.

**Why:**
- `localName` is already lowercase (returns the local part of the qualified name)
- More efficient (no string conversion needed)
- Cleaner and more readable code
- Standard practice in modern web development

**Example:**

```typescript
// ❌ Avoid
const tagName = element.tagName.toLowerCase();
if (tagName === 'input') { /* ... */ }

// ✅ Prefer
const tagName = element.localName;
if (tagName === 'input') { /* ... */ }
```

## Module Conventions

### File Extensions
- Use `*.ts` files for all source code — TypeScript is compiled to JS via `tsc`
- The project uses `"type": "module"` in package.json (ES modules)
- Use `.js` extensions in import paths (TypeScript resolves these to `.ts` sources)
- Compiled `.js` and `.d.ts` output is gitignored

### Build
- `npm run build` compiles TypeScript to JavaScript
- `npm test` runs build then Playwright tests
- `tsconfig.json` has `"declaration": true` for auto-generated `.d.ts` files

## When to Use Each Property

- **`localName`**: Use for tag name comparisons in HTML documents (recommended)
- **`tagName`**: Use when you need the original casing (rare) or working with XML namespaces
- **`nodeName`**: Use when working with any node type (not just elements)
