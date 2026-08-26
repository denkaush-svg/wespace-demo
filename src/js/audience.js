// Unified audience calculation module
// Calculates who can be contacted based on consent rules
(function (WS) {
  /* Полный перечень причин, по которым адресат не попадает в выборку. Он не декоративный:
     по нему строятся подписи и на нём держится обещание, что «исключён» всегда объяснимо.
     Причина, которую модуль выдаёт, но здесь не перечисляет, — это причина без подписи. */
  const EXCLUSION_REASONS = [
    'нет согласия',
    'согласие унаследовано, источник его не имеет',
    'согласие принадлежит другому лицу',
    'роль участника не опознана',
    'нет канала связи'
  ];

  /* Наследовать согласие клиента сделки может только сторона клиента — и только по роли,
     которую справочник знает. Проверка «группа не client» этого не давала: `roleGroupOf`
     на незнакомой роли возвращает `client` по умолчанию, и «Менеджер застройщика»
     (опечатка вместо «Менеджер девелопера») получал согласие покупателя. Правило должно
     разрешать по совпадению, а не запрещать по несовпадению. */
  function clientSideRole(recipient) {
    const ui = (typeof WS !== 'undefined' && WS.ui) || null;
    if (!ui || !ui.roleOf || !ui.CONTACT_ROLES || !ui.roleGroupOf) return 'unknown';
    const role = ui.roleOf(recipient);
    if (ui.CONTACT_ROLES.indexOf(role) < 0) return 'unknown';
    return ui.roleGroupOf(recipient) === 'client' ? 'client' : 'other';
  }

  function getEffectiveConsent(recipient, options, allClients) {
    // Recipient has direct consent field: use it immediately
    if (recipient.consent !== undefined) {
      return { consent: recipient.consent };
    }

    // Recipient has own clientId: look up consent in allClients
    if (recipient.clientId) {
      const client = allClients.find(c => c.id === recipient.clientId);
      return { consent: client ? client.consent : undefined };
    }

    // Recipient is participant without own clientId: inherit from deal client
    if (options && options.dealClients && options.dealClients.length > 0) {
      const side = clientSideRole(recipient);
      /* Две разные причины, потому что разные и действия по ним. Со-брокеру согласие берут
         у него самого; опечатку в роли — исправляют в карточке. Одна общая формулировка
         послала бы агента не туда, а «нет согласия» сказало бы, что человек отказался. */
      if (side === 'other') return { consent: undefined, reason: 'согласие принадлежит другому лицу' };
      if (side === 'unknown') return { consent: undefined, reason: 'роль участника не опознана' };
      const dealClient = options.dealClients[0];
      return { consent: dealClient.consent };
    }

    return { consent: undefined };
  }

  function calculateAudience(recipients, options) {
    // Handle the case where recipients is empty or not provided
    if (!recipients || !Array.isArray(recipients)) {
      recipients = [];
    }

    // Get all clients from WS.store.data
    const allClients = (typeof WS !== 'undefined' && WS.store && WS.store.data && WS.store.data.clients)
      ? WS.store.data.clients
      : [];

    const suitable = [];
    const excluded = [];

    recipients.forEach(recipient => {
      const result = getEffectiveConsent(recipient, options, allClients);
      const consent = result.consent;
      const inheritedReason = result.reason;

      // Check for channel before consent: if there is no channel to contact, exclude immediately
      if (!recipient.channel && consent !== false) {
        excluded.push({
          id: recipient.id,
          consent: consent,
          reason: 'нет канала связи'
        });
        return;
      }

      if (consent === true) {
        suitable.push({
          id: recipient.id,
          consent: true
        });
      } else if (consent === false) {
        excluded.push({
          id: recipient.id,
          consent: false,
          reason: 'нет согласия'
        });
      } else if (inheritedReason) {
        // Explicit reason from getEffectiveConsent (e.g., from non-client role group)
        excluded.push({
          id: recipient.id,
          consent: undefined,
          reason: inheritedReason
        });
      } else if (consent === undefined && options && options.dealClients) {
        // Inherited consent is undefined: means deal client had no consent field
        excluded.push({
          id: recipient.id,
          consent: undefined,
          reason: 'согласие унаследовано, источник его не имеет'
        });
      } else {
        // No consent information available
        excluded.push({
          id: recipient.id,
          consent: undefined,
          reason: 'нет согласия'
        });
      }
    });

    return {
      suitable: suitable,
      excluded: excluded,
      stats: {
        total: recipients.length,
        excluded: excluded.length
      }
    };
  }

  function getExclusionReasons() {
    return EXCLUSION_REASONS;
  }

  return WS.audience = {
    calculateAudience: calculateAudience,
    getExclusionReasons: getExclusionReasons
  };
})(window.WS = window.WS || {});
