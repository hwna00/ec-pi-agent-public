"""ContextGraph CLI; all mutation commands are serialized per session directory."""
import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from context_graph import *
from post_reader import PostReader,FixtureReader
import board_reader as b


def current_from_dom(snapshot):
    # Identifies the foreground detail popup, never derives current ID from stale
    # list rows. The subsequent readCurrent always performs new API requests.
    import re
    from post_reader import SITE_TYPES
    text=snapshot['text'];matches=[]
    for t,c in SITE_TYPES.items():
        pattern=re.escape(c['name'])+r'\s*View\b'
        for m in re.finditer(pattern,text):
            tail=text[m.end():]
            ids=re.search(r'(?:^|\n)\s*(\d+)\s*[|｜]',tail)
            if ids:matches.append((m.start(),{'type':t,'id':ids.group(1)}))
    if len(matches)!=1:raise ContextError('Cannot unambiguously identify current detail popup')
    return matches[0][1]

def cdp_current(endpoint):
    command=['node',str(b.ROOT/'current_page.mjs'),endpoint]
    try:
        p=subprocess.run(command,capture_output=True,text=True,timeout=20,check=True)
        return current_from_dom(json.loads(p.stdout))
    except (subprocess.SubprocessError,ValueError) as e:raise ContextError('Current browser connection failed; check CDP endpoint') from e

def session_input(args):
    if args.session_prompt:
        u=urlsplit(getpass.getpass('Logged-in ERP URL (hidden): '))
        return {'host':u.hostname,'ec_req_sid':parse_qs(u.query).get('ec_req_sid',[''])[0],'cookie':getpass.getpass('Request Cookie header (hidden): ')}
    if args.browser_stdio:return json.loads(sys.stdin.readline())
    return json.load(sys.stdin) if args.session_stdin else json.loads(os.environ.get('ECOUNT_SESSION_JSON','{}'))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--session-dir',type=Path,required=True)
    p.add_argument('--fixtures',type=Path)
    p.add_argument('--browser-stdio',action='store_true')
    p.add_argument('--recursive',action='store_true')
    p.add_argument('--max-nodes',type=int,default=100)
    auth=p.add_mutually_exclusive_group();auth.add_argument('--session-prompt',action='store_true');auth.add_argument('--session-stdin',action='store_true')
    p.add_argument('--cdp',default=os.environ.get('ECOUNT_CDP_URL','http://127.0.0.1:9222'))
    sub=p.add_subparsers(dest='command',required=True)
    c=sub.add_parser('collect');c.add_argument('ref',help='type:id or current')
    c=sub.add_parser('add',aliases=['add-context']);c.add_argument('ref')
    c=sub.add_parser('refresh',aliases=['update-context']);c.add_argument('key',nargs='?')
    sub.add_parser('load');sub.add_parser('context');sub.add_parser('read-current')
    args=p.parse_args()
    try:
        store=SnapshotStore(args.session_dir)
        if args.command in ('load','context'):
            with store.locked():result=store.load()
            if args.command=='context':sys.stdout.write(result['context']);return 0
            print(json.dumps({'entryKey':result['graph']['entryKey'],'nodes':len(result['graph']['nodes']),'edges':len(result['graph']['edges']),'context':str(args.session_dir/'context.md')},ensure_ascii=False));return 0
        reader=FixtureReader(args.fixtures) if args.fixtures else PostReader(session_input(args),args.session_dir/'captures',lambda:cdp_current(args.cdp),client_factory=b.BrowserClient if args.browser_stdio else b.Client)
        service=GraphService(reader,recursive=args.recursive,max_nodes=args.max_nodes);session=ContextSession(store,service)
        if args.command=='read-current':
            raw=reader.readCurrent();node=service.parser.parse(raw)
            b.dump(args.session_dir/'current-post.json',raw)
            print(json.dumps({'key':node['key'],'markdown_characters':len(node['data']),'artifact':str(args.session_dir/'current-post.json')},ensure_ascii=False));return 0
        if args.command=='collect':
            if args.ref=='current':
                # Resolve current ref without fetching it twice within the operation.
                entry=(json.loads((args.fixtures/'current.json').read_text()) if args.fixtures else cdp_current(args.cdp))
            else:entry=ref(args.ref)
            result=session.collect(entry)
        elif args.command in ('add','add-context'):result=session.update('add',ref(args.ref))
        else:result=session.update('refresh',args.key)
        graph=result.pop('graph');
        if service.entry_metadata is not None:b.dump(args.session_dir/'test-servers.json',service.entry_metadata)
        result.update({'entryKey':graph['entryKey'],'nodes':len(graph['nodes']),'edges':len(graph['edges']),'context':str(args.session_dir/'context.md')})
        print(json.dumps(result,ensure_ascii=False));return 0
    except Exception as e:
        known=isinstance(e,ContextError)
        print(json.dumps({'error':str(e) if known else type(e).__name__,'code':getattr(e,'code','operation_failed'),'post':getattr(e,'key',None)},ensure_ascii=False));return 2
if __name__=='__main__':sys.exit(main())
