import { supabase, rpc } from "./supabase.js";
import { escapeHtml } from "./escape.js";

// WHAT: everything a vendor's team needs to manage their products: list,
//       add, edit, set stock, pause, withdraw an edit, remove, upload photos.
// WHY:  pages call these small functions and get { ok, data, error } back.
// SECURITY: the database decides everything. A vendor can't publish:
//       new products and every edit wait for admin approval. Stock changes
//       are the one instant change, because they aren't a content change.

const BUCKET = "catalog-images";
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const listProducts = (vendorId) => rpc("vendor_list_products", { p_vendor_id: vendorId });

const fields = (f) => ({
  p_name: f.name,
  p_description: f.description,
  p_price: f.price,
  p_category_id: f.categoryId,
  p_image: f.image || null,
  p_availability: f.availability,
});

export const submitProduct = (vendorId, f) => rpc("vendor_submit_product", { p_vendor_id: vendorId, ...fields(f) });
export const editProduct = (productId, f) => rpc("vendor_edit_product", { p_product_id: productId, ...fields(f) });
export const setStock = (productId, stock) => rpc("vendor_set_stock", { p_product_id: productId, p_stock: stock });
export const pauseProduct = (productId) => rpc("vendor_pause_product", { p_product_id: productId });
export const withdrawEdit = (productId) => rpc("vendor_withdraw_edit", { p_product_id: productId });
export const removeProduct = (productId) => rpc("vendor_remove_product", { p_product_id: productId });

export function checkImage(file) {
  if (!file) return "";
  if (!IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG or WebP photo.";
  if (file.size > MAX_IMAGE_BYTES) return "That photo is over 3 MB. Choose a smaller one.";
  return "";
}

// Photos go into this store's own folder; the database refuses anywhere else.
export async function uploadPhoto(vendorId, file) {
  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `vendor-products/${vendorId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) return { ok: false, error: "We couldn't upload that photo. Please try again." };
    return { ok: true, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  } catch (error) {
    return { ok: false, error: "We couldn't upload that photo. Please try again." };
  }
}

// The category list, loaded once.
let categoryCache = null;
export async function loadCategories() {
  if (categoryCache) return categoryCache;
  const { data, error } = await supabase.from("categories").select("id, name").order("name");
  if (error || !data) return [];
  categoryCache = data;
  return data;
}

export function formatNaira(amount) {
  return "₦" + Number(amount).toLocaleString("en-NG");
}

// A missing or broken photo becomes a quiet tile with the first letter of
// the name, instead of a broken-image icon.
function placeholderTile(letter) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#EFEDE4"/>` +
    `<text x="200" y="150" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="80" font-weight="700" fill="#66716B">${escapeHtml(letter)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function withImageFallback(imgEl) {
  const showPlaceholder = () => {
    const name = (imgEl.alt || "").trim();
    imgEl.src = placeholderTile((name.charAt(0) || "?").toUpperCase());
  };
  imgEl.addEventListener("error", showPlaceholder, { once: true });
  if (!imgEl.getAttribute("src")) showPlaceholder();
}
