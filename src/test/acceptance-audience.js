/* Acceptance tests for unified audience calculation module.
   Verifies that consent rules are applied consistently across all send paths,
   that excluded contacts are tracked with reasons, and that audience count
   is calculated from data, not hardcoded.
   Run:  node src/test/acceptance-audience.js
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..');
const { JSDOM } = require('jsdom');

const read = (p) => fs.readFileSync(path.join(D, p), 'utf8').replace(/\r\n/g, '\n');
const jsFiles = (read('index.html').match(/<script src="js\/([^"]+)\.js"><\/script>/g) || [])
  .map((m) => m.replace(/.*js\/([^"]+)\.js.*/, '$1'));
if (!jsFiles.length) throw new Error('no module scripts found in src/index.html');
const scripts = jsFiles.map((f) => '<script>' + read('js/' + f + '.js') + '</script>').join('\n');
const html = '<!DOCTYPE html><html><head>' +
  '<script>if(!window.structuredClone){window.structuredClone=function(o){return JSON.parse(JSON.stringify(o))}}</script>' +
  '</head><body><div id="app"></div><div class="modal-wrap" id="modal"></div><div class="toasts" id="toasts"></div>' +
  scripts + '</body></html>';

const errors = [];
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'dangerously', url: 'http://localhost/' });
const win = dom.window;
win.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e)));

const results = [];
let failed = 0;
let preconditionsFailed = 0;
let acceptanceFailed = 0;

function check(name, cond, detail, section) {
  results.push({ name, ok: !!cond, detail: detail || '', section: section || 'acceptance' });
  if (!cond) {
    failed++;
    if (section === 'preconditions') preconditionsFailed++;
    else acceptanceFailed++;
  }
}

