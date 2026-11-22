---
name: Tabulous
description: Tabulation for judged events, run from a calm control booth while the show is live.
colors:
  prussian: "#0b2545"
  oxford: "#13315c"
  regal: "#134074"
  powder: "#8da9c4"
  mint: "#eef4ed"
  white: "#ffffff"
  line: "#c8d6e2"
  field: "#718cac"
  placeholder: "#607186"
  wash: "#e2ebe9"
  danger: "#b3261e"
  danger-ink: "#8c1d17"
  danger-soft: "#f4b4ae"
  tally: "#e5484d"
  judging: "#0f8a7a"
  go: "#4ade80"
  caution: "#fbbf24"
  stop: "#fe6555"
  chroma-key: "#00ff00"
  night-page: "#0b1728"
  night-card: "#12233a"
  night-ink: "#e3ebf3"
  night-accent: "#9fc2ea"
  night-line: "#2a4060"
  print-muted: "#4b5f78"
  print-podium: "#e3ebf2"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 300
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 300
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 300
    lineHeight: 1.375
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  action:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  tag:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
  reading:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.625
  broadcast:
    fontFamily: "Montserrat, sans-serif"
    fontWeight: 600
  numeral:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 700
    fontFeature: "\"tnum\""
rounded:
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  card: "20px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.regal}"
    textColor: "{colors.mint}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.oxford}"
  button-quiet:
    backgroundColor: "{colors.white}"
    textColor: "{colors.regal}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.white}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.danger-ink}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  button-on-navy:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.prussian}"
    rounded: "{rounded.pill}"
    height: "56px"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.prussian}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "0 14px"
    height: "44px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "20px"
  note:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.prussian}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  choice-selected:
    backgroundColor: "{colors.regal}"
    textColor: "{colors.mint}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  nav-item-active:
    backgroundColor: "{colors.white}"
    textColor: "{colors.prussian}"
    rounded: "{rounded.xl}"
    padding: "0 12px"
    height: "40px"
  session-desk:
    backgroundColor: "{colors.prussian}"
    textColor: "{colors.mint}"
    rounded: "{rounded.card}"
  keypad-key:
    backgroundColor: "{colors.oxford}"
    textColor: "{colors.mint}"
    typography: "{typography.numeral}"
    rounded: "{rounded.2xl}"
  keypad-key-active:
    backgroundColor: "{colors.regal}"
---

# Design System: Tabulous

## Overview

**Creative North Star: "The Control Booth"**

Tabulous is the booth at the back of the hall: a calm instrument panel run by people under show pressure, where every control says what it does and every number reads from across the room. The organizer's admin panel is the booth's daylight side, mint paper and white cards ruled with hairlines; the session desk, the judges' screens and the public boards are its stage side, deep Prussian navy with mint type. One family of five blues and a mint runs through both, so the panel, the desk, a judge's phone, the projected results and the LED wall read as one system.

The density is a working instrument's, not a dashboard's: one clear next action per moment, generous 44px targets for thumbs under venue lighting, quiet secondary controls, and large tabular numerals wherever a score appears. Titles are set light and large, labels and actions semibold; the type does the hierarchy so colour doesn't have to. Colour is reserved for state: the red tally dot when a session is on air, teal while judges deliberate, and the timer's green, amber and red, always with words beside them.

It is not a neon esports scoreboard, not a generic SaaS dashboard of gradients and glass, not playful (no confetti, emoji or mascots), and not the dense grey spreadsheet it replaces. Everything it shows may be projected, keyed into a broadcast or signed in print, and has to hold up there.

**Key Characteristics:**
- Two sides of one booth: mint-and-white admin, Prussian-navy stage surfaces (desk, judges, live results, LED).
- Five core blues and a mint, swapped in place for the admin's dark theme.
- Inter across the app: light for titles, semibold for labels and actions, bold tabular numerals for scores; Montserrat on the LED wall alone.
- Flat surfaces on hairlines; shadows only on what floats.
- Calm and decisive controls: soft pills and rounded fields, one filled primary per moment.

## Colors

A cool navy-to-mint family that reads as one voice in daylight and on stage, with colour for state alone.

### Primary
- **Regal** (`regal`): the one accent of the light admin. Primary buttons, links and text actions, a selected choice's fill, focus borders, the active tab's indicator bar. On the judges' keypad it's a key being pressed.

