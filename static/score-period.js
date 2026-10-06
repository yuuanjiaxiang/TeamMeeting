export function scoreMonthPeriod(year, month) {
  const y = Number(year), m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new RangeError("Invalid score month");
  }
  const prefix = `${y}-${String(m).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${new Date(y, m, 0).getDate()}` };
}

export function initializeScorePeriod(yearInput, monthInput, now = new Date()) {
  if (!yearInput.options.length) {
    for (let year = 2100; year >= 2000; year--) yearInput.add(new Option(`${year} 年`, String(year)));
    yearInput.value = String(now.getFullYear());
  }
  if (!monthInput.options.length) {
    for (let month = 1; month <= 12; month++) monthInput.add(new Option(`${month} 月`, String(month)));
    monthInput.value = String(now.getMonth() + 1);
  }
}
