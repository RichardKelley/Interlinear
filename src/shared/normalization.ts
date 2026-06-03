export function normalizeTerm(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[.,;:!?()[\]{}"“”‘’]/gu, "")
    .replace(/\s+/gu, " ");
}

export function termsEqual(left: string, right: string): boolean {
  return normalizeTerm(left) === normalizeTerm(right);
}

