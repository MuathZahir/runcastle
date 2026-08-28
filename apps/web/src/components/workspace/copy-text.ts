export function copyText(
  text: string,
  toast: { push: (m: string, k?: 'error' | 'info' | 'success') => void },
): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.push(`copied ${text}`, 'info'))
    .catch(() => toast.push('copy failed'))
}
