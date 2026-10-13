/* The shop (shop_plan.md §6): your chests, streak freezes, sound packs and
   correct-answer effects, bought with coins. Every item can be previewed
   before buying; buying equips it. The last section prints how coins are
   earned and the chest odds, which are public. */

import { get, post, put } from '../api.js';
import { store } from '../store.js';
import { el, icon } from '../lib/dom.js';
import { hero, body, section, page, emptyState } from '../lib/view.js';
import { chestList } from '../lib/economy.js';
import { preview as previewSounds } from '../player/sounds.js';
import { celebrate } from '../player/effects.js';

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
    get('/api/shop').catch(() => null),
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
      const res = await post(`/api/shop/${item.key}/buy`, {});
      if (res.me) store.set('me', res.me);
      window.UI.toast(item.slot ? `Bought ${item.title}. It's on now.` : `Bought a ${item.title.toLowerCase()}.`);
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
  const freeze = items.find((i) => i.kind === 'freeze');
  const sounds = items.filter((i) => i.kind === 'sound_pack');
  const effects = items.filter((i) => i.kind === 'effect');

  const freezeCard = freeze ? el('div', { class: 'card shop-item', 'data-item': freeze.key },
    el('div', { class: 'card-header' },
      el('span', { class: 'avatar' }, icon(freeze.icon)),
      el('div', { class: 'card-header-text' },
        el('h3', { class: 'card-title' }, freeze.title),
        el('p', { class: 'card-subtitle' }, `You hold ${shop.freezes} of ${shop.freeze_cap}`))),
    el('div', { class: 'card-body' }, freeze.description),
    el('div', { class: 'card-actions card-actions-end' }, action(freeze))) : null;

  const soundCards = sounds.map((s) => itemCard(s, { onPreview: () => previewSounds({ asset: s.asset, steps: s.steps }) }));

  const effectCards = effects.map((e) => {
    const answer = el('span', { class: 'fx-sample' }, icon('check_circle', 'icon-sm'), 'Correct!');
    const stage = el('div', { class: 'fx-stage', 'aria-hidden': 'true' }, answer);
    return itemCard(e, {
      stage,
      onPreview: e.asset === 'none' ? null : () => celebrate(e.asset, answer, { host: stage }),
    });
  });

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
      el('li', {}, 'Coins can only be earned. There is nothing to buy with money.'))) : null;

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
      freezeCard ? section('Streak freeze', el('div', { class: 'grid-auto', style: '--min: 260px' }, freezeCard)) : null,
      section('Sound packs', el('p', { class: 'text-muted mb-3' }, 'The sounds for a right answer, a wrong one and a finished lesson.'),
        el('div', { class: 'grid-auto', style: '--min: 240px' }, ...soundCards)),
      section('Correct-answer effects', el('p', { class: 'text-muted mb-3' }, 'Plays on every right answer. With reduced motion turned on, it\'s a short flash instead.'),
        el('div', { class: 'grid-auto', style: '--min: 240px' }, ...effectCards)),
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
