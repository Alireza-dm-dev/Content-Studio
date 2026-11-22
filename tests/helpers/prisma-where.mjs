// Minimal in-memory evaluator for the Prisma `where` shapes used by the
// Published Posts routes: equality, { in }, { notIn }, OR, and
// `collaborators: { some: { brandId } }`. `collaboratorsOf(row)` returns the
// collaborator rows for a post. Not a general Prisma emulator.

export function matchesWhere(row, where, collaboratorsOf = () => []) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!cond.some((w) => matchesWhere(row, w, collaboratorsOf))) return false;
      continue;
    }
    if (key === "collaborators") {
      const rows = collaboratorsOf(row);
      if (cond.some && !rows.some((c) => matchesWhere(c, cond.some))) return false;
      continue;
    }
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond && !cond.in.includes(row[key])) return false;
      if ("notIn" in cond && cond.notIn.includes(row[key])) return false;
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}
