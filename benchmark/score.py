import json, html, statistics

BASE = "benchmark"
bench = json.load(open(f"{BASE}/benchmark.json"))
old = {r["query"]: r for r in json.load(open(f"{BASE}/old_results.json"))}
rag = {r["query"]: r for r in json.load(open(f"{BASE}/rag_results.json"))}

def norm(s):
    return html.unescape(s).lower()

def hit(titles, truths, k=3):
    top = [norm(t) for t in titles[:k]]
    return any(norm(tr) in t for tr in truths for t in top)

buckets = {}
rows = []
for item in bench:
    q, truths, b = item["query"], item["truth"], item["bucket"]
    o = old[q]; r = rag[q]
    oh = hit(o["titles"], truths)
    rh = hit(r["docs"], truths)
    o_anywhere = hit(o["titles"], truths, k=len(o["titles"]) or 1)
    buckets.setdefault(b, []).append((oh, rh))
    rows.append((b, q, oh, o["count"], o_anywhere, rh))

print(f"{'bucket':<20} {'query':<42} {'old3':<5} {'#res':<5} {'oldAny':<7} {'rag3'}")
for b, q, oh, c, oa, rh in rows:
    print(f"{b:<20} {q:<42} {str(oh):<5} {c:<5} {str(oa):<7} {rh}")

print("\n=== Top-3 hit rate ===")
tot_o = tot_r = 0
for b, res in buckets.items():
    o = sum(1 for x, _ in res if x); r = sum(1 for _, y in res if y)
    tot_o += o; tot_r += r
    print(f"{b}: old {o}/{len(res)}  rag {r}/{len(res)}")
print(f"TOTAL: old {tot_o}/30  rag {tot_r}/30")

counts = [old[i['query']]['count'] for i in bench]
print(f"\nold search result-list size: mean {statistics.mean(counts):.0f}, median {statistics.median(counts)}, max {max(counts)}")
zero = [i['query'] for i in bench if old[i['query']]['count'] == 0]
print(f"old search zero-result queries: {zero}")
