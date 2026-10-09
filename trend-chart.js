// Gray bars use the right axis; store trend lines use the left axis.
function axis(max){
 const raw=Math.max(max,1)/5,power=10**Math.floor(Math.log10(raw));
 const step=([1,2,5,10].find(n=>n*power>=raw)||10)*power;
 return {step,max:Math.ceil(Math.max(max,1)/step)*step};
}
export function drawTrend(canvas,{rows,dates,stores,colors,key,unit,target,date,wide,onDate,totalLabel='全店客数'}){
 const viewport=canvas.parentElement.clientWidth||390;
 const W=wide?Math.max(viewport,dates.length*44+120,720):viewport,H=340,dpr=window.devicePixelRatio||1;
 canvas.style.width=`${W}px`;canvas.style.height=`${H}px`;canvas.width=W*dpr;canvas.height=H*dpr;
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 const pad={l:54,r:54,t:30,b:55},plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
 const x=i=>pad.l+plotW*(dates.length===1?.5:i/(dates.length-1));
 const values=rows.filter(r=>stores.includes(r.store)&&Number.isFinite(r[key])).map(r=>r[key]);
 if(!values.length){ctx.fillStyle='#475569';ctx.font='14px sans-serif';ctx.fillText('表示できるデータがありません',20,50);canvas.onclick=null;return;}
 const left=axis(Math.max(...values));
 const totals=dates.map(day=>rows.find(r=>r.date===day&&Number.isFinite(r.marketTotal))?.marketTotal??rows.filter(r=>r.date===day).reduce((sum,r)=>sum+(r.customers||0),0)),right=axis(Math.max(...totals));
 const y=v=>pad.t+plotH*(1-v/left.max);
 ctx.font='12px sans-serif';ctx.fillStyle='#475569';ctx.fillText(`${unit}（左軸）`,4,17);ctx.textAlign='right';ctx.fillText(`${totalLabel}（右軸）`,W-4,17);
 const barW=Math.min(30,plotW/Math.max(dates.length,1)*.7);
 ctx.fillStyle='#e5e7eb';totals.forEach((total,i)=>{const h=plotH*total/right.max;ctx.fillRect(x(i)-barW/2,pad.t+plotH-h,barW,h);});
 ctx.strokeStyle='#cbd5e1';ctx.lineWidth=1;
 for(let v=0;v<=left.max+left.step/10;v+=left.step){const yy=y(v);ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();ctx.textAlign='right';ctx.fillStyle='#334155';ctx.fillText(String(Math.round(v*100)/100),pad.l-8,yy+4);}
 for(let v=0;v<=right.max+right.step/10;v+=right.step){ctx.textAlign='left';ctx.fillStyle='#64748b';ctx.fillText(String(Math.round(v)),W-pad.r+8,pad.t+plotH*(1-v/right.max)+4);}
 const interval=Math.max(1,Math.ceil(dates.length/Math.max(2,Math.floor(plotW/(wide?45:60)))));
 ctx.textAlign='center';ctx.fillStyle='#475569';
 dates.forEach((day,i)=>{if(i%interval!==0&&i!==dates.length-1)return;ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(x(i),pad.t);ctx.lineTo(x(i),H-pad.b);ctx.stroke();ctx.save();ctx.translate(x(i),H-pad.b+20);if(wide)ctx.rotate(-Math.PI/4);ctx.fillText(day.slice(5).replace('-','/'),0,0);ctx.restore();});
 const dateIndex=dates.indexOf(date);if(dateIndex>=0){ctx.save();ctx.strokeStyle='#64748b';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x(dateIndex),pad.t);ctx.lineTo(x(dateIndex),H-pad.b);ctx.stroke();ctx.restore();}
 for(const store of stores){
  const data=new Map(rows.filter(r=>r.store===store).map(r=>[r.date,r]));
  ctx.strokeStyle=ctx.fillStyle=colors.get(store);ctx.lineWidth=store===target?3.5:2.5;ctx.lineJoin='round';ctx.beginPath();let connected=false;
  dates.forEach((day,i)=>{const v=data.get(day)?.[key];if(!Number.isFinite(v)){connected=false;return;}if(connected)ctx.lineTo(x(i),y(v));else ctx.moveTo(x(i),y(v));connected=true;});ctx.stroke();
  dates.forEach((day,i)=>{const v=data.get(day)?.[key];if(!Number.isFinite(v))return;ctx.beginPath();ctx.arc(x(i),y(v),day===date?4:2.5,0,Math.PI*2);ctx.fill();});
 }
 ctx.fillStyle='#475569';ctx.textAlign='left';ctx.fillText(`${dates[0]} 〜 ${dates.at(-1)}`,pad.l,H-5);
 canvas.onclick=event=>{const px=event.clientX-canvas.getBoundingClientRect().left;const i=dates.length===1?0:Math.max(0,Math.min(dates.length-1,Math.round((px-pad.l)/plotW*(dates.length-1))));onDate(dates[i]);};
}