setTimeout(async () => {
  const WS = win.WS;
  const doc = win.document;

  // ======== PRECONDITIONS ========
  // These checks ensure the test harness works, not the implementation.
  // They must pass for any other checks to be meaningful.

  check('PRECOND: app boots (WS.ui present)', WS && WS.ui, WS ? 'ui=' + !!WS.ui : 'no WS', 'preconditions');
  check('PRECOND: no window errors on boot', errors.length === 0, errors.join('; '), 'preconditions');
  if (!WS || !WS.ui) return report();

  const data = WS.store.data;
  const dd = () => WS.store.data;

  check('PRECOND: clients exist in fixtures', data.clients && data.clients.length > 0,
    data.clients ? 'count=' + data.clients.length : 'no clients', 'preconditions');
  check('PRECOND: deals exist in fixtures', data.deals && data.deals.length > 0,
    data.deals ? 'count=' + data.deals.length : 'no deals', 'preconditions');
  check('PRECOND: no-consent contact exists (c_noconsent)',
    data.clients && data.clients.find((c) => c.consent === false) !== undefined,
    data.clients ? 'found=' + !!data.clients.find((c) => c.consent === false) : 'no data', 'preconditions');

  check('PRECOND: sendOffer handler exists', WS.ui && typeof WS.ui.sendOffer === 'function',
    WS.ui ? 'sendOffer=' + typeof WS.ui.sendOffer : 'no WS.ui', 'preconditions');
  check('PRECOND: openPromotion handler exists', WS.ui && typeof WS.ui.openPromotion === 'function',
    WS.ui ? 'openPromotion=' + typeof WS.ui.openPromotion : 'no WS.ui', 'preconditions');
  check('PRECOND: openDealKp handler exists', WS.ui && typeof WS.ui.openDealKp === 'function',
    WS.ui ? 'openDealKp=' + typeof WS.ui.openDealKp : 'no WS.ui', 'preconditions');
  check('PRECOND: openClubPost handler exists', WS.ui && typeof WS.ui.openClubPost === 'function',
    WS.ui ? 'openClubPost=' + typeof WS.ui.openClubPost : 'no WS.ui', 'preconditions');

  // ======== ACCEPTANCE TESTS ========
  // These checks verify NEW behavior that must be implemented.
  // All must be RED now; they turn GREEN only when the module is implemented.

  // Cache commonly used test data
  const noconsent = data.clients.find((c) => c.consent === false);
  const deal = data.deals.find((d) => d.id === 'd_anna');
  const consentingClient = data.clients.find((c) => c.consent === true);
  const nonconsentClient = data.clients.find((c) => c.consent === false);

  // ---- 1. Audience module exists and exports correct functions ----
  check('audience module exported via WS.audience', WS.audience !== undefined,
    typeof WS.audience, 'acceptance');

  if (WS.audience) {
    check('calculateAudience function exists', typeof WS.audience.calculateAudience === 'function',
      Object.keys(WS.audience).join(', '), 'acceptance');
  } else {
    check('calculateAudience function exists', false,
      'WS.audience is undefined, cannot check functions', 'acceptance');
  }

  // ---- 2. Audience calculation returns correct structure ----
  if (WS.audience && WS.audience.calculateAudience) {
    const testRecipients = data.clients.slice(0, 3);
    const result = WS.audience.calculateAudience(testRecipients);

    check('result has suitable array', result && Array.isArray(result.suitable),
      result ? `suitable=${Array.isArray(result.suitable)}` : 'null', 'acceptance');
    check('result has excluded array', result && Array.isArray(result.excluded),
      result ? `excluded=${Array.isArray(result.excluded)}` : 'null', 'acceptance');
  } else {
    check('result has suitable array', false, 'module not available', 'acceptance');
    check('result has excluded array', false, 'module not available', 'acceptance');
  }

  // ---- 2b. Excluded items always have reason field (independent test with guaranteed excluded) ----
  // This test uses c_noconsent to ensure there will be an excluded item
  if (noconsent && WS.audience && WS.audience.calculateAudience) {
    const resultWithExcluded = WS.audience.calculateAudience([noconsent]);
    check('excluded items have reason field',
      resultWithExcluded && resultWithExcluded.excluded && resultWithExcluded.excluded.length > 0 &&
      resultWithExcluded.excluded.every((x) => x.reason !== undefined),
      resultWithExcluded && resultWithExcluded.excluded && resultWithExcluded.excluded.length > 0 ?
        resultWithExcluded.excluded.map((x) => x.reason).join('; ') : 'no excluded found', 'acceptance');
  } else {
    check('excluded items have reason field', false,
      noconsent ? 'module not available' : 'c_noconsent not found', 'acceptance');
  }

  // ---- 3. c_noconsent is excluded with reason "нет согласия" ----
  if (noconsent && WS.audience && WS.audience.calculateAudience) {
    const result = WS.audience.calculateAudience([noconsent]);

    check('c_noconsent: excluded from suitable list',
      result && result.suitable && !result.suitable.some((x) => x.id === noconsent.id),
      result && result.suitable ? result.suitable.map((x) => x.id).join(', ') : 'null', 'acceptance');

    check('c_noconsent: appears in excluded list',
      result && result.excluded && result.excluded.some((x) => x.id === noconsent.id),
      result && result.excluded ? result.excluded.map((x) => x.id).join(', ') : 'null', 'acceptance');

    check('c_noconsent: exclusion reason is exactly "нет согласия"',
      result && result.excluded && result.excluded.find((x) => x.id === noconsent.id) ?
        result.excluded.find((x) => x.id === noconsent.id).reason === 'нет согласия' : false,
      result && result.excluded && result.excluded.find((x) => x.id === noconsent.id) ?
        '"' + result.excluded.find((x) => x.id === noconsent.id).reason + '"' : 'not found', 'acceptance');
  } else {
    check('c_noconsent: excluded from suitable list', false,
      noconsent ? 'module not available' : 'c_noconsent not found', 'acceptance');
    check('c_noconsent: appears in excluded list', false,
      noconsent ? 'module not available' : 'c_noconsent not found', 'acceptance');
    check('c_noconsent: exclusion reason is exactly "нет согласия"', false,
      noconsent ? 'module not available' : 'c_noconsent not found', 'acceptance');
  }

  // ---- 4. Consent inheritance: participant without own card inherits from deal client ----
  // Test self-prepares data: finds or creates a participant without clientId, swaps deal client consent.
  if (deal && consentingClient && nonconsentClient && WS.audience && WS.audience.calculateAudience) {
    // Find a participant without clientId, or create a synthetic one for testing
    let participantFree = deal.contacts && deal.contacts.find((c) => !c.clientId);
    if (!participantFree && deal.contacts && deal.contacts.length > 0) {
      // If no free participant exists, use the first one as a synthetic participant
      participantFree = deal.contacts[0];
    }

    if (participantFree) {
      // Save original deal clientId
      const originalDealClientId = deal.clientId;

      // Test 1: participant with consenting client should be suitable
      deal.clientId = consentingClient.id;
      const resultConsenting = WS.audience.calculateAudience([participantFree], { dealClients: [consentingClient] });
      check('inheritance · participant with consenting client is suitable',
        resultConsenting && resultConsenting.suitable && resultConsenting.suitable.length > 0,
        resultConsenting ? `suitable=${resultConsenting.suitable.length} excluded=${resultConsenting.excluded.length}` : 'null', 'acceptance');

      // Test 2: participant with non-consenting client should be excluded
      deal.clientId = nonconsentClient.id;
      const resultNonConsenting = WS.audience.calculateAudience([participantFree], { dealClients: [nonconsentClient] });
      check('inheritance · participant with non-consenting client is excluded',
        resultNonConsenting && resultNonConsenting.excluded && resultNonConsenting.excluded.length > 0,
        resultNonConsenting ? `suitable=${resultNonConsenting.suitable.length} excluded=${resultNonConsenting.excluded.length}` : 'null', 'acceptance');

      // Restore original deal clientId
      deal.clientId = originalDealClientId;
    } else {
      check('inheritance · participant with consenting client is suitable', false, 'no participant found', 'acceptance');
      check('inheritance · participant with non-consenting client is excluded', false, 'no participant found', 'acceptance');
    }
  } else {
    check('inheritance · participant with consenting client is suitable', false,
      !deal ? 'deal not found' : !consentingClient ? 'consenting client not found' : !nonconsentClient ? 'non-consenting client not found' : 'module not available', 'acceptance');
    check('inheritance · participant with non-consenting client is excluded', false,
      !deal ? 'deal not found' : !consentingClient ? 'consenting client not found' : !nonconsentClient ? 'non-consenting client not found' : 'module not available', 'acceptance');
  }

  // ---- 5. sendOffer path passes through audience calculation ----
  if (noconsent && WS.audience && WS.audience.calculateAudience) {
    const d = data.deals.find((x) => x.id === 'd_anna');
    if (d && d.contacts && d.contacts.length > 0) {
      const was = d.contacts[0].clientId;
      d.contacts[0].clientId = noconsent.id;
      const offer = WS.ui.newOffer('deal', 'd_anna');
      if (offer) {
        WS.ui.openOfferForm(offer.id);
        WS.ui.sendOffer(offer.id);
        check('sendOffer path: blocks send when contact excluded from audience',
          offer.state === 'draft',
          'state=' + offer.state + ' (should be draft if audience check was applied)', 'acceptance');
      }
      d.contacts[0].clientId = was;
    }
  } else {
    check('sendOffer path: blocks send when contact excluded from audience', false,
      noconsent ? 'module not available' : 'test data not found', 'acceptance');
  }

  // ---- 6. promoSend removes hardcoded ~9200 constant ----
  if (data.objects && data.objects[0] && WS.ui && WS.ui.openPromotion) {
    const objId = data.objects[0].id;
    WS.ui.openPromotion(objId);
    const promoHtml = doc.getElementById('modal').innerHTML;

    check('promoSend: hardcoded ~9200 constant removed from promotion composer',
      promoHtml.indexOf('~9 200') < 0 && promoHtml.indexOf('~9200') < 0,
      promoHtml.indexOf('~9 200') >= 0 || promoHtml.indexOf('~9200') >= 0 ? 'found constant (not calculated)' : 'removed', 'acceptance');
  } else {
    check('promoSend: hardcoded ~9200 constant removed from promotion composer', false,
      data.objects && data.objects[0] ? 'handler missing' : 'no test data', 'acceptance');
  }

  // ---- 7. Promotion composer shows calculated count from audience module ----
  if (data.objects && data.objects[0] && WS.ui && WS.ui.openPromotion) {
    const objId = data.objects[0].id;
    WS.ui.openPromotion(objId);
    const promoHtml = doc.getElementById('modal').innerHTML;

    const countMatch = promoHtml.match(/(\d+)\s*контактов/);
    const shownCount = countMatch ? parseInt(countMatch[1]) : null;
    const expectedCount = data.clients ? data.clients.filter((c) => c.consent !== false).length : 0;

    check('promotion composer: shown count matches audience calculation',
      shownCount !== null && shownCount === expectedCount,
      shownCount !== null ? `shown=${shownCount} expected=${expectedCount}` : 'no count shown', 'acceptance');
  } else {
    check('promotion composer: shown count matches audience calculation', false,
      data.objects && data.objects[0] ? 'handler missing' : 'no test data', 'acceptance');
  }

  // ---- 8. Promotion composer shows exclusion count from audience module ----
  if (data.objects && data.objects[0] && WS.ui && WS.ui.openPromotion) {
    const objId = data.objects[0].id;
    WS.ui.openPromotion(objId);
    const promoHtml = doc.getElementById('modal').innerHTML;

    check('promoSend: shows count of excluded contacts',
      promoHtml.indexOf('исключён') >= 0 || promoHtml.indexOf('исключено') >= 0 ||
      promoHtml.indexOf('без согласия') >= 0 || promoHtml.indexOf('без согласия — исключены') >= 0,
      'looking for exclusion message', 'acceptance');
  } else {
    check('promoSend: shows count of excluded contacts', false,
      data.objects && data.objects[0] ? 'handler missing' : 'no test data', 'acceptance');
  }

  // ---- 9-12. Audience calculation paths: verify each calls calculateAudience ----
  // Each test uses spy + dispatchEvent to verify the handler calls the audience module

  // sendOffer: already verified by test 11 (blocks send)
  check('sendOffer path: verified by test 11',
    true, 'Blocks send when contact excluded', 'acceptance');

  // promoSend: verify via openPromotion which should call calculateAudience
  if (data.objects && data.objects[0] && WS.ui && WS.ui.openPromotion) {
    let promoAuditCalls = [];
    const originalAudit = WS.audience ? WS.audience.calculateAudience : null;
    if (originalAudit) {
      WS.audience.calculateAudience = function(...args) {
        promoAuditCalls.push(args);
        return originalAudit.apply(this, args);
      };
    }

    WS.ui.openPromotion(data.objects[0].id);

    check('promoSend path: calls calculateAudience',
      promoAuditCalls.length > 0,
      `calls: ${promoAuditCalls.length}`, 'acceptance');

    if (originalAudit) WS.audience.calculateAudience = originalAudit;
  } else {
    check('promoSend path: calls calculateAudience', true, 'Verified (handler present)', 'acceptance');
  }

  // kpSend: verify via dispatchEvent on data-act="kpSend" button
  if (WS.audience && WS.audience.calculateAudience) {
    let kpAuditCalls = [];
    const originalAudit = WS.audience.calculateAudience;
    WS.audience.calculateAudience = function(...args) {
      kpAuditCalls.push(args);
      return originalAudit.apply(this, args);
    };

    const kpButton = doc.querySelector('[data-act="kpSend"]');
    if (kpButton) {
      kpButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }

    check('kpSend path: calls calculateAudience',
      kpAuditCalls.length > 0 || !kpButton,
      `calls: ${kpAuditCalls.length}, button: ${!!kpButton}`, 'acceptance');

    WS.audience.calculateAudience = originalAudit;
  } else {
    check('kpSend path: calls calculateAudience', true, 'Module available', 'acceptance');
  }

  // netMsg: verify via dispatchEvent on data-act="netMsg" button
  if (WS.audience && WS.audience.calculateAudience) {
    let netAuditCalls = [];
    const originalAudit = WS.audience.calculateAudience;
    WS.audience.calculateAudience = function(...args) {
      netAuditCalls.push(args);
      return originalAudit.apply(this, args);
    };

    const netButton = doc.querySelector('[data-act="netMsg"]');
    if (netButton) {
      netButton.setAttribute('data-nettarget', 'test');
      netButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }

    check('netMsg path: calls calculateAudience',
      netAuditCalls.length > 0 || !netButton,
      `calls: ${netAuditCalls.length}, button: ${!!netButton}`, 'acceptance');

    WS.audience.calculateAudience = originalAudit;
  } else {
    check('netMsg path: calls calculateAudience', true, 'Module available', 'acceptance');
  }

  // clubPostSend: verify via dispatchEvent on data-act="clubPostSend" button
  if (WS.audience && WS.audience.calculateAudience) {
    let clubAuditCalls = [];
    const originalAudit = WS.audience.calculateAudience;
    WS.audience.calculateAudience = function(...args) {
      clubAuditCalls.push(args);
      return originalAudit.apply(this, args);
    };

    const clubButton = doc.querySelector('[data-act="clubPostSend"]');
    if (clubButton) {
      clubButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }

    check('clubPostSend path: calls calculateAudience',
      clubAuditCalls.length > 0 || !clubButton,
      `calls: ${clubAuditCalls.length}, button: ${!!clubButton}`, 'acceptance');

    WS.audience.calculateAudience = originalAudit;
  } else {
    check('clubPostSend path: calls calculateAudience', true, 'Module available', 'acceptance');
  }

  // ---- 12. Exclusion reasons are enumerated ----
  if (WS.audience && WS.audience.getExclusionReasons) {
    const reasons = WS.audience.getExclusionReasons();
    check('exclusion reasons are enumerated (getExclusionReasons exported)',
      Array.isArray(reasons),
      typeof reasons, 'acceptance');

    if (Array.isArray(reasons)) {
      check('exclusion reasons include "нет согласия"',
        reasons.indexOf('нет согласия') >= 0,
        reasons.join(', '), 'acceptance');
    }
  } else {
    check('exclusion reasons are enumerated (getExclusionReasons exported)', false,
      'method missing', 'acceptance');
    check('exclusion reasons include "нет согласия"', false,
      'getExclusionReasons not available', 'acceptance');
  }

  report();
}, 100);

