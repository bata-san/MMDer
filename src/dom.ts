export function $(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function $all<T extends Element = HTMLElement>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector)];
}

export function input(selector: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(selector);
  if (!element) throw new Error(`Missing input: ${selector}`);
  return element;
}

export function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing button: ${selector}`);
  return element;
}

export function output(selector: string): HTMLOutputElement {
  const element = document.querySelector<HTMLOutputElement>(selector);
  if (!element) throw new Error(`Missing output: ${selector}`);
  return element;
}

export function extension(file: Pick<File, 'name'>): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export function objectUrl(file: Blob): string {
  return URL.createObjectURL(file);
}

export function revokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}

export function toast(text: string): void {
  const root = document.querySelector<HTMLElement>('#toast');
  if (!root) { console.info(text); return; }
  root.textContent = text;
  root.classList.add('show');
  window.clearTimeout(Number(root.dataset.timer ?? 0));
  const timer = window.setTimeout(() => root.classList.remove('show'), 2500);
  root.dataset.timer = String(timer);
}

export function setNotice(text = 'READY — LOCAL MODE'): void {
  const notice = document.querySelector<HTMLElement>('#notice');
  if (notice) notice.textContent = text;
}