### Secondary
- **Oxford** (`oxford`): the primary button's hover, and on navy surfaces the raised layer: keypad keys, judge cards (at 40%), the desk's inner panels.

### Neutral
- **Prussian** (`prussian`): ink on light surfaces (all body text, at 70% for hints and table heads) and the ground of every stage surface: the session desk, the judges' screens, the live results and the default LED theme.
- **Powder** (`powder`): secondary text on navy (ledes, labels, quiet figures) and the faint ring on keypad keys.
- **Mint** (`mint`): the admin page and dialog ground, text on navy, and the fill of the main action on a navy surface.
- **White** (`white`): cards, fields and the active sidebar row on the mint page.
- **Line** (`line`): every hairline: card borders, table rules, dividers, skeleton blocks.
- **Field** (`field`): form control outlines, at the 3:1 a field needs to be found.
- **Placeholder** (`placeholder`): placeholder text, 5:1 on white.
- **Wash** (`wash`): notes, disabled fields and quiet tinted panels.

### Status
- **Danger** and **Danger Ink** (`danger`, `danger-ink`): destructive buttons and errors on light surfaces, ink for hover.
- **Danger Soft** (`danger-soft`): errors and warnings on navy, where Danger is too dark to read.
- **Tally** (`tally`): the on-air dot of a live session. Only ever a dot, never text.
- **Judging** (`judging`): the teal dot of a session whose scores wait for a deliberation.
- **Go, Caution, Stop** (`go`, `caution`, `stop`): the scoring timer's bar and the deep tint a judge's screen takes while it runs (green, amber as it closes, red once it has), always under navy text with the time left in words.
- **Chroma Key** (`chroma-key`): the LED lower third's keying green. A broadcast requirement, never a colour of the design.

### Dark admin theme
The admin's dark mode redefines the same tokens rather than adding new ones: the page becomes **Night Page** (`night-page`), cards **Night Card** (`night-card`), ink **Night Ink** (`night-ink`), the accent **Night Accent** (`night-accent`, light enough to carry dark text on a button) and hairlines **Night Line** (`night-line`). The navy stage surfaces keep their colours in dark mode.

### Print
The results PDFs can't read the CSS tokens, so they carry the palette as literals, plus two values tuned for paper: **Print Muted** (`print-muted`), Prussian at about 75% on white, for report labels, table heads, numbers and notes, a step darker than the screen's 70% so small print stays crisp; and **Print Podium** (`print-podium`), the pale blue fill behind the top three rows of a results table.

### Named Rules
**The State-Only Color Rule.** Colour beyond the navy-and-mint family means state: on air, deliberating, time running, time up, danger. It never decorates, and it never travels without words.

**The One Family Rule.** Every surface, light or stage, is built from the same five blues and mint. A new surface takes its colours from them; the LED wall's alternative themes are the only other palettes, and they live on the wall alone.

## Typography

