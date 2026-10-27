# Design system

Two surfaces share one set of tokens (`tokens.css`).

- **Product** (the dashboard and the demo): a warm off-white page, generous white cards and pill-shaped controls. Calm and friendly rather than dense.
- **Editorial** (docs and landing): the same warm neutrals, with large Bricolage headings and small tracked labels.

Elevation comes from a light warm border plus a barely visible shadow. Only popups (select lists, the date picker, tooltips), dialogs and the cards on the realtime map float.

## Palette

| Token                 | Light     | Dark      | Use                                                |
| --------------------- | --------- | --------- | -------------------------------------------------- |
| `--bg`                | `#f7f6f2` | `#131210` | page background (warm off-white / warm near-black) |
| `--surface`           | `#ffffff` | `#1c1b18` | cards, inputs, secondary buttons, dialogs          |
| `--bg-subtle`         | `#fbfaf7` | `#22201d` | hover fills inside cards, code blocks              |
| `--bg-muted`          | `#f0eee9` | `#2a2824` | tab and segmented-control tracks, badges           |
| `--border`            | `#ebe8e1` | `#2e2c27` | default 1px card and pill border                   |
| `--border-strong`     | `#d9d5cb` | `#45413a` | inputs, hover borders                              |
| `--text`              | `#1c1b18` | `#f3f1ec` | body and headings (never pure black)               |
| `--text-muted`        | `#5f5b53` | `#b0aba0` | labels, helper text, inactive tabs                 |
| `--text-faint`        | `#736e65` | `#959085` | placeholders, axis labels                          |
| `--accent`            | `#1c1b18` | `#f3f1ec` | primary pill fill (black in light, ink in dark)    |
| `--on-accent`         | `#ffffff` | `#1c1b18` | text on the primary pill                           |
| `--accent-text`       | `#1f5fc7` | `#8db3f0` | links, focus ring                                  |
| `--accent-soft`       | `#e5eefb` | `#223249` | bar-list fills, selected rows                      |
| `--success` / `-soft` | `#1f9d55` | `#4ade80` | online dots, live state, up trends                 |
| `--warning` / `-soft` | `#d9622b` | `#f0905f` | warnings, errors, down trends                      |

Every text pair above meets WCAG AA (4.5:1) on `--bg`, `--surface` and, for row labels, on `--accent-soft`.

### Chart series

In order: soft blue `#8fb4ea` (visitors), orange `#d9805f` (revenue), green `#5bb98a`, violet `#a58ee6`. Series colours are never used for text; a legend square next to the label ties a number to its series. Area fills are a vertical gradient of the series colour (see Charts), gridlines are dashed `--border-strong`.

### Realtime map

A dark navy canvas independent of the page theme: background `#0e1a2b`, land dots `#2d4567`, graticule `#1a2a42`, markers `#4ade80`. Floating cards use `rgb(16 28 46 / 0.8)` with a 10px backdrop blur, text `#e9eef7`, secondary text `#a9b6c9`. The light map variant swaps to `#e9eef5` / `#b6c3d6` with white cards.

### Logo

Colours come from the logo artwork, not from the UI accent: `--logo-blue #2f80ed`, `--logo-green #27a98a`, `--logo-yellow #fbbf24`, `--logo-ink #0f1a3d`. In dark mode the ink flips to `#e8ecff`. They appear only in the mark, the README banner and the favicons.

## Typography

- **Bricolage Grotesque** (variable, `@fontsource-variable/bricolage-grotesque`, OFL): all UI text and every heading, product and editorial. A characterful grotesque with an optical-size axis (`font-optical-sizing: auto`), so 40px headings tighten and 12px labels open up. Weights 400, 500, 600, 700. The dashboard names `'Bricolage Grotesque Variable'` first and falls back to the system sans; the package does not bundle fonts.
- **Geist Mono** (`@fontsource/geist-mono`): code, IDs, snippets, and the values in chart tooltips.

No serif: next to Bricolage it read as a second voice.

The commercial faces behind the reference designs are not redistributed.

Scale (base 14px for UI, 16px for prose): 11 / 12 / 13 / 14 / 16 / 18 / 22 / 26 / 30 / 36 / 40. Line height 1.43 for UI, 1.5 for prose.

- Page headings: 30 to 36px, weight 700, letter spacing -0.02em.
- Stat numbers: 26px 700 in the stat strip, 40px 700 on site cards, tabular numbers.
- Card titles: 16px 700. Labels: 13px 500 `--text-muted`.
- Column headings and footer links ("VISITORS", "DETAILS"): 11px 600 uppercase, `letter-spacing: 0.08em`.

## Spacing, radius, borders

- Base unit 4px: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Max content width 1240px. Card padding 20px, dialogs 24 to 28px.
- Radius: pills (buttons, toolbar controls, tabs, chips) 9999px, bar rows and small tiles 8px, inputs 12px, cards 18px, dialogs and feature cards 24px.
- Borders: 1px `--border` on every card and pill.
- Shadows: cards and pills `0 1px 2px rgb(28 27 24 / 0.04)` (none in dark mode); dialogs `0 24px 64px rgb(0 0 0 / 0.16)` over a backdrop of `rgb(28 27 24 / 0.32)` with a 6px blur.

