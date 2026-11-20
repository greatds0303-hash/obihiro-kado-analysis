import {validDate} from './report-parser.js';

const DAY = 86400000;
const dateValue = date => Date.parse(`${date}T00:00:00Z`);
const offsetDate = (date, days) => new Date(dateValue(date) + days * DAY).toISOString().slice(0, 10);

export function marketRange(latest, period) {
 if (!validDate(latest)) return {from:'', to:''};
 return {from:offsetDate(latest, 1 - Number(period)), to:latest};
}

const REPORT_HOURS = [11, 15, 19];

export function marketObservations(rows, time) {
 if (time !== 'average') return rows.filter(row => row.time === Number(time));

 const byStoreDay = new Map();
 for (const {date, store, time:hour, customers} of rows) {
  if (!REPORT_HOURS.includes(hour)) continue;
  const key = JSON.stringify([date, store]);
  if (!byStoreDay.has(key)) byStoreDay.set(key, {date, store, byHour:new Map()});
  byStoreDay.get(key).byHour.set(hour, customers);
 }

 const averages = [];
 for (const {date, store, byHour} of byStoreDay.values()) {
  if (byHour.size !== REPORT_HOURS.length) continue;
  const total = REPORT_HOURS.reduce((sum, hour) => sum + byHour.get(hour), 0);
  averages.push({date, store, customers:total / REPORT_HOURS.length});
 }
 return averages;
}

function marketMetrics(days) {
 const total = days.reduce((sum, day) => sum + day.market, 0);
 const own = days[0].own == null ? null : days.reduce((sum, day) => sum + day.own, 0);
 return {
  market: total / days.length,
  own: own == null ? null : own / days.length,
  share: total && own != null ? own / total * 100 : null,
 };
}

export function summarizeMarket(rows, {from, to, target}) {
 if (!validDate(from) || !validDate(to) || from > to) return null;
 const count = (dateValue(to) - dateValue(from)) / DAY + 1;
 const previousRange = {from:offsetDate(from, -count), to:offsetDate(from, -1)};
 const byDate = new Map();
 for (const row of rows) {
  if (row.date < previousRange.from || row.date > to) continue;
  if (!byDate.has(row.date)) byDate.set(row.date, new Map());
  byDate.get(row.date).set(row.store, row.customers);
 }

 // Select the most frequently reported store roster in the chosen period.
 const reports = [...byDate].sort(([a], [b]) => b.localeCompare(a)).map(([date, stores]) => {
  const names = [...stores.keys()].sort();
  return {date, stores, names, key:JSON.stringify(names)};
 });
 const current = reports.filter(report => report.date >= from);
 if (!current.length) return {count, days:[], previousRange};
 const rosters = new Map();
 for (const report of current) {
  if (!rosters.has(report.key)) rosters.set(report.key, {key:report.key, names:report.names, frequency:0});
  rosters.get(report.key).frequency++;
 }
 const [roster] = [...rosters.values()].sort((a, b) => b.frequency - a.frequency || b.names.length - a.names.length);
 const complete = reports.filter(report => report.key === roster.key).map(({date, stores}) => ({
  date,
  stores,
  market: [...stores.values()].reduce((total, customers) => total + customers, 0),
  own: stores.get(target) ?? null,
 }));
 const days = complete.filter(day => day.date >= from).reverse();
 const priorByDate = new Map(complete.filter(day => day.date < from).map(day => [day.date, day]));
 const matched = days.filter(day => priorByDate.has(offsetDate(day.date, -count)));
 const previous = matched.map(day => priorByDate.get(offsetDate(day.date, -count)));
 const average = (list, store) => list.reduce((sum, day) => sum + day.stores.get(store), 0) / list.length;
 const stores = roster.names.map(name => ({
  name,
  customers: average(days, name),
  change: matched.length ? average(matched, name) - average(previous, name) : null,
 })).sort((a, b) => b.customers - a.customers || a.name.localeCompare(b.name, 'ja'));
 return {
  count, days, stores, previousRange, metrics:marketMetrics(days),
  comparison:matched.length ? {count:matched.length, current:marketMetrics(matched), previous:marketMetrics(previous)} : null,
 };
}
