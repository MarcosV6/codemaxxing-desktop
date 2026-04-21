export function cn(...classes: (string | boolean | undefined | null | 0)[]): string {
  return classes.filter(Boolean).join(' ')
}