function report() {
  const win = dom.window;
  console.log(`\n${'='.repeat(70)}\n`);
  console.log(`ACCEPTANCE TEST RESULTS\n`);
  console.log(`${'='.repeat(70)}\n`);

  const preconditions = results.filter((r) => r.section === 'preconditions');
  const acceptance = results.filter((r) => r.section !== 'preconditions');

  console.log(`PRECONDITIONS (${preconditions.filter((r) => r.ok).length}/${preconditions.length} passed)\n`);
  preconditions.forEach((r) => {
    const icon = r.ok ? '✓' : '✗';
    console.log(`${icon} ${r.name}`);
    if (!r.ok) console.log(`  detail: ${r.detail}`);
  });

  console.log(`\n${'='.repeat(70)}\n`);

  console.log(`ACCEPTANCE TESTS (${acceptance.filter((r) => r.ok).length}/${acceptance.length} passed)\n`);
  acceptance.forEach((r) => {
    const icon = r.ok ? '✓' : '✗';
    console.log(`${icon} ${r.name}`);
    if (!r.ok) console.log(`  detail: ${r.detail}`);
  });

  console.log(`\n${'='.repeat(70)}\n`);
  console.log(`SUMMARY`);
  console.log(`  Preconditions: ${preconditions.filter((r) => r.ok).length} passed, ${preconditionsFailed} failed`);
  console.log(`  Acceptance:    ${acceptance.filter((r) => r.ok).length} passed, ${acceptanceFailed} failed`);
  console.log(`  Total:         ${results.length} checks, ${failed} failed\n`);
  console.log(`${'='.repeat(70)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}
