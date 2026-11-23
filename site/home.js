(function () {
  // The headline shows its three lines in turn ("Sell to any agent.", "Buy from any agent.", "Go direct."), every
  // 3.5 s, and holds while hovered. It stays on the first for a visitor who asks for reduced motion; screen readers
  // read all of it from the .sr line. Only the line on show takes room, so each stays centred. At a swap the line is set
  // back where it stood, then let go, so it glides to its new centre in 0.45 s and nothing jumps.
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var h = document.querySelector('h1'), line = h.querySelector('.line'), slot = h.querySelector('.verb'), v = slot.querySelectorAll('.v'), i = 0, t;
  var swap = function () {
    var was = slot.getBoundingClientRect().right;
    v[i].classList.remove('on'); i = (i + 1) % v.length; v[i].classList.add('on');
    line.style.transition = 'none'; line.style.transform = 'translateX(' + (was - slot.getBoundingClientRect().right) + 'px)';
    line.getBoundingClientRect(); // the line now stands where it stood
    line.style.transition = ''; line.style.transform = '';
  };
  if (!still) {
    var start = function () { clearInterval(t); t = setInterval(swap, 3500); };
    h.addEventListener('mouseenter', function () { clearInterval(t); });
    h.addEventListener('mouseleave', start);
    start();
  }
  // The case study's code (examples/buy-dataset.ts: a buyer agent buys a cleaned customers.csv for 25 tUSDC from a
  // seller agent), typed faintly down the page: the buyer's code on the left, the seller's on the right, each
  // with its call results as comments. New lines arrive at the bottom and push older ones up. Each line is
  // [delay ms, 'b' | 's', text], the delay scaled by K; a new deal starts every 6200 ms × K, about 13.6 s.
  var hex = function (n) { var s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; };
  var K = 2.2; // one pace for both streams
  var CALLS = function (i, id) {
    var open = [
      [0, 'b', "const me = { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey };"],
      [80, 'b', "await mail(seller, me); // ask for an offer: customers.csv, at most 30 tUSDC"],
      [0, 's', "const offer = await seller.offer({"],
      [60, 's', "  template: 'checks-only', price: { token: TUSDC, amount: '25000000' },"],
      [120, 's', "  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },"],
      [180, 's', "  checks: [cols, rows, uniq], buyer: me, adjudicators: { primary, fallback, appeal },"],
      [240, 's', "}); // \u2192 offer " + id + ": Offered"],
      [300, 's', "await mail(buyer, offer.terms);"],
      [320, 'b', "await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);"],
      [420, 'b', "const held = await buyer.agreeAndFund(offer.terms, 30_000_000n);"],
      [520, 'b', "// verify domain, price, nonces \u00b7 sign Agree + FundingAuthorization"],
      [600, 'b', "// \u2192 Held, 26000000 base units (price + fee)"],
      [620, 's', "await seller.waitFor(offer.id, ['Held']); // \u2192 Held"],
      [700, 's', "await seller.deliver(offer.terms, new TextEncoder().encode(csv));"],
      [820, 's', "// AES-256-GCM \u00b7 key sealed to 3 adjudicators + buyer \u00b7 sign Delivery"],
      [1100, 's', "// \u2192 Delivered"]
    ];
    var tail = [
      [ // release
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \u2713 rows \u2713 uniq \u2713 \u2192 accept"],
        [2900, 'b', "// \u2192 Released: the content key is mine"],
        [2900, 's', "// \u2192 Released: 25000000 tUSDC paid to me"],
        [3300, 'b', "const work = await buyer.openDelivery(offer.id); // open envelope, check sha256"],
        [3600, 'b', "// customer_id,email \u00b7 1,ada@example.com \u00b7 2,alan@\u2026"],
        [4300, 'b', "await balance(buyer); // \u2192 9974000000"],
        [4300, 's', "await balance(seller); // \u2192 10025000000"]
      ],
      [ // refund
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// adjudicator: cols \u2713 rows \u2717 (2 of 3) uniq \u2713 \u2192 reject"],
        [2900, 'b', "// \u2192 Refunded: 25000000 tUSDC back to me (the 1 tUSDC fee is spent)"],
        [2900, 's', "// \u2192 Refunded: unpaid, and the buyer never got the key"],
        [4300, 'b', "await balance(buyer); // \u2192 9999000000"]
      ],
      [ // default
        [1500, 'b', "// judgeBy and fallbackBy pass with no decision from either adjudicator"],
        [1500, 's', "// judgeBy and fallbackBy pass with no decision from either adjudicator"],
        [2200, 'b', "await buyer.call('POST', '/v1/commitments/' + offer.id + '/triggers/default');"],
        [2350, 'b', "// \u2192 Defaulted, then Refunded in the same transaction"],
        [2600, 's', "await seller.waitFor(offer.id, ['Refunded']);"],
        [2900, 'b', "// \u2192 refunded: 25000000 tUSDC and the 1 tUSDC fee back to me"],
        [2900, 's', "// \u2192 no decision, so the default outcome: the buyer's money goes back"]
      ],
      [ // escalation
        [1500, 'b', "const done = await buyer.waitFor(offer.id, ['Released', 'Refunded']);"],
        [1500, 's', "await seller.waitFor(offer.id, ['Released', 'Refunded']);"],
        [2100, 'b', "// primary adjudicator: the screen flags the work \u2192 escalate"],
        [2600, 's', "// \u2192 Escalated: the appeal adjudicator decides within appealDecideSec"],
        [3300, 'b', "// the drand round after the escalation's block seeds a fresh panel"],
        [4200, 'b', "// appeal adjudicator: rows \u2717 (2 of 3) \u2192 reject \u00b7 final"],
        [4350, 'b', "// \u2192 Refunded: 25000000 tUSDC back to me"],
        [4350, 's', "// \u2192 Refunded: the decision is final when it settles"]
      ]
    ][i];
    // the agents asking the API about itself, spread over the four deals so every feature shows once
    var c = "'/v1/commitments/' + offer.id + '";
    var QA = [
      [ // release
        [4500, 'b', "// which adjudicators can we name, and what do they charge?"],
        [4620, 'b', "await buyer.call('GET', '/v1/adjudicators'); // \u2192 3 \u00b7 fee.min 1 tUSDC"],
        [4500, 's', "// does every operator serve the same record?"],
        [4620, 's', "await seller.call('GET', " + c + "/events'); // \u2192 same hashes on op-1 and op-2"],
        [5200, 'b', "// what did the seller actually sign?"],
        [5320, 'b', "await buyer.call('GET', " + c + "/terms'); // \u2192 matches the mailed offer"],
        [5200, 's', "// a fresh agent? the faucet funds it and admits it to the club"],
        [5320, 's', "await fresh.call('POST', '/v1/faucet', { address }); // \u2192 1000 tUSDC \u00b7 demo-club"]
      ],
      [ // refund
        [4500, 'b', "// what exactly did the checks find?"],
        [4620, 'b', "await buyer.call('GET', " + c + "/judgment'); // \u2192 rows: 2, terms say 3"],
        [4500, 's', "// can I preview a submit before signing it?"],
        [4620, 's', "await seller.call('POST', " + c + "/deliveries?validateOnly=true', draft); // \u2192 200, nothing changed"],
        [5200, 's', "// who must the content key be sealed to?"],
        [5320, 's', "await seller.call('GET', " + c + "/recipients'); // \u2192 primary, fallback, appeal, buyer"]
      ],
      [ // default
        [4500, 'b', "// what does the club's rulebook say a default pays?"],
        [4620, 'b', "await buyer.call('GET', '/v1/clubs/demo-club'); // \u2192 the default outcome: refund the buyer"],
        [4500, 's', "// what can this API do?"],
        [4620, 's', "await seller.call('GET', '/v1/openapi.json'); // \u2192 OpenAPI 3.1, every route"],
        [5200, 's', "// which settlement layer is this, and what time is it there?"],
        [5320, 's', "await seller.call('GET', '/.well-known/holdback.json'); // \u2192 domain, settlementTime"]
      ],
      [ // escalation
        [2700, 'b', "// who decides now, and by when?"],
        [2820, 'b', "await buyer.call('GET', " + c + "'); // \u2192 escrowState: Escalated \u00b7 the appeal adjudicator's turn"],
        [4800, 's', "// where are my receipts?"],
        [4920, 's', "await seller.call('GET', " + c + "/receipts'); // \u2192 signed by each operator"],
        [5000, 'b', "// what do I hold now?"],
        [5120, 'b', "await buyer.call('GET', '/v1/balances/' + buyer.address); // \u2192 the 25 tUSDC price is back"]
      ]
    ][i];
    return open.concat(tail, QA);
  };
  var streams = { b: document.getElementById('stream-b'), s: document.getElementById('stream-s') }, streamTimers = [];
  function say(side, text) {
    var el = streams[side];
    if (!el) return;
    var line = document.createElement('div'); line.textContent = text; el.appendChild(line);
    while (el.childNodes.length > 90) el.removeChild(el.firstChild);
  }
  function play(i) {
    streamTimers.forEach(clearTimeout); streamTimers = [];
    var id = '0x' + hex(6) + '\u2026' + hex(4);
    var calls = CALLS(i, id);
    if (still) { calls.forEach(function (l) { say(l[1], l[2]); }); return; }
    var head = ' \u00b7 ' + ['release', 'refund', 'default', 'escalation'][i];
    say('b', ''); say('b', '// buyer agent' + head);
    say('s', ''); say('s', '// seller agent' + head);
    calls.forEach(function (l) { streamTimers.push(setTimeout(function () { say(l[1], l[2]); }, l[0] * K)); });
  }
  // Four deals in turn, one every 6200 ms × K. A visitor who asks for reduced motion gets the first deal's code
  // written once, with no animation.
  var deal = 0; play(0);
  if (!still) setInterval(function () { deal = (deal + 1) % 4; play(deal); }, 6200 * K);
  // Try Crow: the copy icon copies the prompt for the visitor's AI assistant.
  // Where the clipboard is refused, the prompt shows selected instead so the visitor can copy it by hand.
  var select = function (el) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  var prompt = document.getElementById('prompt').textContent, tag = document.getElementById('copied');
  var fallback = function () { tag.textContent = '\u201c' + prompt + '\u201d'; select(tag); };
  document.getElementById('copy').addEventListener('click', function () {
    var done = function () { tag.textContent = 'Copied'; setTimeout(function () { tag.textContent = ''; }, 2500); };
    if (navigator.clipboard) navigator.clipboard.writeText(prompt).then(done, fallback); else fallback();
  });
  // early access: the email form sits on the page
  var form = document.getElementById('join-form'), msg = document.getElementById('join-msg'), send = document.getElementById('join-send');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Please enter a full email address, like you@example.com.'; return; }
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('https://join.crow.direct/early-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, company: form.company.value, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) { msg.textContent = x.ok ? 'Thank you. We’ll be in touch at ' + email + '.' : (x.b && x.b.error) || 'That didn’t go through. Please try again.'; if (x.ok) form.email.value = ''; })
      .catch(function () { msg.textContent = 'That didn’t go through. Check your connection and try again.'; })
      .then(function () { send.disabled = false; });
  });
})();
(function () {
  var opens = document.querySelectorAll('[data-join]');
  if (!opens.length || typeof HTMLDialogElement !== 'function') return; // the controls stay links to a visible form
  var box = document.createElement('div');
  box.innerHTML = "<dialog class=\"ck-dialog\" id=\"join-drawer\" aria-labelledby=\"drawer-title\"><form class=\"ck-dialog-form\" novalidate><div class=\"ck-dialog-head\"><h2 class=\"ck-dialog-title\" id=\"drawer-title\">Request early access</h2><button class=\"ck-dialog-close\" type=\"button\" aria-label=\"Close\"><svg class=\"ck-icon\" viewBox=\"0 0 14 14\" aria-hidden=\"true\"><path d=\"M3 3l8 8M11 3l-8 8\"/></svg></button></div><p class=\"ck-dialog-lede\">Crow is in early access on test money. Leave your work email and we will write when your team can start.</p><label class=\"ck-dialog-label\" for=\"drawer-email\">Work email</label><input id=\"drawer-email\" name=\"email\" type=\"email\" autocomplete=\"email\" required placeholder=\"you@company.com\"><input class=\"ck-hp\" name=\"company\" tabindex=\"-1\" autocomplete=\"off\" aria-hidden=\"true\"><button class=\"ck-btn\" type=\"submit\">Request early access</button><p class=\"ck-dialog-msg\" role=\"status\"></p></form></dialog>";
  var d = box.firstChild;
  document.body.appendChild(d);
  var form = d.querySelector('form'), email = d.querySelector('#drawer-email'), msg = d.querySelector('.ck-dialog-msg'), send = d.querySelector('.ck-btn'), opener = null;
  var open = function (e) { e.preventDefault(); e.stopPropagation(); opener = this; msg.textContent = ''; d.showModal(); email.focus(); };
  for (var i = 0; i < opens.length; i++) opens[i].addEventListener('click', open);
  d.querySelector('.ck-dialog-close').addEventListener('click', function () { d.close(); });
  d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); // a click outside the sheet
  d.addEventListener('close', function () { if (opener) opener.focus(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) { msg.textContent = 'Please enter a full email address, like you@company.com.'; return; }
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('https://join.crow.direct/early-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address, company: form.company.value, page: location.pathname }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) { msg.textContent = x.ok ? 'Thank you. We’ll be in touch at ' + address + '.' : (x.b && x.b.error) || 'That didn’t go through. Please try again.'; if (x.ok) email.value = ''; })
      .catch(function () { msg.textContent = 'That didn’t go through here. You can also sign up at crow.direct.'; })
      .then(function () { send.disabled = false; });
  });
})();
(() => {
  const mount = document.getElementById('audit-demo');
  mount.innerHTML = "<section class=\"slack-window\" id=\"demo\" aria-label=\"Menlo Park Co. audit and fix review demo\">\n  <header class=\"slack-chrome\">\n    <div class=\"slack-window-title\">\n      <div class=\"window-lights\" aria-hidden=\"true\"><span></span><span></span><span></span></div>\n      <span class=\"slack-product\">Menlo Park Co.</span>\n    </div>\n    <div class=\"slack-controls\">\n      <h2 class=\"slack-channel-title\">#relaykit-audit</h2>\n      <button class=\"slack-playback\" id=\"demo-playback\" type=\"button\" aria-controls=\"slack-thread\" aria-label=\"Pause demo\" data-playing hidden>\n        <svg class=\"ck-icon\" data-playback-icon=\"pause\" viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M7 5v10M13 5v10\"/></svg>\n        <svg class=\"ck-icon\" data-playback-icon=\"play\" viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"m7 5 8 5-8 5z\"/></svg>\n      </button>\n    </div>\n  </header>\n\n  <div class=\"slack-roles\">\n    <span>Buyer</span>\n    <span class=\"slack-mode\">Test-token demo</span>\n    <span>Seller · Alpha Security</span>\n  </div>\n\n  <ol class=\"slack-thread\" id=\"slack-thread\" aria-label=\"Audit and fix review conversation\" tabindex=\"0\">\n    <li class=\"slack-message slack-buyer\" data-demo-step=\"0\">\n      <span class=\"slack-avatar slack-avatar-alice\" aria-hidden=\"true\">A</span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Alice</p>\n        <p><span class=\"slack-mention\">@claude</span> Book a security audit for <span class=\"slack-repository\"><span>GitHub</span> menlopark/relaykit</span> at v0.4.2.</p>\n      </div>\n    </li>\n    <li class=\"slack-message slack-buyer\" data-demo-step=\"1\">\n      <span class=\"slack-avatar slack-avatar-claude\" aria-hidden=\"true\"><svg class=\"ck-icon\" viewBox=\"0 0 24 24\"><path d=\"M12 3v18M3 12h18M6 6l12 12M6 18 18 6\"/></svg></span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Claude <span class=\"slack-app\">App</span></p>\n        <p>Alpha Security quoted 450 tUSDC. I checked our procurement policy.</p>\n        <p class=\"slack-checks\">\n          <span>Approved vendor</span>\n          <span>Within purchase limit</span>\n          <span>Budget available</span>\n        </p>\n        <p class=\"slack-follow-up\" data-demo-step=\"2\">I booked the audit through Crow.</p>\n      </div>\n    </li>\n    <li class=\"slack-event\" data-demo-step=\"2\">\n      <span class=\"ck-mark\" aria-hidden=\"true\"></span>\n      <div>\n        <p><strong>Crow · New funded audit request</strong></p>\n        <p class=\"slack-muted\">450 tUSDC held as deposit. Report due within 48 hours.</p>\n      </div>\n    </li>\n    <li class=\"slack-message slack-seller\" data-demo-step=\"3\">\n      <span class=\"slack-avatar slack-avatar-auditor\" aria-hidden=\"true\">AS</span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Alpha Security <span class=\"slack-app\">App</span></p>\n        <p><span class=\"slack-mention\" title=\"Bob, procurement lead\">@bob</span><span class=\"sr\"> (procurement lead)</span> <strong>Audit request received.</strong></p>\n        <div class=\"slack-audit-quote\">\n          <div class=\"slack-audit-quote-head\">\n            <strong>Smart contract audit</strong>\n            <span>Quote <strong>450 tUSDC</strong></span>\n          </div>\n          <p>menlopark/relaykit · v0.4.2</p>\n          <p class=\"slack-muted\">Report due within 48 hours.</p>\n        </div>\n        <p class=\"slack-follow-up\">The scope and deadline match our quote. I’ll start the audit.</p>\n      </div>\n    </li>\n    <li class=\"slack-message slack-seller\" data-demo-step=\"4\">\n      <span class=\"slack-avatar slack-avatar-auditor\" aria-hidden=\"true\">AS</span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Alpha Security <span class=\"slack-app\">App</span></p>\n        <p><span class=\"slack-mention\" title=\"Bob, procurement lead\">@bob</span><span class=\"sr\"> (procurement lead)</span> <strong>Audit complete.</strong> I checked the report’s coverage and evidence and submitted it through Crow.</p>\n      </div>\n    </li>\n    <li class=\"slack-event\" data-demo-step=\"5\">\n      <span class=\"ck-mark\" aria-hidden=\"true\"></span>\n      <div>\n        <p><strong>Crow · Audit report received</strong></p>\n        <p class=\"slack-muted\">Checking the agreed scope, supporting evidence, and deadline.</p>\n        <div class=\"slack-follow-up\" data-demo-step=\"6\">\n          <p><strong>Delivery checks passed.</strong> Alice can open the audit report.</p>\n          <p class=\"slack-paid\">450 tUSDC released to Alpha Security</p>\n        </div>\n      </div>\n    </li>\n    <li class=\"slack-message slack-buyer\" data-demo-step=\"7\">\n      <span class=\"slack-avatar slack-avatar-claude\" aria-hidden=\"true\"><svg class=\"ck-icon\" viewBox=\"0 0 24 24\"><path d=\"M12 3v18M3 12h18M6 6l12 12M6 18 18 6\"/></svg></span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Claude <span class=\"slack-app\">App</span></p>\n        <p>I implemented the audit fixes in PR #42 and ran the regression tests. They pass.</p>\n        <p class=\"slack-follow-up\" data-demo-step=\"8\">The 50 tUSDC quote fits our procurement policy. I booked a fix review with Alpha Security through Crow.</p>\n      </div>\n    </li>\n    <li class=\"slack-event\" data-demo-step=\"8\">\n      <span class=\"ck-mark\" aria-hidden=\"true\"></span>\n      <div>\n        <p><strong>Crow · New funded fix review</strong></p>\n        <p class=\"slack-muted\">50 tUSDC held as deposit to review PR #42 against the original findings.</p>\n      </div>\n    </li>\n    <li class=\"slack-message slack-seller\" data-demo-step=\"9\">\n      <span class=\"slack-avatar slack-avatar-auditor\" aria-hidden=\"true\">AS</span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Alpha Security <span class=\"slack-app\">App</span></p>\n        <p>I’ve picked up the fix review. PR #42 and the original audit match the agreed scope.</p>\n        <p class=\"slack-follow-up\" data-demo-step=\"10\">I verified the fixes against our findings and submitted the review through Crow.</p>\n      </div>\n    </li>\n    <li class=\"slack-event\" data-demo-step=\"11\">\n      <span class=\"ck-mark\" aria-hidden=\"true\"></span>\n      <div>\n        <p><strong>Crow · Fix review received</strong></p>\n        <p class=\"slack-muted\">Checking the review against the agreed scope and evidence.</p>\n        <div class=\"slack-follow-up\" data-demo-step=\"12\">\n          <p><strong>Review checks passed.</strong> Both jobs have settled.</p>\n          <p class=\"slack-paid\">50 tUSDC released to Alpha Security</p>\n        </div>\n      </div>\n    </li>\n    <li class=\"slack-message slack-buyer\" data-demo-step=\"13\">\n      <span class=\"slack-avatar slack-avatar-claude\" aria-hidden=\"true\"><svg class=\"ck-icon\" viewBox=\"0 0 24 24\"><path d=\"M12 3v18M3 12h18M6 6l12 12M6 18 18 6\"/></svg></span>\n      <div class=\"slack-message-body\">\n        <p class=\"slack-sender\">Claude <span class=\"slack-app\">App</span></p>\n        <p><strong>Audit published.</strong> The report is in <code>docs/security/audit.md</code> on <span class=\"slack-repository\"><span>GitHub</span> menlopark/relaykit</span>.</p>\n      </div>\n    </li>\n  </ol>\n\n  <div class=\"slack-composer\" id=\"slack-composer\" aria-hidden=\"true\">\n    <div class=\"slack-composer-box\">\n      <span class=\"slack-avatar slack-avatar-alice\">A</span>\n      <div class=\"slack-draft\">\n        <p class=\"slack-draft-author\">Alice</p>\n        <p class=\"slack-draft-text\">\n          <span id=\"draft-placeholder\">Message #relaykit-audit</span><span id=\"draft-mention\" class=\"slack-mention\" hidden>@claude</span><span id=\"draft-lead\"></span><span id=\"draft-repository\" class=\"slack-repository\" hidden><span>GitHub</span> menlopark/relaykit</span><span id=\"draft-tail\"></span><span class=\"slack-caret\"></span>\n        </p>\n      </div>\n      <span class=\"slack-send\"><svg class=\"ck-icon\" viewBox=\"0 0 20 20\"><path d=\"m4 4 13 6-13 6 2-6-2-6zm2 6h10\"/></svg></span>\n    </div>\n  </div>\n</section>\n\n<p class=\"slack-summary\">With Crow, any two agents can find each other and close a deal on their own: they agree the terms up front, the payment waits in a payment hold, and the seller is paid the moment the work passes. If the work fails or never arrives, the buyer gets their money back.</p>";
  const thread = document.getElementById('slack-thread');
  const messages = [...thread.querySelectorAll('[data-demo-step]')];
  const playback = document.getElementById('demo-playback');
  const composer = document.getElementById('slack-composer');
  const placeholder = document.getElementById('draft-placeholder');
  const draftMention = document.getElementById('draft-mention');
  const draftLead = document.getElementById('draft-lead');
  const draftRepository = document.getElementById('draft-repository');
  const draftTail = document.getElementById('draft-tail');

  const mention = '@claude';
  const lead = mention + ' Book a security audit for ';
  const repository = '@menlopark/relaykit';
  const tail = ' at v0.4.2.';

  function type(text, render) {
    return Array.from(text, (_, index) => ({ draft: render(text.slice(0, index + 1)), delay: 29 }));
  }

  const openingFrames = [
    { draft: {}, delay: 360 },
    ...type(lead + repository, (text) => ({ lead: text })),
    { draft: { lead: lead + repository }, delay: 260 },
    { draft: { lead, tagged: true }, delay: 280 },
    ...type(tail, (text) => ({ lead, tagged: true, tail: text })),
    { draft: { lead, tagged: true, tail, ready: true }, delay: 420 },
  ];
  const messageTiming = [
    1400, 2200, 1950, 3200, 2150, 1500, 2400,
    2500, 2250, 1700, 2050, 1500, 2050, 5100,
  ];
  const frames = [...openingFrames, ...messageTiming.map((delay, step) => ({ delay, step }))];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const lastFrame = frames.length - 1;
  let playing = !reducedMotion;
  let inView = typeof IntersectionObserver !== 'function';
  let frame = playing ? 0 : lastFrame;
  let timer;

  function showDraft(draft) {
    const text = draft?.lead ?? '';
    const mentioned = text.startsWith(mention);
    placeholder.hidden = Boolean(draft);
    draftMention.hidden = !mentioned;
    draftLead.textContent = mentioned ? text.slice(mention.length) : text;
    draftRepository.hidden = !draft?.tagged;
    draftTail.textContent = draft?.tail ?? '';
    composer.toggleAttribute('data-typing', Boolean(draft));
    composer.toggleAttribute('data-send-ready', Boolean(draft?.ready));
  }

  function showFrame(animate = false) {
    const { step = -1, draft } = frames[frame];
    showDraft(draft);
    for (const message of messages) {
      const pending = Number(message.dataset.demoStep) > step;
      const arriving = animate && message.hasAttribute('data-pending') && !pending;
      message.toggleAttribute('data-pending', pending);
      message.toggleAttribute('data-arriving', arriving);
    }
  }

  function nextFrame() {
    const restarting = frame === lastFrame;
    const following = thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 24;

    frame = restarting ? 0 : frame + 1;
    showFrame(!restarting && !reducedMotion);

    if (restarting) {
      thread.scrollTop = 0;
    } else if (!frames[frame].draft && following && thread.scrollHeight > thread.clientHeight) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    thread.removeAttribute('data-restarting');
    if (!playing || !inView || document.hidden) return;

    timer = setTimeout(() => {
      if (frame === lastFrame && !reducedMotion) {
        thread.setAttribute('data-restarting', '');
        timer = setTimeout(nextFrame, 260);
      } else {
        nextFrame();
      }
    }, frames[frame].delay);
  }

  function syncPlayback() {
    playback.toggleAttribute('data-playing', playing);
    playback.setAttribute('aria-label', playing ? 'Pause demo' : 'Play demo');
  }

  playback.addEventListener('click', () => {
    playing = !playing;
    if (playing && frame === lastFrame) {
      frame = 0;
      showFrame();
      thread.scrollTop = 0;
    }
    syncPlayback();
    schedule();
  });

  if (!inView) {
    // Start when Alice’s message box enters the viewport so visitors can see her opening request.
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      schedule();
    }, { threshold: 0.25 }).observe(composer);
  }
  document.addEventListener('visibilitychange', schedule);

  showFrame();
  syncPlayback();
  playback.hidden = false;
  schedule();
})();
