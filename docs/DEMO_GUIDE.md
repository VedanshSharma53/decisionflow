# DecisionFlow — Demo Guide

Spoken viva script. Prefer **Demo script** mode if the mic or Wi‑Fi is unreliable.

Full clone / install: [../README.md](../README.md).  
Prep checklist + team split: [GUIDE.md](GUIDE.md) (Step 9).

## Setup (2 minutes)

```bash
# First time: npm run install:all, then copy server/.env.example → server/.env
npm run seed                 # AI_MODE=mock needs no Claude key
npm run dev
```

Open **http://localhost:5173**  
Log in: **`demo@decisionflow.app` / `demo1234`**  
Project: **Campus Connect App**

---

## Walkthrough

### 1. Dashboard
Show the four stat cards (open actions, overdue, pending reviews, decisions this week), the open action list (overdue in red), and recent meetings from Sprint 1.

### 2. Decisions + search
- Open **Decisions**.
- Type **`launch`** in the page search (or use the top-bar global search).
- Open **Launch the beta on 15 March** — status **APPROVED**, history shows PROPOSED → APPROVED.

### 3. Live Meeting 2 (the main demo)
1. **Meetings → Sprint 2 Planning → Start meeting**.
2. Optionally open the same URL in a second browser window to show live join.
3. Input mode = **Demo script**, file = `meeting2_followup.txt`, speed **2× or 4×**, **Play demo**.
4. Point out:
   - Transcript lines appearing with speaker names.
   - Decision / action / blocker / question cards in the middle.
   - Chit-chat (“cafeteria chai”) is **not** extracted.

### 4. Conflict alert
When the line about moving the launch to **1 April** is processed:
- A **red/amber review card** appears in **Alerts**.
- It compares against **Launch the beta on 15 March**.
- Click **Accept**.
- The old decision badge becomes **MODIFIED** (or **SUPERSEDED** depending on relation type); the new one becomes **APPROVED**.

Also expect a flag for **Google sign-in** vs **email OTP only**.

### 5. Recurring blocker
When the SMTP line appears:
- An amber **Recurring blocker** card shows “Also raised in Sprint 1 Kickoff”.

### 6. End → report
1. **End meeting**.
2. Click **View report**.
3. Show the Markdown summary, then **Print / Save as PDF** (sidebar hides via print CSS) and **Download .md**.
4. Optional: **Regenerate**.

### 7. Wrap-up pages
- Open the old decision → **Decision chain** links 15 March ↔ 1 April.
- **Action Items** — overdue rows in red; change a status with the dropdown.
- **Insights** — bar / pie / line charts, accountability score, recurring blockers table.
- **Review Queue** if any flags are still pending (sidebar shows a red count).

---

## Mic fallback (optional)

If you want to show speech:
1. Use **Chrome or Edge** at `http://localhost:5173` (not a LAN IP).
2. Allow microphone permission.
3. Input mode = **Microphone**, pick a participant in “Speaking as”, **Start mic**.
4. Read lines from `demo/meeting2_followup.txt` with a teammate.

If the browser stops listening after silence, that is normal — the app restarts recognition while the meeting is LIVE and not paused.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| No AI cards | Confirm `AI_MODE=mock` in `server/.env`, restart `npm run dev`, play more demo lines (buffer needs ~4 lines or 20s). |
| No conflict flag | Re-seed (`npm run seed`) so Meeting 1 APPROVED decisions exist; play Meeting 2 again. |
| Socket / blank live page | Check terminal — server on :4000, Vite proxy for `/api` and `/socket.io`. |
| Mic silent | Chrome/Edge + localhost + permission + internet (Chrome speech needs network). |

---

## Demo accounts & seed content

| Item | Value |
|---|---|
| Login | `demo@decisionflow.app` / `demo1234` |
| Project | Campus Connect App |
| Meeting 1 | Sprint 1 Kickoff (ENDED) — 15 March launch, SQLite, OTP-only, SMTP blocker |
| Meeting 2 | Sprint 2 Planning (SCHEDULED) — run live with `meeting2_followup.txt` |
