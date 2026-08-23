import type { AccentTheme } from "@/lib/accent";

/**
 * The contract both world-level renderers satisfy, so `MapExplorer` can choose
 * between them without knowing which it got.
 *
 * Identical to what `WorldMapProps` already was — extracted rather than
 * invented, so the flat map is not a special case of the globe or the reverse.
 * Two renderers, one interface, one selection contract.
 */
export interface WorldLevelProps {
  /** ISO alpha-2 of the country currently chosen, if any. */
  selectedCountry?: string | null;
  onSelectCountry: (code: string) => void;
  /**
   * Which accent ramp to tint with. Defaults to the ramp `PrefsProvider`
   * resolved — resolving the theme a second time here would let the map
   * disagree with the page it sits on. Override only to render a fixed ramp.
   */
  theme?: AccentTheme;
}
