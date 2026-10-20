import type { JobName } from './tasks.js';

export const SCHEDULE_TZ = 'Asia/Kolkata';

/** Start of an IST calendar day (`YYYY-MM-DD`), as an instant. */
export const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

/** Start of the IST day after `date`: the exclusive upper bound of "up to and including `date`". */
export const istDayEnd = (date: string) => new Date(istDayStart(date).getTime() + 24 * 3600 * 1000);

/** Scheduled jobs (cron in IST). Registered by the worker with BullMQ job schedulers. */
export const schedules: { id: string; job: JobName; pattern: string }[] = [
  { id: 'aggregate-dirty', job: 'aggregate-dirty', pattern: '*/15 * * * *' },
  { id: 'aggregate-full-rebuild', job: 'aggregate-full-rebuild', pattern: '30 23 * * *' },
  { id: 'generate-insights', job: 'generate-insights', pattern: '30 18 * * *' },
  { id: 'generate-daily-brief', job: 'generate-daily-brief', pattern: '0 19 * * *' },
  { id: 'collector-watchdog', job: 'collector-watchdog', pattern: '*/5 * * * *' },
  { id: 'propose-dictionary-aliases', job: 'propose-dictionary-aliases', pattern: '0 6 * * 0' },
];
