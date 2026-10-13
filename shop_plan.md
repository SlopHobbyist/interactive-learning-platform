# Shop Plan — Chests, Coins, Daily Quests and the Shop

This replaces **Resonance drops** (plan §6, Phase 7). Read `plan.md` §0 (ground rules) first; every
rule there still holds. In particular: no real money, no externally hosted assets, no build step,
the Wavefront visual language (fills, one accent, no gradients or glow, reduced motion respected),
and **the odds are shown openly in the UI**.

---

## 1. What changes

| Before | After |
|---|---|
| Resonance drops: a 35 % roll after each new lesson, rarities, odds on the profile | **Chests**: earned from **daily quests**, plus a chance after each new lesson |
| Rewards: XP boost, streak freeze, tile shapes, ripple pattern, titles | Chests hold an **XP boost**, a **streak freeze** or **coins**. Nothing else |
| XP boost doubles the next lesson | XP boost is **15 minutes of double XP**, starting when the chest is opened |
| Freezes stack without limit | You can hold at most **2** freezes |
| Nothing to buy | **Coins**, earned reliably, spent in the **Shop** |
| Cosmetics: map tile shapes and patterns, profile titles | Removed. The shop sells **sound packs** and **correct-answer effects** |
| Setting `drops` | Setting `chests` (chests and daily quests). Coins and the shop are always on |

The split is deliberate. **Chests are the random part** (boosts and freezes). **Coins are the
reliable part** and buy the things people choose (sounds, effects, a freeze).

---

## 2. Daily quests

- There are three a day, one per tier: **easy**, **medium** and **hard**. They reset at local
  midnight, using the same day boundary as the streak (the timezone the client sends).
- They are picked deterministically per learner and day (seeded with `user id : date`) and
  stored the first time they are read. A config change never rewrites today's quests.
- Progress is **derived from what already happened that day**: the daily log, completions and
  attempts. There are no separate counters to drift. Quests are re-checked when a lesson or
  review is completed and when `/api/quests` is read. A quest that has just been met grants one
  chest (`source: quest`).
- The tiers are staggered so the chests arrive at different points in a session:
  - **easy**: done in the first lesson ("Finish a lesson", "Earn ½ goal XP").
  - **medium**: 2–3 lessons ("Get 8 right in a row", "Review 10 items", "Meet your daily goal").
  - **hard**: a real session ("Earn 2× your daily goal", "Finish a perfect lesson", "Finish 3
    lessons", "Get 15 right in a row").
- XP targets scale with the daily goal (`target_goal: 0.5`), rounded to 5.
- Review quests are only offered once the learner has enough items to review
  (`requires_items`), so a new learner never gets a quest they cannot finish.
- The pool lives in `server/app/economy.yaml` (`quests:`).

## 3. Chests after a lesson (the timing)

The aim is to make "one more lesson" worth it, honestly: the odds are public and the summary
shows the real chance of a chest on the next lesson.

The chance is worked out on each **first completion** of a lesson (repeats never give a chest):

```
chance = base                                   10 %
       + per_session_lesson × lessons this session   +5 % each, at most +20 %
       + perfect (if every answer was right first time)  +10 %
       + per_dry_lesson × lessons since the last lesson chest   +8 % each
```

- **Session momentum.** A session is a run of XP-earning activity (lessons or reviews) with gaps
  of less than 30 minutes. Each one already done this session raises the chance.
- **Bad-luck protection.** After 6 lessons in a row with no lesson chest, the next one is
  guaranteed.
- **First lesson ever:** a guaranteed chest, as an early hook.
- **Daily cap:** at most 3 lesson chests a day. Quest chests don't count toward the cap.
- **Show the next chance.** The summary says "Next lesson: 38 % chest chance (48 % if
  perfect)" beside Continue. At the cap it says so, and points to the quests instead.
- **Never mid-lesson.** Chests are opened on the summary with a tap. A chest that is not opened
  waits under *Your chests* in the shop and on the home page.

## 4. What a chest holds

