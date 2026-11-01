// Las prioridades siguen guardándose como números en el frontmatter.
export const PRIORITIES = [
  { value: 1, label: "Alta" },
  { value: 2, label: "Media" },
  { value: 3, label: "Baja" },
] as const;

export function priorityLabel(value: number | null): string {
  return PRIORITIES.find((p) => p.value === value)?.label ?? "";
}
