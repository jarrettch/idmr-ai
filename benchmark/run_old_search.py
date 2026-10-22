import json, re, time, urllib.parse, urllib.request

BASE = "benchmark"
queries = json.load(open(f"{BASE}/benchmark.json"))

out = []
for item in queries:
    params = urllib.parse.urlencode({
        "action": "epkb-search-kb",
        "epkb_kb_id": "1",
        "search_words": item["query"],
        "is_kb_main_page": "1",
        "kb_block_post_id": "0",
    })
    req = urllib.request.Request(
        f"https://idmr.net/wp-admin/admin-ajax.php?{params}",
        headers={"User-Agent": "Mozilla/5.0 (benchmark; contact jarrett.harris@gmail.com)"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        html = json.load(r)["search_result"]
    titles = [re.sub(r"\s+", " ", t).strip()
              for t in re.findall(r'epkb-article__text">([^<]+)<', html)]
    out.append({"query": item["query"], "titles": titles, "count": len(titles)})
    print(f"{item['query']!r}: {len(titles)} results; top3={titles[:3]}")
    time.sleep(0.6)

json.dump(out, open(f"{BASE}/old_results.json", "w"), indent=1)
print("done")
