import { PRIORITIES } from "./priority.ts";
import "./priority.css";

export function PrioritySelector({ value, onChange }: { value: unknown; onChange(value: number | null): void }) {
  const choices = [{ value: null, label: "Sin prioridad" }, ...PRIORITIES];
  return (
    <div class="priority-selector" role="group" aria-label="Prioridad">
      {choices.map((choice) => (
        <button type="button" key={choice.label} aria-pressed={choice.value === null ? value == null || value === "" : String(value) === String(choice.value)}
          onClick={() => onChange(choice.value)}>{choice.label}</button>
      ))}
    </div>
  );
}
