export function $(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
}
export function $all(selector) {
    return [...document.querySelectorAll(selector)];
}
export function input(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing input: ${selector}`);
    return element;
}
export function button(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing button: ${selector}`);
    return element;
}
export function output(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing output: ${selector}`);
    return element;
}
export function extension(file) {
    return file.name.split('.').pop()?.toLowerCase() ?? '';
}
export function objectUrl(file) {
    return URL.createObjectURL(file);
}
export function revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
}
export function toast(text) {
    const root = $('#toast');
    root.textContent = text;
    root.classList.add('show');
    window.clearTimeout(Number(root.dataset.timer ?? 0));
    const timer = window.setTimeout(() => root.classList.remove('show'), 2500);
    root.dataset.timer = String(timer);
}
export function setNotice(text = 'READY — LOCAL MODE') {
    $('#notice').textContent = text;
}
