# Gather — Digital Social Atelier

> Superseded by [gather-white-glass.md](gather-white-glass.md), the current source of truth.

This direction supersedes the previous glass-and-sage visual correction. Gather is a warm editorial social space for sharing moments, discovering people, and having private conversations. The design uses real product data and keeps all current routes, permissions, and actions.

## Visual direction board

**Mood:** intimate creative journal × lively community paper × focused communication studio.

**Materials:** porcelain page canvas; clear white content surfaces; ink-toned text; violet and coral accents; ambient light only at page edges; fine warm-gray rules; short, soft shadows. Translucent glass is reserved for floating navigation, menus, drawers, and overlays. Media and text content stay crisp.

**Typography:** use the existing Inter/system sans stack; expressive display scale for page titles, firm 600–700 weights for names, restrained tracked micro-labels, and generous 1.5–1.65 body line height. Avoid overly condensed or dashboard-like typography.

**Composition:** asymmetrical editorial columns, varied media spans, open feed rhythm, compact identity blocks, and page-specific surface treatments. Use 8 px spacing increments, 12–20 px radii for functional surfaces, and 44 px minimum mobile controls.

**Avoid:** green as the dominant brand color, uniform rounded cards, blanket blur, large empty canvases, Instagram story-ring styling as the main identity, decorative gradients behind every component, copied competitor layouts, and fake content/actions.

## Token targets

| Semantic role | Light: Porcelain & Ink | Dark: Midnight Studio |
| --- | --- | --- |
| Canvas | `#F6F4F0` | `#11141B` |
| Main surface | `#FFFFFF` | `#1A1F29` |
| Raised surface | `#FFFFFF` | `#232936` |
| Primary text | `#22232B` | `#F2F0F7` |
| Secondary text | `#747583` | `#A7A8B5` |
| Primary accent | `#665BE0` | `#A79AF6` |
| Secondary accent | `#E48C75` | `#E99A82` |
| Soft accent surface | `#EEEBFF` | `#302D45` |
| Border | `#E9E5DF` | `#343946` |

Use semantic CSS variables; adjust values if contrast checks require it. Keep `prefers-color-scheme` behavior and explicit saved appearance preference.

## Information architecture and page wireframes

### Global navigation

Desktop floating rail: Gather wordmark; grouped **Create** action; main destinations **Today**, **Discover**, **Watch**, **Inbox**; utility **Activity**; bottom identity **You** and **Settings**. Global search opens from the top command/search control and remains available without a permanent sidebar row. Labels map to existing route URLs. On narrow screens, use a compact top bar plus a thumb-friendly bottom destination bar; expose secondary destinations through the existing menu pattern.

### Today — `/`

```text
┌ floating rail ┐  ┌ greeting + create action ──────────────┐
│ Today         │  │ moments strip · compact, no giant rings │
│ Discover      │  ├ featured updates / people activity ─────┤
│ Watch         │  │ main timeline, open editorial post flow │  ┌ side shelf ┐
│ Inbox         │  │ varied media/text proportions           │  │ people and  │
│ Activity      │  │ load/error/empty states in same rhythm   │  │ context     │
│ You           │  └─────────────────────────────────────────┘  └─────────────┘
└───────────────┘
```

At mobile widths, move the identity and create affordance into the top bar, show Moments as a short horizontal strip, then use one full-width timeline. Keep the side shelf below primary feed content or omit it when the current page has no real data for it.

### Discover — `/explore`

```text
┌ title + global search entry ─────────────────────────────────┐
│ topic/filter controls                                         │
│ ┌ large image ┐ ┌ image ┐ ┌ image ┐                           │
│ │ creator     │ │       │ │       │   asymmetric masonry      │
│ └─────────────┘ └───────┘ └───────┘   with real attribution    │
│ ┌ image ┐ ┌ wide image ────────────┐ ┌ image ┐                │
└───────────────────────────────────────────────────────────────┘
```

Keep masonry order deterministic and reading order logical. Use existing server data, creator names, loading skeletons, empty copy, and retry controls.

### Watch — `/reels`

```text
┌ title / compact discovery controls ─────────────────────────┐
│      creator + caption context      │ large portrait stage   │
│      reactions / follow             │ controls over scrim    │
│                                      │                        │
└──────────────────────────────────────┴────────────────────────┘
```

On mobile the portrait stage owns the viewport; controls and creator details float in safe areas. Comments open in a bottom drawer; do not shrink the video into a small card.

### Inbox — `/messages`

```text
┌ conversation list (300–340px) ┬ selected conversation (flex) ┐
│ search + rich previews        │ header                       │
│ selected row                  │ readable grouped messages    │
│                               │ composer                      │
└───────────────────────────────┴───────────────────────────────┘
```

Use two panes by default on desktop. Conversation details open on demand from the header, not as a permanent third column. Mobile transitions between list and full-screen conversation. Keep real-time messages, reactions, sharing, and call controls intact.

### Personal Space — `/profile/[username]`

```text
┌ compact identity + actions ───────────────────────────────────┐
│ bio / counts / follow state                                   │
├ posts · reels · saved (only where currently permitted) ──────┤
│ varied editorial media collection; no oversized blank header  │
└───────────────────────────────────────────────────────────────┘
```

Preserve private-account, block, mute, and ownership rules. Retain the existing tab/action behavior and adapt the gallery proportions to device width.

### Settings — `/settings`

```text
┌ settings title + short context ──────────────────────────────┐
│ grouped section navigation │ focused section and controls    │
│ Appearance                 │ concise explanation             │
│ Privacy                    │ real switches/forms             │
│ Security                   │ clear status and actions        │
│ Account                    │ destructive action separated    │
│ Notifications              │ clear preferences               │
└────────────────────────────┴──────────────────────────────────┘
```

Use a quiet document-like layout rather than dashboard tiles. Mobile uses horizontal section tabs or a compact section picker with one form column.

## State, accessibility, and responsive rules

- Design loading, empty, error, and success states using the same editorial hierarchy as populated content.
- Preserve visible keyboard focus and reduced-motion behavior. All icon-only controls need names; status cannot rely on color alone.
- Keep text contrast at WCAG AA targets, especially on tinted accent surfaces and media scrims.
- Reflow deliberately at 1920, 1440, 1366, 1024, 390, and 360 CSS pixels; avoid horizontal page overflow. Preserve touch targets of at least 44 px.
- Use media cropping intentionally with meaningful alt text where images convey content; decorative avatar imagery remains appropriately labeled.

## Current implementation sequence

P0 visual board and page wireframes; P1 tokens/theme; P2 navigation and Today; P3 Discover and Watch; P4 Inbox and Personal Space; P5 Settings and remaining consistency; P6 accessibility, responsive, and interaction validation.
