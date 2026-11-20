import {marketObservations, marketRange, summarizeMarket} from './market-report-analysis.js?v=41';

const number = new Intl.NumberFormat('ja-JP', {maximumFractionDigits:1});
const format = (value, unit) => value == null ? '—' : number.format(value) + unit;
const rounded = value => Math.round(value * 10) / 10 || 0;
const signed = (value, unit) => value == null ? '—' : (rounded(value) > 0 ? '+' : '') + format(rounded(value), unit);
const difference = (current, previous) => current == null || previous == null ? null : current - previous;
const dates = ({from, to}) => from === to ? from : from + ' ～ ' + to;

function element(tag, text, className) {
 const node = document.createElement(tag);
 if (text != null) node.textContent = text;
 if (className) node.className = className;
 return node;
}

function table(headers, rows, caption, highlight = () => false) {
 const node = element('table');
 node.append(element('caption', caption, 'market-visually-hidden'));
 const heading = node.createTHead().insertRow();
 for (const label of headers) {
  const cell = element('th', label);
  cell.scope = 'col';
  heading.append(cell);
 }
 const body = node.createTBody();
 rows.forEach((values, index) => {
  const row = body.insertRow();
  row.classList.toggle('market-own', highlight(values, index));
  for (const value of values) row.insertCell().textContent = value;
 });
 return node;
}

function drawTrend(canvas, days, range) {
 if (!days.length) return;
 const width = canvas.clientWidth;
 if (!width) return;
 const height = 176;
 const scale = window.devicePixelRatio || 1;
 canvas.width = Math.round(width * scale);
 canvas.height = Math.round(height * scale);
 const ctx = canvas.getContext('2d');
 ctx.scale(scale, scale);
 const pad = {left:50, right:14, top:12, bottom:28};
 const plot = {width:width-pad.left-pad.right, height:height-pad.top-pad.bottom};
 const highest = days.reduce((max, day) => Math.max(max, day.market), 1);
 const tickSize = Math.max(1, Math.ceil(highest / 3));
 const max = tickSize * 3;
 const dateNumber = day => Date.parse(day + 'T00:00:00Z');
 const start = dateNumber(range.from);
 const span = dateNumber(range.to) - start;
 const x = date => pad.left + plot.width * (span ? (dateNumber(date) - start) / span : 0.5);
 const y = value => pad.top + plot.height * (1 - value / max);

 ctx.font = '12px system-ui, sans-serif';
 ctx.fillStyle = '#475569';
 ctx.strokeStyle = '#d9deea';
 ctx.textAlign = 'right';
 for (let index = 0; index <= 3; index++) {
  const tick = index * tickSize;
  ctx.fillText(number.format(tick), pad.left - 7, y(tick) + 4, pad.left - 9);
  ctx.beginPath();
  ctx.moveTo(pad.left, y(tick));
  ctx.lineTo(width - pad.right, y(tick));
  ctx.stroke();
 }
 const tickCount = span ? (width > 490 ? 5 : 3) : 1;
 for (let index = 0; index < tickCount; index++) {
  const date = new Date(start + span * index / Math.max(1, tickCount - 1)).toISOString().slice(0, 10);
  ctx.textAlign = index === tickCount - 1 ? 'right' : index === 0 ? 'left' : 'center';
  ctx.fillText(date.slice(5).replace('-', '/'), tickCount === 1 ? x(date) + 14 : x(date), height - 6);
 }
 ctx.strokeStyle = '#0a62b5';
 ctx.fillStyle = '#0a62b5';
 ctx.lineWidth = 2;
 ctx.beginPath();
 days.forEach((day, index) => {
  const contiguous = index > 0 && dateNumber(day.date) - dateNumber(days[index - 1].date) === 86400000;
  if (contiguous) ctx.lineTo(x(day.date), y(day.market));
  else ctx.moveTo(x(day.date), y(day.market));
 });
 ctx.stroke();
 for (const day of days) {
  ctx.beginPath();
  ctx.arc(x(day.date), y(day.market), 2.5, 0, Math.PI * 2);
  ctx.fill();
 }
}

