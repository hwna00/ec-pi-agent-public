"""Site adapter: fresh API reads, explicit relations, no graph persistence."""
from __future__ import annotations
import datetime as dt
import html
import json
import re
import uuid
from pathlib import Path
from urllib.parse import parse_qs,urlsplit
import board_reader as b
from context_graph import ContextError,UnsupportedError,ParseError,ref,key,refs,Tree,clean_url

SITE_TYPES={
 'job':{'name':'작업','bizz':'B_000000E074008','view':'M_000000E200436'},
 'dev':{'name':'개발','bizz':'B_000000E074010','view':'M_000000E200440'},
 'tp':{'name':'테스트오류수정','bizz':'B_000000E074013','view':'M_000000E200446'},
 'hub':{'name':'개발본부 Hub','bizz':'B_000000E074000','view':'M_000000E200420'},
 'dp':{'name':'테스트/배포','bizz':'B_000000E074020','view':'M_000000E200460'},
 'meeting':{'name':'회의','bizz':'B_000000E074015','view':'M_000000E200450'},
 'decision':{'name':'방향결정','bizz':'B_000000E074014','view':'M_000000E200448'},
}
# Resolve reference identities without fetching the referenced posts.
REFERENCE_TYPES={c['bizz']:t for t,c in SITE_TYPES.items()}
class PostReadError(ContextError):pass

def attachment_items(value,post_key=None):
    """Decode attachment envelopes without confusing an empty list with failure."""
    if value is None or value=='':return []
    if isinstance(value,str):
        try:value=json.loads(value)
        except ValueError:raise ParseError('Invalid inline attachment JSON',post_key) from None
    if isinstance(value,dict):
        for field in ('attached_list','data'):
            if field in value:
                value=value[field]
                break
    if not isinstance(value,list) or any(not isinstance(item,dict) for item in value):
        raise ParseError('Unrecognized inline attachment structure',post_key)
    return value

def attachment_ref(item):
    if not isinstance(item,dict):raise ParseError('Invalid attachment record')
    sid=item.get('bizz_sid');number=item.get('BOARD_NUM',item.get('data_no'))
    # Files are retained in Markdown but do not become post nodes.
    if number is None and (isinstance(item.get('file_info_list'),list) or (item.get('link_type')=='01' and item.get('file_id'))):return None
    if not sid and number is None:return None
    t=REFERENCE_TYPES.get(sid)
    if not t:raise UnsupportedError('Attached board is not supported: '+str(sid))
    if number is None:raise ParseError('Attached post has no display number')
    return ref({'type':t,'id':str(number)})

def html_post_refs(source):
    found=[]
    def walk(n):
        if isinstance(n,str):return
        tag,a,children=n
        if a.get('data-context-type') and a.get('data-post-id'):
            found.append(ref({'type':a['data-context-type'],'id':a['data-post-id']}))
        if tag=='a' and a.get('href'):
            url=urlsplit(html.unescape(a['href']));query=parse_qs(url.query)
            query.update(parse_qs(url.fragment))
            if query.get('context_type') and query.get('data_no'):
                found.append(ref({'type':query['context_type'][0],'id':query['data_no'][0]}))
            elif query.get('bizz_sid') and query.get('data_no'):
                found.append(attachment_ref({'bizz_sid':query['bizz_sid'][0],'BOARD_NUM':query['data_no'][0]}))
        for c in children:walk(c)
    walk(Tree(source).root);return refs(x for x in found if x)

