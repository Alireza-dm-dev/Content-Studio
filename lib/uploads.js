// Canonical set of upload purposes used across the app.
// slug   → used as DB value and URL path segment
// label  → display name

export const FILE_PURPOSES = [
  { slug: "brand-logo",          label: "Brand Logo" },
  { slug: "brand-screenshot",    label: "Brand Screenshot" },
  { slug: "website-screenshot",  label: "Website Screenshot" },
  { slug: "social-screenshot",   label: "Social Media Screenshot" },
  { slug: "previous-design",     label: "Previous Design" },
  { slug: "reference-image",     label: "Reference Image" },
];

export const PURPOSE_SLUGS = FILE_PURPOSES.map((p) => p.slug);

export const PURPOSE_LABEL = Object.fromEntries(
  FILE_PURPOSES.map((p) => [p.slug, p.label])
);
