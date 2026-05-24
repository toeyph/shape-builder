# ShapeBuilder — Project Rules

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 6 (strict) |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Alerts | SweetAlert2 (toast mixin) |
| Utils | clsx + tailwind-merge via `cn()` |

## Tailwind v4 — CSS-first config

**No `tailwind.config.ts` exists.** All theme customization lives in `app/globals.css`:

```css
@import "tailwindcss";      /* replaces @tailwind base/components/utilities */

@theme {
  --color-sb-blue: #0071e3;
  --color-sb-orange: #ff9500;
  /* ... other sb-* colors ... */
  --font-sans: 'DM Sans', -apple-system, sans-serif;
}
```

PostCSS uses `@tailwindcss/postcss` (not the old `tailwindcss` plugin). `autoprefixer` is no longer needed.

### Custom color palette

All `sb-*` colors are available as Tailwind utilities:

| Token | Hex | Example classes |
|---|---|---|
| `sb-blue` | `#0071e3` | `bg-sb-blue`, `text-sb-blue`, `border-sb-blue` |
| `sb-orange` | `#ff9500` | `bg-sb-orange`, `text-sb-orange` |
| `sb-red` | `#ff3b30` | `text-sb-red` |
| `sb-green` | `#30d158` | `text-sb-green` |
| `sb-light` | `#f2f2f7` | `bg-sb-light` (canvas background) |
| `sb-dark` | `#1c1c1e` | `bg-sb-dark` (code block background) |
| `sb-mid` | `#636366` | `text-sb-mid` (secondary text) |
| `sb-muted` | `#aeaeb2` | `text-sb-muted` (disabled/placeholder text) |

Opacity modifiers work normally: `bg-sb-blue/10`, `bg-sb-orange/90`.

## Alerts — SweetAlert2 only

Never use `alert()`, browser confirm, or custom `copied` state for notifications.
Use the Toast mixin defined at the top of `components/ShapeBuilder.tsx`:

```ts
Toast.fire({ icon: "success", title: "Copied to clipboard!" });
Toast.fire({ icon: "error", title: "Something went wrong" });
```

## SSR safety

`ShapeBuilder` runs in the browser only. Rules:
- Never initialize `useState` with `window.*` — start with `0` or `null` and set real values in `useEffect`.
- `app/page.tsx` must stay `"use client"` so `next/dynamic` with `ssr: false` is allowed.
- All browser API access (`window`, `document`, `navigator`) must be inside `useEffect` or event handlers.

## Conditional classes

Always use `cn()` from `@/lib/utils` — never string concatenation:

```ts
import { cn } from "@/lib/utils";
cn("base-class", condition && "conditional-class", variant === "a" && "a-class")
```

## Performance pattern (direct DOM mutation)

The `paintLive()` function mutates SVG attributes directly via `svgRef.current` to hit 60 fps during drag without triggering React re-renders. Do not refactor it to use setState.

## File structure

```
app/
  globals.css       ← Tailwind @import + @theme (only theme config file)
  layout.tsx        ← Server Component, sets metadata
  page.tsx          ← "use client", dynamic import with ssr: false
components/
  ShapeBuilder.tsx  ← entire editor (single component file)
lib/
  utils.ts          ← cn() utility only
```

## Dev commands

```bash
npm run dev     # start dev server (Turbopack)
npm run build   # production build + TypeScript check
npm run lint    # ESLint
```
