#!/usr/bin/env node
// Regenerates skills/transitions-dev/ from the live transitions.dev index.html.
//
// What this does:
//   1. Reads the source HTML (path via SOURCE_HTML env var, defaulting to a
//      sibling Essencial/ checkout).
//   2. Pulls PROTO_TEMPLATES out of the inline <script> by balanced-brace
//      matching, then evaluates it in a Node vm sandbox. The object only
//      uses string concatenation and array literals, so vm-eval is safe.
//   3. Pulls every --pX-* declaration out of the :root { … } block to use
//      as the "default value" for each tunable variable.
//   4. Renders SKILL.md, _root.css, and the per-transition reference docs
//      using the templates in build/templates/.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const skillDir = path.join(repoRoot, "skills", "transitions-dev");
const templateDir = path.join(here, "templates");

const sourceHtml = process.env.SOURCE_HTML
  ? path.resolve(process.env.SOURCE_HTML)
  : path.resolve(repoRoot, "index.html");

if (!fs.existsSync(sourceHtml)) {
  console.error(`extract.mjs: source HTML not found at ${sourceHtml}`);
  console.error("Set SOURCE_HTML=/path/to/transitions.dev/index.html");
  process.exit(1);
}

const html = fs.readFileSync(sourceHtml, "utf8");

