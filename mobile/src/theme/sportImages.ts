export const heroImages = {
  auth: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?fm=jpg&fit=crop&w=1000&q=70",
  steps: "https://images.unsplash.com/photo-1501555088652-021faa106b9b?fm=jpg&fit=crop&w=900&q=70",
  running: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?fm=jpg&fit=crop&w=900&q=70",
  cycling: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?fm=jpg&fit=crop&w=900&q=70",
  swimming: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?fm=jpg&fit=crop&w=900&q=70",
  sleep: "https://images.unsplash.com/photo-1519681393784-d120267933ba?fm=jpg&fit=crop&w=900&q=70",
  pool: "https://images.unsplash.com/photo-1519681393784-d120267933ba?fm=jpg&fit=crop&w=900&q=70",
  competition: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?fm=jpg&fit=crop&w=900&q=70",
} as const;

export function sportImageFor(metricKey: string | null | undefined) {
  if (metricKey === "running" || metricKey === "cycling" || metricKey === "swimming" || metricKey === "sleep" || metricKey === "steps") {
    return heroImages[metricKey];
  }
  return heroImages.competition;
}
