(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  const form = document.querySelector('#lead-form');
  const result = document.querySelector('#form-result');
  const moreButton = document.querySelector('.more-fields');
  const extraFields = document.querySelector('#extra-fields');
  const endpoint = window.GESTIA_CONFIG?.leadEndpoint?.trim() || '';
  if (endpoint) {
    form.querySelector('.submit-button').firstChild.textContent = 'Отправить заявку ';
    document.querySelector('#form-hint').textContent = 'После отправки мы передадим заявку компании для ответа. Срок ответа зависит от работы сервиса.';
  }

  document.querySelector('#year').textContent = new Date().getFullYear();
  const today = new Date();
  const localDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  document.querySelector('#preferred-date').min = localDate;

  menuButton.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!expanded));
    menuButton.setAttribute('aria-label', expanded ? 'Открыть меню' : 'Закрыть меню');
    nav.classList.toggle('open', !expanded);
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Открыть меню');
  }));

  document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
    document.querySelector('#service-select').value = link.dataset.service;
  }));

  moreButton.addEventListener('click', () => {
    const expanded = moreButton.getAttribute('aria-expanded') === 'true';
    moreButton.setAttribute('aria-expanded', String(!expanded));
    moreButton.lastElementChild.textContent = expanded ? '+' : '−';
    extraFields.hidden = expanded;
  });

  const showResult = (content, isError = false) => {
    result.hidden = false;
    result.classList.toggle('error', isError);
    result.replaceChildren(...content);
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    if (data.get('website')) return;
    const phone = String(data.get('phone') || '').trim();
    if (phone.replace(/\D/g, '').length < 10) {
      showResult([node('strong', 'Проверьте номер телефона'), node('p', 'Укажите не менее 10 цифр, чтобы мы могли связаться с вами.')], true);
      return;
    }
    const lead = {
      name: String(data.get('name') || '').trim(),
      phone,
      service: String(data.get('service') || ''),
      area: String(data.get('area') || '').trim(),
      date: String(data.get('date') || ''),
      location: String(data.get('location') || '').trim(),
      comment: String(data.get('comment') || '').trim(),
      contactMethod: String(data.get('contactMethod') || 'phone'),
      email: String(data.get('email') || '').trim(),
      consent: true,
      website: ''
    };
    if (lead.contactMethod === 'email' && !lead.email) {
      extraFields.hidden = false;
      moreButton.setAttribute('aria-expanded', 'true');
      showResult([node('strong', 'Добавьте адрес почты'), node('p', 'Вы выбрали ответ по электронной почте.')], true);
      form.elements.email.focus();
      return;
    }

    if (endpoint) {
      const button = form.querySelector('.submit-button');
      button.disabled = true;
      button.firstChild.textContent = 'Отправляем заявку ';
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        showResult([node('strong', 'Заявка отправлена'), node('p', 'Спасибо! Мы получили ваши данные и свяжемся с вами после обработки заявки.')]);
        form.reset();
      } catch {
        showResult([node('strong', 'Не удалось отправить заявку'), node('p', 'Попробуйте ещё раз позже или свяжитесь с нами по телефону.')], true);
      } finally {
        button.disabled = false;
        button.firstChild.textContent = 'Отправить заявку ';
      }
      return;
    }

    const lines = [
      'Заявка на уборку — Гестия',
      `Имя: ${lead.name}`,
      `Телефон: ${lead.phone}`,
      `Услуга: ${lead.service}`,
      lead.area && `Площадь: ${lead.area} м²`,
      lead.date && `Дата: ${lead.date}`,
      lead.location && `Район/адрес: ${lead.location}`,
      lead.comment && `Комментарий: ${lead.comment}`,
      `Способ связи: ${{ phone: 'телефон', telegram: 'Telegram', email: 'почта' }[lead.contactMethod]}`,
      lead.email && `Email: ${lead.email}`
    ].filter(Boolean);
    const text = lines.join('\n');
    const copy = node('button', 'Скопировать заявку', 'copy-button');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Скопировано ✓'; }
      catch { copy.textContent = 'Выделите и скопируйте текст выше'; }
    });
    showResult([node('strong', 'Заявка подготовлена'), node('p', 'Сейчас сайт работает в демо-режиме: данные не отправлены. Скопируйте текст для связи с компанией.'), node('pre', text), copy]);
  });
})();