## Components

- **Primary button**: black pill (`--accent`), `--on-accent` text, 38px high, 16px side padding, weight 600. One per surface. Disabled: grey fill (`#e4e1da` light / `#34322d` dark) with muted text, no opacity trick.
- **Secondary button**: white pill (`--surface`), 1px `--border`, same size. Hover darkens the border.
- **Toolbar**: a row of white pills: site switcher (initial tile + select), date range (previous/next arrows around the preset select), interval select, a "Live" toggle with a status dot, a round refresh icon button.
- **Card**: `--surface`, 1px `--border`, 18px radius, card shadow.
- **Stat strip**: inside the main card, tiles separated by 1px dividers; label 13px muted with an optional series square or status dot, value 26px 700, delta badge.
- **Tabs**: a `--bg-muted` pill track; the selected tab is a white pill. Keyboard: arrows, Home, End.
- **Bar list row**: full-width row, 8px radius, a `--accent-soft` fill proportional to the value behind the label, count right-aligned in 600.
- **Site card**: initial tile (pastel square, dark letter), name and domain, a big visitor number, "N online" with a green or grey dot.
- **Dialog**: centred, 24px radius, blurred dimmed backdrop, full-width primary pill at the bottom.
- **Input**: `--surface`, 1px `--border-strong`, 12px radius, 38px high; focus darkens to `--text`.
- **Focus**: 2px `--accent-text` outline, 2px offset, on every interactive element.

## Do

- Put content on white cards on the warm page.
- Use pills for every button and toolbar control.
- Reserve the black pill for one action per surface.
- Support light and dark with the same token names; dark keeps the same structure on warm near-black cards.
- Respect `prefers-reduced-motion`: pulsing dots and map halos stop, transitions and Recharts animations switch off, numbers jump instead of counting, Motion keeps only opacity fades.

## Don't

- Cold grey neutrals or blue-tinted greys outside the realtime map.
- Heavy shadows, glows, or gradients anywhere but the soft fills inside charts.
- Pure `#000` body text.
- Series colours as text colours.
- Motion that moves layout for its own sake: animate to explain a change (a new value, a new row, an opened panel).

## Controls (dashboard)

Built on Base UI primitives, written as small copy-in modules in `src/dashboard/ui/` and styled with the `--analytik-*` variables (no Tailwind needed by consumers).

- **Select**: a pill or 12px-radius trigger with a chevron that turns when open; the list is a 16px-radius popup with `--shadow-popup`, 8px-radius rows, a highlighted row on `--bg-muted`, a check in `--accent-text` for the chosen one.
- **Combobox** (time zones): an input that filters a list of at most 60 matches.
- **Date range**: one pill: previous arrow, a calendar-icon trigger with the preset name or the days ("Oct 1 – 3, 2026"), next arrow. The popover lists the presets on the left (a row of chips on phones) and a Monday-first month grid on the right; range ends are black pills, the days between sit on `--accent-soft`, today has a dot. Presets apply at once, a picked range with "Apply".
- **Switch**: 34×20 track, `--border-strong` off, `--success` on, white thumb. Used for Live and for on/off settings.
- **Tabs**: the selected tab's white pill slides between tabs.
- **Tooltip**: an inverted (`--accent` on `--on-accent`) 8px-radius label, 12px 500.
- **Dialog**: centred on wide screens; under 640px a bottom sheet with 24px top corners and a grab handle.
- Popups render inside the dashboard root so they keep its theme; parts used on their own get the `analytik-layer` class with the default tokens.

## Charts (dashboard)

Recharts, loaded with the first chart (a lazy chunk), in a soft style: the area is the series colour with a vertical gradient from 38% to 2% opacity and a 2.25px monotone line; revenue bars use a gradient of `--series-2`, 4px top radius, at most 14px wide, on a right-hand axis. Only horizontal dashed gridlines (`3 5`, `--border-strong`), no axis lines or tick marks, 11px `--text-faint` labels, three ticks on a "nice" scale. The tooltip is a blurred card that glides between points with a dashed cursor line; the legend above the chart is a row of buttons that switch series on and off. Series enter with a 0.7 to 0.9s ease-out and animate between data updates. Every chart has a text summary and a screen-reader table of its values.

## Motion (dashboard)

Motion (`motion/react`) for what CSS cannot do; CSS transitions on Base UI's `data-starting-style` / `data-ending-style` for popups and dialogs.

- Ease `cubic-bezier(0.22, 1, 0.36, 1)`; entrances 250 to 350ms, exits 120 to 200ms.
- Views fade up 8px with their cards staggered by 50ms and fade out when another view replaces them; the active nav pill slides to the chosen item.
- Bar-list rows fade in and their bars grow from zero; tab panels fade in on change; filter chips scale in and out.
- Stat values count to their new value over 600ms.
- Realtime: new map markers pop in on a spring with a one-off ripple, places nobody is at fade out, feed lines slide in from the top and push the others down, the online count counts.
