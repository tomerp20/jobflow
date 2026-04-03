"""
JobFlow Injestor — Phase 1 Pilot Script

4-stage pipeline for processing Israeli startup companies:
  Stage 1 — Careers Discovery
  Stage 2 — Headcount Verification
  Stage 3 — Data Extraction
  Stage 4 — LLM Classification (Gemini 1.5 Flash)

Output: crawler/pilot_results.json
"""

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

DATASET_URL = (
    "https://raw.githubusercontent.com/TheBSD/scraping-israeli-data/"
    "refs/heads/main/4.startupnationcentral/Results-Folder/Json-Files/companies.json"
)
SERPER_URL = "https://google.serper.dev/search"
CONCURRENCY = 5
REQUEST_TIMEOUT = 10.0
MAX_COMPANIES = 100

ATS_PATTERNS = [
    ("greenhouse", "boards.greenhouse.io"),
    ("lever", "jobs.lever.co"),
    ("comeet", "comeet.com/co"),
    ("breezy", "breezy.hr"),
    ("workable", "apply.workable.com"),
    ("ashby", "jobs.ashbyhq.com"),
    ("bamboohr", "bamboohr.com/careers"),
    ("workday", "myworkdayjobs.com"),
    ("smartrecruiters", "smartrecruiters.com/"),
    ("recruitee", "recruitee.com/"),
    ("icims", "icims.com/"),
    ("taleo", "taleo.net/"),
    ("rippling", "app.rippling.com/jobs"),
]

# Paths probed directly when HTML scan finds nothing (handles JS-rendered sites)
CAREER_PATHS = ["/careers", "/jobs", "/work-with-us", "/join-us", "/hiring", "/open-positions", "/openings", "/positions", "/team/join", "/about/careers"]

GEMINI_PROMPT = """\
You are a job-market analyst helping a senior backend developer find relevant Israeli companies.

Company Name: {company_name}
Sector: {sector}
Website: {website}
Meta Description: {meta_description}
OG Description: {og_description}
Page Title: {page_title}
Body Text: {body_snippet}

Classify and return ONLY valid JSON (no markdown, no backticks):
{{
  "service_score": <1-10, where 1=pure product, 10=pure service/consulting>,
  "category": "<PRODUCT|SERVICE|IRRELEVANT>",
  "reasoning_hebrew": "<reasoning in Hebrew>",
  "is_relevant_for_senior_backend": <true|false>
}}"""

# Sentinel used by stage4_classify to signal a drop without ambiguity.
# Using a distinct object avoids colliding with any key in a real classification dict.
_STAGE4_DROP = object()


# ---------------------------------------------------------------------------
# Stage 1 — Careers Discovery
# ---------------------------------------------------------------------------

async def _probe_career_paths(
    client: httpx.AsyncClient, base_url: str
) -> Optional[str]:
    """
    Try fetching each career path directly. Returns the first path that
    responds with 2xx. Used as fallback for JS-rendered sites where links
    don't appear in static HTML.
    """
    base = base_url.rstrip("/")
    for path in CAREER_PATHS:
        url = base + path
        try:
            resp = await client.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True)
            if resp.status_code < 300:
                return path
        except Exception:
            continue
    return None


async def stage1_careers(
    client: httpx.AsyncClient, company: dict
) -> tuple[Optional[dict], Optional[str], dict]:
    """
    Returns (drop_result, html, careers_meta).

    drop_result is set only when the company is genuinely unreachable or has
    no website — NOT when careers detection fails (that is a detection
    limitation, not evidence the company isn't hiring).

    careers_meta: {"careers_url": str|None, "ats_platform": str|None, "careers_detected": bool}

    Two-pass approach:
      Pass 1 — scan static HTML for ATS fingerprints and career path links.
      Pass 2 — if nothing found (JS-rendered sites), probe each career path
                directly with a live HTTP request.
    """
    name = company.get("company_name", "?")
    website = company.get("website") or ""
    if not website:
        return (
            {"reason": "no website field", "stage": 1},
            None,
            {"careers_url": None, "ats_platform": None, "careers_detected": False},
        )

    if not website.startswith("http"):
        website = "https://" + website

    try:
        resp = await client.get(
            website, timeout=REQUEST_TIMEOUT, follow_redirects=True
        )
        html = resp.text
    except Exception as exc:
        log.info("[Stage 1] %s -> unreachable: %s", name, exc)
        return (
            {"reason": f"unreachable: {exc}", "stage": 1},
            None,
            {"careers_url": None, "ats_platform": None, "careers_detected": False},
        )

    html_lower = html.lower()

    # Pass 1a — ATS fingerprint in static HTML
    ats_found = None
    careers_url = None
    for platform, pattern in ATS_PATTERNS:
        if pattern in html_lower:
            ats_found = platform
            careers_url = pattern
            break

    # Pass 1b — career path href in static HTML (scoped to <a href> attributes only)
    if not careers_url:
        soup_pass1 = BeautifulSoup(html, "html.parser")
        for a_tag in soup_pass1.find_all("a", href=True):
            href = a_tag["href"].lower()
            for path in CAREER_PATHS:
                if href == path or href.startswith(path + "/") or href.startswith(path + "?"):
                    careers_url = path
                    break
            if careers_url:
                break

    # Pass 2 — probe paths directly (handles JS-rendered / SPA sites)
    if not careers_url:
        log.info("[Stage 1] %s -> static scan empty, probing career paths…", name)
        careers_url = await _probe_career_paths(client, website)

    careers_detected = careers_url is not None
    if careers_detected:
        log.info(
            "[Stage 1] %s -> careers found: %s (%s)",
            name,
            careers_url,
            ats_found or "direct probe",
        )
    else:
        log.info("[Stage 1] %s -> careers not detected (passing through to Stage 2)", name)

    careers_meta = {
        "careers_url": careers_url,
        "ats_platform": ats_found,
        "careers_detected": careers_detected,
    }
    return None, html, careers_meta


