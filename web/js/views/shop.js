/* The shop (shop_plan.md §6, §10): your chests, the streak tools (freeze,
   repair, wager), and the styles: sound packs, correct-answer effects,
   lesson-complete celebrations, combo meters and progress bars. Every style
   can be previewed before buying; buying equips it. The last section prints
   how coins are earned, the chest odds and the terms, which are public. */

import { get, post, put } from '../api.js';
import { store } from '../store.js';
import { el, icon } from '../lib/dom.js';
import { hero, body, section, page, emptyState } from '../lib/view.js';
import { chestList } from '../lib/economy.js';
import { preview as previewSounds } from '../player/sounds.js';
import { celebrate, celebrateFinish } from '../player/effects.js';
import { paintCombo, paintProgress } from '../player/skins.js';
import { multiplierFor } from '../player/engine.js';

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

function coinsLabel(n) {
  return el('span', { class: 'row row-tight' }, icon('toll', 'icon-sm'), String(n));
}

export default async function view({ setTitle }) {
  setTitle('Shop');
  const root = el('div', { class: 'view' });
  await render(root, { opened: [] });
  return root;
}

/* `visit.opened` keeps the chests opened on this visit, so a re-render (to show
   the new balance) still shows what came out of them. */
async function render(root, visit) {
  const [shop, chests] = await Promise.all([
    get(`/api/shop?tz=${encodeURIComponent(store.get('settings').timezone)}`).catch(() => null),
    get('/api/chests', { silent: true }).catch(() => ({ unopened: [], odds: null })),
  ]);
  if (!shop) {
    root.replaceChildren(hero({ eyebrow: 'Coins', title: 'Shop' }), body(emptyState('cloud_off', 'Shop unavailable', 'The server could not be reached.')));
    return;
  }
  const refresh = async () => {
    const y = window.scrollY;
    await render(root, visit);
    window.UI.init(root);
    window.scrollTo({ top: y, behavior: 'instant' });
  };

  async function buy(item) {
    try {
      const res = await post(`/api/shop/${item.key}/buy?tz=${encodeURIComponent(store.get('settings').timezone)}`, {});
      if (res.me) store.set('me', res.me);
      const said = {
        repair: () => `Streak repaired: ${res.me ? res.me.streak : ''} days and counting.`,
        wager: () => `Wager on. Keep your streak for ${item.terms ? item.terms.days : 7} days.`,
        freeze: () => 'Bought a streak freeze.',
      }[item.kind];
      window.UI.toast(said ? said() : `Bought ${item.title}. It's on now.`);
      await refresh();
    } catch { /* the api layer already showed why */ }
  }
  async function equip(item) {
    try {
      const res = await put('/api/shop/equip', { key: item.key });
      store.update('me', (me) => (me ? { ...me, equipped: res.equipped } : me));
      await refresh();
    } catch { /* toast shown */ }
  }

  function action(item) {
    if (item.slot && item.equipped) {
      return el('span', { class: 'chip chip-primary', 'data-state': 'equipped' }, icon('check', 'icon-sm'), 'In use');
    }
    if (item.slot && item.owned) {
      const b = el('button', { type: 'button', class: 'button button-tonal button-sm', 'data-action': 'equip' }, 'Use');
      b.addEventListener('click', () => equip(item));
      return b;
    }
    const short = shop.coins < item.price;
    const b = el('button', {
      type: 'button',
      class: 'button button-filled button-sm',
      'data-action': 'buy',
      disabled: item.can_buy ? null : true,
      'aria-label': `Buy ${item.title} for ${item.price} coins`,
      title: short ? `You need ${item.price - shop.coins} more coins` : null,
    }, icon('toll', 'icon-sm'), `Buy · ${item.price}`);
    b.addEventListener('click', () => buy(item));
    return b;
  }

  function itemCard(item, { stage = null, onPreview = null } = {}) {
    const prev = onPreview ? el('button', { type: 'button', class: 'button button-text button-sm', 'data-action': 'preview' }, icon('play_arrow'), 'Preview') : null;
    if (prev) prev.addEventListener('click', onPreview);
    return el('div', { class: `card shop-item ${item.equipped ? 'is-equipped' : ''}`, 'data-item': item.key },
      el('div', { class: 'card-header' },
        el('span', { class: 'avatar' }, icon(item.icon)),
        el('div', { class: 'card-header-text' },
          el('h3', { class: 'card-title' }, item.title),
          el('p', { class: 'card-subtitle' }, item.default ? 'Free' : `${item.price} coins`))),
      stage,
      el('div', { class: 'card-body' }, item.description),
      el('div', { class: 'card-actions card-actions-split' }, prev || el('span'), action(item)));
  }

  const items = shop.items;
  const ofKind = (kind) => items.filter((i) => i.kind === kind);

  /* Streak tools: a freeze (stacks to the cap), a repair (only when a streak just broke) and a
     wager (one at a time). Each card says where you stand. */
  function toolCard(item, subtitle, status = null) {
    return el('div', { class: 'card shop-item', 'data-item': item.key },
      el('div', { class: 'card-header' },
        el('span', { class: 'avatar' }, icon(item.icon)),
        el('div', { class: 'card-header-text' },
          el('h3', { class: 'card-title' }, item.title),
          el('p', { class: 'card-subtitle' }, subtitle))),
      el('div', { class: 'card-body' }, item.description, status ? el('p', { class: 'tool-status' }, status) : null),
      el('div', { class: 'card-actions card-actions-end' }, action(item)));
  }
  const tools = [];
  for (const item of ofKind('freeze')) tools.push(toolCard(item, `You hold ${shop.freezes} of ${shop.freeze_cap}`));
  for (const item of ofKind('repair')) {
    const r = item.repair;
    tools.push(toolCard(item, r ? `Your ${r.lost}-day streak can come back` : 'Nothing to repair right now',
      r ? `Covers ${r.missed.length === 1 ? 'the missed day' : `the ${r.missed.length} missed days`}; your streak becomes ${r.restores} days.` : null));
  }
  for (const item of ofKind('wager')) {
    const w = item.wager;
    tools.push(toolCard(item, w ? `Day ${Math.min(w.kept + 1, w.days)} of ${w.days}` : `Win ${item.terms.payout} coins`,
      w ? `${w.kept} of ${w.days} days kept. Keep going until ${w.end_date} to win ${w.payout} coins.` : `Starts today. Freezes count as kept days.`));
  }

  /* Previews: each style is shown on a sample of what it changes. */
  const stageOf = (...children) => el('div', { class: 'fx-stage', 'aria-hidden': 'true' }, ...children);

  const soundCards = ofKind('sound_pack').map((s) => itemCard(s, { onPreview: () => previewSounds({ asset: s.asset, steps: s.steps }) }));

  const effectCards = ofKind('effect').map((e) => {
    const answer = el('span', { class: 'fx-sample' }, icon('check_circle', 'icon-sm'), 'Correct!');
    const stage = stageOf(answer);
    return itemCard(e, { stage, onPreview: e.asset === 'none' ? null : () => celebrate(e.asset, answer, { host: stage }) });
  });

  const celebrationCards = ofKind('celebration').map((c) => {
    const sample = el('span', { class: 'fx-sample' }, icon('emoji_events', 'icon-sm'), 'Lesson complete');
    const stage = stageOf(sample);
    return itemCard(c, { stage, onPreview: c.asset === 'none' ? null : () => celebrateFinish(c.asset, sample, { host: stage }) });
  });

  /* A combo meter or progress bar preview steps through a short run. */
  function stepper(paint, steps) {
    let timer = null;
    return () => {
      if (timer) return;
      let i = 0;
      paint(0);
      timer = setInterval(() => {
        i += 1;
        paint(i);
        if (i >= steps) { clearInterval(timer); timer = null; }
      }, 380);
    };
  }

  const comboCards = ofKind('combo').map((c) => {
    const chip = el('span', { class: 'chip player-combo skin-sample-chip' });
    const paint = (streak) => paintCombo(chip, c.asset, { streak, multiplier: multiplierFor(streak) });
    paint(4);
    return itemCard(c, { stage: stageOf(chip), onPreview: stepper(paint, 7) });
  });

  const progressCards = ofKind('progress').map((pr) => {
    const bar = el('div', { class: 'progress-linear progress-linear-lg player-progress skin-sample' });
    const paint = (done) => paintProgress(bar, pr.asset, { done, total: 6 });
    paint(3);
    return itemCard(pr, { stage: stageOf(bar), onPreview: stepper(paint, 6) });
  });

  const slotSection = (title, lede, cards) => (cards.length
    ? section(title, el('p', { class: 'text-muted mb-3' }, lede), el('div', { class: 'grid-auto', style: '--min: 240px' }, ...cards))
    : null);

  const odds = chests.odds;
  const howItWorks = odds ? section('How coins and chests work',
    el('div', { class: 'grid' },
      el('div', { class: 'col-6' },
        el('h3', { class: 'text-heading-3 mb-2' }, 'Earning coins'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table table-dense' },
          el('tbody', {},
            earnRow('First time through a lesson', odds.earn.lesson),
            earnRow('…every answer right first time', `+${odds.earn.perfect_bonus}`),
            earnRow('A review session', odds.earn.review),
            earnRow('Meeting your daily goal', odds.earn.daily_goal),
            odds.earn.league.length && window.app.auth.mode === 'multi' ? earnRow('Weekly league, top three', odds.earn.league.join(' / ')) : null,
            earnRow('A chest', `${Math.min(...odds.coins)}–${Math.max(...odds.coins)}`))))),
      el('div', { class: 'col-6' },
        el('h3', { class: 'text-heading-3 mb-2' }, 'What a chest holds'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table table-dense' },
          el('tbody', {}, ...odds.contents.map((c) => el('tr', {},
            el('td', {}, el('span', { class: 'row row-tight' }, icon(c.icon, 'icon-sm'), contentLabel(c, odds))),
            el('td', { class: 'table-numeric' }, pct(c.chance))))))))),
    el('h3', { class: 'text-heading-3 mt-5 mb-2' }, 'Where chests come from'),
    el('ul', { class: 'shop-rules' },
      el('li', {}, 'Each of the three daily quests gives a chest. New quests arrive at midnight.'),
      el('li', {}, `The first time through a lesson there is a chance of a chest: ${pct(odds.lesson.base)} to start, +${pct(odds.lesson.per_session_lesson)} for each lesson or review already done in this sitting (up to +${pct(odds.lesson.session_max)}), +${pct(odds.lesson.perfect)} for a perfect lesson, and +${pct(odds.lesson.per_dry_lesson)} for each lesson since your last chest.`),
      el('li', {}, `After ${odds.lesson.guarantee_after} lessons in a row without one, the next lesson always gives a chest. So does your very first lesson.`),
      el('li', {}, `At most ${odds.lesson.daily_cap} lesson chests a day. Quest chests don't count toward this.`),
      Object.keys(odds.streak_chests || {}).length
        ? el('li', {}, `Streak milestones give chests: ${Object.entries(odds.streak_chests).map(([d, n]) => `${d} days → ${n}`).join(', ')}. Once per streak.`)
        : null,
      el('li', {}, 'Coins can only be earned. There is nothing to buy with money.')),
    el('h3', { class: 'text-heading-3 mt-5 mb-2' }, 'Streak tools'),
    el('ul', { class: 'shop-rules' },
      el('li', {}, `A repair is offered when a streak of at least ${odds.tools.repair_min_streak} days broke in the last ${odds.tools.repair_max_gap} days and your freezes could not cover it.`),
      el('li', {}, `A wager lasts ${odds.tools.wager_days} days from the day you place it and pays ${odds.tools.wager_payout} coins. A day without your goal (and without a freeze) loses it. One wager at a time.`))) : null;

  root.replaceChildren(
    hero({
      eyebrow: 'Coins',
      title: 'Shop',
      lede: `You have ${shop.coins} ${shop.coins === 1 ? 'coin' : 'coins'}. Earn more with lessons, reviews, quests and chests.`,
    }),
    body(
      chests.unopened.length || visit.opened.length
        ? section('Your chests', chestList([...visit.opened, ...chests.unopened], {
          onOpened(res) { visit.opened.push(res.chest); setTimeout(refresh, 1200); },
        }))
        : null,
      tools.length ? section('Streak tools', el('div', { class: 'grid-auto', style: '--min: 240px' }, ...tools)) : null,
      slotSection('Sound packs', 'The sounds for a right answer, a wrong one and a finished lesson.', soundCards),
      slotSection('Correct-answer effects', 'Plays on every right answer. With reduced motion turned on, it\'s a short flash instead.', effectCards),
      slotSection('Lesson-complete celebrations', 'Plays on the summary when you finish a lesson or a review.', celebrationCards),
      slotSection('Combo meters', 'How the player shows your run of right answers and the XP multiplier.', comboCards),
      slotSection('Progress bars', 'How the player shows how far through the lesson you are.', progressCards),
      howItWorks));
}

function earnRow(label, value) {
  return el('tr', {}, el('td', {}, label), el('td', { class: 'table-numeric' }, coinsLabel(value)));
}

function contentLabel(c, odds) {
  if (c.kind === 'xp_boost') return `${odds.boost_minutes} minutes of double XP`;
  if (c.kind === 'freeze') return `Streak freeze (coins if you already hold ${odds.freeze_cap})`;
  return `${Math.min(...odds.coins)}–${Math.max(...odds.coins)} coins`;
}