| Content | Weight | Effect |
|---|---|---|
| XP boost | 40 | 15 minutes of double XP, starting now. Opening another one while a boost is active adds 15 minutes. |
| Streak freeze | 20 | +1 freeze. If you already hold 2, it becomes coins instead. |
| Coins | 40 | 10, 15, 20, 25 or 30, each equally likely. |

The boost doubles every XP gain recorded while it is active: lesson completions and review
sessions. It is a timestamp on the user (`users.xp_boost_until`), using the same clock as
everything else, including dev time travel.

## 5. Coins

| Earned for | Coins |
|---|---|
| First completion of a lesson | 5 |
| …and every answer right first time | +5 |
| A finished review session (the first 5 a day) | 3 |
| Meeting the daily goal (once a day) | 10 |
| Last week's league, ranks 1 / 2 / 3 (multi-user mode, opted in, at least 3 learners with XP) | 50 / 30 / 20 |
| A chest | 10–30 |

That comes to about 25–40 coins on a normal day. Coins are a ledger (`coin_events`), so the
balance is a sum and every payout can be checked. League payouts are settled lazily, the first
time `/api/me` or `/api/shop` is read in the new week, and are paid once per week
(`ref = league:<week start>`).

## 6. The shop

| Item | Slot | Price |
|---|---|---|
| Streak freeze (cap 2) | — | 100 |
| **Classic** sounds (the current ones) | sounds | free, default |
| **Marimba** sounds | sounds | 300 |
| **Chiptune** sounds | sounds | 300 |
| **Combo Climb** sounds: each correct answer in a row plays one note higher (8 steps) | sounds | 450 |
| No effect | effect | free, default |
| **Ripple** effect: soft filled circles in the accent soft fill expand from the answer | effect | 200 |
| **Confetti** effect: solid token-coloured pieces | effect | 250 |
| **Stamp** effect: a check mark thunks onto the card | effect | 300 |

- The catalog is `server/app/shop.yaml`. Adding a sound pack means adding WAVs (made by
  `server/tools/make_sounds.py`) and a YAML entry. Adding an effect needs a function in
  `web/js/player/effects.js`.
- Buying equips the item. One item per slot is equipped; the default is always owned.
- Every item can be **previewed** in the shop before buying (the sounds play; the effect runs
  on a sample card).
- Effects follow the visual language: solid token fills, no gradients, no glow. Under
  `prefers-reduced-motion` every effect becomes a brief static flash of the success soft fill.
- Sound assets: `web/assets/sounds/<pack>/{correct,wrong,complete}.wav`. Combo Climb has
  `correct-1.wav` … `correct-8.wav`.

Not in this round: a companion character or outfits (ruled out), badges, profile frames and
fonts.

---

## 7. Server

- `server/app/economy.yaml`: coin payouts, chest contents, the lesson-chest rules and the quest
  pool. `server/app/shop.yaml`: the catalog.
- `server/app/progress/economy.py`: config loading, the coin ledger, freezes (stackable
  inventory), the XP boost and the league payout.
- `server/app/progress/chests.py`: the lesson-chest chance (a pure function plus a DB state
  reader), granting and opening.
- `server/app/progress/quests.py`: picking, metrics and refresh.
- `server/app/progress/shop.py`: catalog, buy, equip, equipped.
- `progress/rewards.py` and `rewards.yaml` are deleted.
- Migration `0003`:
  - new tables `coin_events`, `chests`, `daily_quests`, and the column `users.xp_boost_until`;
  - the `drops` setting is renamed `chests`;
  - held XP boosts, cosmetics and titles are refunded as coins (25 for each boost, 100 for each
    cosmetic or title) and removed;
  - freezes above 2 are refunded at 100 each.

API (the old `/api/rewards`, `/api/inventory` and `/api/inventory/{id}/equip` are removed):

| Method | Path | Returns |
|---|---|---|
| GET | `/api/quests?tz=` | `{ enabled, date, resets_in, quests: [...] }` |
| GET | `/api/chests` | `{ unopened: [...], odds, lesson_rules, coins }` (the public odds) |
| POST | `/api/chests/{id}/open` | `{ chest (with reward), me }` |
| GET | `/api/shop` | `{ coins, freezes, freeze_cap, items: [...], equipped }` |
| POST | `/api/shop/{key}/buy` | `{ item, coins, equipped, me }`; 400 for not enough coins, already owned, or at the freeze cap |
| PUT | `/api/shop/equip` `{ key }` | `{ equipped }` |

