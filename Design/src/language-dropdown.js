let listeners;
export function enhanceLanguageSwitcher() {
  listeners?.abort();
  listeners = new AbortController();
  const select = document.querySelector('#language');
  if (!select) return;
  const wrapper = select.closest('.language-switcher');
  select.hidden = true;
  const globe = wrapper.querySelector('svg');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'crafted-trigger language-trigger';
  trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'language-choices');
  trigger.append(globe);
  const label = document.createElement('span');
  label.textContent = select.value.toUpperCase();
  trigger.append(label);
  trigger.insertAdjacentHTML('beforeend', '<svg class="language-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
  const menu = document.createElement('div');
  menu.id = 'language-choices';
  menu.className = 'crafted-menu language-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label'));
  wrapper.append(trigger, menu);
  const close = () => { if (menu.matches(':popover-open')) menu.hidePopover(); };
  function position() {
    if (!menu.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect();
    menu.style.width = rect.width + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 6 + 'px';
  }
  for (const option of select.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'option';
    button.tabIndex = -1;
    button.textContent = option.textContent;
    button.setAttribute('aria-selected', String(option.selected));
    button.setAttribute('aria-label', option.value === 'bg' ? 'Български' : 'English');
    button.onclick = () => {
      close();
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('.language-trigger')?.focus({ preventScroll: true });
    };
    menu.append(button);
  }
  trigger.onclick = () => {
    if (menu.matches(':popover-open')) return close();
    menu.showPopover();
    position();
    menu.querySelector('[aria-selected="true"]').focus({ preventScroll: true });
  };
  menu.addEventListener('toggle', () => {
    const open = menu.matches(':popover-open');
    trigger.setAttribute('aria-expanded', String(open));
    wrapper.classList.toggle('is-open', open);
  });
  wrapper.onkeydown = event => {
    const buttons = [...menu.children];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!menu.matches(':popover-open')) return trigger.click();
      const current = buttons.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault(); close(); trigger.focus();
    } else if (event.key === 'Tab') {
      close(); trigger.focus();
    }
  };
  window.addEventListener('resize', position, { signal: listeners.signal });
  document.addEventListener('scroll', close, { capture: true, signal: listeners.signal });
}

export function cleanupLanguageSwitcher() { listeners?.abort(); }
