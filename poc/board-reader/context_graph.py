"""Deterministic ContextGraph services; no site access in parser/renderer/store."""
from __future__ import annotations
import copy
import errno
import hashlib
import html
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qsl, urlencode

if os.name == 'nt':
    import msvcrt
else:
    import fcntl

TYPES={'job','dev','hub','tp','dp','decision','meeting'}
class ContextError(Exception):
    code='context_error'
    def __init__(self,message,key=None):super().__init__(message);self.key=key
class ParseError(ContextError):code='parse_error'
class UnsupportedError(ContextError):code='unsupported'
class SnapshotError(ContextError):code='snapshot_error'

def ref(value):
    if isinstance(value,str):
        try:t,i=value.split(':',1)
        except ValueError:raise ContextError('Expected type:id') from None
    else:t,i=value['type'],value['id']
    if t not in TYPES or not isinstance(i,str) or not i or any(c in i for c in '\n\r/\\'):
        raise ContextError('Invalid post reference')
    return {'type':t,'id':i}
def key(r):r=ref(r);return r['type']+':'+r['id']
def refs(values):return [ref(k) for k in sorted({key(v) for v in values})]
def canonical(graph):
    return {'entryKey':graph['entryKey'],'nodes':sorted(graph['nodes'],key=lambda n:n['key']),
            'edges':sorted(graph['edges'],key=lambda e:(e['from'],e['relation'],e['to']))}
def serialize(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def digest(value):return hashlib.sha256(value).hexdigest()
def validate(graph):
    if set(graph)!={'entryKey','nodes','edges'}:raise SnapshotError('Invalid graph fields')
    nodes={}
    for n in graph['nodes']:
        if set(n)!={'key','type','id','data'} or key(n)!=n['key'] or not isinstance(n['data'],str):raise SnapshotError('Invalid node')
        if n['key'] in nodes:raise SnapshotError('Duplicate node')
        nodes[n['key']]=n
    if graph['entryKey'] not in nodes:raise SnapshotError('Missing entry node')
    seen=set()
    for e in graph['edges']:
        if set(e)!={'from','to','relation'} or e['from'] not in nodes or e['to'] not in nodes or e['relation'] not in {'belongs_to','attach_to'}:raise SnapshotError('Invalid edge')
        if e['relation']=='belongs_to' and (nodes[e['from']]['type']!='dev' or nodes[e['to']]['type']!='job'):raise SnapshotError('Invalid parent edge')
        sig=(e['from'],e['to'],e['relation'])
        if sig in seen:raise SnapshotError('Duplicate edge')
        seen.add(sig)
    return graph

TOKEN_KEYS={'ec_req_sid','__disablemin','token','access_token','session','sessionid','session_id','key','timestamp','v5q','options','xce'}
def clean_url(value,base):
    absolute=urljoin(base,html.unescape(value or ''))
    p=urlsplit(absolute)
    if p.scheme not in ('https','http','mailto','tel'):return ''
    q=[(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if k.lower() not in TOKEN_KEYS]
    fragment=p.fragment
    if '=' in fragment:fragment=urlencode([(k,v) for k,v in parse_qsl(fragment,keep_blank_values=True) if k.lower() not in TOKEN_KEYS])
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),fragment))

class Tree(HTMLParser):
    VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self,source):
        super().__init__(convert_charrefs=True);self.root=['root',{},[]];self.stack=[self.root]
        self.feed(source);self.close()
    def handle_starttag(self,tag,attrs):
        node=[tag,dict(attrs),[]];self.stack[-1][2].append(node)
        if tag not in self.VOID:self.stack.append(node)
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag not in self.VOID:self.stack.pop()
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i][0]==tag:del self.stack[i:];break
    def handle_data(self,data):self.stack[-1][2].append(data)

def text_content(node):
    if isinstance(node,str):return node
    return ''.join(text_content(x) for x in node[2])
def escape(s):return re.sub(r'([\\`*_\[\]<>])',r'\\\1',s)

