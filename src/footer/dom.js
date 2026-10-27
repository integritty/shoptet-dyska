// Tiny DOM builder. Text always goes through textContent, never through HTML parsing.
export function el(tag, props, children) {
  const node = document.createElement(tag);
  const options = props || {};
  for (const key of Object.keys(options)) {
    const value = options[key];
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "on") {
      for (const type of Object.keys(value)) node.addEventListener(type, value[type]);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children || []) {
    if (child) node.appendChild(child);
  }
  return node;
}
