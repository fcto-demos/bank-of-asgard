// The Ministry of Finance's home page, with the officer workspace where a tax officer reviews the
// evidence for provisional reliefs. Served by this agent at /tax-agent/inbox, because it belongs
// to the ministry, not to the bank. The page signs the officer in at the identity provider
// (authorization code + PKCE, public client `expectedAudience`, scope `officerScope`) and calls
// the officer API with their own token. Claims are built from each run's recorded input, and a
// claim disappears on its own once it is decided or its deadline passes. The public parts (tax
// year, deadline, published reliefs) come from /inbox/config, so they always match the rules the
// agent applies.
//
// Laid out like the Bank of Asgard's home page (utility bar, masthead, hero with a side panel,
// titled bands, dark footer) under the ministry's own identity: navy and brass, and an emblem
// drawn inline so the page needs no image files.
//
// Embedded rather than read from a file so it ships inside the agent wherever it is deployed.
// The page avoids backticks and dollar-brace sequences, which a Ballerina string template
// would take as its own syntax.
const string INBOX_PAGE = string `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ministry of Finance</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='23' fill='%2316324f'/%3E%3Cpath d='M24 12v22M13 17h22M17 34h14' stroke='%23d9b766' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #0e1a2b; --navy: #16324f; --navy-2: #1f4468; --brass: #a07a2c; --brass-light: #d9b766;
    --paper: #f7f5f0; --surface: #ffffff; --text: #1b2430; --muted: #5f6b78; --line: #e4dfd4;
    --accept: #1e6b47; --accept-bg: #e7f3ec; --reject: #9b3427; --reject-bg: #f8e9e6;
    --warn: #9a5b00; --warn-bg: #fdf1dc;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--surface); color: var(--text);
    font: 15px/1.6 Poppins, system-ui, -apple-system, "Segoe UI", sans-serif; }
  a { color: inherit; }
  .container { max-width: 1140px; margin: 0 auto; padding: 0 16px; }
  .num { font-variant-numeric: tabular-nums; }

  /* Utility bar and masthead */
  .utility { background: var(--ink); color: #c9d1db; font-size: 13px; }
  .utility .container { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 34px; }
  .utility .who { display: flex; align-items: center; gap: 0; }
  .utility .who span { padding: 0 12px; }
  .utility button, .utility a.signin { font: inherit; border: 0; cursor: pointer; padding: 7px 14px;
    background: var(--brass); color: #fff; text-decoration: none; }
  .masthead { background: var(--surface); border-bottom: 1px solid var(--line); }
  .masthead .container { display: flex; align-items: center; justify-content: space-between; gap: 20px;
    min-height: 82px; flex-wrap: wrap; padding-top: 8px; padding-bottom: 8px; }
  .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--navy); }
  .brand svg { width: 46px; height: 46px; color: var(--brass); flex: none; }
  .brand small { display: block; font-size: 11px; letter-spacing: 0.28em; color: var(--brass); line-height: 1.2; }
  .brand strong { display: block; font-size: 21px; letter-spacing: 0.12em; font-weight: 600; line-height: 1.2; }
  nav { display: flex; gap: 28px; flex-wrap: wrap; }
  nav a { text-decoration: none; font-size: 13px; font-weight: 500; text-transform: uppercase; color: var(--ink); line-height: 1.3; }
  nav a small { display: block; font-size: 10px; color: var(--muted); font-weight: 400; }
  nav a:hover { color: var(--brass); }

  /* Hero */
  .hero { display: grid; grid-template-columns: 3fr 1fr; min-height: 380px; }
  .hero-main { position: relative; overflow: hidden; color: #fff; padding: 64px 56px;
    background:
      radial-gradient(circle at 78% 40%, rgba(217, 183, 102, 0.35), transparent 42%),
      radial-gradient(circle at 10% 110%, rgba(160, 122, 44, 0.45), transparent 45%),
      linear-gradient(120deg, var(--ink) 0%, var(--navy) 55%, var(--navy-2) 100%); }
  .hero-main::after { content: ""; position: absolute; inset: 0; opacity: 0.07; pointer-events: none;
    background: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 22px); }
  .hero-main > :not(.hero-emblem) { position: relative; z-index: 1; }
  .hero-emblem { position: absolute; right: 6%; top: 50%; transform: translateY(-50%); width: 300px; height: 300px;
    color: var(--brass-light); opacity: 0.28; }
  .eyebrow { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--brass-light); }
  .hero h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.25; font-weight: 600; text-transform: uppercase; max-width: 560px; }
  .hero h1 span { color: var(--brass-light); }
  .hero p.lead { margin: 0 0 30px; max-width: 470px; color: #dfe5ec; font-size: 15px; }
  .btns { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn { display: inline-block; font: 500 14px Poppins, system-ui, sans-serif; padding: 10px 30px; border: 0;
    text-decoration: none; cursor: pointer; }
  .btn-light { background: #fff; color: var(--ink); }
  .btn-brass { background: var(--brass); color: #fff; }
  .hero-side { background: var(--ink); color: #fff; padding: 40px 28px; display: flex; flex-direction: column; justify-content: center; }
  .hero-side h2 { margin: 0 0 6px; font-size: 22px; font-weight: 500; line-height: 1.25; }
  .hero-side p { margin: 0; font-size: 13.5px; color: #c9d1db; }
  .hero-side hr { border: 0; border-top: 1px solid #ffffff55; margin: 22px 0; }

  /* Bands and section titles */
  .band { padding: 64px 0; }
  .band.paper { background: var(--paper); }
  .band.dark { background: #1f2124; color: #fff; }
  .title { margin: 0 0 6px; text-align: center; font-size: 26px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .title::after { content: ""; display: block; width: 46px; height: 3px; background: var(--brass); margin: 12px auto 0; }
  .subtitle { text-align: center; color: var(--muted); max-width: 720px; margin: 14px auto 34px; }
  .band.dark .subtitle { color: #c4c8ce; }

  /* Officer workspace */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--brass); padding: 14px 16px; }
  .stat small { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .stat strong { font-size: 20px; font-weight: 600; }
  .panel { background: var(--surface); border: 1px solid var(--line); box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 4px 20px rgba(0,0,0,.06); }
  .signin-card { max-width: 520px; margin: 0 auto; padding: 36px 32px; text-align: center; border-top: 3px solid var(--brass); }
  .signin-card svg { width: 54px; height: 54px; color: var(--brass); }
  .signin-card h3 { margin: 10px 0 6px; font-size: 19px; font-weight: 600; }
  .signin-card p { color: var(--muted); margin: 0 0 22px; }
  .empty { padding: 44px 20px; text-align: center; color: var(--muted); }
  .empty strong { display: block; color: var(--text); font-size: 17px; font-weight: 600; margin-bottom: 4px; }

  .claim { margin-bottom: 26px; border-top: 3px solid var(--navy); }
  .claim-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; padding: 18px 22px 14px; }
  .claim-head h3 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.02em; }
  .claim-head .ref small { display: block; font-size: 11px; color: var(--brass); letter-spacing: 0.18em; text-transform: uppercase; }
  .claim-meta { color: var(--muted); font-size: 13px; margin-top: 2px; }
  .clock { min-width: 210px; text-align: right; }
  .clock .left { display: inline-block; font-weight: 600; color: var(--warn); background: var(--warn-bg); padding: 3px 10px; font-size: 14px; }
  .clock .left.urgent { color: var(--reject); background: var(--reject-bg); }
  .clock .bar { height: 4px; background: var(--line); margin-top: 8px; }
  .clock .bar span { display: block; height: 100%; background: var(--warn); transition: width 1s linear; }
  .clock small { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }

  .section-label { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 0 0 10px; }
  .under-review { padding: 18px 22px; background: var(--paper); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .relief { display: grid; grid-template-columns: 1.4fr repeat(4, 1fr); gap: 14px; align-items: end; }
  .relief + .relief { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line); }
  .relief .name { font-size: 17px; font-weight: 600; }
  .relief .name small { display: block; font-size: 12px; font-weight: 400; color: var(--muted); }
  .fig small { display: block; font-size: 11.5px; color: var(--muted); }
  .fig strong { font-size: 17px; font-weight: 600; }
  .fig.key strong { color: var(--brass); font-size: 20px; }
  .evidence-note { margin: 14px 0 0; font-size: 13px; color: var(--muted); }

  .outcomes { display: grid; grid-template-columns: 1fr 1fr; }
  .outcome { padding: 18px 22px; }
  .outcome + .outcome { border-left: 1px solid var(--line); }
  .outcome h4 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
  .outcome.accept h4 { color: var(--accept); }
  .outcome.reject h4 { color: var(--reject); }
  .outcome p { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
  .outcome .due { font-size: 22px; font-weight: 600; }
  .outcome .delta { font-size: 13px; font-weight: 600; color: var(--reject); margin-left: 6px; }

  details.filed { border-top: 1px solid var(--line); }
  details.filed summary { cursor: pointer; padding: 12px 22px; font-size: 13px; font-weight: 500; color: var(--navy); }
  details.filed .inner { padding: 0 22px 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 600; border-bottom: 0; }
  .tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; }
  .tag.prov { background: var(--warn-bg); color: var(--warn); }
  .tag.ok { background: var(--accept-bg); color: var(--accept); }

  .decision { padding: 18px 22px 22px; border-top: 1px solid var(--line); }
  .declaration { display: flex; gap: 10px; align-items: flex-start; background: var(--paper); border: 1px solid var(--line);
    padding: 12px 14px; font-size: 13.5px; margin-bottom: 12px; cursor: pointer; }
  .declaration input { margin-top: 4px; accent-color: var(--navy); width: 16px; height: 16px; flex: none; }
  textarea { width: 100%; font: inherit; font-size: 14px; padding: 9px 10px; border: 1px solid var(--line);
    background: var(--surface); color: var(--text); min-height: 56px; margin-bottom: 12px; resize: vertical; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .actions .btn:disabled { opacity: 0.45; cursor: default; }
  .btn-accept { background: var(--accept); color: #fff; }
  .btn-reject { background: var(--surface); color: var(--reject); box-shadow: inset 0 0 0 1px var(--reject); }
  .signature { margin-left: auto; font-size: 12px; color: var(--muted); text-align: right; }

  /* How it works, reliefs, footer */
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
  .step { background: #fff; color: var(--text); padding: 26px 24px; }
  .step .n { width: 38px; height: 38px; border: 2px solid var(--brass); color: var(--brass); display: grid; place-items: center;
    font-weight: 600; margin-bottom: 14px; }
  .step h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; text-transform: uppercase; }
  .step p { margin: 0; font-size: 14px; color: var(--muted); }
  .reliefs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
  .rule { border: 1px solid var(--line); background: var(--surface); padding: 22px 20px; border-bottom: 3px solid var(--line); }
  .rule.evidence { border-bottom-color: var(--brass); }
  .rule h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; min-height: 44px; }
  .rule .rate { font-size: 30px; font-weight: 600; color: var(--navy); line-height: 1; }
  .rule .rate small { font-size: 13px; color: var(--muted); font-weight: 400; }
  .rule p { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
  footer { background: #1f2124; color: #d0d3d8; padding: 48px 0 30px; font-size: 13.5px; }
  footer .cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
  footer h4 { color: #fff; font-size: 17px; font-weight: 500; margin: 0 0 12px; }
  footer p { margin: 0 0 4px; }

  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #fff;
    padding: 10px 18px; font-size: 14px; display: none; max-width: 90vw; border-left: 3px solid var(--brass); z-index: 10; }

  @media (max-width: 900px) {
    .hero { grid-template-columns: 1fr; }
    .hero-main { padding: 44px 24px; }
    .hero-emblem { width: 200px; height: 200px; right: -30px; }
    .hero h1 { font-size: 26px; }
    .stats, .reliefs { grid-template-columns: repeat(2, 1fr); }
    .steps, footer .cols { grid-template-columns: 1fr; }
    .relief { grid-template-columns: repeat(2, 1fr); }
    .relief .name { grid-column: 1 / -1; }
    nav { gap: 16px; }
  }
  @media (max-width: 600px) {
    .outcomes { grid-template-columns: 1fr; }
    .outcome + .outcome { border-left: 0; border-top: 1px solid var(--line); }
    .clock { text-align: left; min-width: 0; }
    .signature { margin-left: 0; text-align: left; width: 100%; }
    .utility .tagline { display: none; }
  }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="emblem" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="22.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="0.7" stroke-dasharray="1.4 1.8"/>
    <path d="M24 11.5v22.5M14.5 16.5h19M18 34h12M22 11.5h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M14.5 16.5l-4 8.5M14.5 16.5l4 8.5M33.5 16.5l-4 8.5M33.5 16.5l4 8.5" fill="none" stroke="currentColor" stroke-width="1.1"/>
    <path d="M10.2 25h8.6a4.3 2.6 0 0 1-8.6 0zM29.2 25h8.6a4.3 2.6 0 0 1-8.6 0z" fill="currentColor"/>
  </symbol>
</svg>

<div class="utility">
  <div class="container">
    <span class="tagline">An official service of the Realm of Asgard</span>
    <div class="who" id="who"></div>
  </div>
</div>

<header class="masthead">
  <div class="container">
    <a class="brand" href="#top" aria-label="Ministry of Finance, home">
      <svg><use href="#emblem"/></svg>
      <span><small>REALM OF ASGARD</small><strong>MINISTRY OF FINANCE</strong></span>
    </a>
    <nav aria-label="Main">
      <a href="#how">Income tax<small>How returns are decided</small></a>
      <a href="#reliefs">Reliefs<small>What you can claim</small></a>
      <a href="#review">Evidence review<small>Tax officers</small></a>
      <a href="#contact">Contact<small>Offices and help</small></a>
    </nav>
  </div>
</header>

<section class="hero" id="top">
  <div class="hero-main">
    <svg class="hero-emblem" aria-hidden="true"><use href="#emblem"/></svg>
    <p class="eyebrow" id="hero-year">Tax year</p>
    <h1>File your return from your bank.<br><span>Reviewed by people.</span></h1>
    <p class="lead">Your bank's assistant shares only your income and relief totals, never your transactions.
      You sign the return yourself, and the ministry files it at once.</p>
    <div class="btns">
      <a class="btn btn-light" href="#reliefs">Reliefs</a>
      <a class="btn btn-brass" href="#review">Officer workspace</a>
    </div>
  </div>
  <aside class="hero-side">
    <div>
      <h2>Filing deadline</h2>
      <p id="hero-deadline">Returns for the tax year are due by the filing deadline.</p>
    </div>
    <hr>
    <div>
      <h2>Provisional reliefs</h2>
      <p id="hero-review">Reliefs that need evidence are granted when you file, then confirmed by a tax officer.</p>
    </div>
  </aside>
</section>

<section class="band paper" id="review">
  <div class="container">
    <h2 class="title">Evidence review</h2>
    <p class="subtitle">Each claim below was filed with a relief that needs evidence. Check it, then accept or reject it
      before the deadline. A claim nobody reviews in time is withdrawn automatically and the return is amended.</p>
    <div class="stats" id="stats" hidden></div>
    <div id="content"><div class="panel empty">Loading&hellip;</div></div>
  </div>
</section>

<section class="band dark" id="how">
  <div class="container">
    <h2 class="title">How a provisional relief is decided</h2>
    <p class="subtitle">The ministry's agent runs each return as a durable workflow: it waits for the officer as long as the
      deadline allows, survives restarts, and files and amends exactly once.</p>
    <div class="steps">
      <div class="step"><div class="n">1</div><h3>Filed at once</h3>
        <p>The citizen signs and the return is filed. Reliefs that need evidence are granted provisionally.</p></div>
      <div class="step"><div class="n">2</div><h3>Officer review</h3>
        <p>A tax officer checks the evidence here and records a signed decision before the deadline.</p></div>
      <div class="step"><div class="n">3</div><h3>Confirmed or amended</h3>
        <p>Accepted, the relief stands. Rejected or not reviewed in time, it is withdrawn and the return amended automatically.</p></div>
    </div>
  </div>
</section>

<section class="band" id="reliefs">
  <div class="container">
    <h2 class="title" id="reliefs-title">Reliefs</h2>
    <p class="subtitle">A relief deducts a share of your qualifying spend from your taxable income, up to a cap.
      Reliefs marked with evidence are reviewed by an officer after filing.</p>
    <div class="reliefs" id="reliefs-list"></div>
  </div>
</section>

<footer id="contact">
  <div class="container cols">
    <div><h4>Ministry of Finance</h4><p>Realm of Asgard</p><p id="footer-year"></p></div>
    <div><h4>Services</h4><p>Income tax returns</p><p>Reliefs and allowances</p><p>Evidence review</p></div>
    <div><h4>Contact</h4><p>Hall of Revenues, Gladsheim</p><p>Mon&ndash;Fri, 9:00&ndash;17:00</p></div>
    <div><h4>Your data</h4><p>The ministry receives only totals from your bank, and only with your consent.</p></div>
  </div>
</footer>
<div class="toast" id="toast" role="status"></div>

<script>
(function () {
  var TOKEN_KEY = "ministryInbox.token";
  var NAME_KEY = "ministryInbox.name";
  var VERIFIER_KEY = "ministryInbox.verifier";
  var STATE_KEY = "ministryInbox.state";
  var redirectUri = location.origin + location.pathname;
  var apiBase = location.pathname.replace(/\/inbox\/?$/, "");
  var config = null;
  var deciding = {};
  var drafts = {};
  var claimsCache = [];
  var renderedKey = null;

  function store(key, value) { try { if (value === null) { sessionStorage.removeItem(key); } else { sessionStorage.setItem(key, value); } } catch (e) {} }
  function load(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function esc(text) { var div = document.createElement("div"); div.textContent = String(text); return div.innerHTML; }
  function el(id) { return document.getElementById(id); }
  function toast(text) {
    var box = el("toast"); box.textContent = text; box.style.display = "block";
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { box.style.display = "none"; }, 4000);
  }
  function base64Url(bytes) {
    var text = ""; for (var i = 0; i < bytes.length; i++) { text += String.fromCharCode(bytes[i]); }
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString() { var bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return base64Url(bytes); }
  function jwtPayload(token) {
    try { var part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(part)); }
    catch (e) { return {}; }
  }
  function money(value) { return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function percent(rate) { return Math.round(Number(rate) * 100) + "%"; }
  function longDate(iso) { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); }
  function dateTime(iso) { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function officerName() { return load(NAME_KEY) || "officer"; }

  // --- Public content, from the agent's own rules ---

  function renderPublic() {
    el("hero-year").textContent = "Tax year " + config.taxYear;
    el("hero-deadline").textContent = "Returns for " + config.taxYear + " are due by " + longDate(config.filingDeadline) + ".";
    el("hero-review").textContent = "Reliefs that need evidence are granted when you file, then confirmed by a tax officer within " +
      config.reviewDeadlineMinutes + " minute" + (config.reviewDeadlineMinutes === 1 ? "" : "s") + ".";
    el("reliefs-title").textContent = "Reliefs for " + config.taxYear;
    el("footer-year").textContent = "Tax year " + config.taxYear;
    el("reliefs-list").innerHTML = config.reliefs.map(function (rule) {
      return "<div class=\"rule" + (rule.evidenceRequired ? " evidence" : "") + "\"><h3>" + esc(rule.label) + "</h3>" +
        "<div class=\"rate\">" + percent(rule.rate) + " <small>of spend</small></div>" +
        "<p>Up to " + money(rule.cap) + " a year." + (rule.evidenceRequired ?
          " <span class=\"tag prov\">Evidence reviewed</span>" : " <span class=\"tag ok\">Granted on filing</span>") + "</p></div>";
    }).join("");
  }

  // --- Sign-in ---

  function renderWho() {
    var who = el("who");
    if (!load(TOKEN_KEY)) {
      who.innerHTML = "<a class=\"signin\" href=\"#review\" id=\"who-signin\">Officer sign-in</a>";
      el("who-signin").onclick = function (e) { e.preventDefault(); signIn(); };
      return;
    }
    who.innerHTML = "<span>Signed in as " + esc(officerName()) + "</span>";
    var button = document.createElement("button"); button.textContent = "Sign out";
    button.onclick = function () { store(TOKEN_KEY, null); store(NAME_KEY, null); renderSignIn(); };
    who.appendChild(button);
  }

  function renderSignIn(message) {
    renderWho();
    el("stats").hidden = true;
    renderedKey = null;
    el("content").innerHTML = "<div class=\"panel signin-card\"><svg aria-hidden=\"true\"><use href=\"#emblem\"/></svg>" +
      "<h3>Officer sign-in</h3><p>" + esc(message || "Sign in with your ministry account to review the evidence for provisional reliefs.") +
      "</p><button class=\"btn btn-brass\" id=\"signin\">Sign in</button></div>";
    el("signin").onclick = signIn;
  }

  async function signIn() {
    var verifier = randomString();
    var state = randomString();
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    store(VERIFIER_KEY, verifier); store(STATE_KEY, state);
    var params = new URLSearchParams({
      response_type: "code", client_id: config.clientId, redirect_uri: redirectUri,
      scope: "openid profile " + config.scope, state: state,
      code_challenge: base64Url(new Uint8Array(digest)), code_challenge_method: "S256",
      // Always show the login form: in a demo the same browser is often signed in at the
      // identity provider as the citizen, and that session would sign the officer in silently.
      prompt: "login"
    });
    location.assign(config.idpBaseUrl + "/oauth2/authorize?" + params.toString());
  }

  async function finishSignIn(code, state) {
    history.replaceState(null, "", redirectUri + "#review");
    if (state !== load(STATE_KEY)) { renderSignIn("Sign-in failed: unexpected state. Please try again."); return false; }
    var body = new URLSearchParams({
      grant_type: "authorization_code", code: code, redirect_uri: redirectUri,
      client_id: config.clientId, code_verifier: load(VERIFIER_KEY) || ""
    });
    store(VERIFIER_KEY, null); store(STATE_KEY, null);
    var response = await fetch(config.idpBaseUrl + "/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body
    });
    if (!response.ok) {
      var detail = "";
      try { var failure = await response.json(); detail = failure.error_description || failure.error || ""; } catch (e) {}
      renderSignIn("Sign-in failed at the identity provider (HTTP " + response.status + (detail ? ": " + detail : "") + "). Please try again.");
      return false;
    }
    var tokens = await response.json();
    var identity = jwtPayload(tokens.id_token || tokens.access_token);
    var fullName = [identity.given_name, identity.family_name].filter(Boolean).join(" ");
    store(TOKEN_KEY, tokens.access_token);
    store(NAME_KEY, fullName || identity.username || identity.email || identity.sub || "officer");
    el("review").scrollIntoView();
    return true;
  }

  async function api(path, options) {
    var init = options || {};
    init.headers = Object.assign({ Authorization: "Bearer " + load(TOKEN_KEY) }, init.headers || {});
    var response = await fetch(apiBase + path, init);
    if (response.status === 401) { store(TOKEN_KEY, null); renderSignIn("Your session has ended. Please sign in again."); throw new Error("signed out"); }
    if (response.status === 403) { throw new Error("forbidden"); }
    if (!response.ok) { throw new Error("HTTP " + response.status); }
    return response.status === 202 ? null : response.json();
  }

  // --- The officer's claims ---

  function secondsLeft(deadline) { return Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)); }
  function timeLeft(deadline) {
    var seconds = secondsLeft(deadline);
    if (seconds === 0) { return "Deadline reached"; }
    var minutes = Math.floor(seconds / 60);
    return (minutes > 0 ? minutes + " min " : "") + (seconds % 60) + " s left";
  }
  function share(claim) {
    var total = new Date(claim.deadline).getTime() - new Date(claim.openedAt).getTime();
    return total > 0 ? Math.max(0, Math.min(100, (new Date(claim.deadline).getTime() - Date.now()) / total * 100)) : 0;
  }

  function renderStats() {
    var stats = el("stats");
    stats.hidden = false;
    var next = claimsCache.reduce(function (soonest, claim) {
      return soonest === null || claim.deadline < soonest ? claim.deadline : soonest;
    }, null);
    var atStake = claimsCache.reduce(function (sum, claim) { return sum + Number(claim.additionalTaxIfWithdrawn); }, 0);
    stats.innerHTML =
      "<div class=\"stat\"><small>Claims waiting</small><strong>" + claimsCache.length + "</strong></div>" +
      "<div class=\"stat\"><small>Next deadline</small><strong data-deadline=\"" + esc(next || "") + "\">" + (next ? timeLeft(next) : "&ndash;") + "</strong></div>" +
      "<div class=\"stat\"><small>Tax at stake</small><strong class=\"num\">" + money(atStake) + "</strong></div>" +
      "<div class=\"stat\"><small>Review window</small><strong>" + config.reviewDeadlineMinutes + " min</strong></div>";
  }

  function claimCard(claim) {
    var draft = drafts[claim.taskId] || { note: "", confirmed: false };
    var busy = !!deciding[claim.taskId];
    var a = claim.assessment;
    var under = claim.claims.map(function (relief) {
      return "<div class=\"relief\">" +
        "<div class=\"name\">" + esc(relief.label) + "<small>Category total declared by the citizen's bank</small></div>" +
        "<div class=\"fig\"><small>Spend declared</small><strong class=\"num\">" + money(relief.qualifyingSpend) + "</strong></div>" +
        "<div class=\"fig\"><small>Rate</small><strong>" + percent(relief.rate) + "</strong></div>" +
        "<div class=\"fig\"><small>Annual cap</small><strong class=\"num\">" + money(relief.cap) + "</strong></div>" +
        "<div class=\"fig key\"><small>Relief claimed" + (relief.capped ? " (capped)" : "") + "</small><strong class=\"num\">" + money(relief.deduction) + "</strong></div>" +
        "</div>";
    }).join("");
    var rows = a.reliefs.map(function (relief) {
      return "<tr><td>" + esc(relief.label) + " " + (relief.evidenceRequired ? "<span class=\"tag prov\">Provisional</span>" : "<span class=\"tag ok\">Granted</span>") +
        "</td><td class=\"r\">" + money(relief.qualifyingSpend) + "</td><td class=\"r\">" + money(relief.deduction) + "</td></tr>";
    }).join("");
    var left = secondsLeft(claim.deadline);
    return "<article class=\"panel claim\" data-claim=\"" + esc(claim.taskId) + "\">" +
      "<div class=\"claim-head\"><div class=\"ref\"><small>Return under review</small><h3>" + esc(claim.filingReference) + "</h3>" +
        "<div class=\"claim-meta\">Citizen " + esc(claim.citizen.slice(0, 8)) + "&hellip; &middot; tax year " + a.taxYear +
        " &middot; filed " + esc(dateTime(claim.openedAt)) + "</div></div>" +
        "<div class=\"clock\"><span class=\"left" + (left < 60 ? " urgent" : "") + "\" data-deadline=\"" + esc(claim.deadline) + "\">" + timeLeft(claim.deadline) + "</span>" +
        "<div class=\"bar\"><span data-share=\"" + esc(claim.taskId) + "\" style=\"width:" + share(claim) + "%\"></span></div>" +
        "<small>Decide by " + esc(dateTime(claim.deadline)) + "</small></div></div>" +
      "<div class=\"under-review\"><p class=\"section-label\">Claim under review</p>" + under +
        "<p class=\"evidence-note\">The bank shared this as a category total, with the citizen's consent. The ministry holds no receipts, merchants or dates.</p></div>" +
      "<div class=\"outcomes\">" +
        "<div class=\"outcome accept\"><h4>If you accept</h4><p>The relief stands and the return is final.</p>" +
          "<span class=\"due num\">" + money(a.taxAfterReliefs) + "</span> <small>tax due</small></div>" +
        "<div class=\"outcome reject\"><h4>If you reject, or the deadline passes</h4><p>The relief is withdrawn and the return amended automatically.</p>" +
          "<span class=\"due num\">" + money(claim.taxIfWithdrawn) + "</span> <small>tax due</small>" +
          "<span class=\"delta num\">+" + money(claim.additionalTaxIfWithdrawn) + "</span></div>" +
      "</div>" +
      "<details class=\"filed\"><summary>The return as filed</summary><div class=\"inner\"><table>" +
        "<thead><tr><th>Relief</th><th class=\"r\">Spend</th><th class=\"r\">Relief</th></tr></thead><tbody>" + rows +
        "<tr class=\"total\"><td>Total deductions</td><td></td><td class=\"r\">" + money(a.totalDeductions) + "</td></tr></tbody></table>" +
        "<table style=\"margin-top:10px\"><tbody>" +
        "<tr><td>Gross income</td><td class=\"r\">" + money(a.grossIncome) + "</td></tr>" +
        "<tr><td>Taxable income</td><td class=\"r\">" + money(a.taxableIncome) + "</td></tr>" +
        "<tr><td>Tax before reliefs</td><td class=\"r\">" + money(a.taxBeforeReliefs) + "</td></tr>" +
        "<tr class=\"total\"><td>Tax due as filed</td><td class=\"r\">" + money(a.taxAfterReliefs) + "</td></tr>" +
        "</tbody></table></div></details>" +
      "<div class=\"decision\"><p class=\"section-label\">Your decision</p>" +
        "<label class=\"declaration\"><input type=\"checkbox\" data-confirm=\"" + esc(claim.taskId) + "\"" + (draft.confirmed ? " checked" : "") + (busy ? " disabled" : "") + ">" +
          "<span>I, <strong>" + esc(officerName()) + "</strong>, have examined the evidence for the claim above and record this decision on behalf of the Ministry of Finance.</span></label>" +
        "<textarea data-note=\"" + esc(claim.taskId) + "\" placeholder=\"Note for the record (optional)\"" + (busy ? " disabled" : "") + ">" + esc(draft.note) + "</textarea>" +
        "<div class=\"actions\">" +
          "<button class=\"btn btn-accept\" data-task=\"" + esc(claim.taskId) + "\" data-accept=\"true\"" + (busy || !draft.confirmed ? " disabled" : "") + ">Accept evidence</button>" +
          "<button class=\"btn btn-reject\" data-task=\"" + esc(claim.taskId) + "\" data-accept=\"false\"" + (busy || !draft.confirmed ? " disabled" : "") + ">Reject evidence</button>" +
          "<span class=\"signature\">Signed " + esc(officerName()) + "<br>" + esc(new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })) + "</span>" +
        "</div></div>" +
      "</article>";
  }

  // Rebuilt only when the set of claims changes, so a refresh never wipes a note being typed;
  // the countdowns are updated in place by tick().
  function renderClaims(force) {
    renderWho();
    renderStats();
    var key = claimsCache.map(function (claim) { return claim.taskId; }).join(",");
    if (!force && key === renderedKey) { return; }
    renderedKey = key;
    var content = el("content");
    if (claimsCache.length === 0) {
      content.innerHTML = "<div class=\"panel empty\"><strong>No claims waiting for review</strong>New claims appear here as soon as a return with a provisional relief is filed.</div>";
      return;
    }
    content.innerHTML = claimsCache.map(claimCard).join("");
    content.querySelectorAll("[data-confirm]").forEach(function (box) {
      box.onchange = function () {
        var id = box.getAttribute("data-confirm");
        drafts[id] = Object.assign(drafts[id] || { note: "" }, { confirmed: box.checked });
        content.querySelectorAll("button[data-task=\"" + id + "\"]").forEach(function (button) { button.disabled = !box.checked; });
      };
    });
    content.querySelectorAll("[data-note]").forEach(function (field) {
      field.oninput = function () {
        var id = field.getAttribute("data-note");
        drafts[id] = Object.assign(drafts[id] || { confirmed: false }, { note: field.value });
      };
    });
    content.querySelectorAll("button[data-task]").forEach(function (button) {
      button.onclick = function () { decide(button.getAttribute("data-task"), button.getAttribute("data-accept") === "true"); };
    });
  }

  async function decide(taskId, accepted) {
    var draft = drafts[taskId] || { note: "", confirmed: false };
    if (!draft.confirmed) { return; }
    deciding[taskId] = true; renderClaims(true);
    try {
      var review = { accepted: accepted };
      var note = (draft.note || "").trim();
      if (note) { review.note = note; }
      await api("/officer/claims/" + encodeURIComponent(taskId), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(review)
      });
      toast(accepted ? "Evidence accepted. The relief stands and the return is final." : "Evidence rejected. The return will be amended.");
      claimsCache = claimsCache.filter(function (claim) { return claim.taskId !== taskId; });
      delete drafts[taskId];
    } catch (e) {
      if (e.message === "forbidden") { toast("You can't review the evidence for your own return."); }
      else if (e.message !== "signed out") { toast("That decision didn't go through: the claim may have expired. Refreshing."); }
    }
    delete deciding[taskId];
    renderClaims(true);
    refresh();
  }

  async function refresh() {
    if (!load(TOKEN_KEY)) { return; }
    try {
      var result = await api("/officer/claims");
      claimsCache = result.claims;
      renderClaims(false);
    } catch (e) {
      if (e.message === "forbidden") {
        var who = officerName();
        store(TOKEN_KEY, null); store(NAME_KEY, null);
        renderSignIn(who + " isn't a tax officer: the token has no " + config.scope + " scope. Sign in with an officer account.");
      } else if (e.message !== "signed out" && claimsCache.length === 0) {
        renderWho();
        el("content").innerHTML = "<div class=\"panel empty\"><strong>The claims couldn't be loaded</strong>" + esc(e.message) +
          ". Retrying every few seconds.</div>";
        renderedKey = null;
      }
    }
  }

  function tick() {
    document.querySelectorAll("[data-deadline]").forEach(function (node) {
      var deadline = node.getAttribute("data-deadline");
      if (!deadline) { return; }
      node.textContent = timeLeft(deadline);
      if (node.classList.contains("left")) { node.classList.toggle("urgent", secondsLeft(deadline) < 60); }
    });
    claimsCache.forEach(function (claim) {
      var bar = document.querySelector("[data-share=\"" + claim.taskId + "\"]");
      if (bar) { bar.style.width = share(claim) + "%"; }
    });
  }

  async function start() {
    config = await (await fetch(apiBase + "/inbox/config")).json();
    renderPublic();
    var query = new URLSearchParams(location.search);
    if (query.get("code")) {
      if (!(await finishSignIn(query.get("code"), query.get("state")))) { return; }
    } else if (query.get("error")) {
      history.replaceState(null, "", redirectUri + "#review");
      renderSignIn("Sign-in was cancelled or refused: " + query.get("error"));
      return;
    }
    if (!load(TOKEN_KEY)) { renderSignIn(); return; }
    await refresh();
    setInterval(refresh, 5000);
    setInterval(tick, 1000);
  }

  start().catch(function (e) {
    // A failed fetch to the identity provider is usually CORS: the page's origin must be an
    // allowed origin on the client (see the README's "The tax officer").
    renderSignIn("Sign-in couldn't complete (" + (e && e.message ? e.message : "unknown error") + "). If this persists, check that " +
      location.origin + " is an allowed origin of the sign-in client.");
  });
})();
</script>
</body>
</html>
`;
