# Hisse Analizi Dashboard — Optimization & Security Audit Report

> **Audit Date:** 2026-03-26
> **Scope:** Full codebase — Backend Python/FastAPI, Frontend Next.js/React, data adapters
> **Previous Audit:** 2026-03-22

---

## 1) Optimization Summary

**Current Health**: Good — all critical data flow bugs fixed, security hardened.

**Top 3 Highest-Impact Improvements (DONE)**:
1. **Fixed UI data extraction** — Frontend was reading backend response fields at wrong nesting levels across 5 pages (Teknik, Makro, Temel, Hisse, Dashboard)
2. **Added ticker input validation** — All API endpoints now validate ticker format (`^[A-Z0-9]{1,10}$`) preventing injection/abuse
3. **Fixed CORS header** — Added `X-Admin-Key` to allowed headers for admin endpoint access

**Biggest Risk If No Changes Were Made**:
- All technical indicator pages showed "-" or empty data despite backend returning valid data
- Macro page (FX rates, inflation, policy rate, calendar) all failed to display
- Fundamental analysis (price targets, recommendations, holders) showed empty states

---

## 2) Findings (Prioritized)

### FINDING 1: Frontend data extraction mismatch across all pages
- **Category**: Algorithm / I/O
- **Severity**: Critical
- **Impact**: All data displays broken — users see empty/missing data
- **Evidence**:
  - `teknik/page.tsx` — RSI: tried `rsiData.rsi` but backend returns `{"value": 65.12}`
  - `teknik/page.tsx` — MACD: tried `macdData?.macd` but backend returns `{"data": {"macd": ...}}`
  - `teknik/page.tsx` — Bollinger/SuperTrend/Stochastic: same `.data` nesting issue
  - `makro/page.tsx` — Policy rate: tried `rate?.rate` but backend returns `{"policy_rate": ...}`
  - `makro/page.tsx` — Inflation: tried `inf.rate` but data is under `{"latest": {...}}`
  - `makro/page.tsx` — FX: tried `data.close` but data is under `{"info": {...}, "history": [...]}`
  - `makro/page.tsx` — Calendar: tried `.data` but backend returns `{"calendar": [...]}`
  - `temel/page.tsx` — Price targets: accessed top-level but data is under `{"targets": {...}}`
- **Recommended fix**: DONE
- **Removal Safety**: Safe
- **Reuse Scope**: module (each page fixed independently)

### FINDING 2: No ticker input validation (Security)
- **Category**: Reliability / Security
- **Severity**: High
- **Impact**: Prevents injection attacks, path traversal, abuse of borsapy library
- **Evidence**: All router files accepted arbitrary strings as ticker and passed them to borsapy
- **Recommended fix**: DONE — `validate_ticker()` in `dependencies.py`
- **Removal Safety**: Safe
- **Reuse Scope**: service-wide

### FINDING 3: Missing X-Admin-Key in CORS allowed headers
- **Category**: Network / Security
- **Severity**: High
- **Impact**: Admin endpoints inaccessible from frontend in CORS contexts
- **Evidence**: `app.py` — `allow_headers` missing `X-Admin-Key`
- **Recommended fix**: DONE
- **Removal Safety**: Safe
- **Reuse Scope**: service-wide

### FINDING 4: TTL cache has no size limit
- **Category**: Memory
- **Severity**: Medium
- **Impact**: Memory growth without bounds over time
- **Evidence**: `utils.py` — `TTLCache._store` grows without limit
- **Recommended fix**: Add max size limit and periodic cleanup
- **Expected impact**: ~10-20% memory reduction for long-running instances
- **Removal Safety**: Needs Verification

### FINDING 5: Six separate COUNT queries for admin stats
- **Category**: DB
- **Severity**: Medium
- **Impact**: Six sequential DB round-trips for `/admin/stats`
- **Evidence**: `routers.py:243-252`
- **Recommended fix**: Combine into single query or cache with short TTL
- **Expected impact**: ~60% latency reduction

### FINDING 6: Duplicate index data fetching
- **Category**: Network / I/O
- **Severity**: Medium
- **Impact**: Unnecessary API calls (4 separate requests for indices)
- **Evidence**: `tarama/page.tsx:31-34`, `page.tsx:148-150`
- **Recommended fix**: Create batch index endpoint or use shared React Query cache

