/* explanation — a block of markdown. Ungraded. */

export default {
  type: 'explanation',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw } = lib;
    root.append(html`
      <article class="el-explanation">
        ${item.title_html ? html`<h2 class="text-heading-2 mb-3">${raw(item.title_html)}</h2>` : ''}
        <div class="prose el-prompt">${raw(item.body_html || '')}</div>
      </article>`);
    ctx.onChange(true);
    return {
      getAnswer: () => ({ read: true }),
      check: () => ({ correct: true }),
      showResult() {},
      focus() { root.closest('[tabindex]')?.focus(); },
      destroy() {},
    };
  },
};
