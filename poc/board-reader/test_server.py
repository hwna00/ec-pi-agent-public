"""Extract explicit test targets from entry metadata and labeled HTML, never replies."""
import json
import re
from pathlib import Path
from context_graph import Tree,text_content
import board_reader as b

SERVER=re.compile(r'(?<![\w.-])((?:test|zeus|stage)[a-z0-9-]*)(?:\.ecount\.com)?(?![\w.-])',re.I)
LABEL=re.compile(r'서버\s*/?\s*계정|테스트\s*서버|서버정보|test\s*server',re.I)

def parse_target(value,source):
    text=b.content(value)['text'];match=SERVER.search(text)
    if not match:return []
    # Preserve different explicit targets. Ambiguity is resolved in /test-server.
    targets=[]
    for match in [match]:
        server=match[1].lower();tail=text[match.end():]
        if tail.startswith('.ecount.com'):tail=tail[len('.ecount.com'):]
        # Captured ERP fields: chrome / zeus07lxba1 / company / user / password [내선...]
        parts=[p.strip() for p in tail.lstrip(' /:').split('/')]
        target={'server':server,'source':source}
        if len(parts)>=3 and re.fullmatch(r'\d{3,12}',parts[0]):
            target.update(company=parts[0],user=parts[1],password=re.split(r'\s*\[?내선|\s*\[?Ext\.','/'.join(parts[2:]),flags=re.I)[0].strip())
        for field,pattern in {'company':r'(?:회사코드|company)\s*[:=]\s*(\d+)', 'user':r'(?:아이디|사용자\s*ID|user(?:name)?|\bID)\s*[:=]\s*([^\s/]+)', 'password':r'(?:비밀번호|password|\bPW)\s*[:=]\s*([^\s/]+)'}.items():
            found=re.search(pattern,text,re.I)
            if found:target[field]=found[1]
        targets.append(target)
    return targets

def html_sources(source):
    result=[]
    def walk(n):
        if isinstance(n,str):return
        tag,attrs,children=n;value=text_content(n)
        if tag in ('li','tr','p') and LABEL.search(value) and len(value)<2000:
            result.append(value);return
        for child in children:walk(child)
    walk(Tree(source).root)
    return result

def extract_test_servers(post,capture=None):
    props={'board_s$txt_003'} if post['board']=='테스트오류수정' else set()
    if capture:
        # Resolve field names from Setup, not fixed response indexes.
        for path in (Path(capture)/'raw').glob('*-setup.json'):
            setup=b.normalize(json.loads(path.read_text()))
            def walk(x):
                if isinstance(x,dict):
                    if LABEL.search(str(x.get('prop_name',''))) and x.get('prop_id'):props.add(x['prop_id'])
                    for v in x.values():walk(v)
                elif isinstance(x,list):
                    for v in x:walk(v)
            walk(setup)
    found=[]
    for prop in sorted(props):
        value=post['metadata'].get(prop)
        if isinstance(value,str):found.extend(parse_target(value,'metadata:'+prop))
    for item in post.get('body',[]):
        source=item['content']['raw_html']
        for value in html_sources(source):found.extend(parse_target(value,'html:'+item['field']))
        # Explicit test links are also useful when the form has no labeled account block.
        for link in item['content'].get('links',[]):
            href=link.get('href') or ''
            if re.match(r'https?://(?:test|zeus|stage)[a-z0-9-]*\.ecount\.com(?:[/:?]|$)',href,re.I):found.extend(parse_target(href,'link:'+item['field']))
    unique={}
    for target in found:
        ident=tuple(target.get(k,'') for k in ('server','company','user','password'))
        unique.setdefault(ident,target)
    return list(unique.values())