`POST …/complete` (lesson) now returns `boosted`, `coins_earned`, `chests` (new and unopened,
lesson and quest), `chest_next` and `quests` instead of `drop`. The review completion returns
`boosted`, `coins_earned`, `chests` and `quests`. `/api/me` adds `coins`, `boost_seconds`,
`freeze_cap`, `equipped` and `chests_unopened`, and drops `title`, `cosmetics` and `xp_boosts`.

## 8. Web

- **Topbar:** a coins chip linking to `/shop`, and while a boost is active, a "2×" chip with a
  countdown.
- **Player:** a boost chip in the head, the equipped sound pack (Combo Climb pitches with the
  streak) and the equipped effect on every correct answer.
- **Summary:**
  - coins earned;
  - the new chests, each opened with a tap (focus goes to the first unopened chest, then to
    Continue);
  - the next-lesson chest chance;
  - a compact view of today's quests.
- **Home:** a Daily quests panel (three meters, chest state, a reset countdown) and any
  unopened chests.
- **Shop** (`/shop`, a drawer item with the balance):
  - Your chests;
  - Streak freeze;
  - Sound packs;
  - Correct-answer effects;
  - How coins and chests work (earning table, chest odds, lesson-chest rules).
- **Profile:** the drops section, the odds table and titles are removed. Coins, freezes (x/2)
  and an active boost are shown.
- **Settings:** "Chests and daily quests" replaces "Resonance drops".
- **Map:** the tile-shape and pattern cosmetics are removed (code and CSS).

## 9. Done when ☑

- The unit tests cover:
  - the chance formula (base, session, perfect, dry-run guarantee, cap, first lesson);
  - chest opening (the freeze cap turning a freeze into coins, a boost extending an active one);
  - quest picking being deterministic, quest progress, and a single chest per quest;
  - coin payouts (first completion only, daily goal once, league once a week);
  - buy and equip (balance, already owned, freeze cap, equip only what you own);
  - boost doubling only inside its window;
  - the migration's refunds.
- The browser tests cover:
  - a summary chest opening;
  - buying and equipping a sound pack in the shop;
  - the quest panel on home;
  - the `chests` setting off leaving no quest or chest UI behind.
- No "resonance" or "drop" wording is left in the UI or the docs.
- The pre-existing failures (the subject-count tests that predate this work) are unchanged and no
  new ones appear.

## 10. Round two ☑

Everything from the old "Later" list. The same rules hold: coins are earned, never bought; the
odds and the terms are printed in the shop; the visual language holds (solid token fills, no
gradients or glow, reduced motion respected).

### 10.1 Streak tools

| Item | Price | What it does |
|---|---|---|
| **Streak-milestone chests** | free | Reaching a 7, 30, 100 or 365-day streak gives 1, 2, 3 or 5 chests (`source: streak`). Paid once per streak: a streak that breaks and is rebuilt earns them again. |
| **Streak repair** | 200 | Offered when a streak of at least 3 days broke 1–2 days ago and freezes did not cover the gap. Marks the missed days as frozen, so the streak comes back. Gone after the window. |
| **Streak wager** | 50 | Keep your streak for 7 days, starting today, and win 100 coins. Freezes count as kept days. One wager at a time; a missed day loses the stake. |

- Milestones (`streak_chests`) and the repair and wager terms (`streak_tools`) live in
  `economy.yaml`. The prices are in `shop.yaml`.
- Wagers are a new table (`wagers`, migration 0004). They are settled lazily whenever `/api/me`
  is computed, after freezes are applied; the payout is a coin event (`ref = wager:<id>`).
- Repair writes `freeze_used` on the missed days of the daily log: the streak code already counts
  those days.

### 10.2 More shop slots