class MarkdownParser:
    def html_to_markdown(self,source,base):
        if not isinstance(source,str):raise ParseError('Content must be HTML text')
        tree=Tree(source)
        protected={}
        def protect(value):
            token='\x00BLOCK'+str(len(protected))+'\x00'
            protected[token]=value
            return token
        def render(n,depth=0):
            if isinstance(n,str):return escape(re.sub(r'\s+',' ',n))
            tag,a,children=n
            if tag in {'script','style','button','nav','input','select','textarea'}:return ''
            if tag=='pre':
                value=text_content(n).replace('\r\n','\n')
                fence='`'*max(3,max((len(x)+1 for x in re.findall(r'`+',value)),default=3))
                return '\n\n'+protect(fence+'\n'+value+'\n'+fence)+'\n\n'
            if tag=='code':
                value=text_content(n);fence='`'*max(1,max((len(x)+1 for x in re.findall(r'`+',value)),default=1))
                return protect(fence+' '+value+' '+fence)
            if tag in ('ul','ol'):
                lines=[];start=int(a.get('start','1')) if a.get('start','1').isdigit() else 1
                for i,item in enumerate(x for x in children if not isinstance(x,str) and x[0]=='li'):
                    v=''.join(render(x,depth+1) for x in item[2]).strip()
                    bullet=f'{start+i}. ' if tag=='ol' else '- '
                    lines.append(bullet+v.replace('\n','\n'+' '*len(bullet)))
                return '\n\n'+'\n'.join(lines)+'\n\n'
            if tag=='table':
                # HTML tables preserve rowspan/colspan, nested blocks and empty cells,
                # which GFM pipe tables cannot express without loss.
                def table_html(x):
                    if isinstance(x,str):return html.escape(x)
                    t,at,ch=x
                    if t in {'script','style','button','input'}:return ''
                    attrs=[]
                    for k,v in sorted(at.items()):
                        if k in {'rowspan','colspan','alt','title','scope','start'}:attrs.append((k,v))
                        if k in {'href','src'}:
                            u=clean_url(v,base)
                            if u:attrs.append((k,u))
                    start='<'+t+''.join(' '+k+'="'+html.escape(v or '',quote=True)+'"' for k,v in attrs)+'>'
                    return start+('' if t in Tree.VOID else ''.join(table_html(y) for y in ch)+'</'+t+'>')
                return '\n\n'+protect(table_html(n))+'\n\n'
            value=''.join(render(c,depth) for c in children)
            if tag=='a':
                url=clean_url(a.get('href',''),base)
                return '['+(value.strip() or escape(url))+'](<'+url+'>)' if url else value
            if tag=='img':
                url=clean_url(a.get('src',''),base)
                return '!['+escape(a.get('alt',''))+'](<'+url+'>)' if url else escape(a.get('alt',''))
            if tag in {'video','audio','source','iframe','object','embed'}:
                url=clean_url(a.get('src') or a.get('data',''),base)
                return value+ ('\n['+tag+'](<'+url+'>)\n' if url else '')
            if tag in {'strong','b'}:return '**'+value+'**'
            if tag in {'em','i'}:return '*'+value+'*'
            if tag in {'del','s'}:return '~~'+value+'~~'
            if tag=='br':return '  \n'
            if tag=='hr':return '\n\n---\n\n'
            if re.fullmatch('h[1-6]',tag):return '\n\n'+'#'*int(tag[1])+' '+value.strip()+'\n\n'
            if tag=='blockquote':return '\n\n'+ '\n'.join('> '+line for line in value.strip().splitlines())+'\n\n'
            if tag in {'p','div','section','article','header','footer','li'}:return '\n\n'+value.strip()+'\n\n'
            return value
        value=render(tree.root).strip()
        value=re.sub(r'\n(?:[ \t]*\n){2,}','\n\n',value)
        for token,original in protected.items():value=value.replace(token,original)
        return value
    def parse(self,post):
        r=ref(post['ref']);k=key(r)
        try:
            md=self.html_to_markdown(post['content'],post['sourceUrl'])
            if not md:raise ParseError('Empty parsed post',k)
            relations=post['relations'];parent=relations.get('parentJob')
            if parent and (r['type']!='dev' or ref(parent)['type']!='job'):raise ParseError('Invalid parent relation',k)
            attached=refs(relations.get('attachedPosts',[]))
            md+='\n\n## 게시글 관계\n\n'
            md+='상위 작업: '+(key(parent) if parent else '없음')+'\n\n'
            md+='첨부 게시글:\n'+ ('\n'.join('- '+key(x) for x in attached) if attached else '- 없음')+'\n'
            return {'key':k,**r,'data':md}
        except ContextError:raise
        except Exception as e:raise ParseError('Markdown parse failed: '+type(e).__name__,k) from e

class ContextRenderer:
    def render(self,graph):
        validate(graph);g=canonical(graph);by={n['key']:n for n in g['nodes']}
        order=[g['entryKey']]+[k for k in sorted(by) if k!=g['entryKey']]
        out=['# ContextGraph','',f"Entry: {g['entryKey']}",'','## 관계','']
        out.extend(f"- {e['from']} --{e['relation']}--> {e['to']}" for e in g['edges'])
        for k in order:out.extend(['','---','',f'## {k}'+(' (Entry)' if k==g['entryKey'] else ''),'',by[k]['data']])
        return '\n'.join(out).rstrip()+'\n'