export function setupMarket(getRows, target, bindChange) {
 const $ = id => document.getElementById('market' + id);
 const preset = $('Preset');
 const from = $('From');
 const to = $('To');
 const time = $('Time');
 let report = '';
 let trend = null;
 const redraw = () => { if (trend) drawTrend($('Chart'), trend.days, trend.range); };

 function render() {
  const rows = marketObservations(getRows(), time.value);
  const isAverage = time.value === 'average';
  const timeLabel = time.selectedOptions[0].textContent;
  let earliest = '';
  let latest = '';
  for (const row of rows) {
   if (!earliest || row.date < earliest) earliest = row.date;
   if (row.date > latest) latest = row.date;
  }
  if (preset.value !== 'custom') {
   const range = preset.value === 'all' ? {from:earliest, to:latest} : marketRange(latest, preset.value);
   from.value = range.from;
   to.value = range.to;
  }

  const range = {from:from.value, to:to.value};
  const scope = range.from && range.to && range.from <= range.to ? dates(range) + ' ｜ ' + timeLabel : '';
  const result = summarizeMarket(rows, {...range, target});
  $('Scope').textContent = scope;
  $('Feedback').textContent = '';
  $('Results').hidden = !result?.days.length;
  $('Actions').hidden = $('Results').hidden;
  report = '';
  trend = null;

  if (preset.value === 'custom' && (!range.from || !range.to)) {
   $('Status').textContent = '開始日と終了日を入力してください。';
   return;
  }
  if (!result && range.from && range.to) {
   $('Status').textContent = '開始日は終了日以前に設定してください。';
   return;
  }
  if (!result?.days.length) {
   $('Status').textContent = latest
    ? '選択した期間に集計できる報告がありません。' + timeLabel + 'の集計可能な範囲は ' + dates({from:earliest, to:latest}) + ' です。'
    : isAverage ? '同じ店舗・同じ日の11・15・19時の報告がそろうと平均を表示します。'
    : 'この時刻の報告がありません。稼働報告を取り込むか、報告時刻を変更してください。';
   return;
  }

  const {count, days, stores, metrics, comparison, previousRange} = result;
  const latestLabel = isAverage ? '3時刻がそろった最新日 ' : timeLabel + 'の最新報告 ';
  const coverage = '集計 ' + days.length + ' / ' + count + '日 ・ 対象 ' + stores.length + '店舗 ・ ' + latestLabel + latest;
  const prior = dates(previousRange);
  const comparisonLabel = comparison
   ? '直前の同日数（' + prior + '）と比較 ・ 対応 ' + comparison.count + ' / ' + days.length + '日。'
   : '直前の同日数（' + prior + '）に比較できる報告がありません。';
  $('Status').textContent = coverage;
  $('Comparison').textContent = comparisonLabel;
  const metricsList = [
   ['対象店舗の平均客数', 'market', '名', '名'],
   ['帯広店の平均客数', 'own', '名', '名'],
   ['帯広店の客数シェア', 'share', '%', 'pt'],
  ];
  $('Metrics').replaceChildren(...metricsList.map(([label, key, unit, changeUnit]) => {
   const card = element('div', null, 'market-metric');
   const change = difference(comparison?.current[key], comparison?.previous[key]);
   card.append(
    element('div', label),
    element('strong', format(metrics[key], unit)),
    element('div', change == null ? '前期間比 —' : '前期間比 ' + signed(change, changeUnit),
     change > 0 ? 'market-up' : change < 0 ? 'market-down' : ''),
   );
   return card;
  }));

  const observations = '市場は平均' + format(metrics.market, '名')
   + (metrics.own == null ? '。対象店舗に帯広店の報告はありません。'
    : '、帯広店は平均' + format(metrics.own, '名') + '、客数シェアは' + format(metrics.share, '%') + 'です。');
  const compareText = comparison ? metricsList.flatMap(([label, key, unit, changeUnit]) => {
   const change = difference(comparison.current[key], comparison.previous[key]);
   return change == null ? [] : [label + ' ' + format(comparison.previous[key], unit) + ' → '
    + format(comparison.current[key], unit) + '（' + signed(change, changeUnit) + '）'];
  }).join('、') + '。' : '';
  const competitors = stores.filter(store => store.name !== target);
  const increased = competitors.filter(store => rounded(store.change) > 0).sort((a,b) => b.change - a.change)[0];
  const decreased = competitors.filter(store => rounded(store.change) < 0).sort((a,b) => a.change - b.change)[0];
  const moves = [[increased, '増加'], [decreased, '減少']].flatMap(([store, label]) => store
   ? [label + 'が最も大きい競合は' + store.name + '（' + signed(store.change, '名') + '）'] : []);
  let competition = competitors.length ? '競合の平均客数トップは' + competitors[0].name + '（' + format(competitors[0].customers, '名') + '）。' : 'この集計範囲に競合店の報告はありません。';
  if (moves.length) competition += '前期間比で' + moves.join('、') + 'です。';
  const followup = !comparison || metrics.own == null
   ? '次の確認候補：比較期間や帯広店の報告を追加し、同じ時刻で比較する。'
   : '次の確認候補：帯広店の時間帯比較と貸玉別比較で、客数差が大きい時間・貸玉を確認する。';

  $('Conclusion').textContent = observations + ' ' + compareText;
  $('Competition').textContent = competition;
  $('Followup').textContent = followup;
  $('Stores').replaceChildren(table(
   ['順位', '店舗', '平均客数', '前期間差'],
   stores.map((store, index) => [index + 1, store.name, format(store.customers, '名'), signed(store.change, '名')]),
   '対象店舗の客数順位', (_, index) => stores[index].name === target,
  ));
  $('Daily').replaceChildren(table(
   ['日付', isAverage ? '市場平均客数' : '市場客数', isAverage ? '帯広店平均客数' : '帯広店客数', '帯広店シェア'],
   days.map(day => [day.date, format(day.market, '名'), format(day.own, '名'), format(day.market && day.own != null ? day.own / day.market * 100 : null, '%')]),
   '集計対象日の日別客数とシェア',
  ));

  const averageMethod = isAverage ? '同じ店舗・同じ日の11・15・19時がすべてそろった客数を、同じ重みで平均しています。' : '';
  const method = '出典は取り込んだ稼働報告です。' + averageMethod + '市場の平均客数は、表示期間で最も多く報告された店舗の組み合わせに一致する日を集計。客数シェアは帯広店の延べ客数 ÷ 対象店舗の延べ客数。前期間比は、各期間の1日目同士、2日目同士のように、両方で対象店舗がそろう日を比較しています。';
  $('Method').textContent = method;
  report = ['EAGLE 帯広店 市場の要約', scope, coverage, comparisonLabel,
   observations, compareText, competition, followup, '集計方法 ' + method].filter(Boolean).join('\n');
  trend = {days, range};
  redraw();
 }

 bindChange(preset, render);
 bindChange(time, render);
 for (const input of [from, to]) {
  input.addEventListener('change', () => {
   preset.value = 'custom';
   render();
  });
 }
 $('Copy').addEventListener('click', async () => {
  if (!report) return;
  try {
   await navigator.clipboard.writeText(report);
   $('Feedback').textContent = '要約をコピーしました。';
  } catch {
   $('Feedback').textContent = '自動コピーを利用できません。会議で伝えるポイントを選択してコピーできます。';
  }
 });
 $('Print').addEventListener('click', () => window.print());
 window.addEventListener('resize', redraw);
 return render;
}
