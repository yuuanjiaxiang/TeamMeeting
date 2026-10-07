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
      const max=Math.max(1,...report.words.map(word=>word.count));
      content.innerHTML=`<div class="thank-insight-stat"><strong>${Number(report.thanks)} 次感谢</strong><span>${e(report.period_from)} — ${e(report.period_to)}</span></div>
        <p>${e(report.summary)}</p><div class="thank-word-wall" aria-label="感谢内容关键词">${report.words.map((word,i)=>`<span class="thank-wall-word tone-${i%4}" style="font-size:${14+Math.round(18*word.count/max)}px" title="${Number(word.count)} 条感谢提及">${e(word.text)}<small>${Number(word.count)}</small></span>`).join('') || '<p>感谢内容较简短，暂未提炼出关键词。</p>'}</div>
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