// ── Parse PROTO_TEMPLATES ─────────────────────────────────────────
// Find the literal `var PROTO_TEMPLATES = {` and walk forward until the
// matching closing brace. We respect string boundaries so a `}` inside
// a CSS string never trips the counter.
function extractObjectLiteral(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`extract.mjs: marker not found: ${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("extract.mjs: unbalanced braces in PROTO_TEMPLATES");
}

const objLiteral = extractObjectLiteral(html, "var PROTO_TEMPLATES =");
const sandbox = { result: null };
vm.createContext(sandbox);
vm.runInContext(`result = ${objLiteral};`, sandbox);
const PROTO_TEMPLATES = sandbox.result;

// ── Parse :root { --pX-*: … } defaults ────────────────────────────
const rootMatch = html.match(/:root\s*\{([\s\S]*?)\n\s*\}/);
if (!rootMatch) throw new Error("extract.mjs: no :root block found");
const rootBlock = rootMatch[1];
const defaults = new Map();
// Match one- or two-digit prototype numbers (--p1-…, --p10-…) so the
// regex keeps working as new prototypes are added beyond p9.
const declRe = /(--p\d{1,2}-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
let m;
while ((m = declRe.exec(rootBlock)) !== null) {
  defaults.set(m[1].trim(), m[2].trim().replace(/\s+/g, " "));
}

// ── Parse the motion-token layer ──────────────────────────────────
// The --pX-* defaults now reference shared motion tokens
// (--duration-*, --ease-*, --distance-*, --scale-*, --blur-*). The
// skill must stay self-contained, so we resolve those var() refs back
// to their literal ms/px values when rendering. Token values live once
// in index.html; this keeps the skill output literal.
const tokenRe =
  /(--(?:duration|ease|distance|scale|blur)-[a-z-]+)\s*:\s*([^;]+);/gi;
const tokens = new Map();
let tk;
while ((tk = tokenRe.exec(rootBlock)) !== null) {
  tokens.set(tk[1].trim(), tk[2].trim().replace(/\s+/g, " "));
}

// ── Curated metadata: ordering, file names, decision-rule copy ────
// The README's published order (card → number → badge → text → menu →
// modal → panel → page → icon) is the canonical taxonomy users see, so
// the skill mirrors it. `summary` is a one-line cell for the quick-ref
// table; `when` is a longer paragraph for each per-transition file.
const ORDER = [
  { key: "p4", file: "01-card-resize",         summary: "Tween a container's width or height when its layout state changes",
    when: "Tweening a container's width or height when its layout state changes (compact ↔ expanded card, collapsing panel, list row toggling extra detail). Pure CSS — no JS required beyond the class toggle that drives the size change." },
  { key: "p9", file: "02-number-pop-in",       summary: "Re-enter each digit with a blurred slide when a number updates",
    when: "Counters, prices, balances, or any number that updates and should re-enter from a direction with blur. Each character animates independently and the last two digits stagger so decimals feel alive without looking chaotic." },
  { key: "p1", file: "03-notification-badge",  summary: "Slide a small badge onto a trigger and pop the dot",
    when: "A small badge appearing on top of a trigger (bell, inbox, button). Slides in diagonally and pops the dot independently of the trigger so the trigger itself never moves." },
  { key: "p6", file: "04-text-states-swap",    summary: "Swap text in place with a blurred up-and-down transition",
    when: "Swapping the text of a status indicator in place — \"Processing…\" → \"Done\", \"Save\" → \"Saved\". The old text exits up with blur, the new text enters from below." },
  { key: "p2", file: "05-menu-dropdown",       summary: "Open an origin-aware dropdown that grows from its trigger",
    when: "Contextual menus, dropdowns, popovers — anything that opens from a trigger and should visually grow from that trigger's position. Origin-aware via `data-origin` (top-left, top-center, top-right, bottom-*)." },
  { key: "p7", file: "06-modal",               summary: "Scale-up modal dialog with a softer scale-down on close",
    when: "Modal dialogs and full-overlay surfaces that scale up from center. Use when the surface is conceptually \"on top of\" the page rather than anchored to a trigger." },
  { key: "p3", file: "07-panel-reveal",        summary: "Slide a panel into a region with a cross-blur",
    when: "A panel that slides into view inside an existing container — e.g. detail panel inside a card, expanding section. Combines a short translate, opacity, and a 2px cross-blur so a half-height travel still reads as a full open." },
  { key: "p8", file: "08-page-side-by-side",   summary: "Slide between two side-by-side pages (list ↔ detail, step 1 ↔ step 2)",
    when: "Sliding between two full pages or screens that live side-by-side: list ↔ detail, step 1 ↔ step 2 in a wizard. Page 1 exits left, page 2 exits right." },
  { key: "p5", file: "09-icon-swap",           summary: "Cross-fade two icons in the same slot with blur and scale",
    when: "Cross-fading two icons in the same slot — hamburger ↔ close, sun ↔ moon, play ↔ pause, expand ↔ collapse. Both icons stay in the DOM stacked in the same grid cell." },
  { key: "p10", file: "10-success-check",      summary: "Compose fade + rotate + Y-bob + path stroke-draw to celebrate a completed action",
    when: "Confirming a completed action — payment processed, file uploaded, message sent, form saved. The icon fades in, rotates upright, settles with a Y-bob, and (for SVG icons) draws its path stroke. Use whenever a status changes from \"pending / unknown\" to \"success\" and you want the moment to feel earned rather than instantaneous.\n\nThe snippet covers the **appear transition only** — bring your own hide behavior (e.g. unmount, opacity:0, or a custom exit). This is intentional: success states are usually persistent, and a soft fade-out is rarely worth the extra DOM/JS surface.",
    notes: `### Calibrating \`stroke-dasharray\` for your path

The CSS hardcodes \`stroke-dasharray: 20\` as a placeholder. For a clean draw, replace 20 with the actual length of **your** path (in user units), measured once with \`path.getTotalLength()\`. Two ways to do it:

1. **Static (recommended)** — measure the path in the browser console once, then paste the rounded-up integer into the CSS:

   \`\`\`js
   document.querySelector(".t-success-check svg path").getTotalLength()
   // → 19.42 → use stroke-dasharray: 20 (round up by 1px for safety)
   \`\`\`

2. **Dynamic** — measure on mount and set both properties inline. Use this when paths vary per-render:

   \`\`\`js
   const path = wrapper.querySelector("svg path");
   const len = Math.ceil(path.getTotalLength());
   path.style.strokeDasharray = String(len);
   path.style.strokeDashoffset = String(len);
   \`\`\`

If the dasharray is too short the stroke pre-reveals before the animation starts; too long and the path appears to draw past its end before fading in. Round up by 1px to absorb sub-pixel float jitter.` },
  { key: "p11", file: "11-avatar-group-hover", summary: "Distance-falloff lift on a row of items with a bouncy spring on return",
    when: "Hovering an item in a horizontal stack (avatar row, chip group, badge cluster, segmented button) should lift the hovered item, gently lift its neighbors with a power-falloff, then snap everything back with an overshoot spring on \`mouseleave\`. Direction-aware easing (clean ease-in on hover, bouncy ease-out on return) is what gives the group its springy, physical feel.\n\nEqually good for: pill stacks in a tag editor, chips in a filter bar, reaction-emoji rows, anywhere a horizontal row benefits from a \"comb\" interaction signal.",
    notes: `### React form

\`\`\`jsx
import { useRef } from "react";

// \`items\` is any list of React nodes (avatars, chips, badges, …)
// — this hook only owns the hover-spring transition. Each item is
// wrapped in a .t-avatar so it picks up the transform/transition
// rules from CSS.
export function AvatarGroup({ items }) {
  const rootRef = useRef(null);

  const setShifts = (activeIdx, phase) => {
    if (!rootRef.current) return;
    const cs = getComputedStyle(document.documentElement);
    const num = (name, fb) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fb;
    };
    const ease = (name, fb) =>
      cs.getPropertyValue(name).trim() || fb;

    const lift    = num("--avatar-lift", -4);
    const falloff = num("--avatar-falloff", 0.45);
    const scale   = num("--avatar-scale", 1.05);
    const tf      = phase === "out"
      ? ease("--avatar-ease-out", "cubic-bezier(0.34, 3.85, 0.64, 1)")
      : ease("--avatar-ease-in",  "cubic-bezier(0.22, 1, 0.36, 1)");

    rootRef.current.querySelectorAll(".t-avatar").forEach((el, i) => {
      el.style.transitionTimingFunction = tf;
      if (activeIdx == null) {
        el.style.setProperty("--shift", "0px");
        el.style.setProperty("--scale-active", "1");
        return;
      }
      const d = Math.abs(i - activeIdx);
      el.style.setProperty(
        "--shift",
        (lift * Math.pow(falloff, d)).toFixed(3) + "px"
      );
      el.style.setProperty(
        "--scale-active",
        i === activeIdx ? String(scale) : "1"
      );
    });
  };

  return (
    <div ref={rootRef} onMouseLeave={() => setShifts(null, "out")}>
      {items.map((node, i) => (
        <div
          key={i}
          className="t-avatar"
          onMouseEnter={() => setShifts(i, "in")}
        >
          {node}
        </div>
      ))}
    </div>
  );
}
\`\`\`

### Why the timing-function is set inline before the variable writes

Both the lift (hover-in) and the return (mouseleave) animate the same property — \`transform\`. If we declared one fixed \`transition-timing-function\` in CSS, both directions would share it. Setting it inline immediately before mutating \`--shift\` / \`--scale-active\` means each new transition picks up the timing-function that was current at the moment the property changed, giving us a clean curve on the way up and a bouncy overshoot on the way back without a second \`.is-leaving\` class.` },
  { key: "p12", file: "12-error-state-shake",  summary: "Per-segment cubic-bezier shake with auto-reverting border + message",
    when: "Form validation feedback — invalid email, wrong password, missing required field, mismatched confirmation. The input shakes left/right with overshoot, the border switches to error color, and a message reveals beneath. After a hold timer (long enough to read the message), border + message fade back to neutral. Optional: typing into the input cancels the auto-revert immediately.\n\nThe `t-` snippet is also a fit for any \"this is wrong, try again\" moment that needs a percussive hint without an OS-level alert — a wrong-PIN field on a lock screen, a duplicate-tag warning in a tag editor, a \"name already taken\" username field.",
    notes: `### Recomputing the keyframe stops

The \`%\`-stops in \`@keyframes t-input-shake\` are cumulative leg durations as a fraction of the total. The default leg pattern is **A, A, B, B** — the two big-swing legs (right peak → left peak) take \`--shake-dur-a\` each, the two recovery legs (left peak → overshoot → rest) take \`--shake-dur-b\` each:

\`\`\`
total                = 2·A + 2·B  =  2·80 + 2·60 = 280ms
stop 1 (start)       =   0  / 280 =   0%      (rest)
stop 2 (after A)     =  80  / 280 =  28.57%   (peak right,    +distance)
stop 3 (after 2·A)   = 160  / 280 =  57.14%   (peak left,    -distance)
stop 4 (after 2·A+B) = 220  / 280 =  78.57%   (overshoot,   +overshoot)
stop 5 (end)         = 280  / 280 = 100%      (rest)
\`\`\`

The total in the CSS uses \`calc(var(--shake-dur-a) * 2 + var(--shake-dur-b) * 2)\` — so the math stays consistent with the variables, but the **percentages** are baked literals. If you tune \`--shake-dur-a\` and \`--shake-dur-b\` to a different ratio, recompute the percentages by hand or the legs will drift out of sync with the duration calc.

### Why three classes (\`.is-error\` on wrap + input, \`.is-shaking\` on input)

- \`.is-error\` on \`.t-input-wrap\` controls the **message** visibility — the message lives in the wrap, not the input.
- \`.is-error\` on \`.t-input\` controls the **border color** — the input owns the border.
- \`.is-shaking\` on \`.t-input\` is **separate** from \`.is-error\` so you can replay the shake (remove → reflow → add) without flickering the error state on/off in the same tick. Keeping the shake state orthogonal also lets you trigger the shake on its own (e.g. for a "hint" jiggle) without the full error treatment.` },
  { key: "p13", file: "13-input-clear-dissolve", summary: "Fly-out + per-word streak when a text field is cleared",
    when: "Clearing a text field — search box, filter input, any field with a clear (×) button. The typed text flies down + blurs + fades while a soft per-word streak ignites under each word, and the placeholder falls in from above. Per-frame JS is required: the streak envelope and per-word gradient stack cannot be expressed as static @keyframes.",
    notes: `### Dark mode

The glow uses \`mix-blend-mode: multiply\` in light mode. In dark mode flip to \`screen\`, bump \`--glow-opacity\` to ~0.85, and paint **white** gradients in JS — multiply over a dark surface vanishes.` },
  { key: "p14", file: "14-skeleton-reveal", summary: "Pulse a placeholder, then cross-fade + cross-blur to the loaded content",
    when: "A placeholder that loads then reveals real content — list rows, cards, profile headers. The skeleton pulses, then both layers cross-fade with a matching cross-blur. Bring your own bars / avatar / text; the skeleton stays in the same slot as the content so the swap is layout-free." },
  { key: "p15", file: "15-shimmer-text", summary: "Sweep a highlight band across muted text on a loop (pure CSS)",
    when: "A loading / \"thinking\" label that shimmers — streaming status, \"Generating…\", any in-progress copy that should feel alive without a spinner. Pure CSS: duplicate the string into \`data-text\` on \`.t-shimmer\` and tune \`--shimmer-base\` / \`--shimmer-highlight\` per theme." },
  { key: "p16", file: "16-tabs-sliding", summary: "Slide the active pill between tabs in a segmented control",
    when: "A segmented control / tab bar where the active pill slides between options — view switchers, filter segments, small mutually-exclusive button sets. JS writes the active tab's \`offsetLeft\` / \`offsetWidth\` onto the pill; CSS owns the tween." },
  { key: "p17", file: "17-tooltip", summary: "Delayed fade+scale in, instant out (pure CSS)",
    when: "A hover/focus tooltip that fades + scales in with a short appear-delay but disappears immediately on leave. Pure CSS — the wrap (not the trigger) is the hover target so the pointer can drift onto the tooltip without flicker." },
  { key: "p18", file: "18-texts-reveal", summary: "Staggered blurred rise for stacked text lines, quiet fade out",
    when: "A headline + supporting line that rise into view with staggered blur — hero copy, empty states, onboarding steps. Exit is decoupled: a single quiet fade with no Y-return so dismissing doesn't replay the reveal in reverse." },
  { key: "p19", file: "19-card-tilt", summary: "Tilt a card in 3D toward the pointer with a cursor-tracked glare",
    when: "A card / tile / media surface that tilts in 3D toward the pointer while hovered, with a soft light \"glare\" tracking the cursor across it. Use for product cards, credit / membership cards, feature tiles, cover art — anything that should feel physical and reactive on hover. Pointer-only (skips touch) and flattens under reduced motion.\n\nThe pointer is tracked on an **outer flat wrapper** (`.t-tilt`) that never transforms, so the tilting card can't rotate its own edges out from under the cursor (which causes hover flicker). The inner `.t-tilt-card` is the element that actually rotates.",
    notes: `### Peak tilt angle

The rotation magnitude is a JS constant (\`MAX\`, in degrees), not a CSS variable — the orchestration writes \`--tilt-rx\` / \`--tilt-ry\` from the pointer position scaled by \`MAX\`. Raise it for a stronger lean (the live demo goes up to ~40°); 10–16° reads as a subtle, tasteful tilt.

### Why the pointer is tracked on the flat wrapper

Bind \`pointermove\` to the outer \`.t-tilt\` (which never transforms), not the \`.t-tilt-card\` that rotates. If you track the tilting element, its rotating edges slip out from under the cursor near the borders and the hover flickers on and off.

### Touch / mobile

Because it uses Pointer Events, the tilt also works on touch: tap-hold-drag on the card and it follows your finger (a touch \`pointermove\` only fires while pressed). Two pieces make this reliable — \`touch-action: none\` on \`.t-tilt\` so the drag tilts instead of scrolling the page, and \`setPointerCapture\` on \`pointerdown\` so the gesture keeps targeting the card even if the finger drifts past its edge.` },
  { key: "p20", file: "20-plus-menu-morph", summary: "Morph a circular trigger into the menu / panel it opens",
    when: "A small circular trigger (a \"+\" FAB, a compose button, an add-action affordance) that **morphs into the menu / panel it opens** instead of popping a separate surface next to it. The button's box grows in width / height and relaxes its corner radius into a rounded panel while the plus icon cross-fades + rotates out and the menu content slides in.\n\nReach for this over **menu dropdown** when the trigger and the surface are the *same* element (the button becomes the panel). Use plain **menu dropdown** when the surface is a distinct popover that merely grows from the trigger's corner.",
    notes: `### Pin the plus button to a corner

The plus button must overlay the panel, pinned to a corner (\`inset: auto 0 0 auto\`), so it stays put while the box grows up-and-left out of it. If it's in normal flow it gets shoved around as the container resizes. \`overflow: hidden\` on \`.t-morph\` is load-bearing — it clips the menu content during the size morph so items don't spill outside the growing rounded box.

### Open and close use different eases

The bouncy \`--morph-ease\` only drives the open; the close falls back to the calm \`--morph-close-ease\`. Don't collapse them into one variable. Adjust the open \`width\` / \`height\` in the snippet to your real panel size — they're hardcoded, not derived from the content.` },
  { key: "p21", file: "21-accordion", summary: "Grow / shrink a panel via grid-rows with a chevron flip",
    when: "A disclosure / accordion / collapsible section whose panel grows and shrinks in height when toggled, with the header chevron flipping between a downward \"v\" and an upward \"^\". Use for settings groups, FAQs, filter sections, \"show more\" details — any header + collapsible body.\n\nHeight animates via `grid-template-rows: 0fr ↔ 1fr`, so there's **no JS height measuring** and content of any size animates cleanly. The chevron rotates 180° to flip the \"v\" into a \"^\".",
    notes: `### Two-element panel + padding placement

The panel needs the two-element structure (\`.t-acc-panel\` grid track + \`.t-acc-panel-inner\` with \`overflow: hidden\`). The \`0fr → 1fr\` track can only collapse a child that clips its own overflow. Keep padding on \`.t-acc-panel-inner\`, never on \`.t-acc-panel\` — padding on the \`0fr\` track leaves a residual height strip so the panel never fully closes.

### Why the chevron rotates instead of morphing its path

It's tempting to morph the chevron's SVG \`d\` between a "v" and a "^", but CSS \`d:\` path interpolation is **Chromium-only** — on mobile Safari and Firefox it snaps (or doesn't move at all). Rotating the whole chevron 180° is visually identical for a symmetric glyph and animates in every browser, so that's what the snippet ships.` },
];