# ---------------------------------------------------------------------------
# Stage 2 — Headcount Verification
# ---------------------------------------------------------------------------

HEADCOUNT_RE = re.compile(r"([\d,]+)\s*[-–]\s*([\d,]+)\s*employees", re.IGNORECASE)
SINGLE_HEADCOUNT_RE = re.compile(r"([\d,]+)\s*\+?\s*employees", re.IGNORECASE)


def _parse_headcount_from_snippet(snippet: str) -> Optional[int]:
    m = HEADCOUNT_RE.search(snippet)
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except ValueError:
            pass
    m = SINGLE_HEADCOUNT_RE.search(snippet)
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return None


def _parse_headcount_from_source(num_employees_field: str) -> Optional[int]:
    """Parse '51-200' style field from source JSON → lower bound."""
    if not num_employees_field:
        return None
    m = re.search(r"(\d[\d,]*)", num_employees_field)
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return None


_CAREER_LINK_KEYWORDS = (
    "/careers", "/jobs", "/hiring", "/open-positions", "/openings",
    "greenhouse.io", "lever.co", "workable.com",
    "ashbyhq.com", "comeet.com", "smartrecruiters.com", "bamboohr.com",
)


def _detect_ats(link_lower: str) -> Optional[str]:
    for platform, pattern in ATS_PATTERNS:
        if pattern in link_lower:
            return platform
    return None


async def stage2_headcount_and_careers(
    client: httpx.AsyncClient,
    company: dict,
    serper_key: str,
    semaphore: asyncio.Semaphore,
    existing_careers_url: Optional[str],
) -> tuple[Optional[dict], dict]:
    """
    Consolidated Serper call: headcount verification + careers URL enrichment.

    Returns (drop_result, enrichment) where enrichment may contain
    careers_url / ats_platform if Stage 1 left them null and Serper found one.
    """
    name = company.get("company_name", "?")
    headcount: Optional[int] = None
    verified = False
    enrichment: dict = {}

    if serper_key:
        try:
            payload = {"q": f'"{name}" employees OR careers OR jobs', "num": 10}
            headers = {"X-API-KEY": serper_key, "Content-Type": "application/json"}
            async with semaphore:
                await asyncio.sleep(0.5)  # inside semaphore: spaces out slot releases for rate-limiting
                resp = await client.post(
                    SERPER_URL, json=payload, headers=headers, timeout=10.0
                )
            data = resp.json()
            organic = data.get("organic", [])

            # Parse headcount
            for item in organic:
                snippet = item.get("snippet", "")
                parsed = _parse_headcount_from_snippet(snippet)
                if parsed is not None:
                    headcount = parsed
                    verified = True
                    break

            # Enrich careers URL if Stage 1 found nothing
            if existing_careers_url is None:
                for item in organic:
                    link = item.get("link", "")
                    link_lower = link.lower()
                    if any(kw in link_lower for kw in _CAREER_LINK_KEYWORDS):
                        enrichment["careers_url"] = link
                        enrichment["ats_platform"] = _detect_ats(link_lower)
                        break

        except Exception as exc:
            log.warning("[Stage 2] %s -> Serper call failed: %s", name, exc)

    # Fallback to source JSON field
    if headcount is None:
        source_field = company.get("num_employees") or ""
        headcount = _parse_headcount_from_source(str(source_field))

    company["_headcount"] = headcount
    company["_headcount_verified"] = verified

    if headcount is not None and headcount < 20:
        log.info("[Stage 2] %s -> dropped: headcount %d < 20", name, headcount)
        return {"reason": f"headcount {headcount} < 20", "stage": 2}, enrichment

    log.info(
        "[Stage 2] %s -> headcount: %s (%s)",
        name,
        headcount if headcount is not None else "unknown",
        "verified" if verified else "unverified",
    )
    return None, enrichment


