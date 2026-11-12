#!/usr/bin/env python3
"""Liner Search 확인 호출 결과(작업 폴더의 결과 JSON)를 tests/fixtures/search/ 고정 응답으로 옮긴다.

파일 이름은 lib/liner/search.ts의 fixtureFileName과 같은 규칙(검색어·date_range 해시 16자리).
요청 ID·파비콘은 버리고, 검색 요약(description)은 출처 이용 조건을 확인하기 전이라 비운다.
사용: python3 scripts/eval/make-search-fixtures.py <결과.json> [<결과2.json> ...]
"""
import hashlib, json, sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "tests/fixtures/search"
NOTE = "Liner Search 응답(2026. 11. 13. 확인 호출)에서 제목·URL·호스트·날짜만 남김. description은 출처 이용 조건 확인 전이라 비움"


def file_name(query, date_range):
    key = json.dumps({"query": query.strip(), "date_range": date_range}, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(key.encode()).hexdigest()[:16] + ".json"


def entries(doc):
    for s in doc.get("searches", []):
        yield s, None
    if "search_past_year" in doc:
        yield doc["search_past_year"], "past_year"


index = {}
for src in sys.argv[1:]:
    doc = json.loads(Path(src).read_text())
    for s, dr in entries(doc):
        if s.get("status") != 200:
            continue
        results = [
            {"title": r.get("title", ""), "url": r["url"], "hostname": r.get("hostname", ""), "description": "", "date": r.get("date")}
            for r in s["body"].get("results", [])
        ]
        name = file_name(s["query"], dr)
        body = {"_note": NOTE, "query": s["query"], "date_range": dr, "results": results}
        (OUT / name).write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n")
        index[name] = {"query": s["query"], "date_range": dr, "results": len(results)}

(OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
print(f"{len(index)}개 저장: {OUT}")
