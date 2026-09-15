export const heroImages = {
  auth: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=1400&q=80",
  steps: "https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&w=1200&q=80",
  running: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80",
  cycling: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=1200&q=80",
  swimming: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
  sleep: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80",
  pool: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80",
  competition: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=1200&q=80",
} as const;

export function sportImageFor(metricKey: string | null | undefined) {
  if (metricKey === "running" || metricKey === "cycling" || metricKey === "swimming" || metricKey === "sleep" || metricKey === "steps") {
    return heroImages[metricKey];
  }
  return heroImages.competition;
}
