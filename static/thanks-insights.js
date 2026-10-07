export function renderWordCloud(words, e) {
  const ctx = document.createElement('canvas').getContext('2d');
  const entries = words.filter(word => word.text && Number(word.count)>0).slice(0,60)
    .sort((a,b) => b.count-a.count || b.text.length-a.text.length);
  if (!entries.length) return '<p>感谢内容较简短，暂未提炼出关键词。</p>';
  const max = Math.max(...entries.map(word => Number(word.count)));
  // Search the entire rectangle, including the corners, with a tight gap.
  const points=[];
  for (let y=8;y<280;y+=6) for (let x=8;x<500;x+=6) points.push({x,y});
  points.sort((a,b) => Math.hypot((a.x-250)/250,(a.y-140)/140)-Math.hypot((b.x-250)/250,(b.y-140)/140));
  function layout(scale) {
    const placed=[];
    entries.forEach((word,index) => {
      const vertical=index>2 && index%6===0 && word.text.length<=5;
      const initial=(17+34*Math.sqrt(Number(word.count)/max)) * scale;
      for (let size=initial;size>=12;size-=3) {
        ctx.font=`700 ${size}px system-ui,sans-serif`;
        const length=ctx.measureText(word.text).width+4;
        const width=vertical ? size*1.3+6 : length, height=vertical ? length : size*1.3+6;
        const point=points.find(({x,y}) => x-width/2>=4 && x+width/2<=496 && y-height/2>=4 && y+height/2<=276 &&
          !placed.some(rect => Math.abs(x-rect.x)<(width+rect.width)/2 && Math.abs(y-rect.y)<(height+rect.height)/2));
        if (!point) continue;
        placed.push({...point,width,height,size,vertical,word,index});
        break;
      }
    });
    return placed;
  }
  let placed=[];
  for (const scale of [1.45,1.2,1,0.85]) {
    const candidate=layout(scale);
    const area=list => list.reduce((total,item) => total+item.width*item.height,0);
    if (candidate.length>placed.length || candidate.length===placed.length && area(candidate)>area(placed)) placed=candidate;
    if (placed.length===entries.length && area(placed)>500*280*0.65) break;
  }
  // Trim unused margins for sparse source data instead of repeating invented words.
  const left=Math.min(...placed.map(r=>r.x-r.width/2))-4;
  const top=Math.min(...placed.map(r=>r.y-r.height/2))-4;
  const width=Math.max(...placed.map(r=>r.x+r.width/2))-left+4;
  const height=Math.max(...placed.map(r=>r.y+r.height/2))-top+4;
  const labels=placed.map(({x,y,size,vertical,word,index}) => `<text class="thank-cloud-word tone-${index%4}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})${vertical?' rotate(-90)':''}" text-anchor="middle" dominant-baseline="central" font-size="${size.toFixed(1)}" font-weight="700"><title>${e(word.text)}：${Number(word.count)} 条感谢提及</title>${e(word.text)}</text>`);
  return `<svg class="thank-word-cloud" viewBox="${left} ${top} ${width} ${height}" role="img" aria-label="感谢内容词云：字号越大，提及越多"><title>感谢内容关键词词云</title>${labels.join('')}</svg>`;
}

export function createThanksInsights({api, escapeHtml: e, periodQuery, contextKey}) {
  const box = document.querySelector('#thankInsightPopover');
  if (!box) return {close() {}};
  let sequence = 0;
  let trigger = null;
  const content = document.querySelector('#thankInsightContent');
  function close() {
    sequence += 1;
    if (box.matches(':popover-open')) box.hidePopover();
    trigger?.setAttribute('aria-expanded','false');
    trigger = null;
  }
  function place() {
    if (!trigger || !box.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(520, innerWidth - 24);
    box.style.width = `${width}px`;
    box.style.left = `${Math.max(12,Math.min(innerWidth-width-12,rect.right-width))}px`;
    const height = box.getBoundingClientRect().height;
    const below = rect.bottom + 10;
    box.style.top = `${Math.max(12,Math.min(innerHeight-height-12,below))}px`;
  }
  async function open(button) {
    if (trigger === button && box.matches(':popover-open')) return close();
    close(); trigger=button;
    const current=++sequence, scope=contextKey(), query=periodQuery();
    button.setAttribute('aria-expanded','true');
    document.querySelector('#thankInsightTitle').textContent='Thank You 之星 · 感谢分析';
    content.innerHTML='<p role="status">正在整理感谢内容…</p>';
    box.showPopover();place();
    try {
      const data=await api(`/api/thank-you/insights?${query}&receiver_id=${encodeURIComponent(button.dataset.thankInsightId)}`);
      if (current!==sequence || scope!==contextKey() || query!==periodQuery() || !box.matches(':popover-open')) return;
      const report=data.reports?.[0];
      if (!report) throw new Error('当前时间范围暂无感谢分析');
      document.querySelector('#thankInsightTitle').textContent=`TOP${report.rank} · ${report.display_name}`;
      content.innerHTML=`<div class="thank-insight-stat"><strong>${Number(report.thanks)} 次感谢</strong><span>${e(report.period_from)} — ${e(report.period_to)}</span></div>
        <p>${e(report.summary)}</p><div class="thank-word-wall">${renderWordCloud(report.words, e)}</div>
        <details class="thank-insight-examples"><summary>看看大家怎么说</summary>${report.examples.map(text=>`<blockquote>${e(text)}</blockquote>`).join('')}</details>
        <footer><p>${e(report.method)}</p><small>更新于 ${e(new Date(report.generated_at).toLocaleString('zh-CN'))} · 定时更新</small></footer>`;
      place();
    } catch (error) {
      if (current!==sequence) return;
      content.innerHTML=`<p role="alert">${e(error.message || '感谢分析暂不可用，请稍后重试')}</p>`;place();
    }
  }
  document.querySelector('#thankStars')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-thank-insight-id]');
    if(button) open(button);
  });
  box.addEventListener('toggle',event=>{
    if(event.newState==='closed') { sequence+=1;trigger?.setAttribute('aria-expanded','false');trigger=null; }
  });
  box.querySelector('[data-thank-insight-close]')?.addEventListener('click',close);
  addEventListener('resize',place);
  addEventListener('scroll',place,true);
  return {close};
}
