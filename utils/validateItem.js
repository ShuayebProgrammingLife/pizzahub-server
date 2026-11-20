import { CATEGORIES } from "./constants.js";

export function validateItem(body = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};
  const has = (k) => body[k] !== undefined;

  const text = (key, label, min, max) => {
    if (!has(key)) {
      if (!partial) errors.push(`${label} is required`);
      return;
    }
    if (typeof body[key] !== "string") return errors.push(`${label} must be text`);
    const v = body[key].trim();
    if (v.length < min || v.length > max) errors.push(`${label} must be ${min}-${max} characters`);
    else data[key] = v;
  };

  text("itemName", "Item name", 2, 80);
  text("description", "Description", 10, 1000);
  text("location", "Location", 2, 80);

  if (has("category")) {
    if (!CATEGORIES.includes(body.category)) errors.push("Invalid category");
    else data.category = body.category;
  } else if (!partial) errors.push("Category is required");

  if (has("price")) {
    const p = Number(body.price);
    if (!Number.isFinite(p) || p <= 0 || p > 100000) errors.push("Price must be a positive number");
    else data.price = Math.round(p * 100) / 100;
  } else if (!partial) errors.push("Price is required");

  if (has("images")) {
    const imgs = body.images;
    const ok =
      Array.isArray(imgs) &&
      imgs.length >= 1 &&
      imgs.length <= 4 &&
      imgs.every((u) => {
        try {
          return new URL(u).protocol === "https:";
        } catch {
          return false;
        }
      });
    if (!ok) errors.push("Provide 1 to 4 valid image URLs");
    else data.images = imgs;
  } else if (!partial) errors.push("At least one image is required");

  return { data, errors };
}