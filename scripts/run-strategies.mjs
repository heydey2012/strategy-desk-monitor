/* =========================================================================
   STRATEGY DESK — GitHub Actions 실행 스크립트
   5분마다 Binance 선물 데이터를 받아 16개 전략을 계산하고 results.json에 저장합니다.
   외부 npm 패키지 의존성 없음 (Node 18+ 내장 fetch만 사용) — 실행이 빠르고 가볍습니다.
   ========================================================================= */

function sma(arr,n){ if(arr.length<n) return null; const s=arr.slice(-n); return s.reduce((a,b)=>a+b,0)/n; }

function rsi(arr,n=14){ if(arr.length<n+1) return null; const s=arr.slice(-(n+1)); let g=0,l=0;
  for(let i=1;i<s.length;i++){ const d=s[i]-s[i-1]; if(d>0)g+=d; else l-=d; } g/=n; l/=n; if(l===0) return 100; return 100-100/(1+g/l); }

function momentum(arr,n){ if(arr.length<n+1) return null; return arr[arr.length-1]/arr[arr.length-1-n]-1; }

function stddev(arr){ const m=arr.reduce((a,b)=>a+b,0)/arr.length; return Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length); }

function dailyReturns(arr){ const r=[]; for(let i=1;i<arr.length;i++) r.push(arr[i]/arr[i-1]-1); return r; }

function runSingleAssetBacktest(closes, decideFn, capital, instName){
  const n=closes.length; const equity=[capital]; const trades=[]; let pos=0;
  for(let i=1;i<n;i++){
    const soFar=closes.slice(0,i);
    const newPos=decideFn(soFar,i);
    if(newPos!==pos){
      const price=closes[i-1];
      if(newPos===1){ const qty=capital/price; trades.push({barIndex:i-1,type:'BUY',instrument:instName,price,qty,amount:qty*price}); }
      else {
        const lastBuy=[...trades].reverse().find(t=>t.type==='BUY'&&!t.closed);
        if(lastBuy){ lastBuy.closed=true; const amount=lastBuy.qty*price;
          trades.push({barIndex:i-1,type:'SELL',instrument:instName,price,qty:lastBuy.qty,amount,pnl:amount-lastBuy.amount,pnlPct:(amount/lastBuy.amount-1)*100}); }
      }
      pos=newPos;
    }
    const ret=pos*(closes[i]/closes[i-1]-1);
    equity.push(equity[equity.length-1]*(1+ret));
  }
  return {equity, trades, finalPos:pos};
}