// ── Default-value rewrites ───────────────────────────────────────
// A handful of source defaults reference internal --pX-* tokens that
// we deliberately don't export (e.g. --p3-panel-height is a sizing
// token, not a transition knob). Substitute them with literal-friendly
// placeholders so the rendered defaults are self-contained.
const DEFAULT_REWRITES = [
  // Panel height is a per-call value, not a transition knob. Default
  // to half of a 200px panel; users override --panel-translate-y to
  // match their actual panel height.
  [/calc\(var\(--p3-panel-height\)\s*\*\s*0\.5\)/g, "100px"],
];

function rewriteDefault(value) {
  let out = value;
  for (const [re, rep] of DEFAULT_REWRITES) out = out.replace(re, rep);
  // Resolve motion-token references to their literal values so the
  // generated skill stays self-contained (no var(--duration-*) leaks).
  out = out.replace(
    /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g,
    (whole, name) => tokens.get(name) ?? whole
  );
  return out;
}

// Strip leading whitespace common to every non-empty line so HTML
// usage examples render flush-left in the markdown code fence.
function dedent(text) {
  const lines = text.replace(/^\n+|\n+$/g, "").split("\n");
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^\s*/)[0].length);
  if (indents.length === 0) return lines.join("\n");
  const min = Math.min(...indents);
  return lines.map((l) => (l.length >= min ? l.slice(min) : l)).join("\n");
}

