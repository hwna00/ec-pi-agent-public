"""Read-only ECOUNT board PoC. No credentials are stored in output artifacts."""
from __future__ import annotations
import argparse, datetime as dt, getpass, gzip, hashlib, html, json, os, re, sys, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parent
class ReaderError(Exception): pass
class AuthError(ReaderError): pass
class PermissionDenied(ReaderError): pass
class NotFound(ReaderError): pass
class ResponseParseError(ReaderError): pass
class ServerError(ReaderError): pass

def dump(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(value,f,ensure_ascii=False,indent=2)

def normalize(v):
    if isinstance(v,list) and len(v)==3 and v[0]=='__$KeyPack' and isinstance(v[1],dict):
        names=v[1]
        def unpack(x):
            if isinstance(x,dict): return {names.get(k,k):unpack(y) for k,y in x.items()}
            if isinstance(x,list): return [unpack(y) for y in x]
            return x
        return normalize(unpack(v[2]))
    if isinstance(v,dict): return {k:normalize(x) for k,x in v.items()}
    if isinstance(v,list): return [normalize(x) for x in v]
    return v

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

ENDPOINTS={
 'boards':'/ec5/api/app.common/action/GetBizzTypeSearchV5Action',
 'menus':'/ec5/api/app.setup/action/bizz/menu_setting/SelectSubMenuListAction',
 'templates':'/ec5/api/app.common/action/GetTemplateAllowListAction',
 'search':'/ec5/api/app.board/action/SelectBoardSearchListAction',
 'detail':'/ec5/api/app.board/action/GetBoardDataAction',
 'setup':'/ec5/api/app.board/action/GetBoardSetupAction',
 'widget':'/ec5/api.bulk/app.crm/action/SelectWidgetSearchAction',
 'attachments':'/ec5/api/app.common/action/SelectV3SlipLinkInfoByHidAction',
}
class Client:
    def __init__(self,session,out):
        self.session=session;self.out=Path(out);self.metrics=[]
        host=session.get('host','')
        if not re.fullmatch(r'[a-zA-Z0-9-]+\.ecount\.com',host): raise ReaderError('host must be an ECOUNT HTTPS host')
        if not session.get('ec_req_sid') or not session.get('cookie'): raise AuthError('ec_req_sid and cookie required')
        for x in [session['cookie'],session['ec_req_sid']]:
            if '\r' in x or '\n' in x: raise AuthError('Invalid session value')
        self.origin='https://'+host; self.opener=urllib.request.build_opener(NoRedirect())
    def _request(self,kind,payload):
        url=self.origin+ENDPOINTS[kind]+'?'+urllib.parse.urlencode({'ec_req_sid':self.session['ec_req_sid'],'__disableMin':'Y'})
        headers={'Content-Type':'application/json','Accept':'application/json','Accept-Encoding':'identity','Accept-Language':'ko','Origin':self.origin,'Referer':self.origin+'/ec56/view/erp','Cookie':self.session['cookie']}
        request=urllib.request.Request(url,data=json.dumps(payload).encode(),headers=headers,method='POST')
        try:
            try: response=self.opener.open(request,timeout=45)
            except urllib.error.HTTPError as e: response=e
            raw=response.read(); status=response.status
            if response.headers.get('Content-Encoding')=='gzip': raw=gzip.decompress(raw)
        except (urllib.error.URLError,TimeoutError,OSError) as e: raise ReaderError('Network request failed: '+kind+' ('+type(e).__name__+')') from None
        return raw,status
    def post(self,kind,payload,label=None):
        started=time.monotonic()
        raw,status=self._request(kind,payload)
        metric={'api':kind,'label':label,'status':status,'bytes':len(raw),'milliseconds':round((time.monotonic()-started)*1000)}
        self.metrics.append(metric)
        try: obj=json.loads(raw)
        except (ValueError,UnicodeDecodeError):
            if status in (301,302,303,307,308,401,410) or b'type="password"' in raw.lower():raise AuthError('Login required')
            if status==403:raise PermissionDenied('Access denied')
            if status==404:raise NotFound('Resource not found')
            raise ResponseParseError(f'{kind}: non-JSON response (HTTP {status})') from None
        # Store server payload only; never request headers, URL query or credentials.
        seq=len(self.metrics); artifact=f'{seq:02d}-{kind}.json'
        dump(self.out/'raw'/artifact,obj);metric['artifact']='raw/'+artifact
        dump(self.out/'requests.json',self.metrics)
        normalized=normalize(obj)
        if not isinstance(normalized,dict):raise ResponseParseError('Invalid API envelope')
        if status in (401,410) or normalized.get('Status') in (401,410) or 'IInvalidSessionException' in raw.decode('utf8','replace'):
            raise AuthError('ERP session expired; refresh session and retry')
        if status==403 or normalized.get('Status')==403:raise PermissionDenied('Access denied')
        if status==404 or normalized.get('Status')==404:raise NotFound('Resource not found')
        if status!=200 or normalized.get('Status',200)!=200 or normalized.get('Error'):
            error=ServerError(f'{kind}: server error HTTP={status} Status={normalized.get("Status")} (see local artifact {artifact})')
            error.is_query_timeout='Sql-PG-T/O' in raw.decode('utf8','replace')
            raise error
        data=normalized.get('Data',normalized)
        if isinstance(data,dict) and (data.get('error') or data.get('error_info')): raise ReaderError(kind+': error in Data (see local artifact)')
        return data

class BrowserClient(Client):
    """Private stdio RPC to the Pi host; credentials stay in the browser."""
    def __init__(self,session,out):
        self.session=session;self.out=Path(out);self.metrics=[]
        host=session.get('host','')
        if not re.fullmatch(r'[a-zA-Z0-9-]+\.ecount\.com',host):raise AuthError('Invalid ERP host')
        self.origin='https://'+host
    def _request(self,kind,payload):
        print(json.dumps({'rpc':'ec-api','kind':kind,'path':ENDPOINTS[kind],'payload':payload},ensure_ascii=False),flush=True)
        line=sys.stdin.readline()
        if not line:raise AuthError('Browser connection closed')
        response=json.loads(line)
        if response.get('error'):raise AuthError('Browser session unavailable; run /ec-connect')
        return response['body'].encode(),response['status']

def rows_of(data):
    if isinstance(data,list):
        rows=[]
        for x in data:
            if isinstance(x,dict) and 'data' in x: rows.extend(x.get('data') or [])
            elif isinstance(x,dict): rows.append(x)
        return rows
    if isinstance(data,dict):return data.get('data',[]) if isinstance(data.get('data'),list) else []

class ReplayClient:
    """Offline execution of the same reader against captured server responses."""
    def __init__(self,source,out):
        self.source=Path(source);self.out=Path(out);self.metrics=[]
        self.recorded=json.loads((self.source/'requests.json').read_text())
    def post(self,kind,payload,label=None):
        index=len(self.metrics)
        if index>=len(self.recorded):raise ReaderError('Replay exhausted')
        old=self.recorded[index]
        if old['api']!=kind:raise ReaderError(f'Replay sequence mismatch: expected {old["api"]}, got {kind}')
        obj=json.loads((self.source/old['artifact']).read_text())
        dump(self.out/old['artifact'],obj);self.metrics.append(dict(old))
        dump(self.out/'requests.json',self.metrics)
        return normalize(obj).get('Data',obj)

def verify_artifact(directory):
    directory=Path(directory);post=json.loads((directory/'post.json').read_text())
    originals={}
    for path in (directory/'raw').glob('*-widget.json'):
        response=normalize(json.loads(path.read_text()))
        for row in rows_of(response.get('Data',{})):
            for item in extract_contents([row],'body'):
                originals.setdefault((item['record_sid'],item['field']),set()).add(item['content']['raw_html'])
    count=0
    for section in ('body','replies','linked'):
        for item in post[section]:
            c=item['content'];raw=c['raw_html']
            if raw not in originals.get((item['record_sid'],item['field']),set()):raise ReaderError('HTML differs from raw API response')
            if hashlib.sha256(raw.encode()).hexdigest()!=c['sha256']:raise ReaderError('HTML hash mismatch')
            count+=1
    return {'verified':True,'html_fields_verified':count,'replies':post['verification']['fetched_replies'],'artifact':str(directory/'post.json')}

def pick(row,name,default=None):
    # Only current-board aliases; linked-board fields must not masquerade as current.
    for k in ['board_s$'+name,'board_b$'+name,name]:
        if k in row:return row[k]
    return default

def widgets(setup):
    found=[]
    def visit(v,path):
        if isinstance(v,dict):
            typ={'EDITOR_VIEW':'editor','COMMENT':'comment','FORM':'form'}.get(v.get('view_type'))
            if typ:
                for a in v.get('attributes',[]):
                    if a.get('attr_id')!='multi_user_action':continue
                    action=a.get('data',{}).get('load_complete',{})
                    p=action.get('payload',{}); infos=p.get('data_model_infos',{})
                    if not infos:continue
                    mid=p.get('data_model_id') or next(iter(infos))
                    info=infos.get(mid,next(iter(infos.values())))
                    mids=list(infos)
                    body_props=[]
                    for model in mids:
                        for prop in setup.get('data_model_definitions',{}).get(model,{}).get('props',[]):
                            if re.fullmatch(r'body_(?:html_)?ctt(?:_\d+)?',prop.get('refer_type','')):
                                body_props.append(prop['prop_id'])
                    found.append({'type':typ,'section':v.get('sect_sid'),'template_set_sid':p.get('template_set_sid'),'object_id':info.get('object_id'),'info':info,'model_ids':mids,'body_props':list(dict.fromkeys(body_props)),'path':path})
            for k,x in v.items():
                if k=='sections':visit(x,path+'.sections')
        elif isinstance(v,list):
            for i,x in enumerate(v):visit(x,path+f'[{i}]')
    visit(setup.get('view_container',[]),'view_container'); return found

class ContentParser(HTMLParser):
    """Derived representation; original HTML remains the lossless source of truth."""
    VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    BLOCK={'p','div','section','article','h1','h2','h3','h4','li','tr','table','blockquote','pre','ul','ol'}
    def __init__(self):
        super().__init__(convert_charrefs=False);self.events=[];self.text=[];self.assets=[];self.links=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        self.events.append({'kind':'start','tag':tag,'attributes':attrs,'source':self.get_starttag_text()})
        a=dict(attrs)
        if tag in ('script','style'):self.skip+=1
        if tag in self.BLOCK or tag in ('br','hr'):self.text.append('\n')
        if tag in ('td','th'):self.text.append('\t')
        if tag=='img' and a.get('alt'):self.text.append(a['alt'])
        if tag=='a':self.links.append({'href':a.get('href'),'attributes':attrs})
        if tag in ('img','video','audio','source','iframe','object','embed'):self.assets.append({'tag':tag,'attributes':attrs})
    def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.events[-1]['kind']='empty'
    def handle_endtag(self,tag):
        self.events.append({'kind':'end','tag':tag})
        if tag in ('script','style'):self.skip=max(0,self.skip-1)
        if tag in self.BLOCK:self.text.append('\n')
    def handle_data(self,data):
        self.events.append({'kind':'text','value':data})
        if not self.skip:self.text.append(data)
    def handle_entityref(self,name):
        value='&'+name+';';self.events.append({'kind':'entity','source':value})
        if not self.skip:self.text.append(html.unescape(value))
    def handle_charref(self,name):self.handle_entityref('#'+name)
    def handle_comment(self,data):self.events.append({'kind':'comment','value':data})
    def handle_decl(self,decl):self.events.append({'kind':'declaration','value':decl})

def content(value):
    value='' if value is None else str(value);p=ContentParser();p.feed(value);p.close()
    return {'raw_html':value,'sha256':hashlib.sha256(value.encode()).hexdigest(),'text':''.join(p.text).strip(),'events':p.events,'links':p.links,'assets':p.assets}

def widget_payload(w,bizz,menu,row):
    info=w['info']; template={'bizz_sid':bizz,'menu_sid':menu,'menu_type':'view','template_set_sid':w['template_set_sid'],'data_display_standard':info.get('data_display_standard'),'object_id':w['object_id'],'template_sub_type':'fixed','widget_type':w['type'],'is_za_template':False}
    if 'conn_bizz_info' in info:template['conn_bizz_info']=info['conn_bizz_info']
    conditions={'board_s$data_sid':{'type':'contains','value':[pick(row,'data_sid')]}}
    return {'bizz_sid':bizz,'menu_sid':menu,'menu_type':'view','object_id':w['object_id'],'template_info':template,'search_request':{'target':{},'condition':{'board_s$status_type':{'type':'contains','value':'U'}}},'options':{'self_conditions':[conditions]}}

# Verified default detail menus; custom boards can register their own mapping.
def default_view_menu(bizz):
    registry=json.loads((ROOT/'boards.json').read_text())
    return registry.get(bizz,{}).get('view_menu')
GROUPS=['BG_00000C000038','BG_00000C000040','BG_00000C000042','BG_00000C000043','BG_00000C000044']

def search_payload(bizz,menu,template,number,page=1):
    return {'bizz_sid':bizz,'menu_sid':menu,'menu_type':'list','template_sub_type':'fixed','current_template':template,'is_za_template':False,'additional':{'view_all':True,'expand_all':False,'notice_count':0},'target':{k:{} for k in ['board_s$data_no','board_s$data_sid','board_s$record_sid','board_s$title_ctt','board_s$reply_cnt','board_s$record_depth_no','board_s$data_dt']},'condition':{'board_s$data_no':{'type':'equal','value':number}},'sort':{'board_s$record_seq_no':{'sort_type':'asc','priority':1}},'page':{'current_index':page,'row_count':100}}

def collect_pages(client,kind,payload,label):
    result=[];seen=set();page=1
    while page<=1000:
        data=client.post(kind,payload,label)
        batches=data if isinstance(data,list) else [data]
        total=sum(x.get('total_count',0) for x in batches if isinstance(x,dict))
        rows=rows_of(data)
        new=0
        for row in rows:
            key=pick(row,'record_sid') or json.dumps(row,sort_keys=True)
            if key not in seen:seen.add(key);result.append(row);new+=1
        if len(result)>=total:return result
        if not new:raise ReaderError(label+': pagination stopped before total_count; refusing incomplete result')
        page+=1
        target=payload.setdefault('search_request',{}) if kind=='widget' else payload
        target['page']={'current_index':page,'row_count':100}
    raise ReaderError(label+': pagination limit exceeded')

def extract_contents(rows,role,widget=None):
    result=[]
    for row in rows:
        for key,value in row.items():
            if not isinstance(value,str) or not re.search(r'\$(?:body_html_ctt|body_ctt|reply_ctt|comment_ctt)(?:_\d+)?$',key):continue
            linked=not key.startswith(('board_b$','board_s$'))
            prefix=key.split('$board_')[0]+'$' if linked else ''
            source={k[len(prefix):]:v for k,v in row.items() if k.startswith(prefix)} if linked else row
            item={'role':'linked' if linked else role,'field':key,'record_sid':pick(source,'record_sid'),'data_sid':pick(source,'data_sid'),'bizz_sid':pick(source,'bizz_sid'),'parent_record_sid':pick(source,'parent_record_sid'),'writer':pick(source,'writer_nm'),'written_at':pick(source,'write_dtm'),'widget':widget,'content':content(value)}
            result.append(item)
    return result

def summary_contents(post,limit=400):
    sections={}
    for section in ('linked','body','replies'):
        previews=[]
        for index,item in enumerate(post[section]):
            metadata=post['metadata']
            if section=='linked':
                prefix=item['field'].split('$board_')[0]+'$'
                metadata={k[len(prefix):]:v for k,v in metadata.items() if k.startswith(prefix)}
            elif section=='replies':
                metadata=next((r for r in post['reply_records'] if pick(r,'record_sid')==item['record_sid']),{})
            board=pick(metadata,'bizz',{})
            board=board.get('name') if isinstance(board,dict) else board
            value=item['content']['text']
            previews.append({'index':index,'board':board or (post['board'] if section!='linked' else None),
                'number':pick(metadata,'data_no'),'title':str(pick(metadata,'title_ctt',''))[:300],
                'writer':item.get('writer'),'preview':value[:limit],
                'text_characters':len(value),'truncated':len(value)>limit,
                'next_offset':limit if len(value)>limit else None})
        sections[section]=previews
    return sections

def read_post(client,board,number,view_menu=None):
    boards=rows_of(client.post('boards',{'code_type_response':True,'select_by_bizz_group':{'target_bizz_group_sids':GROUPS,'search_param':''}}))
    matches=[x for x in boards if x.get('name')==board and str(x.get('sid','')).startswith('B_')]
    if len(matches)!=1:raise ReaderError(f'Board exact match count={len(matches)}; supply an unambiguous board name')
    bizz=matches[0]['sid'];menus=rows_of(client.post('menus',{'bizz_sid':bizz}))
    menus.sort(key=lambda m: m.get('menu_type_name')!='조회')
    errors=[];row=None;list_rows=[]
    for menu in menus:
        sid=menu['menu_sid']
        try:
            tpl=client.post('templates',{'bizz_sid':bizz,'menu_sid':sid,'menu_type':'list','template_sub_type':'fixed','data_sid':''})
            found=collect_pages(client,'search',search_payload(bizz,sid,tpl.get('current_template',''),number),'locate')
            parents=[x for x in found if str(pick(x,'data_no'))==str(number) and not pick(x,'parent_record_sid') and int(pick(x,'record_depth_no',0) or 0)==0]
            if len(parents)>1:raise ReaderError('Multiple parent posts match the number')
            if parents:row=parents[0];list_rows=found;break
        except (AuthError,PermissionDenied):raise
        except ReaderError as e:errors.append(e)
    if row is None:
        if errors:raise errors[0]
        raise NotFound(f'Post not found in accessible board: {board} #{number}')
    view_menu=view_menu or default_view_menu(bizz)
    if not view_menu:
        candidates=[m['menu_sid'] for m in menus if m.get('menu_type')=='view' or m.get('menu_type_name') in ('상세','보기','상세조회')]
        if len(set(candidates))==1:view_menu=candidates[0]
        else:raise ReaderError('Cannot resolve detail menu for '+board+'; configure boards.json view_menu')
    context={'bizz_sid':bizz,'menu_sid':view_menu,'menu_type':'view','data_sid':pick(row,'data_sid'),'record_sid':pick(row,'record_sid')}
    detail=client.post('detail',context)
    for model in detail.get('data_model',{}).values():
        if isinstance(model,list):
            for x in model:
                if pick(x,'record_sid')==context['record_sid']:row.update(x)
    setup=client.post('setup',context);ws=widgets(setup)
    if not ws:raise ReaderError('No loadable widgets found; verify detail menu or updated server schema')
    dump(client.out/'widgets.json',ws)
    all_contents=[];reply_rows={};queried=[]
    for w in ws:
        if not w['body_props'] and w['type']!='comment':continue
        p=widget_payload(w,bizz,view_menu,row)
        # A comment widget selects replies of data_sid; restricting to the parent's
        # record_sid incorrectly suppresses every reply.
        p['options']['self_conditions'][0].pop('board_s$record_sid',None)
        date=pick(row,'data_dt')
        if date:p['search_request']['condition']['board_s$data_dt']={'type':'range','value':{'from':date,'to':date}}
        result=collect_pages(client,'widget',p,w['section']);queried.append(w['section'])
        if w['type']=='comment':
            for x in result:
                rid=pick(x,'record_sid')
                if rid and rid!=context['record_sid']:reply_rows[rid]=x
        all_contents.extend(extract_contents(result,'reply' if w['type']=='comment' else 'body',w['section']))
    body=[x for x in all_contents if x['role']=='body']
    replies=[x for x in all_contents if x['role']=='reply']
    linked=[x for x in all_contents if x['role']=='linked']
    expected=int(pick(row,'reply_cnt',0) or 0)
    if not body:raise ReaderError('Body field missing; refusing to report empty body as success')
    expected_ids={pick(x,'record_sid') for x in list_rows if pick(x,'record_sid')!=context['record_sid']}
    actual_ids=set(reply_rows)
    if len(actual_ids)!=expected or not expected_ids.issubset(actual_ids):raise ReaderError(f'Reply completeness mismatch: expected={expected}, fetched={len(actual_ids)}')
    if actual_ids-{x['record_sid'] for x in replies}:raise ReaderError('Reply records are missing content fields')
    result={'schema_version':1,'board':board,'number':number,'title':pick(row,'title_ctt'),'identifiers':context,'metadata':row,'body':body,'replies':replies,'linked':linked,'reply_records':list(reply_rows.values()),'verification':{'complete':True,'expected_replies':expected,'fetched_replies':len(actual_ids),'list_reply_ids_verified':len(expected_ids),'widgets_discovered':len(ws),'widgets_queried':len(queried)}}
    dump(client.out/'post.json',result)
    summary={'board':board,'number':number,'title':str(result['title'])[:300],'body_fields':len(body),'replies':len(actual_ids),'linked_fields':len(linked),'body_preview':body[0]['content']['text'][:400],'complete':True,'requests':len(client.metrics),'response_bytes':sum(x['bytes'] for x in client.metrics),'elapsed_api_ms':sum(x['milliseconds'] for x in client.metrics),'artifact':str(client.out/'post.json')}
    summary['contents']=summary_contents(result)
    dump(client.out/'summary.json',summary);return summary

def main():
    parser=argparse.ArgumentParser(description='Read-only board body/reply PoC; stdout is bounded JSON.')
    sub=parser.add_subparsers(dest='command',required=True)
    read=sub.add_parser('read');read.add_argument('board');read.add_argument('number',type=int)
    auth=read.add_mutually_exclusive_group();auth.add_argument('--session-stdin',action='store_true');auth.add_argument('--session-prompt',action='store_true')
    read.add_argument('--view-menu');read.add_argument('--out',type=Path)
    replay=sub.add_parser('replay');replay.add_argument('capture',type=Path);replay.add_argument('--out',type=Path,required=True)
    verify=sub.add_parser('verify');verify.add_argument('capture',type=Path)
    show=sub.add_parser('inspect');show.add_argument('artifact',type=Path);show.add_argument('--section',choices=['body','replies','linked'],default='body');show.add_argument('--index',type=int,default=0);show.add_argument('--offset',type=int,default=0);show.add_argument('--limit',type=int,default=1500)
    args=parser.parse_args()
    try:
        if args.command=='verify':result=verify_artifact(args.capture)
        elif args.command=='replay':
            if args.out.exists():raise ReaderError('Output directory already exists')
            old=json.loads((args.capture/'post.json').read_text())
            result=read_post(ReplayClient(args.capture,args.out),old['board'],old['number'],old['identifiers']['menu_sid'])
            result['offline_replay']=True
        elif args.command=='inspect':
            if args.offset<0 or args.index<0 or not 1<=args.limit<=4000:raise ReaderError('offset/index >=0 and limit 1..4000 required')
            obj=json.loads(args.artifact.read_text());items=obj[args.section]
            if args.index>=len(items):raise ReaderError('Content index out of range')
            value=items[args.index]['content']['text'];end=args.offset+args.limit
            result={'section':args.section,'index':args.index,'count':len(items),'offset':args.offset,'total_characters':len(value),'text':value[args.offset:end],'next_offset':end if end<len(value) else None}
        else:
            if args.number<1:raise ReaderError('Post number must be positive')
            if args.session_prompt:
                url=urllib.parse.urlparse(getpass.getpass('Logged-in ERP URL (hidden): '))
                session={'host':url.hostname,'ec_req_sid':urllib.parse.parse_qs(url.query).get('ec_req_sid',[''])[0],'cookie':getpass.getpass('Request Cookie header (hidden): ')}
            else:session=json.load(sys.stdin) if args.session_stdin else json.loads(os.environ.get('ECOUNT_SESSION_JSON','{}'))
            out=args.out or ROOT/'.local'/dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            if out.exists():raise ReaderError('Output directory already exists; choose a new directory')
            result=read_post(Client(session,out),args.board,args.number,args.view_menu)
        print(json.dumps(result,ensure_ascii=False));return 0
    except (ReaderError,ValueError,KeyError,OSError) as e:
        message=str(e) if isinstance(e,ReaderError) else type(e).__name__+'; check input or local artifacts'
        print(json.dumps({'error':message,'complete':False},ensure_ascii=False));return 3 if isinstance(e,AuthError) else 2
if __name__=='__main__':sys.exit(main())
