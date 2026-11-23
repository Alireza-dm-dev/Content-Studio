// Pure, client-safe filtering for the TODAY dashboard payload.

/** Apply platform + Brand filters; hide empty Brands unless asked. */
export function filterTodayBrands(brands, { filter = "all", brandId = "all", showEmpty = false } = {}) {
  return (brands || [])
    .filter((b) => brandId === "all" || b.id === brandId)
    .map((b) => ({
      ...b,
      instagram: filter === "all" || filter === "instagram" ? b.instagram : [],
      linkedin: filter === "all" || filter === "linkedin" ? b.linkedin : [],
      stories: filter === "all" || filter === "stories" ? b.stories : [],
    }))
    .filter((b) => showEmpty || b.instagram.length + b.linkedin.length + b.stories.length > 0);
}
