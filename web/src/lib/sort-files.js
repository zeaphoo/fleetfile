const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortFiles(files, sortBy, sortOrder) {
  return [...files].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;

    let comparison;
    switch (sortBy) {
      case "size":
        comparison = (a.size ?? 0) - (b.size ?? 0);
        break;
      case "dateModified":
        comparison = (a.modified ?? 0) - (b.modified ?? 0);
        break;
      case "type":
        comparison = naturalCollator.compare(a.file_type || "", b.file_type || "");
        if (comparison === 0) comparison = naturalCollator.compare(a.name, b.name);
        break;
      default:
        comparison = naturalCollator.compare(a.name, b.name);
    }
    return sortOrder === "desc" ? -comparison : comparison;
  });
}

export const DATE_GROUP_LABELS = {
  today: "today",
  yesterday: "yesterday",
  earlierThisWeek: "earlierThisWeek",
  lastWeek: "lastWeek",
  earlierThisMonth: "earlierThisMonth",
  lastMonth: "lastMonth",
  older: "older",
};

const GROUP_ORDER = [
  "today",
  "yesterday",
  "earlierThisWeek",
  "lastWeek",
  "earlierThisMonth",
  "lastMonth",
  "older",
];

export function getDateGroup(modifiedTs) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const modifiedMs = (modifiedTs ?? 0) * 1000;

  if (modifiedMs >= todayStart) return "today";
  if (modifiedMs >= todayStart - 86_400_000) return "yesterday";

  const dayOfWeek = (now.getDay() + 6) % 7;
  const weekStart = todayStart - dayOfWeek * 86_400_000;
  if (modifiedMs >= weekStart) return "earlierThisWeek";
  if (modifiedMs >= weekStart - 7 * 86_400_000) return "lastWeek";

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (modifiedMs >= monthStart) return "earlierThisMonth";
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  if (modifiedMs >= lastMonthStart) return "lastMonth";

  return "older";
}

export function groupFilesByDate(files) {
  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, []]));
  for (const file of files) {
    groups[getDateGroup(file.modified)].push(file);
  }
  return GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => ({
    group: g,
    label: DATE_GROUP_LABELS[g],
    files: groups[g],
  }));
}