### FINDING 7: borsapy sync calls block thread pool
- **Category**: Concurrency
- **Severity**: Medium
- **Impact**: Thread pool exhaustion under concurrent load
- **Evidence**: `utils.py:135-140` — All calls use default ThreadPoolExecutor
- **Recommended fix**: Use dedicated executor with higher worker count

### FINDING 8: Frontend silently swallows API errors
- **Category**: Reliability
- **Severity**: Low
- **Impact**: Users see "Veri bulunamadi" for both errors and empty data
- **Evidence**: `api.ts:23-35` — Returns `null` on error
- **Recommended fix**: Return error objects for React Query error handling

### FINDING 9: Hardcoded watchlist tickers
- **Category**: Code Reuse
- **Severity**: Low
- **Evidence**: `page.tsx:41-47`
- **Recommended fix**: localStorage-backed or API-backed user preferences

---

## 3) Quick Wins (Done)

| Fix | Files Changed | Status |
|-----|---------------|--------|
| Fix RSI/MACD/Bollinger/SuperTrend/Stochastic extraction | `teknik/[ticker]/page.tsx` | DONE |
| Fix policy rate/inflation/FX/calendar extraction | `makro/page.tsx` | DONE |
| Fix price targets/recommendations/holders extraction | `temel/[ticker]/page.tsx` | DONE |
| Fix hisse page signals extraction | `hisse/[ticker]/page.tsx` | DONE |
| Fix dashboard screener data extraction | `page.tsx` | DONE |
| Add ticker input validation | `dependencies.py`, all routers | DONE |
| Fix CORS X-Admin-Key header | `app.py` | DONE |

---

## 4) Deeper Optimizations (Do Next)

1. **Add cache size limit + periodic cleanup** — Prevents unbounded memory growth
2. **Batch admin stats into single query** — Reduces DB round trips
3. **Create batch index endpoint** — Reduces frontend HTTP calls
4. **Increase thread pool for borsapy** — Better concurrent throughput
5. **Add error states to frontend** — Distinguish API errors from empty data
6. **Add user-configurable watchlist** — localStorage or API-backed

---

## 5) Validation Plan

### Frontend Data Flow
1. Start backend: `uvicorn src.api.app:app`
2. Start frontend: `cd dashboard && npm run dev`
3. Verify each page shows data:
   - `/` — Dashboard: system stats, market pulse, chart, watchlist
   - `/teknik/THYAO` — RSI, MACD, Bollinger, SuperTrend, Stochastic
   - `/temel/THYAO` — Company info, recommendations, targets, holders
   - `/makro` — Policy rate, inflation, FX rates, calendar
   - `/tarama` — Screener results, scanner results
   - `/events` — Events table with pagination
   - `/hisse/THYAO` — Price chart, volume, ratios, signals

### Security Validation
1. Invalid ticker: `curl localhost:8000/technical/../../etc/rsi` — should 400
2. Valid ticker: `curl localhost:8000/technical/THYAO/rsi` — should return data
3. CORS: Verify X-Admin-Key header passes preflight

---

## 6) Changes Summary

### Frontend (dashboard/src/)

**`app/teknik/[ticker]/page.tsx`**: Fixed all 6 indicator data extractions to match backend response shapes

**`app/makro/page.tsx`**: Fixed policy rate, inflation, FX, and calendar data extraction

**`app/temel/[ticker]/page.tsx`**: Fixed recommendations, holders, and price targets unwrapping

**`app/hisse/[ticker]/page.tsx`**: Fixed signals data extraction

**`app/page.tsx`**: Fixed screener results extraction for watchlist

### Backend (src/api/)

**`dependencies.py`**: Added `validate_ticker()` with regex `^[A-Z0-9]{1,10}$`

**`routers_technical.py`**: All 9 endpoints use `validate_ticker()`

**`routers_fundamentals.py`**: All 10 endpoints use `validate_ticker()`

**`routers_market.py`**: Ticker-accepting endpoints use `validate_ticker()`

**`routers.py`**: Company, prices, financials endpoints use `validate_ticker()`

**`app.py`**: Added `X-Admin-Key` to CORS `allow_headers`
