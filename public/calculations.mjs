// Every view is derived from the latest committed database snapshot.
// Currency arithmetic uses integer minor units; payments are not sales revenue.
const cents = value => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const money = value => value / 100;
const iso = date => date.toISOString().slice(0, 10);
const dayDate = value => new Date(`${value}T12:00:00Z`);
const addDays = (date, count) => { const copy = dayDate(date); copy.setUTCDate(copy.getUTCDate() + count); return iso(copy); };
export function todayDubai(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function periodBounds(period = 'month', anchor = todayDubai()) {
  const date = dayDate(anchor);
  if (!Number.isFinite(date.getTime()) || iso(date) !== anchor) throw new Error('Invalid calendar date');
  if (period === 'day') return { start: anchor, end: anchor };
  if (period === 'week') { const start = addDays(anchor, -((date.getUTCDay() + 6) % 7)); return { start, end: addDays(start, 6) }; }
  if (period === 'month') { const last = dayDate(`${anchor.slice(0,7)}-01`); last.setUTCMonth(last.getUTCMonth()+1,0); return { start: `${anchor.slice(0, 7)}-01`, end: iso(last) }; }
  if (period === 'year') return { start: `${anchor.slice(0, 4)}-01-01`, end: `${anchor.slice(0, 4)}-12-31` };
  if (period === 'all') return { start: null, end: null };
  throw new Error('Unknown period');
}
function totals(sales, expenses) {
  const revenue = sales.reduce((sum, row) => sum + cents(row.unitPrice) * row.quantity, 0);
  const costs = sales.reduce((sum, row) => sum + cents(row.unitCost) * row.quantity, 0);
  const spent = expenses.reduce((sum, row) => sum + cents(row.amount), 0);
  const profit = revenue - costs - spent;
  return { sales: money(revenue), expenses: money(spent), costOfGoods: money(costs), netProfit: money(profit), profitMargin: revenue ? profit / revenue * 100 : 0 };
}
export function calculate(state, { period = 'month', anchor = todayDubai(), now } = {}) {
  const products = state.products || [], sales = state.sales || [], expenses = state.expenses || [], payments = state.payments || [];
  const bounds = periodBounds(period, anchor);
  const included = row => (!bounds.start || row.date >= bounds.start) && (!bounds.end || row.date <= bounds.end);
  const filteredSales = sales.filter(included), filteredExpenses = expenses.filter(included), filteredPayments = payments.filter(included);
  const selected = totals(filteredSales, filteredExpenses), lifetime = totals(sales, expenses);
  const today = todayDubai(now);
  const daily = totals(sales.filter(s => s.date === today), expenses.filter(e => e.date === today));
  const sold = new Map(), paid = new Map();
  for (const sale of sales) sold.set(sale.productId, (sold.get(sale.productId) || 0) + sale.quantity);
  for (const payment of payments) paid.set(payment.saleId, (paid.get(payment.saleId) || 0) + cents(payment.amount));
  const inventory = products.map(p => ({ ...p, remaining: p.initialStock - (sold.get(p.id) || 0) }));
  const saleBalances = sales.map(s => { const total = cents(s.unitPrice) * s.quantity, received = paid.get(s.id) || 0; return { ...s, total: money(total), paid: money(received), due: money(total - received) }; });
  const unpaidSales = saleBalances.filter(s => cents(s.due) > 0).sort((a,b) => a.date.localeCompare(b.date));
  const capital = cents(state.settings?.capital), earned = cents(lifetime.netProfit);
  const recovered = Math.min(capital, Math.max(0, earned));
  const performance = new Map();
  for (const s of filteredSales) {
    const p = performance.get(s.productId) || { id: s.productId, name: products.find(p => p.id === s.productId)?.name || 'منتج', quantity: 0, revenue: 0, profit: 0 };
    p.quantity += s.quantity; p.revenue += cents(s.unitPrice) * s.quantity; p.profit += (cents(s.unitPrice) - cents(s.unitCost)) * s.quantity; performance.set(s.productId, p);
  }
  let start = bounds.start, end = bounds.end, monthly = period === 'year';
  if (period === 'all') {
    const dates = [...sales, ...expenses].map(x => x.date).sort();
    start = dates[0] || today; end = dates.at(-1) || today;
    monthly = (dayDate(end) - dayDate(start)) / 86400000 > 90;
  }
  const buckets = new Map();
  const bucket = date => monthly ? `${date.slice(0,7)}-01` : date;
  if (monthly) {
    let d = `${start.slice(0,7)}-01`;
    while (d <= end) { buckets.set(d, { date: d, sales: 0, expenses: 0, costOfGoods: 0 }); const next=dayDate(d); next.setUTCMonth(next.getUTCMonth()+1); d=iso(next); }
  } else for (let d = start; d <= end; d = addDays(d,1)) buckets.set(d, { date: d, sales: 0, expenses: 0, costOfGoods: 0 });
  for (const s of filteredSales) { const row = buckets.get(bucket(s.date)); if(row){ row.sales += cents(s.unitPrice) * s.quantity; row.costOfGoods += cents(s.unitCost) * s.quantity; } }
  for (const e of filteredExpenses) { const row = buckets.get(bucket(e.date)); if(row) row.expenses += cents(e.amount); }
  const series = [...buckets.values()].map(r => ({ date:r.date, sales:money(r.sales), expenses:money(r.expenses), netProfit:money(r.sales-r.costOfGoods-r.expenses) }));
  return {
    ...selected, ...bounds, period, anchor, series, daily, inventory, saleBalances,
    filteredSales, filteredExpenses, filteredPayments,
    outstanding: money(unpaidSales.reduce((sum,s)=>sum+cents(s.due),0)),
    stockUnits: inventory.reduce((sum,p)=>sum+p.remaining,0),
    lowStock: inventory.filter(p=>p.remaining<=p.lowStock), unpaidSales,
    capitalRecovered:money(recovered), capitalRemaining:money(Math.max(0,capital-earned)), capitalProgress:capital ? recovered/capital*100 : 0,
    allTimeProfit:lifetime.netProfit,
    productPerformance:[...performance.values()].map(p=>({...p,revenue:money(p.revenue),profit:money(p.profit)})).sort((a,b)=>b.revenue-a.revenue),
  };
}
