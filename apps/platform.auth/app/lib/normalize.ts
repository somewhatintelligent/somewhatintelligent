export function toStringArray(value: unknown, splitOn: " " | "json" = "json"): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") {
    if (splitOn === "json") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed.filter((v): v is string => typeof v === "string")
          : [];
      } catch {
        return [];
      }
    }
    return value.split(" ").filter(Boolean);
  }
  return [];
}
