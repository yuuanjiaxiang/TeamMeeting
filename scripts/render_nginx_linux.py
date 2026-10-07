#!/usr/bin/env python3
import argparse
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Generate an HTTPS Nginx conf.d include for Linux; never reloads or installs it.')
parser.add_argument('--domain',required=True)
parser.add_argument('--certificate',required=True,type=Path)
parser.add_argument('--key',required=True,type=Path)
parser.add_argument('--port',type=int,default=8000)
parser.add_argument('--output',type=Path,default=ROOT/'data/deploy/nginx/team-loop.conf')
args=parser.parse_args()
if not re.fullmatch(r'(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}',args.domain):
    parser.error('请提供有效的公共域名')
if not 1<=args.port<=65535:
    parser.error('端口必须为 1–65535')
paths=[str(p.resolve()) for p in [args.certificate,args.key]]
if any(any(char in value for char in '\n\r"$;{}\\') for value in paths):
    parser.error('证书路径包含不支持的配置字符')
config=(ROOT/'config/nginx/team-loop-linux.conf.template').read_text()
for key,value in {'DOMAIN':args.domain,'CERTIFICATE':paths[0],'KEY':paths[1],'PORT':str(args.port)}.items():
    config=config.replace('{{'+key+'}}',value)
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(config)
print(f'Nginx 配置已生成：{args.output}')
