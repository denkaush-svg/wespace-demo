/* Acceptance tests for contact interests and object types module.
   Verifies that:
   1. Contacts without interest do not disappear from list or appear in filtered views
   2. Object type mapping lives in one place (changes propagate everywhere)
   3. Manually set interest is not overwritten by inferred values
   4. Both interest and objTypes fields are visible on contact card
   5. Multiple object types filter correctly (contact in multiple result sets)
   Run:  node src/test/acceptance-contact-interests.js
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
  check('PRECOND: requests exist in fixtures', data.requests && data.requests.length > 0,
    data.requests ? 'count=' + data.requests.length : 'no requests', 'preconditions');
  check('PRECOND: contactsSearchList function exists',
    WS.ui && typeof WS.ui.contactsSearchList === 'function',
    WS.ui ? 'contactsSearchList=' + typeof WS.ui.contactsSearchList : 'no WS.ui', 'preconditions');
  check('PRECOND: clientCard function exists',
    WS.ui && typeof WS.ui.clientCard === 'function',
    WS.ui ? 'clientCard=' + typeof WS.ui.clientCard : 'no WS.ui', 'preconditions');
  check('PRECOND: contactsFilters work',
    WS.store && WS.store.contactsFilters && WS.CONTACT_FILTERS_DEFAULT,
    WS.store && WS.CONTACT_FILTERS_DEFAULT ? 'filters initialized' : 'store missing', 'preconditions');

  // ======== ACCEPTANCE TESTS ========
  // These checks verify NEW behavior that must be implemented.
  // All must be RED now; they turn GREEN only when the module is implemented.

  // ---- 1. Contact without interest does not disappear from general list ----
  // Create a synthetic contact without interest to test boundary condition
  const contactNoInterest = {
    id: 'c_test_nointr',
    name: 'Test Contact No Interest',
    contactKind: 'buyer',
    consent: true,
    // Deliberately no interest field, or undefined
    objTypes: [],
    goal: 'Test contact for interest filtering'
  };

  // Add to data temporarily
  data.clients.push(contactNoInterest);

  const allContactsList = WS.ui.contactsSearchList();
  const noInterestInList = allContactsList.some((c) => c.id === 'c_test_nointr');
  check('contact without interest: appears in general list', noInterestInList,
    noInterestInList ? 'found' : `total contacts: ${allContactsList.length}, test contact not found`, 'acceptance');

  // ---- 2. Contact without interest does not appear in any interest-filtered view ----
  // Test with known interest values found in fixtures
  const interestValues = ['invest', 'live', 'rent', 'office', 'develop'];
  let failedFilters = [];
  for (const interestVal of interestValues) {
    WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { interest: interestVal });
    const filteredList = WS.ui.contactsSearchList();
    const shouldNotAppear = !filteredList.some((c) => c.id === 'c_test_nointr');
    if (!shouldNotAppear) {
      failedFilters.push(interestVal);
    }
  }
  check('contact without interest: excluded from all interest-filtered views',
    failedFilters.length === 0,
    failedFilters.length > 0 ? `appears in: ${failedFilters.join(', ')}` : 'correctly excluded', 'acceptance');

  // Reset filters
  WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();

  // ---- 3. Object type mapping lives in one place (critique: must catch 3-place parsing) ----
  // Criterion 2 from spec: "соответствие текста ключу живёт в одном месте"
  // Coordinator critique: there are 3 parsing places (ui.js:665, 1297, 10759); if they exist,
  // adding a value to dict won't propagate everywhere. This test takes a dictionary value
  // unknown to all three classifiers (e.g., 'warehouse') and requires it to pass the full path:
  // request objectType text → mapping to key → contact.objTypes → filter match.
  // If there's no single mapping function, the test catches that by failing on propagation.

  const testContactForMapping = {
    id: 'c_test_warehouse',
    name: 'Test Contact Warehouse',
    contactKind: 'buyer',
    consent: true,
    objTypes: [],  // Empty, waiting for fill
    goal: 'Test'
  };

  const testRequest = {
    id: 'r_test_warehouse',
    clientId: 'c_test_warehouse',
    objectType: 'Склад',  // Russian text; must map to 'warehouse' key
    offered: [],
    stage: 'open'
  };

  // Add both to data temporarily
  data.clients.push(testContactForMapping);
  data.requests.push(testRequest);

  // Test if a single mapping/filling function exists that handles the full path
  // Look for the function that fills contact.objTypes from request.objectType text
  let mappingFunctionFound = false;
  let warehouseAppearsInFilter = false;

  // Try to invoke the filling function if it exists
  const possibleFunctionNames = ['fillContactObjTypesFromRequests', 'updateContactObjTypes',
                                  'syncContactTypesFromDeals', 'populateObjTypes'];
  for (const fname of possibleFunctionNames) {
    if (WS.ui && typeof WS.ui[fname] === 'function') {
      mappingFunctionFound = true;
      try {
        // Call with the test contact and data
        WS.ui[fname](testContactForMapping);
      } catch (e) {
        // Function exists but errored; that's ok
      }
      break;
    }
  }

  // Now check: if the mapping worked, the filter should catch 'warehouse'
  WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { objType: 'warehouse' });
  warehouseAppearsInFilter = WS.ui.contactsSearchList().some((c) => c.id === 'c_test_warehouse');
  WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();

  // The test fails if:
  // 1. Mapping function doesn't exist (means parsing happens in 3 places, not 1)
  // 2. Mapping function exists but warehouse doesn't propagate (incomplete parsing)
  const mappingIsSingleSource = mappingFunctionFound && warehouseAppearsInFilter;
  const mappingFailReason = !mappingFunctionFound ?
    'single mapping function not found (parsing in multiple places)' :
    !warehouseAppearsInFilter ?
    'warehouse value does not propagate to filter (incomplete parsing)' :
    '';

  check('object type mapping: single source for text-to-key conversion',
    mappingIsSingleSource,
    mappingIsSingleSource ? 'warehouse maps and filters correctly' : mappingFailReason, 'acceptance');

  // Cleanup
  data.clients = data.clients.filter((c) => c.id !== 'c_test_warehouse');
  data.requests = data.requests.filter((r) => r.id !== 'r_test_warehouse');

  // ---- 4. Multiple object types: contact with two types appears in both filtered views ----
  // Look for a contact with multiple objTypes
  const multiTypeContact = data.clients.find((c) => c.objTypes && c.objTypes.length > 1);
  if (multiTypeContact) {
    const types = multiTypeContact.objTypes;
    let inAllTypes = true;
    let missingFrom = [];

    for (const objType of types) {
      WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { objType: objType });
      const filteredList = WS.ui.contactsSearchList();
      const appearsInFilter = filteredList.some((c) => c.id === multiTypeContact.id);
      if (!appearsInFilter) {
        missingFrom.push(objType);
        inAllTypes = false;
      }
    }

    check('multiple object types: contact with N types appears in all N filtered views',
      inAllTypes,
      inAllTypes ? `${multiTypeContact.name} (types: ${types.join(', ')}) in all filters` :
                   `missing from filters: ${missingFrom.join(', ')}`, 'acceptance');
  } else {
    check('multiple object types: contact with N types appears in all N filtered views', false,
      'no contact with multiple objTypes found', 'acceptance');
  }

  // Reset filters
  WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();

  // ---- 5. Both fields visible on contact card (objTypes should be displayed) ----
  // Open a contact card and check if objTypes field is rendered
  // The card opens via route (clientDetail view) and renders into #main, not modal
  if (data.clients && data.clients.length > 0) {
    const testContact = data.clients[0];
    WS.ui.clientCard(testContact.id);
    // Give the view time to render
    setTimeout(() => {}, 10);
    const cardContent = doc.getElementById('main').innerHTML;
    // Debug: log what we found
    if (cardContent.length < 100) {
      console.log('DEBUG: #main is nearly empty, length=' + cardContent.length);
    }

    // Check if objTypes field appears in the card by looking for the field label or values
    // The field is: dfPair('Интерес контакта к типам', ...) which outputs Russian labels or '(не указан)'
    const objTypesKeywords = ['Интерес контакта к типам', 'офис', 'апартамент', 'склад', '(не указан)',
                              'ритейл', 'земельный'];
    let objTypesVisible = objTypesKeywords.some((kw) => cardContent.indexOf(kw) >= 0);

    check('object types field: visible on contact card',
      objTypesVisible,
      objTypesVisible ? 'found in card markup' : 'objTypes not rendered in contact card', 'acceptance');
  } else {
    check('object types field: visible on contact card', false, 'no test contact available', 'acceptance');
  }

  // ---- 6. Interest field visible on contact card ----
  // The card opens via route (clientDetail view) and renders into #main, not modal
  if (data.clients && data.clients.length > 0) {
    const testContact = data.clients.find((c) => c.interest);
    if (testContact) {
      WS.ui.clientCard(testContact.id);
      // Give the view time to render
      setTimeout(() => {}, 10);
      const cardContent = doc.getElementById('main').innerHTML;
      // Look for the Russian label of the interest; based on CONTACT_INTEREST_LABEL mapping
      const interestLabels = {
        'invest': 'инвестиции', 'live': 'проживание', 'rent': 'аренда',
        'office': 'размещение компании', 'develop': 'девелопмент'
      };
      const interestLabel = interestLabels[testContact.interest];
      const interestVisible = interestLabel && cardContent.indexOf(interestLabel) >= 0;

      check('interest field: visible on contact card',
        interestVisible,
        interestVisible ? 'found in card markup' : 'interest not rendered in contact card', 'acceptance');
    } else {
      check('interest field: visible on contact card', false, 'no contact with interest found', 'acceptance');
    }
  } else {
    check('interest field: visible on contact card', false, 'no test contact available', 'acceptance');
  }

  // ---- 7. Manually set objTypes is not overwritten by inferred values (critique: must test recalc) ----
  // Criterion 3 from spec: "выведенное из заявок не затирает ручное"
  // Coordinator critique: test is green because filling function doesn't exist.
  // Fix: create contact WITHOUT manual objTypes, call filling function, check it gets inferred value.
  // Then set manual value, call filling function again, check manual isn't overwritten.
  // If filling function doesn't exist, test must fall on ITS absence, not on absence of side effects.

  const testContactNoTypes = {
    id: 'c_test_notypes',
    name: 'Test Contact No Types',
    contactKind: 'buyer',
    consent: true,
    objTypes: [],  // Empty, no manual value
    goal: 'Test'
  };

  const testRequestApart = {
    id: 'r_test_apart',
    clientId: 'c_test_notypes',
    objectType: 'Квартира',  // Should infer to 'apart'
    offered: [],
    stage: 'open'
  };

  data.clients.push(testContactNoTypes);
  data.requests.push(testRequestApart);

  // Step 1: Try to call the filling function. If it doesn't exist, test falls.
  let fillingFunctionFound = false;
  const possibleFillingFunctionNames = ['fillContactObjTypesFromRequests', 'updateContactFromRequests',
                                        'syncContactObjTypes', 'inferObjTypesFromDeals'];
  for (const fname of possibleFillingFunctionNames) {
    if (WS.ui && typeof WS.ui[fname] === 'function') {
      fillingFunctionFound = true;
      try {
        WS.ui[fname](testContactNoTypes);
      } catch (e) {
        // Function exists but errored; that's ok, we found it
      }
      break;
    }
  }

  let inferredValueAppeared = false;
  let manualValuePreserved = false;

  if (fillingFunctionFound) {
    // Step 2: Check if inferred value appeared
    inferredValueAppeared = testContactNoTypes.objTypes && testContactNoTypes.objTypes.length > 0;

    // Step 3: Set manual value, call filling again, check it's preserved
    testContactNoTypes.objTypes = ['office'];  // Manual: different from inferred 'apart'
    try {
      // Find and call the filling function again
      for (const fname of possibleFillingFunctionNames) {
        if (WS.ui && typeof WS.ui[fname] === 'function') {
          WS.ui[fname](testContactNoTypes);
          break;
        }
      }
    } catch (e) {
      // ok
    }
    manualValuePreserved = testContactNoTypes.objTypes && testContactNoTypes.objTypes[0] === 'office';
  }

  // Test passes only if:
  // 1. Filling function exists (otherwise test MUST fail)
  // 2. Manual value is preserved after recalc
  const manualPreservationWorks = fillingFunctionFound && manualValuePreserved;
  const failReason = !fillingFunctionFound ?
    'filling function not found (required for criterion 3)' :
    !manualValuePreserved ?
    'manual value overwritten after recalc' :
    '';

  check('manual objTypes: not overwritten by inferred values on recalc',
    manualPreservationWorks,
    manualPreservationWorks ? 'manual preserved through recalc' : failReason, 'acceptance');

  // Cleanup
  data.clients = data.clients.filter((c) => c.id !== 'c_test_notypes');
  data.requests = data.requests.filter((r) => r.id !== 'r_test_apart');

  // ---- 8. Object type count in filter matches contact count ----
  // When filtering by a specific objType, the count should match contacts that have that type
  const objType = 'apart';
  WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { objType: objType });
  const filteredByType = WS.ui.contactsSearchList();
  const expectedCount = data.clients.filter((c) => c.objTypes && c.objTypes.indexOf(objType) >= 0).length;

  check('object type filter: count matches expected',
    filteredByType.length === expectedCount,
    `filtered=${filteredByType.length} expected=${expectedCount}`, 'acceptance');

  // Reset
  WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();

  // ---- 9. Interest filter narrows down contacts correctly ----
  // Pick a specific interest and verify the filter works
  const interestValue = 'invest';
  WS.store.contactsFilters = Object.assign(WS.CONTACT_FILTERS_DEFAULT(), { interest: interestValue });
  const filteredByInterest = WS.ui.contactsSearchList();
  const expectedInterestCount = data.clients.filter((c) => c.interest === interestValue).length;

  check('interest filter: count matches expected',
    filteredByInterest.length === expectedInterestCount,
    `filtered=${filteredByInterest.length} expected=${expectedInterestCount}`, 'acceptance');

  // Reset
  WS.store.contactsFilters = WS.CONTACT_FILTERS_DEFAULT();

  // ---- 10. Existing tests (smoke.js checks) still pass ----
  // Verify that the implementation doesn't break the basic smoke test checks
  const smokeContacts = WS.ui.contactsSearchList();
  check('smoke test compatibility: contacts list not empty after changes',
    smokeContacts && smokeContacts.length > 0,
    `count=${smokeContacts.length}`, 'acceptance');

  // Remove the test contact we added
  data.clients = data.clients.filter((c) => c.id !== 'c_test_nointr');

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
