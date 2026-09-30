/** Joins class-name fragments, dropping falsy values — replaces the manual
 * template-literal ternaries that were scattered across components/ui. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