// PROTO_TEMPLATES.usage strings start with HTML markup, then a blank
// line, then prose annotations (state machine notes, attribute legend,
// etc.). Split them so the HTML can render as a real code fence and
// the prose can render as plain text below it. Each section is dedented
// independently so the HTML sits flush left even when the prose was
// originally less indented than the markup in the source string.
function splitUsage(usage) {
  const trimmed = usage.replace(/^\n+|\n+$/g, "");
  const blankIdx = trimmed.indexOf("\n\n");
  if (blankIdx === -1) return { html: dedent(trimmed), prose: "" };
  return {
    html: dedent(trimmed.slice(0, blankIdx)),
    prose: dedent(trimmed.slice(blankIdx + 2)),
  };
}

// ── JS orchestration: shipped as small, copy-pasteable snippets ──
// Several transitions need a tiny bit of JS to drive the state changes
// (close-then-cleanup sequences, three-phase text swap, etc). These are
// distilled from prototypes.html, stripped of demo-only DOM. Any
// transition not listed here is pure CSS. JS reads from the semantic
// :root names this skill exports — not from the source --pX-* tokens.
const JS_SNIPPETS = {
  p2: `// Toggle .is-open / .is-closing with a setTimeout cleanup so the closing
// scale animates before the element resets to its pre-open rest state.
const dropdown = document.querySelector(".t-dropdown");
const closeMs = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur")
) || 150;

function openDropdown() {
  dropdown.classList.remove("is-closing");
  dropdown.classList.add("is-open");
}
function closeDropdown() {
  dropdown.classList.remove("is-open");
  dropdown.classList.add("is-closing");
  setTimeout(() => dropdown.classList.remove("is-closing"), closeMs);
}`,
  p7: `// Same close-then-cleanup pattern as the dropdown — modals scale from
// --modal-scale up to 1, then on close dip to --modal-scale-close.
const modal = document.querySelector(".t-modal");
const closeMs = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")
) || 150;

function openModal() {
  modal.classList.remove("is-closing");
  modal.classList.add("is-open");
}
function closeModal() {
  modal.classList.remove("is-open");
  modal.classList.add("is-closing");
  setTimeout(() => modal.classList.remove("is-closing"), closeMs);
}`,
  p6: `// Three-phase text swap:
//   1. Add .is-exit              — old text exits up with blur.
//   2. After --text-swap-dur, swap textContent and add .is-enter-start
//      (jumps to "below, no transition"), force a reflow.
//   3. Remove .is-enter-start    — new text animates back to rest.
const el = document.querySelector(".t-text-swap");
const dur = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur")
) || 200;

function swapText(next) {
  el.classList.add("is-exit");
  setTimeout(() => {
    el.textContent = next;
    el.classList.remove("is-exit");
    el.classList.add("is-enter-start");
    void el.offsetHeight; // force reflow so the next change transitions
    el.classList.remove("is-enter-start");
  }, dur);
}`,
  p9: `// Replay the digit pop-in: remove .is-animating, swap the digit spans,
// force a reflow, then re-add .is-animating. Mark the last two digits
// with data-stagger="1" / "2" so they ride in 1× / 2× --digit-stagger
// behind the leading digits.
const group = document.querySelector(".t-digit-group");

function setDigits(str) {
  group.classList.remove("is-animating");
  group.replaceChildren();
  const chars = str.split("");
  chars.forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "t-digit";
    span.textContent = ch;
    if (i === chars.length - 2) span.dataset.stagger = "1";
    else if (i === chars.length - 1) span.dataset.stagger = "2";
    group.appendChild(span);
  });
  void group.offsetHeight; // force reflow
  group.classList.add("is-animating");
}`,
  p8: `// Flip data-page on the container — the CSS handles the rest.
// Set --page-exit-enabled: 0 on the container if you want pages to
// fade without sliding (useful on first paint).
const slider = document.querySelector(".t-page-slide");
function showPage(n) {
  slider.setAttribute("data-page", String(n));
}`,
  p10: `// Cold-load → "out" (no animation). On show, flip to "in".
// Replay-on-retrigger: reset to "out", force a reflow, then flip
// back to "in" so the keyframes restart from offset 0.
const check = document.querySelector(".t-success-check");

function showCheck() {
  check.setAttribute("data-state", "out");
  void check.offsetWidth; // force reflow so keyframes restart
  check.setAttribute("data-state", "in");
}

// If the icon is mounted unconditionally and only shown after some
// event (e.g. await save()), the simpler form is enough:
//   check.setAttribute("data-state", "in");
// The reflow trick only matters when you replay the appear from
// an already-visible state.`,
  p11: `// Distance-falloff lift with direction-aware easing. The trick
// is setting transition-timing-function inline BEFORE writing the
// CSS variables — the browser uses whatever timing-function is
// current at the moment a transitionable property changes, so this
// gives us ease-in on the way up and a bouncy spring on the return
// without two separate transition declarations.
const root = document.querySelector(".t-avatar-group");
const avatars = Array.from(root.querySelectorAll(".t-avatar"));
const cs = getComputedStyle(document.documentElement);
const num = (name, fb) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};
const ease = (name, fb) =>
  cs.getPropertyValue(name).trim() || fb;

function setShifts(activeIdx, phase) {
  const lift    = num("--avatar-lift", -4);
  const falloff = num("--avatar-falloff", 0.45);
  const scale   = num("--avatar-scale", 1.05);
  const tf      = phase === "out"
    ? ease("--avatar-ease-out", "cubic-bezier(0.34, 3.85, 0.64, 1)")
    : ease("--avatar-ease-in",  "cubic-bezier(0.22, 1, 0.36, 1)");

  avatars.forEach((el, i) => {
    el.style.transitionTimingFunction = tf;
    if (activeIdx == null) {
      el.style.setProperty("--shift", "0px");
      el.style.setProperty("--scale-active", "1");
      return;
    }
    const d = Math.abs(i - activeIdx);
    el.style.setProperty(
      "--shift",
      (lift * Math.pow(falloff, d)).toFixed(3) + "px"
    );
    el.style.setProperty(
      "--scale-active",
      i === activeIdx ? String(scale) : "1"
    );
  });
}

avatars.forEach((el, i) => {
  el.addEventListener("mouseenter", () => setShifts(i, "in"));
});
root.addEventListener("mouseleave", () => setShifts(null, "out"));`,
  p12: `// Trigger the error state, replay the shake, and schedule the
// auto-revert. Cancel any in-flight revert so the timer always
// tracks the latest call.
const wrap = document.querySelector(".t-input-wrap");
const input = wrap.querySelector(".t-input");

const cs = getComputedStyle(document.documentElement);
const ms = (name, fb) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};

function showError() {
  wrap.classList.add("is-error");
  input.classList.add("is-error");

  // Replay the shake from a clean baseline.
  input.classList.remove("is-shaking");
  void input.offsetWidth; // force reflow
  input.classList.add("is-shaking");

  const shakeMs =
    ms("--shake-dur-a", 80) * 2 +
    ms("--shake-dur-b", 60) * 2;
  setTimeout(() => input.classList.remove("is-shaking"), shakeMs + 20);

  // Auto-revert: hold long enough to read the message, then fade
  // border + message back to neutral via the CSS transitions.
  if (wrap._revertTimer) clearTimeout(wrap._revertTimer);
  const hold = ms("--revert-hold", 3000);
  wrap._revertTimer = setTimeout(() => {
    wrap._revertTimer = null;
    wrap.classList.remove("is-error");
    input.classList.remove("is-error");
  }, shakeMs + hold);
}

// Optional but recommended: typing cancels the auto-revert and
// clears the error so the user isn't shaking at a value they're
// already correcting.
const inputEl = wrap.querySelector("input, textarea");
  inputEl?.addEventListener("input", () => {
  if (wrap._revertTimer) {
    clearTimeout(wrap._revertTimer);
    wrap._revertTimer = null;
  }
  wrap.classList.remove("is-error");
  input.classList.remove("is-error");
});`,
};

