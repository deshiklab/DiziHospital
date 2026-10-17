# @dizi/tokens

Design tokens for DiziHospital, generated from the plan's single source of truth:
[`docs/plan/design-tokens.json`](../../docs/plan/design-tokens.json) (plan §`02` §4).

The source file is a spec: it is reviewed and versioned like the rest of the plan, and every UI change that
needs a new value changes it there, not in a component.

## Commands

```bash
npm run tokens:build          # regenerate dist/ from docs/plan/design-tokens.json
npm run tokens:check          # CI gate: fails if dist/ drifts from the source
TOKENS_SOURCE=./my-tokens.json node packages/tokens/build.mjs   # generate from an alternate file (experiments)
```

## Outputs (`dist/`, committed on purpose so the drift gate is meaningful)

| File | Use |
|---|---|
| `tokens.css` | CSS custom properties on `:root` — the canonical values (`--dizi-color-brand-500`, …) |
| `theme.css` | Tailwind v4 `@theme` block mapped to the same variables (colours, fonts, spacing, radii) |
| `tokens.ts` | Typed object + `TokenName` union + `cssVar()` helper, so components never hand-type a variable name |
| `tokens.json` | Flattened list (name, CSS variable, value, comment) for audits and tooling |

## Using it

```css
/* app.css */
@import "@dizi/tokens/css";
@import "@dizi/tokens/theme.css";
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```tsx
import { tokens, cssVar } from '@dizi/tokens';

// Prefer the Tailwind scale in JSX; use cssVar() when a value must be inline (charts, print, canvas).
<rect fill={tokens.color.brand[500]} />
```

## Rules

1. **No hard-coded values in components.** PR review rejects a colour, spacing, radius or duration that is not
   a token; the only exceptions are layout maths and third-party integration points.
2. **Contrast is verified in CI.** Every text/surface pair in the tokens must hold WCAG 2.2 AA (plan §`02` §7);
   the theme build is where that check belongs, not in a designer's eye.
3. **`sync.*` tokens are semantic, not decorative** — `queued`, `syncing`, `conflict` and `stale` mean specific
   things about data state (plan §`02` §11) and must never be reused for unrelated emphasis.
4. **Changing a token is a plan change.** Update `docs/plan/design-tokens.json`, run `npm run tokens:build`, and
   let the drift gate prove the artefacts moved with it.
