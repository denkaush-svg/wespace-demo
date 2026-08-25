/* Acceptance tests for incident: participant role-based consent inheritance.
   Verifies that only participants from the client's side can inherit consent
   from the deal client. Participants from the other side or brokers without
   their own clientId must be excluded with a distinct reason.
   Run:  node src/test/acceptance-incident-consent.js
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

  check('PRECOND: app boots (WS.ui present)', WS && WS.ui, WS ? 'ui=' + !!WS.ui : 'no WS', 'preconditions');
  check('PRECOND: no window errors on boot', errors.length === 0, errors.join('; '), 'preconditions');
  if (!WS || !WS.ui) return report();

  const data = WS.store.data;
  const dd = () => WS.store.data;

  check('PRECOND: clients exist in fixtures', data.clients && data.clients.length > 0,
    data.clients ? 'count=' + data.clients.length : 'no clients', 'preconditions');
  check('PRECOND: deals exist in fixtures', data.deals && data.deals.length > 0,
    data.deals ? 'count=' + data.deals.length : 'no deals', 'preconditions');
  check('PRECOND: ROLE_GROUPS dictionary exists', WS.ui && WS.ui.ROLE_GROUPS && Array.isArray(WS.ui.ROLE_GROUPS),
    WS.ui && WS.ui.ROLE_GROUPS ? 'groups=' + WS.ui.ROLE_GROUPS.length : 'missing', 'preconditions');
  check('PRECOND: audience module exists', WS.audience && typeof WS.audience.calculateAudience === 'function',
    WS.audience ? 'module=' + !!WS.audience.calculateAudience : 'no module', 'preconditions');

  // ======== ACCEPTANCE TESTS ========
  // These checks verify NEW behavior that must be implemented.
  // All must be RED now; they turn GREEN only when the module is fixed.

  // Cache test data
  const consentingClient = data.clients.find((c) => c.consent === true);
  const nonconsentClient = data.clients.find((c) => c.consent === false);
  const deal = data.deals.find((d) => d.id === 'd_anna');

  // Helper to identify role group
  function getRoleGroup(role) {
    if (!WS.ui || !WS.ui.ROLE_GROUPS) return null;
    for (const group of WS.ui.ROLE_GROUPS) {
      if (group.roles.indexOf(role) >= 0) return group.k;
    }
    return null;
  }

  // ---- Test 1: Participant from OTHER side without clientId must be excluded when main client consents ----
  if (consentingClient && deal && WS.audience && WS.ui && WS.ui.ROLE_GROUPS) {
    // Create a synthetic participant from "other" side (Собственник, Менеджер девелопера, etc.)
    const otherSideParticipant = {
      id: 'test_other_side_no_card',
      name: 'Other Side Rep',
      role: 'Менеджер девелопера', // from "other" side group
      channel: 'whatsapp',
      // Notably: NO clientId — must NOT inherit from deal client's consent
    };

    const result = WS.audience.calculateAudience([otherSideParticipant],
      { dealClients: [consentingClient] });

    check('Test 1.1: participant from other side without card is EXCLUDED when main client consents',
      result && result.excluded && result.excluded.some((x) => x.id === otherSideParticipant.id),
      result ? `suitable=${result.suitable.length} excluded=${result.excluded.length}` : 'null',
      'acceptance');

    // Verify the exclusion reason is NOT just "no consent"
    const exclusion = result && result.excluded && result.excluded.find((x) => x.id === otherSideParticipant.id);
    check('Test 1.2: exclusion reason distinguishes from "no consent"',
      exclusion && exclusion.reason && exclusion.reason !== 'нет согласия',
      exclusion ? `reason="${exclusion.reason}"` : 'not excluded',
      'acceptance');

    check('Test 1.3: reason indicates consent belongs to another person or different side',
      exclusion && exclusion.reason &&
      (exclusion.reason.indexOf('другом') >= 0 || exclusion.reason.indexOf('сторо') >= 0 ||
       exclusion.reason.indexOf('лиц') >= 0 || exclusion.reason.indexOf('принад') >= 0),
      exclusion ? `reason="${exclusion.reason}"` : 'not excluded',
      'acceptance');
  } else {
    check('Test 1.1: participant from other side without card is EXCLUDED when main client consents', false,
      !consentingClient ? 'no consenting client' : !deal ? 'no deal' : 'module missing',
      'acceptance');
    check('Test 1.2: exclusion reason distinguishes from "no consent"', false,
      'prerequisite failed', 'acceptance');
    check('Test 1.3: reason indicates consent belongs to another person or different side', false,
      'prerequisite failed', 'acceptance');
  }

  // ---- Test 2: Participant from BROKER side without clientId must be excluded when main client consents ----
  if (consentingClient && deal && WS.audience && WS.ui && WS.ui.ROLE_GROUPS) {
    // Create a synthetic participant from "broker" side (Агент-партнёр, Ипотечный брокер)
    const brokerSideParticipant = {
      id: 'test_broker_side_no_card',
      name: 'Partner Broker',
      role: 'Агент-партнёр', // from "broker" side group
      channel: 'whatsapp',
      // Notably: NO clientId — must NOT inherit from deal client's consent
    };

    const result = WS.audience.calculateAudience([brokerSideParticipant],
      { dealClients: [consentingClient] });

    check('Test 2.1: participant from broker side without card is EXCLUDED when main client consents',
      result && result.excluded && result.excluded.some((x) => x.id === brokerSideParticipant.id),
      result ? `suitable=${result.suitable.length} excluded=${result.excluded.length}` : 'null',
      'acceptance');

    // Verify reason is NOT just "no consent"
    const exclusion = result && result.excluded && result.excluded.find((x) => x.id === brokerSideParticipant.id);
    check('Test 2.2: broker side exclusion reason is distinguishable',
      exclusion && exclusion.reason && exclusion.reason !== 'нет согласия',
      exclusion ? `reason="${exclusion.reason}"` : 'not excluded',
      'acceptance');
  } else {
    check('Test 2.1: participant from broker side without card is EXCLUDED when main client consents', false,
      'prerequisite failed', 'acceptance');
    check('Test 2.2: broker side exclusion reason is distinguishable', false,
      'prerequisite failed', 'acceptance');
  }

  // ---- Test 3: Participant from CLIENT SIDE without clientId still inherits consent (rule not revoked) ----
  if (consentingClient && nonconsentClient && deal && WS.audience && WS.ui && WS.ui.ROLE_GROUPS) {
    // Create a synthetic participant from "client" side (Клиент, Супруг, Представитель по доверенности, etc.)
    const clientSideParticipant = {
      id: 'test_client_side_no_card',
      name: 'Spouse',
      role: 'Супруг', // from "client" side group
      channel: 'whatsapp',
      // Notably: NO clientId — SHOULD inherit from deal client
    };

    // Test 3a: with consenting client, should be suitable
    const resultConsent = WS.audience.calculateAudience([clientSideParticipant],
      { dealClients: [consentingClient] });

    check('Test 3a: client-side participant without card is SUITABLE when main client consents',
      resultConsent && resultConsent.suitable && resultConsent.suitable.some((x) => x.id === clientSideParticipant.id),
      resultConsent ? `suitable=${resultConsent.suitable.length} excluded=${resultConsent.excluded.length}` : 'null',
      'acceptance');

    // Test 3b: with non-consenting client, should be excluded
    const resultNoConsent = WS.audience.calculateAudience([clientSideParticipant],
      { dealClients: [nonconsentClient] });

    check('Test 3b: client-side participant without card is EXCLUDED when main client does NOT consent',
      resultNoConsent && resultNoConsent.excluded && resultNoConsent.excluded.some((x) => x.id === clientSideParticipant.id),
      resultNoConsent ? `suitable=${resultNoConsent.suitable.length} excluded=${resultNoConsent.excluded.length}` : 'null',
      'acceptance');
  } else {
    check('Test 3a: client-side participant without card is SUITABLE when main client consents', false,
      'prerequisite failed', 'acceptance');
    check('Test 3b: client-side participant without card is EXCLUDED when main client does NOT consent', false,
      'prerequisite failed', 'acceptance');
  }

  // ---- Test 4: Verify exclusion reason is NOT "no consent" for other/broker side ----
  if (consentingClient && deal && WS.audience && WS.ui && WS.ui.ROLE_GROUPS) {
    const otherSideParticipant = {
      id: 'test_reason_check',
      name: 'Tester',
      role: 'Менеджер девелопера',
      channel: 'whatsapp',
    };

    const result = WS.audience.calculateAudience([otherSideParticipant],
      { dealClients: [consentingClient] });

    const exclusion = result && result.excluded && result.excluded.find((x) => x.id === otherSideParticipant.id);

    check('Test 4: reason for other-side exclusion must NOT be "нет согласия"',
      exclusion && exclusion.reason && exclusion.reason !== 'нет согласия',
      exclusion ? `reason="${exclusion.reason}"` : 'not found',
      'acceptance');
  } else {
    check('Test 4: reason for other-side exclusion must NOT be "нет согласия"', false,
      'prerequisite failed', 'acceptance');
  }

  // ---- Test 5: Multiple participants from different sides ----
  if (consentingClient && deal && WS.audience && WS.ui && WS.ui.ROLE_GROUPS) {
    const mixed = [
      { id: 'mixed_client', name: 'Client Participant', role: 'Супруг', channel: 'whatsapp' },
      { id: 'mixed_other', name: 'Other Participant', role: 'Менеджер девелопера', channel: 'whatsapp' },
      { id: 'mixed_broker', name: 'Broker Participant', role: 'Ипотечный брокер', channel: 'whatsapp' },
    ];

    const result = WS.audience.calculateAudience(mixed, { dealClients: [consentingClient] });

    // Client-side should be suitable
    const hasSuitableClient = result && result.suitable && result.suitable.some((x) => x.id === 'mixed_client');
    check('Test 5.1: mixed batch - client side is suitable',
      hasSuitableClient,
      result ? `suitable=${result.suitable.length} excluded=${result.excluded.length}` : 'null',
      'acceptance');

    // Other-side should be excluded
    const hasExcludedOther = result && result.excluded && result.excluded.some((x) => x.id === 'mixed_other');
    check('Test 5.2: mixed batch - other side is excluded',
      hasExcludedOther,
      result ? `suitable=${result.suitable.length} excluded=${result.excluded.length}` : 'null',
      'acceptance');

    // Broker-side should be excluded
    const hasExcludedBroker = result && result.excluded && result.excluded.some((x) => x.id === 'mixed_broker');
    check('Test 5.3: mixed batch - broker side is excluded',
      hasExcludedBroker,
      result ? `suitable=${result.suitable.length} excluded=${result.excluded.length}` : 'null',
      'acceptance');
  } else {
    check('Test 5.1: mixed batch - client side is suitable', false, 'prerequisite failed', 'acceptance');
    check('Test 5.2: mixed batch - other side is excluded', false, 'prerequisite failed', 'acceptance');
    check('Test 5.3: mixed batch - broker side is excluded', false, 'prerequisite failed', 'acceptance');
  }

  report();
}, 100);

function report() {
  const win = dom.window;
  console.log(`\n${'='.repeat(80)}\n`);
  console.log(`ACCEPTANCE TEST RESULTS — Incident: Role-Based Consent Inheritance\n`);
  console.log(`${'='.repeat(80)}\n`);

  const preconditions = results.filter((r) => r.section === 'preconditions');
  const acceptance = results.filter((r) => r.section !== 'preconditions');

  console.log(`PRECONDITIONS (${preconditions.filter((r) => r.ok).length}/${preconditions.length} passed)\n`);
  preconditions.forEach((r) => {
    const icon = r.ok ? '✓' : '✗';
    console.log(`${icon} ${r.name}`);
    if (!r.ok) console.log(`  detail: ${r.detail}`);
  });

  console.log(`\n${'='.repeat(80)}\n`);

  console.log(`ACCEPTANCE TESTS (${acceptance.filter((r) => r.ok).length}/${acceptance.length} passed)\n`);
  acceptance.forEach((r) => {
    const icon = r.ok ? '✓' : '✗';
    console.log(`${icon} ${r.name}`);
    if (!r.ok) console.log(`  detail: ${r.detail}`);
  });

  console.log(`\n${'='.repeat(80)}\n`);
  console.log(`SUMMARY`);
  console.log(`  Preconditions: ${preconditions.filter((r) => r.ok).length} passed, ${preconditionsFailed} failed`);
  console.log(`  Acceptance:    ${acceptance.filter((r) => r.ok).length} passed, ${acceptanceFailed} failed`);
  console.log(`  Total:         ${results.length} checks, ${failed} failed\n`);
  console.log(`${'='.repeat(80)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}