class GraphService:
    def __init__(self,reader,parser=None,recursive=False,max_nodes=100):
        self.reader=reader;self.parser=parser or MarkdownParser();self.recursive=recursive;self.max_nodes=max_nodes;self.entry_metadata=None
    def _operation(self,graph,targets,expand):
        old=copy.deepcopy(graph);nodes={n['key']:n for n in graph['nodes']};raw={}
        def read(r):
            r=ref(r);k=key(r)
            if k not in raw:
                if len(raw)>=self.max_nodes:raise ContextError('Traversal node limit exceeded; no partial graph saved',k)
                try:
                    p=self.reader.readById(r['type'],r['id'])
                    if key(p['ref'])!=k:raise ParseError('Reader returned a different post',k)
                    nodes[k]=self.parser.parse(p);raw[k]=p
                    if k==graph['entryKey']:self.entry_metadata={'entryKey':k,'candidates':p.get('testServers',[])}
                except Exception as e:
                    if isinstance(e,ContextError):e.key=e.key or k;raise
                    raise ContextError(type(e).__name__+': '+str(e),k) from e
            return raw[k]
        for r in targets:read(r)
        entry=graph['entryKey']
        # Expansion is only owned by the initial entry. Other nodes are read but
        # their attached/parent targets do not recursively expand the collection.
        if expand:
            entry_post=read(ref(entry))
            for r in refs(entry_post['relations'].get('attachedPosts',[])):read(r)
            parent=entry_post['relations'].get('parentJob') if ref(entry)['type']=='dev' else None
            if parent:
                read(parent)
                try:developments=refs(self.reader.listDevelopments(parent['id']))
                except Exception as e:
                    if isinstance(e,ContextError):e.key=e.key or key(parent);raise
                    error=ContextError(type(e).__name__+': '+str(e),key(parent))
                    if type(e).__name__=='AuthError':error.code='auth_expired'
                    if type(e).__name__=='PermissionDenied':error.code='access_denied'
                    raise error from e
                for r in developments:read(r)
        if expand and self.recursive:
            visited=set();jobs={key(parent)} if parent else set()
            while set(raw)-visited:
                for current in sorted(set(raw)-visited):
                    visited.add(current);p=raw[current];rel=p['relations']
                    for target in refs(rel.get('attachedPosts',[])):read(target)
                    if ref(current)['type']=='job' and current not in jobs:
                        jobs.add(current)
                        for target in refs(self.reader.listDevelopments(ref(current)['id'])):read(target)
                    parent=rel.get('parentJob')
                    if parent:
                        read(parent)
                        if key(parent) not in jobs:
                            jobs.add(key(parent))
                            for target in refs(self.reader.listDevelopments(parent['id'])):read(target)
        edges=[e for e in graph['edges'] if e['from'] not in raw]
        for k,p in raw.items():
            rel=p['relations'];owned=[]
            if rel.get('parentJob'):owned.append((rel['parentJob'],'belongs_to'))
            owned.extend((r,'attach_to') for r in refs(rel.get('attachedPosts',[])))
            for target,relation in owned:
                if key(target) in nodes:edges.append({'from':k,'to':key(target),'relation':relation})
        # Previously collected nodes may already explicitly name a target whose
        # node was outside v1 scope. Adding that target resolves those recorded
        # references; it does not infer a new relationship or refetch the source.
        new_keys=nodes.keys()-{n['key'] for n in old['nodes']}
        for source,node in nodes.items():
            if source in raw:continue
            _,marker,relation_text=node['data'].rpartition('\n\n## 게시글 관계\n\n')
            if not marker:continue
            for line in relation_text.splitlines():
                relation='belongs_to' if line.startswith('상위 작업: ') else 'attach_to' if line.startswith('- ') else None
                target=line.removeprefix('상위 작업: ').removeprefix('- ')
                if relation and target in new_keys:edges.append({'from':source,'to':target,'relation':relation})
        unique={(e['from'],e['to'],e['relation']):e for e in edges}
        new=canonical({'entryKey':entry,'nodes':list(nodes.values()),'edges':list(unique.values())});validate(new)
        before={n['key']:n for n in old['nodes']};after={n['key']:n for n in new['nodes']}
        a={(e['from'],e['to'],e['relation']):e for e in old['edges']};b={(e['from'],e['to'],e['relation']):e for e in new['edges']}
        added=sorted(after.keys()-before.keys());updated=sorted(k for k in before.keys()&after.keys() if before[k]['data']!=after[k]['data'])
        return {'graph':new,'changed':bool(added or updated or a.keys()!=b.keys()),'addedNodes':added,'updatedNodes':updated,
                'addedEdges':[b[k] for k in sorted(b.keys()-a.keys())],'removedEdges':[a[k] for k in sorted(a.keys()-b.keys())]}
    def collect(self,entry):
        entry=ref(entry)
        return self._operation({'entryKey':key(entry),'nodes':[],'edges':[]},[entry],True)['graph']
    def add(self,graph,post,edge=None):
        validate(graph);post=ref(post)
        if key(post) in {n['key'] for n in graph['nodes']}:
            return {'graph':copy.deepcopy(graph),'changed':False,'addedNodes':[],'updatedNodes':[],'addedEdges':[],'removedEdges':[]}
        targets=[post]
        if edge:
            if set(edge)!={'from','to','relation'} or key(post) not in (edge['from'],edge['to']):raise ContextError('Invalid explicit connection')
            existing={n['key'] for n in graph['nodes']}|{key(post)}
            if edge['from'] not in existing or edge['to'] not in existing:raise ContextError('Edge endpoint missing')
            if edge['from']!=key(post):targets.append(ref(edge['from']))
        result=self._operation(graph,targets,False)
        if edge and edge not in result['graph']['edges']:raise ContextError('Explicit connection is not present in source relations')
        return result
    def refresh(self,graph,key=None):
        validate(graph);keys={n['key'] for n in graph['nodes']}
        if key and key not in keys:raise ContextError('Node does not exist',key)
        targets=[ref(key)] if key else [ref(k) for k in sorted(keys)]
        parent_keys={e['to'] for e in graph['edges'] if e['from']==graph['entryKey'] and e['relation']=='belongs_to'}
        return self._operation(graph,targets,not key or key==graph['entryKey'] or key in parent_keys)

