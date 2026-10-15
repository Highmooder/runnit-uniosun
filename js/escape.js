// Makes text and links safe to place into HTML.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Only ordinary web addresses are allowed as image or link targets.
export function safeUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? text : "";
  } catch (error) {
    return "";
  }
}

export function attrUrl(value) {
  return escapeHtml(safeUrl(value));
}
