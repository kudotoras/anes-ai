#!/usr/bin/env python3
"""Fetch verified PubMed bibliographic metadata, without generating medical claims."""
import json,re,time,urllib.parse,urllib.request,xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data/research.json';STATUS=ROOT/'data/update_status.json'
BASE='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
JOURNALS=['The Lancet Digital Health','Nature Medicine','Nature Biomedical Engineering','Nature Machine Intelligence','NEJM AI','JAMA','JAMA Network Open','Critical Care','Intensive Care Medicine','Anesthesiology','British Journal of Anaesthesia','Anaesthesia','Anesthesia & Analgesia','IEEE Transactions on Medical Imaging','Medical Image Analysis','Artificial Intelligence in Medicine','npj Digital Medicine']
AI='("artificial intelligence"[tiab] OR "machine learning"[tiab] OR "deep learning"[tiab] OR "large language model"[tiab] OR "reinforcement learning"[tiab] OR "digital twin"[tiab] OR "closed-loop"[tiab] OR "clinical decision support"[tiab])'
CLIN='(anesthe*[tiab] OR perioperative[tiab] OR postoperative[tiab] OR "intensive care"[tiab] OR "critical care"[tiab] OR sepsis[tiab] OR delirium[tiab])'
def get(endpoint,params):
  url=BASE+endpoint+'?'+urllib.parse.urlencode(params);err=None
  for i in range(3):
    try:
      req=urllib.request.Request(url,headers={'User-Agent':'ANES-AI-Explorer/1.0 bibliographic indexing'})
      with urllib.request.urlopen(req,timeout=35) as r: data=r.read()
      time.sleep(.4);return data
    except Exception as e: err=e;time.sleep(2*(i+1))
  raise RuntimeError(str(err))
def txt(n):return re.sub(r'\s+',' ',''.join(n.itertext())).strip() if n is not None else ''
def norm(s):return re.sub('[^a-z0-9]','',s.lower())
def pubdate(a):
  for p in ('./MedlineCitation/Article/ArticleDate','./MedlineCitation/Article/Journal/JournalIssue/PubDate'):
    n=a.find(p)
    if n is None:continue
    y=txt(n.find('Year'));m=txt(n.find('Month'));d=txt(n.find('Day'))
    if not y:continue
    months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    if m and not m.isdigit():m=str(months.index(m[:3].lower())+1) if m[:3].lower() in months else ''
    return y+('-'+m.zfill(2) if m else '')+('-'+d.zfill(2) if m and d.isdigit() else '')
  return ''
def main():
  now=datetime.now(timezone.utc).isoformat(timespec='seconds');ex=json.loads(DATA.read_text('utf-8'))
  seen={norm(r.get('title','')) for r in ex};dois={r['doi'].lower() for r in ex if r.get('doi')}
  queries=['"'+j+'"[jour] AND '+AI for j in JOURNALS]+[CLIN+' AND '+AI,'(anesthesia[tiab] OR perioperative[tiab]) AND '+AI]
  ids=set();failed=[];completed=0
  for q in queries:
    try:
      raw=get('esearch.fcgi',{'db':'pubmed','term':q,'retmode':'json','retmax':'75','sort':'pub_date','reldate':'5','datetype':'edat'})
      ids.update(json.loads(raw)['esearchresult']['idlist']);completed+=1
    except Exception as e:failed.append(str(e))
  if not completed:raise RuntimeError('All PubMed searches failed; existing site data preserved')
  new=[];records=0
  for i in range(0,len(ids),100):
    xml=get('efetch.fcgi',{'db':'pubmed','id':','.join(list(ids)[i:i+100]),'retmode':'xml'})
    for a in ET.fromstring(xml).findall('.//PubmedArticle'):
      pmid=txt(a.find('./MedlineCitation/PMID'));title=txt(a.find('./MedlineCitation/Article/ArticleTitle'))
      if not pmid or not title:continue
      records+=1;doi=''
      for idn in a.findall('./PubmedData/ArticleIdList/ArticleId'):
        if idn.get('IdType')=='doi':doi=txt(idn);break
      if norm(title) in seen or (doi and doi.lower() in dois):continue
      date=pubdate(a)
      if not date:continue
      journal=txt(a.find('./MedlineCitation/Article/Journal/Title'))
      new.append({'id':'pubmed-'+pmid,'pmid':pmid,'doi':doi,'title':title,'title_zh':'','journal':journal,'date':date,'topic':'自动题录','study_type':'未人工精读','source_url':'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/','status':'PubMed 自动收录·待人工精读','origin':'PubMed'})
      seen.add(norm(title))
      if doi:dois.add(doi.lower())
  if new:
    ex.extend(new);ex.sort(key=lambda x:x.get('date',''),reverse=True)
    DATA.write_text(json.dumps(ex,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  STATUS.write_text(json.dumps({'last_success':now,'queries_ok':completed,'queries_total':len(queries),'queries_failed':len(failed),'papers_added':len(new),'pubmed_records_checked':records,'total_papers':len(ex),'notes':'PubMed 题录自动收录；比赛和会议尚未自动抓取。'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  print(f'Added {len(new)} records; total {len(ex)}; completed {completed}/{len(queries)} searches')
if __name__=='__main__':main()
