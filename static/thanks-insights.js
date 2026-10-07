export function renderWordCloud(words, e) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const placed = [];
  const max = Math.max(1, ...words.map(word => Number(word.count)));
  const labels = [];
  words.slice(0, 40).sort((a,b) => b.count-a.count).forEach((word, index) => {
    let size = 20 + 34 * Math.sqrt(Number(word.count)/max);
    const vertical = index > 2 && index % 5 === 0;
    for (; size >= 12; size -= 2) {
      ctx.font = `700 ${size}px sans-serif`;
      const length = ctx.measureText(word.text).width + 8;
      const width = vertical ? size+8 : length, height = vertical ? length : size+8;
      let location = null;
      for (let step=0; step<2400; step++) {
        const angle=step*0.23, radius=1.9*Math.sqrt(step);
        const x=250+Math.cos(angle)*radius*2.3-width/2;
        const y=160+Math.sin(angle)*radius*1.5-height/2;
        if (x<6 || y<6 || x+width>494 || y+height>314) continue;
        if (placed.some(rect => x<rect.x+rect.width && x+width>rect.x && y<rect.y+rect.height && y+height>rect.y)) continue;
        location={x,y,width,height};break;
      }
      if (!location) continue;
      placed.push(location);
      const x=location.x+width/2, y=location.y+height/2;
      labels.push(`<text class="thank-cloud-word tone-${index%4}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})${vertical ? ' rotate(-90)' : ''}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="700"><title>${e(word.text)}：${Number(word.count)} 条感谢提及</title>${e(word.text)}</text>`);
      break;
    }
  });
  return labels.length ? `<svg class="thank-word-cloud" viewBox="0 0 500 320" role="img" aria-label="感谢内容词云：字号越大，提及越多"><title>感谢内容关键词词云</title>${labels.join('')}</svg>` : '<p>感谢内容较简短，暂未提炼出关键词。</p>';
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
