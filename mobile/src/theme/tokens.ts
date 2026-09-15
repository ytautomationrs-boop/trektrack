// Design reference palette/fonts — the single source of truth for color.
// Nothing in components/ should hardcode a hex value; import from here.

export const colors = {
  bg: "#0b0d12",
  surface: "#17191f",
  surfaceRaised: "#24272f",
  text: "#ffffff",
  sub: "#c9cbd1",
  accent: "#ff2f3f",
  accent2: "#ffffff",
  glass: "rgba(23, 25, 31, 0.72)",
  line: "rgba(255, 255, 255, 0.14)",
  sage: "#64d48a",
  risk: "#f5c15b",
  fail: "#ff6b6b",
  won: "#ffe06d",
} as const;

// Fixed status token set — applied identically across dashboard cards, the
// daily result modal, and challenge history so a color always means the
// same thing everywhere in the app.
export const statusColors = {
  on_track: colors.sage,
  at_risk: colors.risk,
  failed: colors.fail,
  completed: colors.won,
  sync_issue: colors.accent,
} as const;

export const statusLabels: Record<keyof typeof statusColors, string> = {
  on_track: "On track",
  at_risk: "At risk",
  failed: "Failed",
  completed: "Completed",
  sync_issue: "Sync issue",
};

export const fonts = {
  display: "Figtree_700Bold",
  body: "Figtree_400Regular",
  bodyMedium: "Figtree_500Medium",
  bodySemiBold: "Figtree_600SemiBold",
  bodyBold: "Figtree_700Bold",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