# ---------------------------------------------------------------------------
# Stage 3 — Data Extraction
# ---------------------------------------------------------------------------

def stage3_extract(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    meta_desc = ""
    og_desc = ""
    page_title = ""

    tag = soup.find("meta", attrs={"name": "description"})
    if tag:
        meta_desc = tag.get("content", "")

    tag = soup.find("meta", attrs={"property": "og:description"})
    if tag:
        og_desc = tag.get("content", "")

    title_tag = soup.find("title")
    if title_tag:
        page_title = title_tag.get_text(strip=True)

    for unwanted in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        unwanted.decompose()

    body_snippet = soup.get_text(separator=" ", strip=True)[:2000]

    return {
        "meta_description": meta_desc,
        "og_description": og_desc,
        "page_title": page_title,
        "body_snippet": body_snippet,
    }


# ---------------------------------------------------------------------------
# Stage 4 — LLM Classification (Gemini 1.5 Flash)
# ---------------------------------------------------------------------------

def _classify_sync(client: genai.Client, prompt: str) -> Optional[dict]:
    try:
        response = client.models.generate_content(
            model="gemini-1.5-flash", contents=prompt
        )
        text = response.text.strip()
        # Strip markdown backticks if present
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        return json.loads(text)
    except json.JSONDecodeError as exc:
        log.warning("[Stage 4] JSON parse failed: %s (response: %s)", exc, text[:200] if text else "(empty)")
        return None
    except Exception as exc:
        log.warning("[Stage 4] Gemini call failed: %s", exc)
        return None


def _sanitize_for_prompt(value: str, max_len: int = 500) -> str:
    """Strip newlines and truncate to limit prompt injection via field values."""
    return value.replace("\n", " ").replace("\r", " ")[:max_len]


async def stage4_classify(
    client: genai.Client,
    company: dict,
    extracted: dict,
    semaphore: asyncio.Semaphore,
):
    """
    Returns:
      _STAGE4_DROP  — company should be dropped (classified IRRELEVANT)
      None          — classification failed; company is kept with null classification
      dict          — valid classification result
    """
    name = company.get("company_name", "?")
    prompt = GEMINI_PROMPT.format(
        company_name=_sanitize_for_prompt(name, 100),
        sector=_sanitize_for_prompt(company.get("sector") or "", 100),
        website=_sanitize_for_prompt(company.get("website") or "", 200),
        meta_description=_sanitize_for_prompt(extracted.get("meta_description", ""), 300),
        og_description=_sanitize_for_prompt(extracted.get("og_description", ""), 300),
        page_title=_sanitize_for_prompt(extracted.get("page_title", ""), 200),
        body_snippet=_sanitize_for_prompt(extracted.get("body_snippet", ""), 1500),
    )

    async with semaphore:
        classification = await asyncio.to_thread(_classify_sync, client, prompt)

    if classification is None:
        log.warning("[Stage 4] %s -> classification failed, keeping with null", name)
        return None

    category = classification.get("category", "?")
    score = classification.get("service_score", "?")
    relevant = classification.get("is_relevant_for_senior_backend", "?")

    if category == "IRRELEVANT":
        log.info("[Stage 4] %s -> dropped: IRRELEVANT", name)
        return _STAGE4_DROP

    log.info(
        "[Stage 4] %s -> %s (score: %s, relevant: %s)",
        name,
        category,
        score,
        relevant,
    )
    return classification


# ---------------------------------------------------------------------------
# Pipeline — process one company
# ---------------------------------------------------------------------------

async def process_company(
    client: httpx.AsyncClient,
    company: dict,
    serper_key: str,
    gemini_client: genai.Client,
    semaphore: asyncio.Semaphore,
    index: int,
) -> dict:
    name = company.get("company_name", f"company_{index}")

    # Validate required fields exist
    if not company.get("website"):
        return {
            "company_id": index + 1,
            "company_name": name,
            "website": "",
            "sector": "",
            "num_employees_source": "",
            "status": "dropped",
            "drop_reason": "missing website field",
            "drop_stage": 1,
            "careers_url": None,
            "ats_platform": None,
            "careers_detected": False,
            "headcount": None,
            "headcount_verified": False,
            "meta_description": None,
            "og_description": None,
            "page_title": None,
            "body_snippet": None,
            "classification": None,
        }

    result: dict = {
        "company_id": index + 1,
        "company_name": name,
        "website": company.get("website") or "",
        "sector": company.get("sector") or "",
        "num_employees_source": str(company.get("num_employees") or ""),
        "status": "dropped",
        "drop_reason": None,
        "drop_stage": None,
        "careers_url": None,
        "ats_platform": None,
        "careers_detected": False,
        "headcount": None,
        "headcount_verified": False,
        "meta_description": None,
        "og_description": None,
        "page_title": None,
        "body_snippet": None,
        "classification": None,
    }

    try:
        # --- Stage 1 ---
        async with semaphore:
            drop, html, careers_meta = await stage1_careers(client, company)
        if drop:
            result["drop_reason"] = drop["reason"]
            result["drop_stage"] = drop["stage"]
            return result

        result["careers_url"] = careers_meta["careers_url"]
        result["ats_platform"] = careers_meta["ats_platform"]
        result["careers_detected"] = careers_meta["careers_detected"]

        # --- Stage 2 (headcount + careers enrichment) ---
        drop, enrichment = await stage2_headcount_and_careers(
            client, company, serper_key, semaphore,
            existing_careers_url=result["careers_url"],
        )
        if enrichment.get("careers_url"):
            result["careers_url"] = enrichment["careers_url"]
            result["ats_platform"] = enrichment["ats_platform"]
            result["careers_detected"] = True

        if drop:
            result["drop_reason"] = drop["reason"]
            result["drop_stage"] = drop["stage"]
            result["headcount"] = company.get("_headcount")
            result["headcount_verified"] = company.get("_headcount_verified", False)
            return result

        result["headcount"] = company.get("_headcount")
        result["headcount_verified"] = company.get("_headcount_verified", False)

        # --- Stage 3 ---
        extracted = stage3_extract(html)
        result.update(extracted)

        # --- Stage 4 ---
        classification = await stage4_classify(gemini_client, company, extracted, semaphore)
        if classification is _STAGE4_DROP:
            result["drop_reason"] = "classified as IRRELEVANT"
            result["drop_stage"] = 4
            return result

        result["classification"] = classification
        result["status"] = "kept"

    except Exception as exc:
        log.error("[Pipeline] %s -> unexpected error: %s", name, exc)
        result["drop_reason"] = f"unexpected error: {exc}"
        result["drop_stage"] = None

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    serper_key = os.getenv("SERPER_API_KEY", "")
    google_key = os.getenv("GOOGLE_API_KEY", "")

    if not google_key:
        log.error("GOOGLE_API_KEY is not set. Copy .env.example to .env and fill in the keys.")
        sys.exit(1)
    if not serper_key:
        log.warning(
            "SERPER_API_KEY is not set. Headcount verification will rely on source JSON only."
        )

    gemini_client = genai.Client(api_key=google_key)

    # Fetch dataset
    log.info("Fetching dataset from %s …", DATASET_URL)
    async with httpx.AsyncClient() as bootstrap_client:
        try:
            resp = await bootstrap_client.get(DATASET_URL, timeout=30.0)
            resp.raise_for_status()
            all_companies = resp.json()
        except Exception as exc:
            log.error("Failed to fetch dataset: %s", exc)
            sys.exit(1)

    companies = all_companies[:MAX_COMPANIES]
    log.info("Processing %d companies …", len(companies))

    semaphore = asyncio.Semaphore(CONCURRENCY)
    drop_breakdown = {
        "stage_1_unreachable": 0,
        "stage_2_headcount_too_small": 0,
        "stage_4_irrelevant": 0,
    }

    async with httpx.AsyncClient(
        headers={"User-Agent": "JobFlow-Injestor/1.0"},
        follow_redirects=True,
    ) as client:
        tasks = [
            process_company(client, company, serper_key, gemini_client, semaphore, i)
            for i, company in enumerate(companies)
        ]
        results = await asyncio.gather(*tasks)

    kept = 0
    for r in results:
        if r["status"] == "kept":
            kept += 1
        else:
            stage = r.get("drop_stage")
            if stage == 1:
                drop_breakdown["stage_1_unreachable"] += 1
            elif stage == 2:
                drop_breakdown["stage_2_headcount_too_small"] += 1
            elif stage == 4:
                drop_breakdown["stage_4_irrelevant"] += 1

    output = {
        "metadata": {
            "run_date": datetime.now(timezone.utc).isoformat(),
            "total_processed": len(results),
            "kept": kept,
            "dropped": len(results) - kept,
            "drop_breakdown": drop_breakdown,
        },
        "results": results,
    }

    output_path = os.path.join(os.path.dirname(__file__), "pilot_results.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    log.info(
        "Done. kept=%d dropped=%d → %s",
        kept,
        len(results) - kept,
        output_path,
    )


if __name__ == "__main__":
    asyncio.run(main())
