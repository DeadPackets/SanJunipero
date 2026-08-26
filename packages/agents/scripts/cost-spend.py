# Every dollar this lane spent, booked two ways: as `pins.ts` prices it, and as Wafer actually
# charges. Wafer served 100% of the calls in every run, so the second column is the real bill.
import sqlite3, os

D = 'packages/agents/data/ladder'
PINS = {'input': 0.14, 'output': 0.28, 'cacheRead': 0.028}
WAFER = {'input': 0.28, 'output': 0.56, 'cacheRead': 0.07}

def cost(inp, out, cr, p):
    return ((inp - cr) * p['input'] + cr * p['cacheRead'] + out * p['output']) / 1e6

tot_b = tot_w = 0.0
print(f"{'run':16s} {'calls':>6s} {'booked$':>9s} {'wafer$':>9s}")
for f in sorted(os.listdir(D)):
    if not f.endswith('.db'):
        continue
    c = sqlite3.connect(f'{D}/{f}')
    r = c.execute("SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM llm_calls").fetchone()
    c.close()
    n, inp, out, cr, booked = r
    w = cost(inp, out, cr, WAFER)
    tot_b += booked
    tot_w += w
    print(f"{f[:-3]:16s} {n:6d} {booked:9.4f} {w:9.4f}")
print(f"{'TOTAL runs':16s} {'':6s} {tot_b:9.4f} {tot_w:9.4f}")
print(f"\ndial probes (2 runs x 60 calls, priced in-script at Wafer rates): $0.0179")
print(f"LANE TOTAL, at what Wafer actually charges: ${tot_w + 0.0179:.4f}")