class SnapshotStore:
    def __init__(self,directory,renderer=None):self.directory=Path(directory);self.renderer=renderer or ContextRenderer()
    @contextmanager
    def locked(self):
        self.directory.mkdir(parents=True,exist_ok=True)
        fd=os.open(self.directory/'.context.lock',os.O_CREAT|os.O_RDWR,0o600)
        with os.fdopen(fd,'r+b',buffering=0) as f:
            if os.name == 'nt':
                if os.fstat(f.fileno()).st_size == 0:f.write(b'\0')
                f.seek(0)
                while True:
                    try:
                        msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
                        break
                    except OSError as error:
                        if error.errno not in (errno.EACCES,errno.EAGAIN,errno.EDEADLK):raise
                        time.sleep(0.05)
            else:
                fcntl.flock(f,fcntl.LOCK_EX)
            try:yield
            finally:
                if os.name == 'nt':
                    f.seek(0)
                    msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
                else:fcntl.flock(f,fcntl.LOCK_UN)
    def _replace(self,name,value):
        fd,path=tempfile.mkstemp(prefix='.context-',dir=self.directory)
        try:
            with os.fdopen(fd,'wb') as f:f.write(value);f.flush();os.fsync(f.fileno())
            os.replace(path,self.directory/name)
        finally:
            if os.path.exists(path):os.unlink(path)
    def commit(self,graph,context):
        validate(graph);self.directory.mkdir(parents=True,exist_ok=True)
        gb=serialize(canonical(graph));cb=context.encode()
        meta=serialize({'graphHash':digest(gb),'contextHash':digest(cb)})
        names=['graph.json','context.md','context.meta.json']
        previous={n:(self.directory/n).read_bytes() if (self.directory/n).exists() else None for n in names}
        try:
            for name,data in zip(names,[gb,cb,meta]):self._replace(name,data)
        except Exception:
            for name,data in previous.items():
                if data is None:(self.directory/name).unlink(missing_ok=True)
                else:self._replace(name,data)
            raise
    def load(self):
        try:graph=json.loads((self.directory/'graph.json').read_text());validate(graph)
        except Exception as e:raise SnapshotError('graph.json is missing or invalid; no web lookup attempted') from e
        try:
            context=(self.directory/'context.md').read_text();meta=json.loads((self.directory/'context.meta.json').read_text())
            if meta!={'graphHash':digest(serialize(canonical(graph))),'contextHash':digest(context.encode())}:raise ValueError('hash mismatch')
        except (OSError,ValueError,KeyError):
            context=self.renderer.render(graph);self.commit(graph,context)
        return {'graph':graph,'context':context}

class ContextSession:
    def __init__(self,store,service):self.store=store;self.service=service
    def collect(self,entry):
        with self.store.locked():
            if (self.store.directory/'graph.json').exists():raise SnapshotError('Session graph already exists')
            graph=self.service.collect(entry);context=self.store.renderer.render(graph);self.store.commit(graph,context)
            return {'graph':graph,'changed':True}
    def update(self,action,post=None):
        with self.store.locked():
            old=self.store.load()['graph']
            result=self.service.add(old,post) if action=='add' else self.service.refresh(old,post)
            if result['changed']:self.store.commit(result['graph'],self.store.renderer.render(result['graph']))
            return result
    def load(self):
        with self.store.locked():return self.store.load()
