// 2026-07-29 (T5, tag-admin-and-score-rework) — shared slugify helper.
//
// Root cause of "my created categories are gone": the Taxonomy panel made
// admins hand-type BOTH a human label AND a machine id validated as
// `/^[a-z0-9-]+$/` (schemas.ts TagCategoryPostSchema). Typing only the label
// ("People & Characters") into the id field 400s with "id must be
// lowercase-kebab" — the category was never actually created, every save
// silently failed client-side. This derives the id FROM the label instead.

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
