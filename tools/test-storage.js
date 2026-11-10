/* tools/test-storage.js
 * Small dependency-free regression harness for schedule and state logic.
 * Run: node tools/test-storage.js
 */

'use strict';

const path = require('path');
global.self = global;
require(path.join(__dirname, '..', 'lib', 'storage.js'));

const S = global.SAStorage;
let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function schedule(overrides = {}) {
  return {
    enabled: true,
    start: '09:30',
    end: '18:30',
    days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
    ...overrides
  };
}

// 2026-11-09 is a Monday.
check('Monday 10:00 is inside a normal workday', S.isWithinSchedule({ schedule: schedule() }, at(2026, 11, 9, 10, 0)) === true);
check('Monday 09:00 is before a normal workday', S.isWithinSchedule({ schedule: schedule() }, at(2026, 11, 9, 9, 0)) === false);
check('Saturday 10:00 is outside a Mon-Fri schedule', S.isWithinSchedule({ schedule: schedule() }, at(2026, 11, 14, 10, 0)) === false);

const overnight = schedule({ start: '22:00', end: '06:00' });
check('Overnight Monday 23:00 is inside', S.isWithinSchedule({ schedule: overnight }, at(2026, 11, 9, 23, 0)) === true);
check('Overnight Tuesday 05:00 is inside Monday shift', S.isWithinSchedule({ schedule: overnight }, at(2026, 11, 10, 5, 0)) === true);
check('Overnight Tuesday 06:00 is outside', S.isWithinSchedule({ schedule: overnight }, at(2026, 11, 10, 6, 0)) === false);

const nextMonday = S.getNextScheduleChange(at(2026, 11, 13, 18, 35), schedule());
check('Friday evening finds Monday 09:30', nextMonday === at(2026, 11, 16, 9, 30).getTime(), String(nextMonday));

const nextEnd = S.getNextScheduleChange(at(2026, 11, 9, 10, 0), schedule());
check('Monday morning finds Monday 18:30', nextEnd === at(2026, 11, 9, 18, 30).getTime(), String(nextEnd));

const nextOvernightEnd = S.getNextScheduleChange(at(2026, 11, 9, 23, 0), overnight);
check('Overnight finds Tuesday 06:00 end', nextOvernightEnd === at(2026, 11, 10, 6, 0).getTime(), String(nextOvernightEnd));

const nextOvernightStart = S.getNextScheduleChange(at(2026, 11, 10, 12, 0), overnight);
check('Overnight midday finds Monday? no, Tuesday 22:00 start', nextOvernightStart === at(2026, 11, 10, 22, 0).getTime(), String(nextOvernightStart));

const migrated = S.normalize({ enabled: true, sessionStartedAt: 12345, modes: { nativeHelper: true }, intervals: { helperMinSec: 90, helperMaxSec: 60 } });
check('normalize keeps enabledAt/defaults without throwing', migrated.v === 2 && migrated.enabledAt === null);
check('normalize keeps native helper mode', migrated.modes.nativeHelper === true);
check('normalize repairs reversed helper intervals', migrated.intervals.helperMaxSec === 91, String(migrated.intervals.helperMaxSec));

const computed = S.computeEffective({ enabled: true, pauseReason: null, schedule: schedule() }, at(2026, 11, 9, 10, 0));
check('computeEffective is true when enabled and in schedule', computed === true);
const paused = S.computeEffective({ enabled: true, pauseReason: 'activity', schedule: schedule() }, at(2026, 11, 9, 10, 0));
check('computeEffective is false while paused', paused === false);

const fresh = S.defaultState();
check('defaults enable neutral clicks and both Teams sites',
  fresh.webActivity.neutralClicks === true &&
  fresh.webActivity.sites['teams.microsoft.com'] === true &&
  fresh.webActivity.sites['teams.cloud.microsoft'] === true);
const legacy = S.normalize({ enabled: true });
check('normalize fills webActivity for pre-1.2 state', legacy.webActivity.neutralClicks === true);
const custom = S.normalize({ webActivity: { neutralClicks: false, sites: { 'teams.cloud.microsoft': false, 'evil.example': true } } });
check('normalize keeps site opt-outs and drops unknown hosts',
  custom.webActivity.neutralClicks === false &&
  custom.webActivity.sites['teams.cloud.microsoft'] === false &&
  custom.webActivity.sites['teams.microsoft.com'] === true &&
  !('evil.example' in custom.webActivity.sites));

console.log('');
if (failures) {
  console.error(`${failures} test(s) failed.`);
  process.exit(1);
}
console.log('All storage/schedule tests passed.');