// Long orchestration lives in build/snippets/*.js so extract.mjs stays readable.
const snippetDir = path.join(here, "snippets");
for (const name of ["p13-clear.js"]) {
  const p = path.join(snippetDir, name);
  if (fs.existsSync(p)) {
    JS_SNIPPETS[name.replace(".js", "").replace("p13-clear", "p13")] =
      fs.readFileSync(p, "utf8").trim();
  }
}

Object.assign(JS_SNIPPETS, {
  p14: `const skel = document.querySelector(".t-skel");
const skeleton = skel.querySelector(".t-skel-skeleton");
const cs = getComputedStyle(document.documentElement);
const num = (name, fb) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};

// Call when async data arrives:
function reveal() {
  skel.classList.add("is-revealed");
}

// Demo replay: snap back, pulse, then reveal.
function replay() {
  skel.classList.add("is-resetting");
  skel.classList.remove("is-revealed");
  skeleton.classList.remove("is-pulsing");
  void skeleton.offsetWidth;
  skel.classList.remove("is-resetting");
  skeleton.classList.add("is-pulsing");
  const total = num("--pulse-dur", 1000) * num("--pulse-count", 1);
  setTimeout(() => skel.classList.add("is-revealed"), total);
}`,
  p16: `const bar = document.querySelector(".t-tabs");
const pill = bar.querySelector(".t-tabs-pill");
const tabs = [...bar.querySelectorAll(".t-tab")];

function moveTo(tab, animate) {
  if (!animate) {
    const prev = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = \`translateX(\${tab.offsetLeft}px)\`;
    pill.style.width = \`\${tab.offsetWidth}px\`;
    void pill.offsetWidth;
    pill.style.transition = prev;
  } else {
    pill.style.transform = \`translateX(\${tab.offsetLeft}px)\`;
    pill.style.width = \`\${tab.offsetWidth}px\`;
  }
}
const active = () =>
  tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) =>
      t.setAttribute("aria-selected", t === tab ? "true" : "false")
    );
    moveTo(tab, true);
  });
});
requestAnimationFrame(() => moveTo(active(), false));
window.addEventListener("resize", () => moveTo(active(), false));`,
  p18: `const block = document.querySelector(".t-stagger");

function showText() {
  block.classList.remove("is-hiding");
  block.classList.remove("is-shown");
  void block.offsetHeight;
  block.classList.add("is-shown");
}
function hideText() {
  block.classList.add("is-hiding");
  block.classList.remove("is-shown");
  setTimeout(() => block.classList.remove("is-hiding"), 200);
}`,
  p19: `// Track the pointer on the OUTER .t-tilt (never transforms) and write
// rotation + glare position onto the inner card. Works for mouse
// (hover) and touch / pen (tap-hold-drag) — a touch pointermove only
// fires while a finger is down, so the press naturally drives the tilt.
const tilt = document.querySelector(".t-tilt");
const card = tilt.querySelector(".t-tilt-card");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const MAX = 14; // peak tilt in degrees at the card edges (raise for a stronger lean)

function reset() {
  tilt.classList.remove("is-hover");
  card.classList.remove("is-tilting");
  card.style.setProperty("--tilt-rx", "0deg");
  card.style.setProperty("--tilt-ry", "0deg");
}

function track(e) {
  if (reduce.matches) return;
  const r = tilt.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  tilt.classList.add("is-hover");
  card.classList.add("is-tilting");
  card.style.setProperty("--tilt-ry", ((px - 0.5) * MAX).toFixed(2) + "deg");
  card.style.setProperty("--tilt-rx", ((0.5 - py) * MAX).toFixed(2) + "deg");
  card.style.setProperty("--tilt-gx", (px * 100).toFixed(1) + "%");
  card.style.setProperty("--tilt-gy", (py * 100).toFixed(1) + "%");
}

tilt.addEventListener("pointerdown", (e) => {
  // Touch / pen: capture so the drag keeps targeting the card even if
  // the finger drifts past its edge. Pair with touch-action: none on
  // .t-tilt so the drag tilts instead of scrolling the page.
  if (e.pointerType !== "mouse") {
    try { tilt.setPointerCapture(e.pointerId); } catch (_) {}
  }
});
tilt.addEventListener("pointermove", track);
tilt.addEventListener("pointerup", reset);
tilt.addEventListener("pointercancel", reset);
tilt.addEventListener("pointerleave", (e) => {
  // Mouse: leaving the card flattens it. Touch already reset on up.
  if (e.pointerType === "mouse") reset();
});`,
  p20: `// Toggle data-open on the container; CSS owns the morph. Mirror the
// state to aria-expanded and close on outside click / Escape.
const morph = document.querySelector(".t-morph");
const plus = morph.querySelector(".t-morph-plus");

function setOpen(open) {
  morph.setAttribute("data-open", String(open));
  plus.setAttribute("aria-expanded", String(open));
}

plus.addEventListener("click", (e) => {
  e.stopPropagation();
  setOpen(morph.getAttribute("data-open") !== "true");
});
document.addEventListener("click", (e) => {
  if (!morph.contains(e.target)) setOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setOpen(false);
});`,
  p21: `// Toggle data-open on the item; CSS owns the height + chevron morph.
const acc = document.querySelector(".t-acc");
const head = acc.querySelector(".t-acc-head");

head.addEventListener("click", () => {
  const open = acc.getAttribute("data-open") === "true";
  acc.setAttribute("data-open", String(!open));
  head.setAttribute("aria-expanded", String(!open));
});`,
});

