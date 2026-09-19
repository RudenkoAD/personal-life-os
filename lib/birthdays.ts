import type { LifeState } from './domain.ts';
type BirthdaySeries = LifeState['calendarSeries'][number];

export function birthdayDate(series: BirthdaySeries, year: number) {
  const month = series.startDate.slice(5, 7),
    day = series.startDate.slice(8, 10);
  if (
    month === '02' &&
    day === '29' &&
    new Date(Date.UTC(year, 1, 29)).getUTCDate() !== 29
  )
    return `${year}-02-28`;
  return `${year}-${month}-${day}`;
}