**Display Font:** Inter (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Inter
**Label/Mono Font:** Inter, with tabular figures for every number
**Broadcast Font:** Montserrat, the LED wall's alone (its "Modern" font, loaded only by the wall)
**Optical sizes:** Inter is loaded with its optical-size axis, so the browser draws the display cut from about 20px up (finer light strokes, closer spacing) and the text cut below. That is why titles need only light tracking.

**Character:** One family carries the whole booth. Titles go light and large in the display cut, so a page's name is calm rather than loud; labels and actions go semibold, so what to press is never in doubt.

### Hierarchy
- **Display** (300, 2.375rem from 640px wide and 2rem below, 1.15, -0.01em): a page's title: the activity's name, the sign-in screens.
- **Headline** (300, 2.25rem from 768px wide and 1.75rem below, 1.15, -0.01em): the judge's screen title: the entry being scored, the screen's state.
- **Title** (300, 1.25rem, 1.375, -0.01em): a section's title inside a page or a dialog, and a card's or a dialog's title on the judges' screens too.
- **Body** (400, 16px, 1.5): running text and table cells. Fields, notes and the sidebar are a step smaller at 15px (fields go back to 16px on touch, so iOS doesn't zoom).
- **Action** (600, 15px): buttons and text actions.
- **Label** (600, 0.875rem): form labels, a card's small heading.
- **Caption** (400, 0.875rem, at 70% ink): hints under fields and quiet explanations. Table heads drop to 13px.
- **Tag** (600, 0.75rem): the small words on chips and beside names: "Chair", "This device", "Deliberating", a sub-activity's progress on the desk.
- **Numeral** (700, tabular figures): every score, average, rank and count; sized to its surface, from table cells to the LED wall's largest figure.
- **Reading** (400, 17px, 1.625, about 72 characters a line): the privacy policy, terms and cookie policy, as a page or a dialog.
- **Broadcast** (Montserrat, 600): the LED wall. It sizes its own type on its fixed 1920×1080 stage, outside this ramp: names in capitals with wide tracking, the average as the largest figure.

### Named Rules
**The Light Title Rule.** Titles are Inter Light (300), lightly tracked in the display cut; weight belongs to labels, actions and numbers. A heading that names a group inside a page or a card (a segment, a sub-activity, a board) is semibold at the size of the text around it, never bold. Medium (500) is kept for quiet emphasis that mustn't read as a link or a label: the open tab in the sidebar, a name that isn't a link.

**The Tabular Score Rule.** Every number that can change is set in tabular figures, so a live board never shimmies as scores arrive.

## Layout

The admin panel is a sidebar and a content column on mint. From 1024px the sidebar stands at 16rem and collapses to 4.75rem of icons; below that it's a drawer from the left. Content sits in a single readable column (48rem for most forms and settings, 56rem for a pageant's program, the full width for the session desk), built from white cards stacked with 16 to 24px between them and 20px inside. Setup forms run as one page of titled sections, with an index of what's done beside them from 1280px and as a sticky chip row above them below that.

The session desk is a two-column instrument on a 1366×768 laptop: the navy desk on the left (what's on, who's still scoring, the action bar that never moves) and a single scrolling side column on the right (the program, the running order, the screens). Below that width it stacks.

The judge's screen is a single column centred on navy: the entry, then the keypad docked at the bottom, so the score is always under the thumb. From 1024px wide the entry sits beside the keypad with the timer across both. The live results fit one projected screen exactly, its rows sized to it and paging by themselves; phones and portrait screens scroll. The LED wall is drawn on a fixed 1920×1080 stage and scaled to the screen.

Spacing steps by 4px; controls are 44px tall (36px for small ones with a mouse, back to 44px on touch).

## Elevation & Depth

Flat by default. Surfaces sit on the page with hairline borders and tonal fills (white on mint, oxford on prussian); nothing at rest casts a shadow except the active sidebar row and tab, which lift by a single hairline of shade onto the card colour. A shadow means "this floats over the page": dialogs, toasts and popovers. A modal's backdrop dims the page to Prussian at 60% with a slight blur. The LED wall alone is the exception: it's on air, so it takes a broadcast pageant's finish (see LED Lower Third).

### Shadow Vocabulary
- **Resting hairline** (`box-shadow: 0 1px 2px rgb(11 37 69 / 0.08)`): the active sidebar row and tab only.
- **Floating** (`box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25)`): dialogs.
- **Toast** (`box-shadow: 0 10px 15px -3px rgb(11 37 69 / 0.4), 0 4px 6px -4px rgb(11 37 69 / 0.4)`): a confirmation that floats over a judge's screen or the panel.
- **Stage separation** (`box-shadow: 0 0 0 1px rgb(159 194 234 / 0.22)`): keeps the navy desk apart from the near-navy page in dark mode.

### Named Rules
**The Only-Floating-Lifts Rule.** A shadow is reserved for what floats over the page. Cards, panels and rows stay flat; depth at rest comes from tone and hairlines.

## Shapes

Soft, consistent curvature that grows with the size of the thing: pills for every button, badge and avatar; small 6px corners for checkboxes and tiny chips; gently rounded fields, notes and choices (12px); 16px for dialogs, toasts and keypad keys; 20px for cards and the session desk. Borders are single hairlines in Line on light surfaces and faint Powder rings on navy. Every photo is cropped square before it's stored: judges show round in the panel and square on the LED wall, entries square in lists and round above the lower third.

## Components

### Buttons
Calm and decisive: soft pills, one filled primary per moment, everything else quiet.
- **Shape:** full pill (9999px), 44px tall, 20px side padding, semibold 15px.
- **Primary:** Regal fill, Mint text; Oxford on hover. A press gives slightly underfoot (scale 0.97), not under reduced motion.
- **Quiet:** white at 60% with a Line hairline and Regal text, solid white on hover. The default for every secondary action.
- **Danger:** Danger fill with white text, Danger Ink on hover; a quiet danger (Danger hairline and text) for less final destruction.
- **Small:** 36px tall with a mouse, 44px on touch.
- **On navy:** the main action is a 56px Mint pill with Prussian text, white on hover.
- **Disabled:** half opacity, not-allowed cursor.

### Inputs / Fields
- **Style:** white, Field outline, 12px corners, 44px tall, 15px text (16px on touch, so phones don't zoom).
- **Focus:** the outline turns Regal with a soft Regal ring at 20%.
- **Disabled:** Wash fill, ink at 60%.
- **Selects:** the same field with a drawn chevron.

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** white on mint (Night Card in dark mode).
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** one Line hairline.
- **Internal Padding:** 20px.
- **Notes:** Wash panels with 12px corners for context that isn't a warning.

### Choices
Radio and checkbox options as bordered 12px tiles on white; the selected one fills Regal with Mint text, so a decision is visible at a glance.

### Navigation
The sidebar's rows are 40px (44px on touch), 12px corners, 15px. Idle rows are ink at 70%, lighting to white at 60% on hover; the open section sits on white with the resting hairline. The open activity's tabs nest under it with a 2px Regal bar marking the current one.

### Session Desk
The organizer's instrument: a 20px-cornered Prussian panel with Mint type, set into the light page. It names what's on, tiles the judges with who's still scoring, and keeps the action bar in one place; the on-air state is the red tally dot with its words. It keeps its navy in dark mode.

### Judge Keypad
The judge's whole interface on a phone: navy screen, the entry's name in Headline, and a 3×4 grid of Oxford keys (16px corners, faint Powder ring, Mint numerals sized to the screen's height), Regal while pressed. The main action under it is the Mint pill. While a scoring timer runs, the whole screen takes a deep shade of its state (green, amber, red) with the bright colour saved for the timer bar.

### Live Results Board
A projected navy board: rows ranked by average, the top three standing out, provisional averages quieter with how many judges are in, every number tabular. The entry being judged carries a Mint "Now judging" pill.

### LED Lower Third
A solid dark bar along the bottom of a chroma-green frame: the entry's round photo rising above its left end, the name in capitals, each judge's square photo on the bar's top edge with their score, and the average at the right, the largest figure once every judge is in. It takes one of ten dark themes (Navy by default), always solid, never translucent, so it keys cleanly.

The wall, lower third and full screen alike, is finished like a pageant broadcast's rather than flat: the bar and the judges' tiles are dark glass (a gloss over their top, a shade at the bottom) in a thin polished-metal rim, the number box and the final average are polished metal plates, and every photo sits in a ring of turned metal. The metal is drawn from the theme, so Black and gold has gold trim and Graphite silver. Every layer ends up opaque over the panel's own colour, and the gloss stays faint where text sits. The full screen's ground has a soft stage light from above.

## Do's and Don'ts

### Do:
- **Do** build every new surface from Prussian, Oxford, Regal, Powder and Mint, with White, Line and Wash on the light side.
- **Do** keep one filled primary button per moment; everything else is Quiet.
- **Do** keep controls at 44px on touch, and the judge's main action at 56px.
- **Do** set every score, average and count in tabular figures.
- **Do** pair every state colour (tally, judging, timer, danger) with words.
- **Do** keep surfaces flat on hairlines; lift only dialogs, toasts and popovers. (The LED wall's glass and metal is the one exception.)
- **Do** keep the stage surfaces (desk, judges, live results, LED) navy in the admin's dark mode.

### Don't:
- **Don't** make it look like a neon esports scoreboard: no glowing gradients, neon outlines or flashy counters.
- **Don't** make it a generic SaaS dashboard: no purple-blue gradients, glassmorphism or grids of KPI tiles.
- **Don't** make it playful or cute: no confetti, emoji, bouncy illustrations or mascots.
- **Don't** make it a dense grey spreadsheet of tiny type: it replaces exactly that.
- **Don't** use the chroma-key green, or anything translucent, on the LED lower third's graphic.
- **Don't** put a shadow on a card or panel at rest.
- **Don't** set titles bold: weight is for labels, actions and numbers.