// ── Render templates ──────────────────────────────────────────────
function renderTemplate(name, vars) {
  const tpl = fs.readFileSync(path.join(templateDir, name), "utf8");
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`template ${name}: missing var "${k}"`);
    return vars[k];
  });
}

function indentBlock(text, prefix) {
  return text.split("\n").map((line) => prefix + line).join("\n").trimEnd();
}

function defaultFor(internal) {
  const raw = defaults.get(internal);
  if (!raw) return "/* unset */";
  return rewriteDefault(raw);
}

function renderVarsTable(varsList) {
  const rows = varsList.map(([semantic, internal]) => {
    return `| \`${semantic}\` | \`${defaultFor(internal)}\` | sourced from \`${internal}\` |`;
  });
  return [
    "| Variable | Default | Notes |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function renderRootBlock(varsList) {
  const lines = varsList.map(([semantic, internal]) => {
    return `  ${semantic}: ${defaultFor(internal)};`;
  });
  return `:root {\n${lines.join("\n")}\n}`;
}

// ── Reference files ───────────────────────────────────────────────
const generated = [];

for (const entry of ORDER) {
  const tpl = PROTO_TEMPLATES[entry.key];
  if (!tpl) throw new Error(`extract.mjs: PROTO_TEMPLATES.${entry.key} missing`);

  const { html: usageHtml, prose: usageProse } = splitUsage(tpl.usage);
  const rendered = renderTemplate("reference.md.tmpl", {
    name: tpl.name,
    when: entry.when,
    usage: usageHtml,
    usageProse: usageProse ? `${usageProse}\n\n` : "",
    varsTable: renderVarsTable(tpl.vars),
    rootBlock: renderRootBlock(tpl.vars),
    css: tpl.css.trim(),
    jsSection: JS_SNIPPETS[entry.key]
      ? `## JavaScript orchestration\n\n\`\`\`js\n${JS_SNIPPETS[entry.key]}\n\`\`\`\n`
      : "## JavaScript orchestration\n\nNone — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.\n",
    // Optional per-prototype deep-dive content (calibration tables,
    // React variants, "why X" sidebars). Rendered below the JS
    // section, separated by a blank line. Empty string for the
    // 9 original prototypes that don't carry extras.
    notesSection: entry.notes ? `\n${entry.notes}\n` : "",
  });

  const outPath = path.join(skillDir, `${entry.file}.md`);
  fs.writeFileSync(outPath, rendered);
  generated.push(path.relative(repoRoot, outPath));
}

// ── _root.css (the universal install block) ──────────────────────
const allDecls = [];
for (const entry of ORDER) {
  const tpl = PROTO_TEMPLATES[entry.key];
  allDecls.push(`  /* ${tpl.name} */`);
  for (const [semantic, internal] of tpl.vars) {
    allDecls.push(`  ${semantic}: ${defaultFor(internal)};`);
  }
}
const rootCss = `/* transitions-dev — copy this :root block into your project once.\n   Every transition snippet reads from these semantic names. */\n:root {\n${allDecls.join("\n")}\n}\n`;
const rootPath = path.join(skillDir, "_root.css");
fs.writeFileSync(rootPath, rootCss);
generated.push(path.relative(repoRoot, rootPath));

// ── SKILL.md ─────────────────────────────────────────────────────
const tableRows = ORDER.map((entry) => {
  const tpl = PROTO_TEMPLATES[entry.key];
  return `| **${tpl.name}** | ${entry.summary}. | [${entry.file}.md](./${entry.file}.md) |`;
}).join("\n");

const skillMd = renderTemplate("skill.md.tmpl", {
  table: tableRows,
  fileList: ORDER.map((e) => `- [${e.file}.md](./${e.file}.md) — ${PROTO_TEMPLATES[e.key].name}`).join("\n"),
});
const skillPath = path.join(skillDir, "SKILL.md");
fs.writeFileSync(skillPath, skillMd);
generated.push(path.relative(repoRoot, skillPath));

// ── Summary ──────────────────────────────────────────────────────
console.log(`extract.mjs: rendered ${generated.length} files from ${path.relative(repoRoot, sourceHtml)}`);
for (const f of generated) console.log(`  ${f}`);