function mulberry32(seed){ return function(){ seed|=0; seed=(seed+0x6D2B79F5)|0;
  let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

function randn(rng){ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

function genSyntheticScoreSeries(length, seed, mean, theta, vol, start){
  const rng=mulberry32(seed); const arr=[start??mean]; let v=start??mean;
  for(let i=1;i<length;i++){ v+=theta*(mean-v)+vol*randn(rng); arr.push(v); }
  return arr;
}

function buildStrategyDefs(dataset, symbolName){
  const closes = dataset[symbolName].map(k=>k.close);
  const times = dataset[symbolName].map(k=>k.closeTime);
  const n = closes.length;

  const epsArr   = genSyntheticScoreSeries(n, 41, 5.0, 0.03, 0.12, 5.0);
  const growArr  = genSyntheticScoreSeries(n, 42, 0.08,0.04, 0.05, 0.08);
  const roeArr   = genSyntheticScoreSeries(n, 43, 0.14,0.03, 0.02, 0.14);
  const divArr   = genSyntheticScoreSeries(n, 44, 0.022,0.03,0.004,0.022);
  const spreadArr= genSyntheticScoreSeries(n, 45, 0.3, 0.05, 0.25, 0.3);

  const defs = [
    {id:'01', name:'추세추종', tag:`MA(10/40) 크로스 · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar)=>{ const f=sma(soFar,10), s=sma(soFar,40); return (f&&s&&f>s)?1:0; } },
    {id:'02', name:'모멘텀', tag:`20봉 모멘텀 · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar)=>{ const m=momentum(soFar,20); return (m!==null&&m>0)?1:0; } },
    {id:'03', name:'평균회귀', tag:`RSI(14) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      holding:false, decide(soFar){ const r=rsi(soFar,14); if(r===null) return this.holding?1:0;
        if(!this.holding && r<32) this.holding=true; else if(this.holding && r>55) this.holding=false; return this.holding?1:0; } },
    {id:'04', name:'밸류', tag:`PER 밴드 (합성 EPS·실데이터 없음) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      holding:false, decide(soFar,i){ const pe=soFar[soFar.length-1]/epsArr[i]; if(!this.holding && pe<17) this.holding=true; else if(this.holding && pe>24) this.holding=false; return this.holding?1:0; } },
    {id:'05', name:'성장주', tag:`EPS성장(합성) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar,i)=> growArr[i]>0.10?1:0 },
    {id:'06', name:'퀄리티', tag:`ROE필터(합성) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar,i)=> roeArr[i]>0.14?1:0 },
    {id:'07', name:'저변동성', tag:`변동성 레짐 필터(자기 20봉vol vs 100봉 중앙값) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide(soFar){ if(soFar.length<121) return 0;
        const vol20=stddev(dailyReturns(soFar.slice(-21)));
        const volHist=[]; for(let k=soFar.length-100;k<soFar.length;k++) volHist.push(stddev(dailyReturns(soFar.slice(k-21,k))));
        const sorted=volHist.slice().sort((a,b)=>a-b);
        return vol20<sorted[Math.floor(sorted.length/2)] ? 1:0; } },
    {id:'08', name:'배당', tag:`배당수익률(합성·코인은 배당 없음) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar,i)=> divArr[i]>0.025?1:0 },
    {id:'09', name:'장기추세강도', tag:`가격 vs SMA(60) +1% 밴드 · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide(soFar){ const s=sma(soFar,60); if(!s) return 0; return soFar[soFar.length-1] > s*1.01 ? 1:0; } },
    {id:'10', name:'계절성', tag:`Sell in May · ${symbolName} (실제 캔들 시각 기준)`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar,i)=>{ const m=new Date(times[i]).getMonth()+1; return (m>=11||m<=4)?1:0; } },
    {id:'11', name:'매크로', tag:`금리차 스프레드(합성) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar,i)=> spreadArr[i]>0?1:0 },
    {id:'12', name:'이벤트', tag:`주기적 이벤트드리프트(합성) · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide:(soFar,i)=> (i%21)<5 ? 1:0 },
    {id:'13', name:'옵션(커버드콜)', tag:`OTM 콜매도 근사(캡 5%) · ${symbolName}`, kind:'covcall', closes, times },
    {id:'14', name:'DCA vs 거치식', tag:`정액분할 vs 일시매수 · ${symbolName}`, kind:'dca', closes, times },
    {id:'15', name:'퀀트멀티팩터', tag:`모멘텀·저변동 자기참조 컴포지트 · ${symbolName}`, kind:'single', closes, times, inst:symbolName,
      decide(soFar){ if(soFar.length<121) return 0;
        const mom=momentum(soFar,20); if(mom===null) return 0;
        const vol=stddev(dailyReturns(soFar.slice(-21)));
        const momHist=[], volHist=[];
        for(let k=soFar.length-100;k<soFar.length;k+=5){ const sub=soFar.slice(0,k);
          const m=momentum(sub,20); if(m!==null) momHist.push(m);
          if(sub.length>21) volHist.push(stddev(dailyReturns(sub.slice(-21)))); }
        if(momHist.length<5||volHist.length<5) return 0;
        const momAvg=momHist.reduce((a,b)=>a+b,0)/momHist.length, volAvg=volHist.reduce((a,b)=>a+b,0)/volHist.length;
        return (mom>momAvg && vol<volAvg) ? 1:0; } },
    {id:'16', name:'변동성타겟 사이징', tag:`일일 목표변동성 1% 기준 포지션 크기 조절 · ${symbolName}`, kind:'voltarget', closes, times, inst:symbolName },
  ];
  return defs.sort((a,b)=>a.id.localeCompare(b.id));
}

async function computeAllStrategies(defs, capital, opts){
  opts = opts || {};
  const computeStart = performance.now();
  const newStrategies=[], newEquity={}, newTrades={};
  for(let idx=0; idx<defs.length; idx++){
    const d = defs[idx];
    if(!opts.silent){ setProgress(idx, defs.length, `전략 ${d.id} · ${d.name}`); setETA(computeStart, idx, defs.length); }
    let result;
    if(d.kind==='single') result = runSingleAssetBacktest(d.closes, (soFar,i)=> d.decide(soFar,i), capital, d.inst);
    else if(d.kind==='basket') result = runBasketBacktest(d.basketCloses, d.basketNames, d.decideW, capital, d.rebal);
    else if(d.kind==='covcall') result = computeCoveredCall(d.closes, capital);
    else if(d.kind==='dca') result = computeDcaVsLumpsum(d.closes, capital);
    else if(d.kind==='voltarget') result = computeVolTargetSizing(d.closes, capital, d.inst || 'BASE');
    newStrategies.push({ id:d.id, name:d.name, tag:d.tag, kind:d.kind, times:d.times, finalPos:result.finalPos, finalW:result.finalW });
    newEquity[d.id] = result.equity;
    newTrades[d.id] = result.trades;
    if(!opts.silent) await new Promise(r=>setTimeout(r,0));
  }
  if(!opts.silent){ setProgress(defs.length, defs.length, '계산 완료'); document.getElementById('etaText').textContent='0초'; }
  return { strategies:newStrategies, equity:newEquity, trades:newTrades };
}

function computeCoveredCall(closes, capital){
  const n=closes.length; const equity=[capital]; const trades=[{barIndex:0,type:'BUY',instrument:'커버드콜 기초자산',price:closes[0],qty:capital/closes[0],amount:capital}];
  let cycleDay=0, cycleStart=closes[0];
  for(let i=1;i<n;i++){
    const CAP_RET=0.05, PREMIUM=0.004;
    if(cycleDay===0) cycleStart=closes[i-1];
    const retBefore=closes[i-1]/cycleStart-1, retAfter=closes[i]/cycleStart-1;
    let r; if(retBefore>=CAP_RET) r=0; else if(retAfter>CAP_RET) r=CAP_RET-retBefore; else r=closes[i]/closes[i-1]-1;
    if(cycleDay===0) trades.push({barIndex:i-1,type:'PREMIUM',instrument:'옵션 프리미엄',price:closes[i-1],qty:(capital*PREMIUM)/closes[i-1],amount:capital*PREMIUM});
    cycleDay=(cycleDay+1)%20;
    const bonus = cycleDay===1?PREMIUM:0;
    equity.push(equity[equity.length-1]*(1+r+bonus));
  }
  return {equity, trades, finalPos:1};
}

function computeDcaVsLumpsum(closes, capital){
  const n=closes.length; const equity=[capital]; const trades=[];
  const lumpShares = capital/closes[0];
  trades.push({barIndex:0,type:'BUY',instrument:'거치식 매수',price:closes[0],qty:lumpShares,amount:capital});
  const installments=20; const interval=Math.max(1, Math.floor(n/installments));
  let dcaShares=0, dcaInvested=0, bought=0;
  for(let i=0;i<n;i++){
    if(i%interval===0 && bought<installments){ const amt=capital/installments; dcaShares+=amt/closes[i]; dcaInvested+=amt; bought++;
      trades.push({barIndex:i,type:'BUY',instrument:'DCA 매수',price:closes[i],qty:amt/closes[i],amount:amt}); }
    if(i>0) equity.push(dcaShares>0 ? dcaShares*closes[i] : capital);
  }
  return {equity, trades, finalPos:1};
}

function computeVolTargetSizing(closes, capital, symbolName){
  const n=closes.length; const equity=[capital];
  const trades=[{barIndex:0,type:'BUY',instrument:`${symbolName} (변동성타겟 포지션)`,price:closes[0],qty:capital/closes[0],amount:capital}];
  const targetDailyVol = 0.01;
  for(let i=1;i<n;i++){
    const ret = closes[i]/closes[i-1]-1;
    let w = 1;
    if(i>=21){
      const recentVol = stddev(dailyReturns(closes.slice(i-21,i)));
      w = recentVol>0 ? Math.min(1, targetDailyVol/recentVol) : 1;
    }
    equity.push(equity[equity.length-1]*(1+w*ret));
  }
  return {equity, trades, finalPos:1};
}

function parseCsvToKlines(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0);
  if(lines.length<2) throw new Error('빈 CSV');
  const header = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/"/g,''));
  const dateIdx = header.findIndex(h=>h.includes('date')||h.includes('time')||h.includes('일자')||h.includes('시각'));
  let closeIdx = header.findIndex(h=>h==='close');
  if(closeIdx===-1) closeIdx = header.findIndex(h=>h.includes('close'));
  if(dateIdx===-1 || closeIdx===-1) throw new Error('Date/Time, Close 컬럼을 찾을 수 없습니다. 헤더를 확인해주세요.');

  function parseDate(s){
    s = s.trim().replace(/"/g,'');
    const kr = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if(kr){ const [,y,mo,d]=kr;
      const timeMatch = s.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);
      let h=0,m=0;
      if(timeMatch){ h=+timeMatch[2]; m=+timeMatch[3]; if(timeMatch[1]==='오후' && h<12) h+=12; if(timeMatch[1]==='오전' && h===12) h=0; }
      return new Date(+y, +mo-1, +d, h, m).getTime();
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  const rows=[];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(',');
    if(cols.length<=Math.max(dateIdx,closeIdx)) continue;
    const ts = parseDate(cols[dateIdx]);
    const close = parseFloat((cols[closeIdx]||'').replace(/[",]/g,''));
    if(ts===null || isNaN(close)) continue;
    rows.push({openTime:ts, close, closeTime:ts});
  }
  if(rows.length<2) throw new Error('파싱 가능한 행이 부족합니다');
  if(rows[0].openTime > rows[rows.length-1].openTime) rows.reverse(); // 최신순 CSV 대응: 오래된순으로 정렬
  return rows;
}


/* ================= 설정 (환경변수로 바꿀 수 있음) ================= */
const SYMBOL = process.env.SYMBOL || 'DOGEUSDT';
const INTERVAL = process.env.INTERVAL || '5m';
const CAPITAL = Number(process.env.CAPITAL || 10000);
const LIMIT = Number(process.env.LIMIT || 500); // 웜업 캔들 수

const STRATEGY_NAME_KO = SYMBOL.replace('USDT', '-USDT');

/* ================= Binance Futures 공개 API ================= */
async function fetchBinanceKlines(symbol, interval, limit){
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if(!res.ok){
    const body = await res.text().catch(()=> '');
    throw new Error(`Binance API 오류 (HTTP ${res.status}): ${body.slice(0,200)}`);
  }
  const data = await res.json();
  if(!Array.isArray(data) || data.length === 0) throw new Error('Binance 응답이 비어있습니다');
  return data.map(k => ({ openTime:k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5], closeTime:k[6] }));
}

/* ================= 메인 ================= */
async function main(){
  console.log(`[${new Date().toISOString()}] ${SYMBOL} ${INTERVAL} 데이터 수신 중...`);
  const klines = await fetchBinanceKlines(SYMBOL, INTERVAL, LIMIT);
  console.log(`캔들 ${klines.length}개 수신 완료. 16개 전략 계산 중...`);

  const dataset = { [STRATEGY_NAME_KO]: klines };
  const defs = buildStrategyDefs(dataset, STRATEGY_NAME_KO);
  const { strategies, equity, trades } = await computeAllStrategies(defs, CAPITAL, { silent:true });

  const ranked = strategies.map(s => {
    const eq = equity[s.id];
    const pct = (eq[eq.length-1] / eq[0] - 1) * 100;
    const isLong = s.finalPos === 1;
    const t = (trades[s.id] || []).slice(-15).map(tr => ({
      time: klines[tr.barIndex] ? new Date(klines[tr.barIndex].closeTime).toISOString() : null,
      type: tr.type, instrument: tr.instrument,
      price: +tr.price.toFixed(6), qty: +tr.qty.toFixed(6), amount: +tr.amount.toFixed(2),
      pnl: tr.pnl !== undefined ? +tr.pnl.toFixed(2) : null,
      pnlPct: tr.pnlPct !== undefined ? +tr.pnlPct.toFixed(3) : null,
    }));
    const sparkline = eq.slice(-40).map(v => +((v/eq[0]-1)*100).toFixed(3));
    return { id:s.id, name:s.name, tag:s.tag, pct:+pct.toFixed(3), badge:isLong?'LONG':'FLAT', trades:t, sparkline };
  }).sort((a,b)=> b.pct - a.pct);

  const first = klines[0], last = klines[klines.length-1];
  const output = {
    symbol: SYMBOL, symbolLabel: STRATEGY_NAME_KO, interval: INTERVAL, capital: CAPITAL,
    periodStart: new Date(first.openTime).toISOString(),
    periodEnd: new Date(last.closeTime).toISOString(),
    candleCount: klines.length,
    generatedAt: new Date().toISOString(),
    strategies: ranked,
  };

  const fs = await import('node:fs/promises');
  await fs.writeFile('results.json', JSON.stringify(output, null, 2));
  console.log(`완료. 1위: STRAT${ranked[0].id} ${ranked[0].name} (${ranked[0].pct}%)`);
}

main().catch(err => { console.error('실행 실패:', err); process.exit(1); });
