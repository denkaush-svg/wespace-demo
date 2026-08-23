// Unified audience calculation module
// Calculates who can be contacted based on consent rules
(function (WS) {
  const EXCLUSION_REASONS = [
    'нет согласия',
    'согласие унаследовано, источник его не имеет',
    'нет канала связи'
  ];

  function getEffectiveConsent(recipient, options, allClients) {
    // Recipient has direct consent field: use it immediately
    if (recipient.consent !== undefined) {
      return recipient.consent;
    }

    // Recipient has own clientId: look up consent in allClients
    if (recipient.clientId) {
      const client = allClients.find(c => c.id === recipient.clientId);
      return client ? client.consent : undefined;
    }

    // Recipient is participant without own clientId: inherit from deal client
    if (options && options.dealClients && options.dealClients.length > 0) {
      const dealClient = options.dealClients[0];
      return dealClient.consent;
    }

    return undefined;
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
      const consent = getEffectiveConsent(recipient, options, allClients);

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