def captured_to_raw(post,attachments=None,origin='https://logine.ecount.com'):
    typ=next((t for t,c in SITE_TYPES.items() if c['name']==post['board']),None)
    if not typ:raise UnsupportedError('Board is not supported: '+post['board'])
    r={'type':typ,'id':str(post['number'])};metadata=post['metadata'];parent=None
    if typ=='dev':
        number=metadata.get('b_000000e074008_001$board_s$data_no')
        if number:parent={'type':'job','id':str(number)}
    blocks=['<h1>'+html.escape(post['title'] or '')+'</h1>','<h2>본문</h2>']
    attached=[]
    for item in sorted(post['body'],key=lambda i:(i.get('field',''),i.get('widget') or '')):
        suffix=re.search(r'ctt_(\d+)$',item.get('field',''))
        if suffix:blocks.append('<h3>내용 '+str(int(suffix.group(1)))+'</h3>')
        blocks.append(item['content']['raw_html']);attached.extend(html_post_refs(item['content']['raw_html']))
    records={b.pick(x,'record_sid'):x for x in post['reply_records']}
    def order(x):
        row=records.get(x['record_sid'],{})
        return (int(b.pick(row,'record_seq_no',0) or 0),x['record_sid'] or '',x['field'])
    ordered=sorted(post['replies'],key=order)
    reply_numbers={item['record_sid']:i for i,item in enumerate(ordered,1)}
    for i,item in enumerate(ordered,1):
        row=records.get(item['record_sid'],{})
        writer=b.pick(row,'writer_nm',item.get('writer') or '')
        parent_reply=reply_numbers.get(b.pick(row,'parent_record_sid'))
        label=' (답글 '+str(parent_reply)+'에 대한 답글)' if parent_reply else ''
        blocks.append('<h2>답글 '+str(i)+label+' · '+html.escape(str(writer))+'</h2>')
        blocks.append(item['content']['raw_html']);attached.extend(html_post_refs(item['content']['raw_html']))
    # Preserve source fields separately from UI controls; response order irrelevant.
    for owner,items in sorted((attachments or {}).items()):
        blocks.append('<h2>첨부 · '+html.escape(owner)+'</h2><ul>')
        for item in sorted(items,key=lambda x:json.dumps(x,sort_keys=True,ensure_ascii=False)):
            ar=attachment_ref(item)
            if ar:attached.append(ar)
            files=item.get('file_info_list')
            if ar is None and isinstance(files,list) and files:
                for file in sorted(files,key=lambda f:(str(f.get('name','')),str(f.get('file_id','')))):
                    name=file.get('name') or file.get('attach_name') or '첨부파일'
                    size=' ('+str(file['size'])+' bytes)' if file.get('size') is not None else ''
                    blocks.append('<li>'+html.escape(str(name)+size)+'</li>')
                continue
            name=item.get('attach_name',item.get('TITLE',item.get('file_name','첨부')))
            blocks.append('<li>'+html.escape(str(name))+(' ['+key(ar)+']' if ar else '')+'</li>')
        blocks.append('</ul>')
    # Known ERP document URL, without session query parameters. Relative links
    # must resolve against the actual browser document, not an invented route.
    url=origin+'/ec56/view/erp'
    relations={'attachedPosts':refs(attached)}
    if parent:relations['parentJob']=parent
    return {'ref':r,'sourceUrl':url,'content':'\n'.join(blocks),'relations':relations}

