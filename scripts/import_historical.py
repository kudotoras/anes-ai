#!/usr/bin/env python3
"""Safely merge user-provided public research history into the published catalogue."""
import json, re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/history_import.json"
RESEARCH = ROOT / "data/research.json"
EVENTS = ROOT / "data/opportunities.json"
BRIEFS = ROOT / "data/history_briefs.json"

def key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").casefold())

def nonempty(value):
    return value is not None and value != "" and value != []

def write_if_changed(path, value):
    content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if not path.exists() or path.read_text(encoding="utf-8") != content:
        path.write_text(content, encoding="utf-8")
        return True
    return False

def main():
    if not SOURCE.exists():
        print("No archive import file yet; retaining existing catalogue.")
        return
    archive = json.loads(SOURCE.read_text(encoding="utf-8"))
    papers = archive.get("papers", [])
    events = archive.get("events", [])
    briefs = archive.get("briefs", [])
    if len(papers) < 82 or len(events) < 20 or len(briefs) < 19:
        raise ValueError("Archive import unexpectedly incomplete; aborting without overwriting data.")

    current = json.loads(RESEARCH.read_text(encoding="utf-8"))
    bytitle = {key(x.get("title")): x for x in current if x.get("title")}
    bydoi = {key(x.get("doi")): x for x in current if x.get("doi")}
    added = 0
    for p in papers:
        name = p.get("title_en", "")
        doi = p.get("doi") or ""
        if not name:
            continue
        matched = bydoi.get(key(doi)) if doi else None
        if matched is None:
            matched = bytitle.get(key(name))
        cat = p.get("categories") or []
        src = p.get("source_url") or ""
        status = "历史简报归档·待人工复核" if p.get("needs_review", True) else "历史来源曾核验·需检查时效"
        if matched:
            matched["title_zh"] = p.get("title_zh") or matched.get("title_zh") or ""
            if nonempty(p.get("summary_zh")):
                matched["description"] = p["summary_zh"]
            if nonempty(p.get("journal")) and (not matched.get("journal") or matched.get("journal") == "Unknown"):
                matched["journal"] = p["journal"]
            if nonempty(p.get("first_online")) and (not matched.get("date") or len(matched.get("date", "")) < 7):
                matched["date"] = p["first_online"]
            if doi:
                matched["doi"] = doi
            if src:
                matched["source_url"] = src
                matched["link_kind"] = "original"
            elif not matched.get("link_kind"):
                matched["link_kind"] = "search"
            if cat:
                matched["topic"] = " / ".join(cat)
                matched["categories"] = cat
            matched["archive"] = True
            matched["archive_review_required"] = bool(p.get("needs_review", True))
            matched["status"] = status
            matched["archive_id"] = p.get("id")
            matched["brief_dates"] = p.get("brief_dates") or []
        else:
            new = {
                "id": p.get("id") or "historical-" + key(name)[:24],
                "title": name,
                "title_zh": p.get("title_zh") or "",
                "journal": p.get("journal") or "待核实",
                "date": p.get("first_online") or "",
                "doi": doi,
                "topic": " / ".join(cat) if cat else "历史简报",
                "categories": cat,
                "study_type": p.get("study_type") or "历史文献",
                "description": p.get("summary_zh") or "",
                "source_url": src,
                "lookup_url": p.get("lookup_url") or "",
                "link_kind": "original" if src else "missing",
                "status": status,
                "origin": "历史简报归档",
                "archive": True,
                "archive_id": p.get("id"),
                "archive_review_required": bool(p.get("needs_review", True)),
                "brief_dates": p.get("brief_dates") or [],
            }
            current.append(new)
            bytitle[key(name)] = new
            if doi:
                bydoi[key(doi)] = new
            added += 1

    current.sort(key=lambda r: r.get("date", ""), reverse=True)
    existing_events = json.loads(EVENTS.read_text(encoding="utf-8"))
    seen_events = {r.get("id") for r in existing_events}
    for e in events:
        if e.get("id") in seen_events:
            continue
        deadline = (e.get("deadline") or "")[:10]
        is_expired = bool(deadline and deadline < date.today().isoformat())
        historical_status = e.get("historical_status_as_of_2026_10_24") or ""
        label = ("已截止·历史归档" if is_expired else
                 "截止日期待复核" if not deadline else
                 "历史记录·开放状态未核验")
        existing_events.append({
            "id": e["id"],
            "title": e.get("name") or "",
            "organizer": e.get("organizer") or "",
            "journal": e.get("organizer") or "",
            "date": deadline,
            "deadline": e.get("deadline") or "",
            "category": e.get("category"),
            "topic": e.get("theme") or ("医学AI比赛" if e.get("category") == "competition" else "学术会议征集"),
            "description": ("截止日期：" + (deadline or "未明确") + "。该记录恢复自历史科研简报，是否仍开放需查看官网核实。"),
            "source_url": e.get("url") or "",
            "status": label,
            "historical_status": historical_status,
            "archive": True,
        })
        seen_events.add(e["id"])
    existing_events.sort(key=lambda r:r.get("date",""), reverse=True)
    changed = [
        write_if_changed(RESEARCH, current),
        write_if_changed(EVENTS, existing_events),
        write_if_changed(BRIEFS, briefs)
    ]
    print(f"Archive: {len(papers)} paper records merged ({added} newly added); {len(existing_events)} events; {len(briefs)} brief dates; changed={changed}.")

if __name__ == "__main__":
    main()
