# Gather visual direction

> Superseded by [gather-white-glass.md](gather-white-glass.md), the current source of truth.

## Reference board

| Reference | Useful signal | Apply to Gather |
| --- | --- | --- |
| Flitter social feed | Airy blue and violet atmosphere, floating navigation, thin translucent borders | Let the feed sit in a calm layered shell with small color accents; keep Gather's identity and content intact. |
| Three-pane messenger | Clear inbox, conversation, and context columns; pearl surfaces; compact controls | Give Messages distinct pane hierarchy and breathable conversation spacing. |
| Editorial discovery grid | Large photography, regular card rhythm, quiet white chrome | Make Explore media-led and keep metadata secondary. |
| Nova portfolio | Cinematic dark background, high-contrast media, restrained chrome | Offer a dark theme with charcoal depth and crisp media instead of green-on-green slabs. |
| Aether material specimen | Pearl backdrop, translucent pill panes, inset highlights, graphite anchors, subtle aurora | Use as the material guide: soft ambient light, layered glass, slim borders, gentle shadows. Do not copy its brand or exact composition. |

## Shared visual language

- **Canvas:** pearl/off-white in light mode, deep charcoal in dark mode, with a low-contrast cyan/lilac ambient wash at the edges. Avoid a single flat color field.
- **Glass:** reserve translucency and backdrop blur for navigation, toolbars, floating trays, menus, and dialogs. Use a faint inset highlight, a fine tinted border, and diffuse shadow so layers read against the canvas.
- **Content:** posts, message bubbles, profile media, and reel imagery stay crisp and legible. Use opaque or nearly opaque content surfaces rather than blurring the information itself.
- **Type:** clean sans-serif UI text; strong dark/light contrast for names and headings; muted secondary metadata; compact uppercase labels only for small utility captions.
- **Shape and spacing:** generous outer gutters, consistent 12–20 px card radii, pill geometry for compact actions, thin separators, and clear breathing room between panels. Keep controls proportionate and touch targets comfortable on mobile.
- **Color:** graphite is the text anchor; sage/emerald is Gather's restrained primary accent; lavender is a secondary highlight. Reserve vivid color for active state, status, and focus.
- **Light and depth:** layered surfaces should have subtle tonal separation and soft ambient shadows, not neon glow or heavy glass blur.

## Theme tokens (directional)

| Role | Light | Dark |
| --- | --- | --- |
| Page canvas | `#F4F6F5` | `#101613` |
| Primary text | `#1C2521` | `#EDF4F0` |
| Secondary text | `#748079` | `#A5B1AA` |
| Primary accent | `#548B76` | `#83B99D` |
| Secondary accent | `#8F82D8` | `#B2A6F3` |
| Glass surface | white at high translucency | graphite at restrained translucency |
| Content surface | near-white, crisp | raised charcoal, crisp |

These are design targets; map them to existing Gather CSS variables rather than duplicating token systems.

## Page mapping

| Gather page | Direction |
| --- | --- |
| Home | Compact story rail and floating shell chrome around a focused feed; content cards remain clear and media-forward. Discovery/suggestion content sits in a quiet side panel on wide screens. |
| Explore | Editorial grid with image-first cards, consistent gutters, and understated controls. |
| Messages | Visually distinct inbox, conversation, and context panes; raised conversation surface and legible message groups; floating menus must not cover the active composer or message content. |
| Reels | Portrait media remains the dominant full-height layer; glass controls and captions float over a subtle contrast scrim. |
| Profile | Clear identity header, compact actions, and a regular media grid; avoid over-framing each tile. |
| Settings | Calm categorized navigation with clearly separated form sections and visible focus/selection states. |

## Responsive behavior and guardrails

- Wide screens use a centered, bounded composition with distinct rails/panes; tablet layouts reduce side content before compressing primary content.
- Mobile layouts prioritize one task at a time, use compact persistent navigation, and let Messages/Settings become focused single-column views.
- Preserve all current actions, permissions, and content. Do not introduce fake controls, remove social functionality, or copy reference branding/layouts literally.
- Reject the current recording's failure modes: one uninterrupted forest-green canvas, weak pane boundaries, oversized empty dark areas, and popovers obscuring the conversation.
