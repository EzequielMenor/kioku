// Colores de las opciones de selección: clase CSS del chip (colores en app.css) y nombres en español de la paleta. Sin JSX.
import { OPTION_COLORS } from "../../src/core/database.ts";
import type { OptionColor, PropOption } from "./types.ts";

export { OPTION_COLORS };

export const OPTION_LABELS: Record<OptionColor, string> = {
  gray: "Gris", brown: "Marrón", orange: "Naranja", yellow: "Amarillo", green: "Verde", blue: "Azul", purple: "Morado", red: "Rojo",
};

/** `opt-<color>`; sin color (o con un color que la paleta no conoce) el chip es neutro. */
export function optionClass(color: OptionColor | undefined): string {
  return color && OPTION_COLORS.includes(color) ? `opt-${color}` : "opt-none";
}

/** Clase del chip de un valor de selección según la opción del esquema que lo nombra. */
export const valueClass = (options: PropOption[] | undefined, value: string): string => optionClass(options?.find((o) => o.name === value)?.color);
