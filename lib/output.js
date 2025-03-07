import { table } from "table";

export function widetable(matrix, columns = []) {
  const drawVerticalLine = (a, b) => a == 0 || a == b || columns.includes(a);
  return table(matrix, { drawVerticalLine });
}

export function assembleTable(info, content) {
  const keys = Array.isArray(info) ? info : Object.keys(info);
  const rows = content.map((row) => keys.map((key) => row[key] || ""));

  const emptyValue = (value) => value === null || value === undefined || value === "";
  const header = (Array.isArray(info) ? info : Object.values(info)).map((label, i) => {
    return rows.every((row) => emptyValue(row[i])) ? "" : label || "";
  });
  return [header].concat(rows);
}

export function timeAgo(date) {
  const output = (c, label) => ((c = Math.floor(c)), `${c} ${label}${c === 1 ? "" : "s"} ago`);
  let ms = Math.floor(new Date() - date);

  if (ms < 10000) return "just now";
  if ((ms /= 1000) < 60) return output(ms, "second");
  if ((ms /= 60) < 60) return output(ms, "minute");
  if ((ms /= 60) < 24) return output(ms, "hour");
  if ((ms /= 24) < 28) return output(ms, "day");
  if ((ms /= 30) < 24) return output(ms, "month"); // approximation
  return output(ms / 12, "year");
}
