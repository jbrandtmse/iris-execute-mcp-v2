/**
 * Shared rendering helpers for {@link PromptDefinition.build} implementations
 * (Epic 25, Story 25.1 content; extracted Story 26.4, CR 25.1-4).
 *
 * Every prompt file previously hand-rolled its OWN local `arg()` helper that
 * collapses an omitted OR empty-string argument to a bracketed placeholder,
 * while the surrounding "was this argument provided?" note-branch logic
 * independently keyed off `value !== undefined` alone. That divergence meant
 * an explicitly-empty string (`production: ""`) took the "provided" branch's
 * wording yet rendered the literal placeholder text (e.g. `Diagnose
 * \`<query>\``). Both concerns now come from ONE definition of "provided" —
 * {@link isArgProvided} — so the two checks can never drift apart again.
 */

/**
 * `true` when `value` is a non-empty, explicitly-supplied argument. An
 * omitted optional argument (`undefined`) and an explicitly-empty string
 * (`""`) are BOTH treated as "not provided" — matching {@link argOrPlaceholder}.
 */
export function isArgProvided(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * Render `value` when provided (per {@link isArgProvided}), otherwise a
 * bracketed placeholder (e.g. `<query>`) for the static skills-pack doc
 * (`build({})` — every argument omitted).
 */
export function argOrPlaceholder(value: string | undefined, placeholder: string): string {
  return isArgProvided(value) ? value : placeholder;
}
