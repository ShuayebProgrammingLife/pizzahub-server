export const OID = /^[a-f\d]{24}$/i;

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const clean = (v, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const rx = (s) => new RegExp(escapeRegex(s), "i");

export function paging(q, def = 10) {
  return {
    page: Math.max(1, parseInt(q.page) || 1),
    limit: Math.min(50, Math.max(1, parseInt(q.limit) || def)),
  };
}

export const pageInfo = (total, page, limit) => ({
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
});