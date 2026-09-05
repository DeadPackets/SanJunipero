#!/usr/bin/env python3
import json, os, collections
BASE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(f'{BASE}/rows.json'))
cls = json.load(open(f'{BASE}/classified.json'))
out = []
P = out.append
P('## 9. LLM classification pass (deepseek-v4-flash, one bounded batch)\n')
P(f'Items classified: {len(cls)} of 3,523 submitted (all speech lines of w2/w3/r3a/r3b; every 3rd w2 thought; all w3/r3 thoughts). Spend: see `classify-llm.db`.\n')
P('| world | kind | n | task | people | wonder | survival is main concern | asks a question | want beyond needs/work |')
P('|---|---|---|---|---|---|---|---|---|')
for kind, key in (('speech', 's'), ('thoughts', 't')):
    for w in ('w2', 'w3', 'r3a', 'r3b'):
        got = [cls[f'{w}:{key}:{i}'] for i in range(len(rows[kind][w])) if f'{w}:{key}:{i}' in cls]
        n = len(got)
        if n == 0: continue
        c = collections.Counter(g['cls'] for g in got)
        sv = sum(g['survival'] for g in got); qq = sum(g['question'] for g in got); wb = sum(g['wantBeyond'] for g in got)
        P(f'| {w} | {kind} | {n} | {c["task"] / n * 100:.0f}% | {c["people"] / n * 100:.0f}% | {c["wonder"] / n * 100:.0f}% | {sv / n * 100:.0f}% | {qq / n * 100:.0f}% | {wb / n * 100:.0f}% |')
# per mind, w2 speech
P('\nw2 speech by mind (LLM classes):\n')
P('| mind | n | task | people | wonder | survival | want beyond |')
P('|---|---|---|---|---|---|---|')
by = collections.defaultdict(list)
for i, r in enumerate(rows['speech']['w2']):
    k = f'w2:s:{i}'
    if k in cls: by[r[1]].append(cls[k])
for a, got in sorted(by.items()):
    n = len(got); c = collections.Counter(g['cls'] for g in got)
    P(f'| {a} | {n} | {c["task"] / n * 100:.0f}% | {c["people"] / n * 100:.0f}% | {c["wonder"] / n * 100:.0f}% | {sum(g["survival"] for g in got) / n * 100:.0f}% | {sum(g["wantBeyond"] for g in got) / n * 100:.0f}% |')
# by day, w2 speech
P('\nw2 speech by sim-day (LLM classes): task / people / wonder\n')
byday = collections.defaultdict(list)
for i, r in enumerate(rows['speech']['w2']):
    k = f'w2:s:{i}'
    if k in cls: byday[r[0] // 1440].append(cls[k])
P('| day | n | task | people | wonder |')
P('|---|---|---|---|---|')
for d in sorted(byday):
    got = byday[d]; n = len(got); c = collections.Counter(g['cls'] for g in got)
    P(f'| {d} | {n} | {c["task"] / n * 100:.0f}% | {c["people"] / n * 100:.0f}% | {c["wonder"] / n * 100:.0f}% |')
# wonder examples
P('\nSpeech the LLM tagged wonder + wantBeyond (first 8, w2/w3):\n')
c = 0
for w in ('w2', 'w3'):
    for i, r in enumerate(rows['speech'][w]):
        g = cls.get(f'{w}:s:{i}')
        if g and g['cls'] == 'wonder' and g['wantBeyond']:
            P(f'- {w} t{r[0]} {r[1]}: "{r[2]}"'); c += 1
            if c >= 8: break
    if c >= 8: break
open(f'{BASE}/llm_section.md', 'w').write('\n'.join(out))
print('\n'.join(out))