| Slot | Default (free) | For sale |
|---|---|---|
| Sound packs | Classic | + **Kalimba** (300), **Typewriter** (300), **Soft clicks** (200), **Synth** (350) |
| Correct-answer effects | None | + **Pixels** (250), **Stars** (250) |
| **Lesson-complete celebrations** (new) | None | **Fireworks** (350), **Confetti rain** (300), **Trophy** (250) |
| **Combo meters** (new) | Classic chip | **Flame** (200): the flame grows with the multiplier; **Blocks** (200): one block per answer in the run up to ×2; **Meter** (150): fills towards the next multiplier |
| **Progress bars** (new) | Classic | **Segments** (150): one per item; **Dots** (150); **Runner** (200): a runner rides the end of the bar |

- Celebrations play on the summary of a finished lesson or review (not on a failed one). Combo
  meters and progress bars restyle the player head.
- Under reduced motion: a celebration is a static flash, and combo and progress styles change
  their shape but never animate.
- Rendering lives in `web/js/player/effects.js` (effects, celebrations) and
  `web/js/player/skins.js` (combo meters, progress bars). The shop previews every item on a
  sample.

### 10.3 Done when

- The unit tests cover:
  - milestone chests (paid once per streak, paid again after a rebuild);
  - repair (offered only inside the window and only for a long enough streak; the streak
    actually comes back);
  - the wager (won after 7 kept days, lost on a missed day, one at a time, freezes count);
  - the new slots in the catalog, each with its assets (sound files, effect, celebration and
    skin names).
- The browser tests cover buying a combo meter and a progress bar and seeing them in the
  player, a celebration on the summary, and the streak tools in the shop.
- The same 5 pre-existing failures and no new ones.

---

## Decision log

- 2026-10-13: Plan written from the brainstorm. Names: **Chests** and **Coins**. Chests come
  from 3 daily quests (reset at local midnight) and from a chance after each new lesson, timed for
  session momentum. Freezes are sold in the shop with a cap of 2. Sound packs and correct-answer
  effects ship first. No companion character. The boost length was not specified; it is 15
  minutes (a timer suits the "stay on" goal better than "next lesson"). The quest-count chip in
  the topbar, part of the brainstorm, is left out: the topbar is already full on phones, so the
  quests live on home and the summary instead.
- 2026-10-13 (built):
  - **Graded attempts only.** Quest runs and review counts only use graded attempts. The attempts
    table has no graded flag, so the quest metrics join on `item_state`: a graded attempt always
    creates the item's row, and an explanation never does.
  - **Review coins.** Review sessions pay coins for the first 5 a day (`review_daily_cap`), so
    short reviews cannot be farmed.
  - **Phone topbar.** The boost has its own icon (`speed`, since `bolt` is XP and the combo). On
    phones the topbar title is hidden and the boost chip shows only its time, so XP, streak,
    coins and a running boost fit in 390 px.
  - **Classic sounds.** The Classic sounds moved to `web/assets/sounds/classic/`; regenerating
    them gives byte-identical files.
  - **Encoding.** `web/css/app.css` contains one stray Windows-1252 byte in a comment (it was
    already there), so it is edited byte-preserving; the additions are ASCII.
  - **Shared helper.** `lib/view.js`'s `section()` now skips null children (home's optional
    chest list printed "null").
- 2026-10-13 (round two built):
  - **Repair order.** Freezes are applied before repair is offered: `/api/shop` and the buy
    endpoint compute `/api/me` first. So repair only covers what freezes could not, and buying
    it never wastes a freeze.
  - **Wager days.** The wager counts its start day, so a bet placed after meeting today's goal
    already has day 1 kept. A missed day is only judged once it is over: today stays open until
    midnight.
  - **Wager notices.** A settled wager is reported once, as `wager_result` on the `/api/me` that
    settled it. The lesson summary shows it as a chip; `me.wager` carries the running one
    (profile and shop).
  - **Milestones.** Milestone chests need the chests setting on, like quest and lesson chests.
    They are granted when the day's goal is met, so the streak includes today.
  - **Rendering.** Combo meters and progress bars are drawn by `skins.js`. The player no longer
    builds the bar's or the chip's children itself, and the shop previews call the same paint
    functions on samples.
  - **New sounds.** The new packs are synthesised like the old ones; the typewriter's noise is
    seeded, so regenerating gives the same files. The existing packs are unchanged.
