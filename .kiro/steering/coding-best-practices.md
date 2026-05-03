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

## JavaScript Module Conventions

### File Extensions
- Use `*.js` files for all browser-executable code
- Use `*.ts` files for type declarations alongside `.js` files
- The project uses `"type": "module"` in package.json (ES modules)

### TypeScript Support
- Use JSDoc comments for type annotations in `.js` files when needed
- Leverage type definitions from the `types` submodule

## When to Use Each Property

- **`localName`**: Use for tag name comparisons in HTML documents (recommended)
- **`tagName`**: Use when you need the original casing (rare) or working with XML namespaces
- **`nodeName`**: Use when working with any node type (not just elements)
