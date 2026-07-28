export function click(id: string): void { document.getElementById(id)?.click(); }

export function clickSelector(selector: string): void { document.querySelector<HTMLElement>(selector)?.click(); }

export function setValue(id: string, value: number | string): void {
  const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setChecked(id: string, checked: boolean): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
