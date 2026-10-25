/* ANES AI research explorer — no external JS libraries required. */
(function () {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = (value) => {
    try {
      const u = new URL(value);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch (_) { return ''; }
  };
  const getToday = () => {
    const d = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date());
    const pick = (type) => (d.find(p => p.type === type) || {}).value || '';
    return pick('year') + '-' + pick('month') + '-' + pick('day');
  };
  const today = getToday();
  const todayTime = Date.parse(today + 'T00:00:00Z');
  const daysSince = (s) => {
    if (!s || !/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return null;
    const t = Date.parse((s.length === 7 ? s + '-01' : s) + 'T00:00:00Z');
    return Number.isFinite(t) ? Math.round((todayTime - t) / 86400000) : null;
  };
  const isFuture = (s) => { const days = daysSince(s); return days != null && days < 0; };
  const displayDate = (s) => s ? escapeHtml(s) : '日期待核验';
  const sourceType = (p) => {
    if (p.id && String(p.id).startsWith('legacy-')) return '原站目录';
    if (p.archive) return '历史简报';
    return 'PubMed 自动题录';
  };
  const clinicalType = (p) => {
    if (p.clinical_field) return p.clinical_field;
    const s = [p.title,p.title_zh,p.topic,(p.categories||[]).join(' ')].join(' ').toLowerCase();
    if (/重症|脓毒|呼吸机|sepsis|intensive care|critical care|ventilat|icu\b/.test(s)) return '重症';
    if (/围术|术前|术后|perioperat|preoperat|postoperat|surgic|surgery/.test(s)) return '围术期';
    if (/麻醉|anesth|anaesth|闭环与智能给药/.test(s)) return '麻醉';
    return '通用医学 / 待分类';
  };

  let papers = [], events = [], briefs = [], updateStatus = {}, detailedSummaries = {};
  let section = 'research', mode = 'all', filtered = [], shown = 20;
  let favorites;
  try { favorites = new Set(JSON.parse(localStorage.getItem('anesSaved') || '[]')); }
  catch (_) { favorites = new Set(); }
  const saveFavorites = () => { try { localStorage.setItem('anesSaved', JSON.stringify(Array.from(favorites))); } catch (_) {} };
  const sectionText = {
    research: ['科研前沿','跨期刊精选 · 可追溯的研究线索'],
    competition: ['比赛机会','医学人工智能 · 科研转化与创新竞赛'],
    conference: ['会议与征集','摘要投稿 · 墙报与学术交流'],
    saved: ['我的收藏','仅保存在当前浏览器中的私人研究书架'],
    briefs: ['简报原文与溯源','历史简报日期索引 · 数据可追溯']
  };
  const getOptions = (values, name) => '<option value="">' + escapeHtml(name) + '</option>' +
    Array.from(new Set(values.filter(Boolean).map(String))).sort((a,b) => a.localeCompare(b,'zh-CN')).map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('');

  function resetFilters() {
    ['journal','topic','studyType','clinical','stateFilter','batch','startDate','endDate','query'].forEach(id => { if (byId(id)) byId(id).value = ''; });
    byId('dateRange').value = 'all';
    byId('savedOnly').checked = false;
    byId('sort').value = 'new';
    shown = 20;
  }

  function rebuildFilters() {
    const research = section === 'research' || section === 'saved';
    const data = research ? papers : events.filter(e => e.category === section);
    byId('journalLabel').textContent = research ? '期刊' : '主办机构';
    byId('journal').innerHTML = getOptions(data.map(e => research ? e.journal : e.organizer || e.journal), research ? '全部期刊' : '全部主办机构');
    byId('topic').innerHTML = getOptions(data.map(e => e.topic), '全部主题');
    byId('studyType').innerHTML = getOptions(data.map(e => e.study_type), '全部研究类型');
    byId('clinical').innerHTML = getOptions(research ? data.map(clinicalType) : [], '全部领域');
    byId('stateFilter').innerHTML = research ? '<option value="curated">精选研究（默认）</option><option value="">全部资料</option><option value="automated">自动检索题录</option>' + Array.from(new Set(data.map(sourceType))).filter(Boolean).map(v=>'<option value="'+escapeHtml(v)+'">'+escapeHtml(v)+'</option>').join('') : getOptions(data.map(e => e.status), '全部收录状态');
    byId('stateFilter').value = research && section === 'research' ? 'curated' : '';
    byId('batch').innerHTML = getOptions(briefs.map(x => x.date).filter(Boolean).reverse(), '全部简报批次');
    ['studyGroup','clinicalGroup','batchGroup','savedGroup'].forEach(id => byId(id).classList.toggle('hidden', !research));
  }

  function setSection(next) {
    section = next;
    document.querySelectorAll('[data-section]').forEach(el => {
      const isCurrent = el.dataset.section === section;
      el.classList.toggle('active', isCurrent);
      el.setAttribute('aria-current', isCurrent ? 'page' : 'false');
    });
    const [title,subtitle] = sectionText[section] || sectionText.research;
    byId('pageTitle').textContent = title;
    byId('pageSubtitle').textContent = subtitle;
    byId('tabsArea').classList.toggle('hidden', !['research','saved'].includes(section));
    byId('filterable').classList.toggle('hidden', section === 'briefs');
    byId('briefsArea').classList.toggle('hidden', section !== 'briefs');
    byId('export').classList.toggle('hidden', section === 'briefs');
    if(section === 'briefs') renderBriefs();
    else { resetFilters(); rebuildFilters(); render(); }
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function setMode(next) {
    mode = next;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === next));
    render();
  }

  function listData() {
    const research = section === 'research' || section === 'saved';
    const base = research ? papers : events.filter(x => x.category === section);
    const query = byId('query').value.trim().toLocaleLowerCase();
    const journal = byId('journal').value, topic = byId('topic').value;
    const study = byId('studyType').value, clinical = byId('clinical').value;
    const state = byId('stateFilter').value, batch = byId('batch').value;
    const range = byId('dateRange').value, start = byId('startDate').value, end = byId('endDate').value;
    const requireSaved = section === 'saved' || byId('savedOnly').checked;
    const compareSearch = x => [x.title,x.title_zh,x.description,x.journal,x.organizer,x.topic,
      (x.categories || []).join(' '),x.doi].filter(Boolean).join(' ').toLocaleLowerCase();
    const data = base.filter(x => {
      if (requireSaved && !favorites.has(x.id)) return false;
      if (query && !compareSearch(x).includes(query)) return false;
      if (journal && (research ? x.journal : x.organizer || x.journal) !== journal) return false;
      if (topic && x.topic !== topic) return false;
      if (research && study && x.study_type !== study) return false;
      if (research && clinical && clinicalType(x) !== clinical) return false;
      if (research && state === 'curated' && !x.archive && !(x.id||'').startsWith('legacy-')) return false;
      if (research && state === 'automated' && (x.archive || (x.id||'').startsWith('legacy-'))) return false;
      if (state && !['curated','automated'].includes(state) && (research ? sourceType(x) : x.status) !== state) return false;
      if (research && batch && !(x.brief_dates || []).includes(batch)) return false;
      if (range !== 'all') {
        const diff = daysSince(x.date);
        if (range === 'custom') {
          if (start && (x.date || '') < start) return false;
          if (end && (x.date || '') > end) return false;
        } else if (diff === null || diff < 0 || diff > Number(range)) return false;
      }
      return true;
    });
    const s = byId('sort').value;
    data.sort((a,b) => {
      if(s === 'journal' || (mode === 'journal' && s === 'new')) {
        const name = x => (x.journal || x.organizer || '').toLowerCase();
        const cmp = name(a).localeCompare(name(b),'zh-CN');
        return cmp || (b.date || '').localeCompare(a.date || '');
      }
      if(mode === 'topic' && s === 'new') {
        const cmp = (a.topic||'').localeCompare(b.topic||'','zh-CN');
        return cmp || (b.date||'').localeCompare(a.date||'');
      }
      if(s === 'old') return (a.date||'').localeCompare(b.date||'');
      // A PubMed issue/volume date may be in the future. Keep it in the archive,
      // but do not make a future date look like the latest published paper.
      const af = isFuture(a.date), bf = isFuture(b.date);
      if(af !== bf) return af ? 1 : -1;
      const byDate=(b.date || '').localeCompare(a.date || '');
      if (byDate) return byDate;
      const priority=x=>{let n=(x.title||'').toLowerCase();return n.includes('discordance between actual care')?0:n.includes('large language models for multimodal')?1:n.includes('sequential diagnosis with language')?2:3;};
      return priority(a)-priority(b);
    });
    return data;
  }

  function tag(label,kind) {
    if (!label) return '';
    return '<span class="tag ' + escapeHtml(kind || '') + '">' + escapeHtml(label) + '</span>';
  }
  function card(p) {
    const research = section === 'research' || section === 'saved';
    const journal = p.journal || p.organizer || '来源待补';
    const heading = p.title_zh || p.title || '未命名记录';
    const hasSummary=Boolean(detailedSummaries[p.id]&&detailedSummaries[p.id].sections&&['研究目的','研究方法','研究结果','研究讨论与结论'].every(k=>(detailedSummaries[p.id].sections[k]||'').length>30));
    const secondary = p.title_zh && p.title && p.title_zh !== p.title ? p.title : '';
    const url = safeUrl(p.source_url);
    const hasFutureDate = isFuture(p.date);
    const status = p.status || (research ? '来源待核验' : '请复核报名状态');
    const desc = p.description || (research
      ? '自动获取的公开题录；尚未完成中文解读与人工精读，点击来源核实论文详情。'
      : '历史征集记录，请以主办方最新通知和截止日期为准。');
    const itemTags = research
      ? tag(p.study_type || '研究类型待分类','type') + tag((p.categories || []).slice(0,2).join(' · ') || p.topic || '待分类','') +
        tag(p.archive_review_required || /待人工|待核验/.test(status) ? '待人工核验' : '来源可追溯','review')
      : tag(p.category === 'competition' ? '竞赛' : '会议与征稿','type') + tag(p.topic || '学术活动','') +
        tag(p.date && p.date < today ? '历史已截止' : '开放状态未核验','review');
    const notice = hasFutureDate ? tag('发表日期待核实','future') : '';
    const checked = favorites.has(p.id);
    const link = url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + (p.archive ? '历史来源 ↗' : '查看来源 ↗') + '</a>'
      : '<span>原始来源待补充</span>';
    return '<article class="entry" data-card="' + escapeHtml(p.id) + '">' +
      '<div class="entry-top"><div class="journal">' + escapeHtml(journal) + '</div>' +
      '<button type="button" class="save ' + (checked?'on':'') + '" data-save="' + escapeHtml(p.id) +
      '" title="' + (checked?'取消收藏':'收藏到我的书架') + '" aria-label="' + (checked?'取消收藏':'收藏') +
      '">' + (checked?'★':'☆') + '</button></div>' +
      '<h2>' + (research && hasSummary ? '<button type="button" class="paper-title-link" data-read="' + escapeHtml(p.id) + '" title="查看结构化研究解读">' + escapeHtml(heading) + '</button>' : escapeHtml(heading)) + '</h2>' +
      (secondary ? '<p class="entry-en">' + escapeHtml(secondary) + '</p>' : '') +
      '<p class="description">' + escapeHtml(desc) + '</p>' +
      '<div class="tags">' + itemTags + notice + '</div>' +
      '<div class="entry-foot"><span>' + (research ? displayDate(p.date) : '截止日期：' + displayDate(p.date)) + '</span>' + link + '</div>' +
      '<div class="entry-meta">' + escapeHtml(status) + (p.archive ? ' · 历史归档' : '') + '</div>' +
      '</article>';
  }

  function openReader(id) {
    const paper=papers.find(p=>String(p.id)===String(id));
    const summary=paper&&detailedSummaries[paper.id];
    const keys=['研究目的','研究方法','研究结果','研究讨论与结论'];
    if(!paper||!summary||!summary.sections||!keys.every(k=>typeof summary.sections[k]==='string'&&summary.sections[k].trim().length>30))return;
    const modal=byId('articleReader');
    byId('readerJournal').textContent=[paper.journal||'期刊待核验',paper.date||'日期待核验'].join(' · ');
    byId('readerTitle').textContent=paper.title_zh||paper.title;
    byId('readerEnglish').textContent=paper.title_zh?(paper.title||''):'';
    const source=safeUrl(summary.source_url||paper.source_url);
    byId('readerSource').classList.toggle('hidden',!source);
    if(source)byId('readerSource').href=source;
    byId('readerQuality').textContent='根据已核实的公开来源整理；细节请以原始论文为准';
    byId('readerSections').innerHTML=keys.map(k=>'<section class="reader-section"><h3>'+escapeHtml(k)+'</h3><p>'+escapeHtml(summary.sections[k])+'</p></section>').join('');
    document.body.classList.add('reader-open');modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');byId('readerClose').focus();
  }
  function closeReader(){
    const modal=byId('articleReader');
    modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('reader-open');
  }
  function renderDaily(){
    const data=papers.filter(p=>p.origin==='PubMed'&&!p.archive);
    const last=updateStatus.last_success;
    const date=updateStatus.ingested_date||(last?new Date(last).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}):'');
    const batch=data.filter(p=>p.ingested_date===date);
    const recent=data.slice().sort((a,b)=>(b.ingested_date||'').localeCompare(a.ingested_date||'')).slice(0,6);
    const list=batch.length?batch:recent;
    byId('dailyDate').textContent=date||'尚未成功更新';
    byId('dailyCount').textContent=updateStatus.papers_added==null?'':('本次新增 '+updateStatus.papers_added+' 条 · 检索完成 '+(updateStatus.queries_ok||0)+'/'+(updateStatus.queries_total||0)+' 项');
    byId('dailyContent').innerHTML=list.length?list.slice(0,4).map(p=>'<a target="_blank" rel="noopener noreferrer" href="'+escapeHtml(safeUrl(p.source_url)||'#')+'"><span>'+escapeHtml(p.title||'')+'</span><small>'+escapeHtml(p.journal||'PubMed')+' · 发表日期 '+escapeHtml(p.date||'待核验')+'</small></a>').join(''):'<p>目前没有自动收录的文献题录。</p>';
    byId('dailyEmpty').textContent=batch.length?'本次新收录题录（未经人工精读）':(updateStatus.papers_added===0?'本次检索没有新收录记录；下方展示以往自动题录。':'显示最近自动题录（部分旧记录未保存首次收录日期）。');
  }
  function render() {
    if (!papers.length && !events.length) return;
    filtered = listData();
    const research = section === 'research' || section === 'saved';
    byId('count').textContent = '找到 ' + filtered.length + ' 条' + (research ? '研究记录' : '机会记录');
    const windowed = filtered.slice(0,shown);
    byId('cardGrid').innerHTML = windowed.length ? windowed.map(card).join('') :
      '<div class="empty" style="grid-column:1/-1">没有符合条件的记录。可以清除筛选条件，查看全部资料。</div>';
    byId('loadMore').classList.toggle('hidden',filtered.length <= shown);
    byId('paginationNote').textContent = filtered.length ? '已显示 ' + Math.min(shown,filtered.length) + ' / ' + filtered.length + ' 条记录' : '';
  }

  function renderBriefs() {
    const count = briefs.reduce((n,b) => n + (b.paper_count||0),0);
    byId('briefDescription').textContent = '现存 ' + briefs.length + ' 个可恢复的简报日期索引（文献关联 ' +
      count + ' 条次）。部分原始简报尚未完整恢复，日期索引不代表每一天都有可读取的原文。';
    byId('briefGrid').innerHTML = briefs.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(b =>
      '<article class="brief-row"><strong>' + displayDate(b.date) + '</strong>' +
      '<div class="stat-line">文献 '+(b.paper_count||0)+' · 比赛 '+(b.competition_count||0)+' · 会议 '+(b.conference_count||0)+'</div>' +
      '<p class="remark">历史记录部分恢复 · 原始简报来源信息待核验</p>' +
      '<button type="button" data-brief="' + escapeHtml(b.date) + '">查看关联文献 ↗</button></article>'
    ).join('') || '<div class="empty">暂无可读取的历史简报索引</div>';
  }

  function updateCounters() {
    byId('navResearch').textContent = papers.filter(x=>x.archive || (x.id||'').startsWith('legacy-')).length;
    byId('navCompetition').textContent = events.filter(x=>x.category==='competition').length;
    byId('navConference').textContent = events.filter(x=>x.category==='conference').length;
    byId('navSaved').textContent = favorites.size;
    const enriched = papers.filter(x => x.title_zh || x.description).length;
    byId('summaryText').textContent = papers.length + ' 条研究记录 · ' +
      new Set(papers.map(x=>x.journal).filter(Boolean)).size + ' 个期刊 · ' +
      events.length + ' 条比赛与会议信息';
    const dateLabel = updateStatus.last_success ? new Date(updateStatus.last_success).toLocaleString('zh-CN',{
      timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'
    }) : '';
    byId('lastUpdate').textContent = '两条路径 · 同一证据库';
    byId('curationNotice').textContent = '本馆含 ' + enriched + ' 条中文整理或摘要记录，其余主要为 PubMed 自动题录。历史简报与自动题录标注不同，原始来源请逐条核验。未来日期的卷期记录已排在默认列表末尾。';
  }

  function exportCsv() {
    const cols = ['title','title_zh','journal','date','topic','study_type','description','source_url','status'];
    const quote = s => '"' + String(s == null ? '' : s).replace(/"/g,'""') + '"';
    const csv = [cols.join(',')].concat(filtered.map(x=>cols.map(k=>quote(x[k])).join(','))).join('\r\n');
    const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');a.href=url;a.download='ANES_AI_'+section+'_'+today+'.csv';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  document.querySelectorAll('[data-section]').forEach(el => el.addEventListener('click',() => setSection(el.dataset.section)));
  document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click',() => setMode(el.dataset.mode)));
  ['journal','topic','studyType','clinical','stateFilter','batch','dateRange','startDate','endDate','sort','savedOnly'].forEach(id=>{
    byId(id).addEventListener('change',()=>{shown=20;render();});
  });
  byId('query').addEventListener('input',()=>{shown=20;render();});
  byId('clearFilters').addEventListener('click',()=>{resetFilters();render();});
  byId('export').addEventListener('click',exportCsv);
  byId('loadMore').addEventListener('click',()=>{shown+=20;render();});
  byId('cardGrid').addEventListener('click',e=>{
    const read=e.target.closest('[data-read]');if(read){openReader(read.dataset.read);return;}
    const el=e.target.closest('[data-save]');if(!el)return;
    const id=el.dataset.save;
    if(favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFavorites();byId('navSaved').textContent = favorites.size;render();
  });
  byId('readerClose').addEventListener('click',closeReader);
  byId('articleReader').addEventListener('click',e=>{if(e.target.id==='articleReader')closeReader();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!byId('articleReader').classList.contains('hidden'))closeReader();});
  byId('briefGrid').addEventListener('click',e=>{
    const el=e.target.closest('[data-brief]');if(!el)return;
    setSection('research');byId('batch').value=el.dataset.brief;render();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName) && section !== 'briefs'){
      e.preventDefault();byId('query').focus();
    }
  });
  Promise.all([
    fetch('data/research.json').then(r=>{if(!r.ok)throw Error('research load');return r.json();}),
    fetch('data/opportunities.json').then(r=>{if(!r.ok)throw Error('events load');return r.json();}),
    fetch('data/update_status.json').then(r=>r.ok?r.json():{}).catch(()=>({})),
    fetch('data/history_briefs.json').then(r=>r.ok?r.json():[]).catch(()=>[]),
    fetch('data/article_summaries.json').then(r=>r.ok?r.json():{}).catch(()=>({}))
  ]).then(result=>{
    papers=Array.isArray(result[0])?result[0]:[];
    events=Array.isArray(result[1])?result[1]:[];
    updateStatus=result[2]||{};briefs=Array.isArray(result[3])?result[3]:[];
    detailedSummaries=result[4]&&typeof result[4]==='object'?result[4]:{};
    updateCounters();renderDaily();setMode('all');setSection('research');
  }).catch(err=>{
    byId('summaryText').textContent='数据读取失败';
    byId('cardGrid').innerHTML='<div class="empty" style="grid-column:1/-1">加载文献数据失败，请稍后刷新或检查 GitHub Pages 的最新部署结果。</div>';
    byId('lastUpdate').textContent=String(err.message||err);
  });
})();