class PostReader:
    def __init__(self,session,artifacts,current_provider=None,client_factory=b.Client):
        self.session=session;self.artifacts=Path(artifacts);self.current_provider=current_provider;self.client_factory=client_factory
    def _client(self,label):return self.client_factory(self.session,self.artifacts/(label+'-'+uuid.uuid4().hex))
    def readCurrent(self):
        if self.current_provider is None:raise UnsupportedError('Current-page resolver required; configure browser CDP adapter')
        current=ref(self.current_provider())
        return self.readById(current['type'],current['id'])
    def readById(self,type,id):
        r=ref({'type':type,'id':id});k=key(r)
        if type not in SITE_TYPES:raise UnsupportedError('Site reader not implemented for '+type,k)
        if not id.isdecimal():raise PostReadError('ECOUNT post number must be numeric',k)
        c=SITE_TYPES[type];client=self._client(k.replace(':','-'))
        try:
            b.read_post(client,c['name'],int(id),c['view'])
            post=json.loads((client.out/'post.json').read_text())
            attachments={}
            for label,row in [('본문',post['metadata'])]+[(str(b.pick(x,'record_sid')),x) for x in post['reply_records']]:
                count=int(b.pick(row,'slip_link_cnt',0) or 0)
                inline=b.pick(row,'slip_link')
                inline_items=attachment_items(inline,k)
                if len(inline_items)>=count:
                    if inline_items:attachments[label]=inline_items
                    continue
                if not count:continue
                hid=b.pick(row,'hid')
                if not hid:raise ParseError('Attachment count present but hid missing',k)
                payload={'prg_id':c['bizz'].split('_')[-1].lstrip('0'),'form_type':'','attach_types':['05'],'attach_exception_group':'','hid':hid,'seq_no':0,'bizz_sid':c['bizz'],'data_sid':b.pick(row,'data_sid',post['identifiers']['data_sid']),'record_sid':b.pick(row,'record_sid')}
                data=client.post('attachments',payload,label)
                items=attachment_items(data,k)
                if len(items)<count:raise ParseError('Attachment response shorter than declared count',k)
                attachments[label]=items
            raw=captured_to_raw(post,attachments,client.origin)
            from test_server import extract_test_servers
            raw['testServers']=extract_test_servers(post,client.out)
            # Preserve the caller's ID string, including leading zeroes.
            raw['ref']=r
            b.dump(client.out/'raw-post.json',raw)
            return raw
        except (b.AuthError,b.PermissionDenied,b.NotFound,b.ResponseParseError,b.ReaderError) as e:
            error=PostReadError(str(e),k)
            error.code=('auth_expired' if isinstance(e,b.AuthError) else 'access_denied' if isinstance(e,b.PermissionDenied) else 'not_found' if isinstance(e,b.NotFound) else 'parse_error' if isinstance(e,b.ResponseParseError) else 'read_failed')
            raise error from e
    def listDevelopments(self,jobId):
        if not str(jobId).isdecimal():raise PostReadError('Invalid job ID','job:'+str(jobId))
        client=self._client('job-'+str(jobId)+'-developments');c=SITE_TYPES['dev']
        menus=b.rows_of(client.post('menus',{'bizz_sid':c['bizz']}));menus.sort(key=lambda x:x.get('menu_type_name')!='조회')
        last=None
        for menu in menus:
            try:
                sid=menu['menu_sid'];template=client.post('templates',{'bizz_sid':c['bizz'],'menu_sid':sid,'menu_type':'list','template_sub_type':'fixed','data_sid':''})
                p=b.search_payload(c['bizz'],sid,template.get('current_template',''),0);p['sort']={}
                p['condition']={'b_000000e074008_001$board_s$data_no':{'type':'range','value':{'from':int(jobId),'to':int(jobId)}}}
                rows=b.collect_pages(client,'search',p,'all-developments')
                result=[]
                for row in rows:
                    if int(b.pick(row,'record_depth_no',0) or 0):continue
                    if str(row.get('b_000000e074008_001$board_s$data_no'))!=str(int(jobId)):raise ParseError('Development search returned unrelated job')
                    number=b.pick(row,'data_no')
                    if number is None:raise ParseError('Development number missing')
                    result.append({'type':'dev','id':str(number)})
                return refs(result)
            except (b.AuthError,b.PermissionDenied):raise
            except b.ReaderError as e:last=e
        raise PostReadError('Cannot enumerate all developments: '+str(last),'job:'+str(jobId))

class FixtureReader:
    """Offline captured RawPost fixtures; never silently used in live mode."""
    def __init__(self,directory):self.directory=Path(directory);self.calls=[]
    def readById(self,type,id):
        k=key({'type':type,'id':id});self.calls.append(k)
        path=self.directory/(k.replace(':','-')+'.json')
        if not path.exists():raise UnsupportedError('No captured fixture for '+k,k)
        return json.loads(path.read_text())
    def listDevelopments(self,jobId):
        path=self.directory/('job-'+jobId+'-developments.json')
        if not path.exists():raise UnsupportedError('Missing complete development-list fixture','job:'+jobId)
        return refs(json.loads(path.read_text()))
    def readCurrent(self):
        r=ref(json.loads((self.directory/'current.json').read_text()))
        return self.readById(r['type'],r['id'])
