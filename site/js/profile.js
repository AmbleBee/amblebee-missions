/* Profiles: the missions you mark done, kept safe on AmbleBee's own server (amblebee-intake) as well as in this
   browser, so clearing the browser or a new phone doesn't lose them. No account: a random secret key IS the profile.

   - The key is made here (128 random bits) and only travels in a header. The server keeps a fingerprint of it, never
     the key. Your profile link is amblebee.com/me/#<key>: the part after # never leaves the browser in an address.
   - What's kept: the missions marked done, the days, thumbs up or down, "as a date", notes, Not for us and the two
     stamp settings. No name, no password, and the recovery email only as a fingerprint.
   - The list in this browser (site/js/done.js) is still the one the site reads. This file sends what changed and
     brings in what changed on your other devices. With no connection it waits and tries again later.
   - Notes are locked here before they're sent (AES-GCM with a random "notes key"), so the server only ever holds
     scrambled notes. The notes key is kept on the server locked twice: with a key made from your profile link, and,
     if you add a recovery email, with a key made from that email (PBKDF2). After "I lost my link" the new link can't
     open the first lock, so the site asks for the recovery email once, opens the second, and locks it with the new
     link. Without a recovery email there's no "I lost my link" at all: the link is the only way back in.
   window.AmbleProfile: { has, state, sync, create, setEmail, lost, remove, signOut, link, offer, open } */
(function () {
  "use strict";

  var API = "https://amblebee-intake.tail58116.ts.net";   // the same server as site/js/intake.js
  var STORE = "amble.profile";
  var DECLINED = "amble.profile.declined";   // "Not now" pressed: Mark done stops asking (Start a free profile still works)
  // The recovery email, kept in this browser only, so the contact, report and suggestion forms can fill it in
  // (site/js/intake.js, site/js/builder.js). It's never sent anywhere from here; the server only ever keeps a fingerprint.
  var EMAIL = "amble.email";
  function keepEmail(v) { try { if (v) localStorage.setItem(EMAIL, v); else localStorage.removeItem(EMAIL); } catch (e) { /* private mode */ } }
  var KEY_RE = /^[A-Za-z0-9_-]{22}$/;
  var QUIET_MS = 30 * 1000;      // with nothing to send, a page checks for changes from other devices at most this often
  var D = window.AmbleDone;
  if (!D) return;

  // ---- what this browser knows about its profile ----
  var mem = null;
  function load() {
    try { var raw = localStorage.getItem(STORE); if (raw) return JSON.parse(raw); } catch (e) { /* private mode */ }
    return mem;
  }
  function save(st) {
    mem = st;
    try { if (st) localStorage.setItem(STORE, JSON.stringify(st)); else localStorage.removeItem(STORE); } catch (e) { /* in memory */ }
    emit();
  }
  var live = { syncing: false, error: "" };
  function state() {
    var st = load() || {};
    return { has: !!(st.key && !st.gone), gone: !!st.gone, email: !!st.email, last: st.last || 0, created: st.created || "",
             locked: !!(st.key && !st.gone && st.locked), syncing: live.syncing, error: live.error };
  }

  // ---- locking notes ----
  var subtle = window.crypto && window.crypto.subtle;
  var TE = new TextEncoder(), TD = new TextDecoder();
  function b64u(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    var bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  var AES = { name: "AES-GCM", length: 256 };
  function linkLock(key) {         // a lock made from the profile key
    return subtle.importKey("raw", TE.encode(key), "HKDF", false, ["deriveKey"]).then(function (base) {
      return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: TE.encode("amblebee notes"), info: TE.encode("link lock v1") },
                              base, AES, false, ["encrypt", "decrypt"]);
    });
  }
  function emailLock(email, salt) { // a lock made from the recovery email (slow on purpose, so guessing is slow too)
    return subtle.importKey("raw", TE.encode(String(email).trim().toLowerCase()), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: 310000 }, base, AES, false, ["encrypt", "decrypt"]);
    });
  }
  function seal(k, bytes) {
    var iv = rand(12);
    return subtle.encrypt({ name: "AES-GCM", iv: iv }, k, bytes).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv); out.set(new Uint8Array(ct), 12);
      return b64u(out);
    });
  }
  function unseal(k, text) {
    var all = unb64u(text);
    return subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12)).then(function (b) { return new Uint8Array(b); });
  }
  var noteKeys = {};
  function noteKey(dk) {
    if (!noteKeys[dk]) noteKeys[dk] = subtle.importKey("raw", unb64u(dk), "AES-GCM", false, ["encrypt", "decrypt"]);
    return noteKeys[dk];
  }
  function lockNote(dk, text) {
    if (!text) return Promise.resolve("");
    return noteKey(dk).then(function (k) { return seal(k, TE.encode(text)); }).then(function (s) { return "n1:" + s; });
  }
  function openNote(dk, text) {    // null when it can't be opened
    if (!text) return Promise.resolve("");
    if (text.slice(0, 3) !== "n1:") return Promise.resolve(null);
    return noteKey(dk).then(function (k) { return unseal(k, text.slice(3)); }).then(function (b) { return TD.decode(b); }, function () { return null; });
  }
  function newVault(key, email) {  // a fresh notes key, locked with the link (and the email, if there is one)
    var dkBytes = rand(32);
    var out = { dk: b64u(dkBytes), vault: {} };
    return linkLock(key).then(function (k) { return seal(k, dkBytes); }).then(function (wk) {
      out.vault.wk = wk;
      return email ? emailVault(dkBytes, email).then(function (v) { out.vault.we = v.we; out.vault.salt = v.salt; return out; }) : out;
    });
  }
  function emailVault(dkBytes, email) {
    var salt = rand(16);
    return emailLock(email, salt).then(function (k) { return seal(k, dkBytes); }).then(function (we) { return { we: we, salt: b64u(salt) }; });
  }
  // the notes key for this device: kept here once known; otherwise opened from the server's link lock
  function notesKey(st) {
    if (!subtle) return Promise.resolve(null);
    if (st.dk) return Promise.resolve(st.dk);
    return post("/profile/sync", { since: null, done: [], removed: [], prefs: null }, st.key).then(function (r) {
      if (r.status === 401) throw { gone: true };
      if (r.status !== 200 || !r.body.ok) throw new Error(OFFLINE);
      var v = r.body.vault || {};
      var now = load() || {};
      if (now.key !== st.key) return null;
      if (v.wk) {
        return linkLock(st.key).then(function (k) { return unseal(k, v.wk); }).then(function (b) {
          now.dk = b64u(b); now.locked = false; delete now.vault; save(now); return now.dk;
        }, function () { now.locked = !!v.we; now.vault = v; save(now); return null; });
      }
      if (v.we) { now.locked = true; now.vault = v; save(now); return null; }   // a new link: the recovery email opens it
      // no notes key yet (a profile started before notes were locked): make one now
      return newVault(st.key, "").then(function (nv) {
        return post("/profile/vault", { vault: { wk: nv.vault.wk } }, st.key).then(function (r2) {
          if (r2.status !== 200) return null;
          now.dk = nv.dk; now.locked = false; save(now); return now.dk;
        });
      });
    });
  }
  function emit() { try { window.dispatchEvent(new CustomEvent("amble:profile", { detail: state() })); } catch (e) { /* old browser */ } }

  function newKey() {
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    var bin = "";
    for (var i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function link(key) {
    var st = load();
    key = key || (st && st.key);
    return key ? location.origin + "/me/#" + key : "";
  }

  function post(path, body, key) {
    var ctl = "AbortController" in window ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    var headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Profile " + key;
    return fetch(API + path, { method: "POST", headers: headers, body: JSON.stringify(body || {}), cache: "no-store",
                               credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; });
      }, function (err) { clearTimeout(timer); throw err; });
  }
  var OFFLINE = "We couldn't reach our server just now. Your missions are safe on this device; we'll try again.";

  // ---- syncing ----
  var running = null, again = false, timer = null;
  function sync(force) {
    var st = load();
    if (!st || !st.key || st.gone) return Promise.resolve(state());
    if (running) { again = true; return running; }
    var all = !st.since;
    var p = D.pending(all);
    var nothing = !p.done.length && !p.removed.length && !p.prefs && !p.plans.length && !p.plans_removed.length;
    if (!force && nothing && st.since && Date.now() - (st.last || 0) < QUIET_MS) return Promise.resolve(state());
    live.syncing = true; emit();
    var dk = null;
    running = notesKey(st).then(function (k) {
      dk = k;
      // notes go locked; with no notes key (locked out, or a browser without WebCrypto) they stay here for now
      return Promise.all(p.done.map(function (c) {
        var o = Object.assign({}, c);
        if (!dk) { delete o.note; return o; }
        return lockNote(dk, c.note).then(function (n) { o.note = n; return o; });
      }));
    }).then(function (out) {
      return post("/profile/sync", { since: st.since || null, done: out, removed: p.removed, prefs: p.prefs,
                                     plans: p.plans, plans_removed: p.plans_removed }, st.key);
    }).then(function (r) {
        var now = load() || {};
        if (now.key !== st.key) return;                          // signed out or switched while this was on its way
        if (r.status === 401 && r.body && r.body.gone) {
          now.gone = true; live.error = ""; save(now); return;
        }
        if (r.status !== 200 || !r.body.ok) { live.error = (r.body && r.body.error) || OFFLINE; return; }
        // what went without its note stays waiting, so the note goes once it can be locked
        D.sent(dk ? p : { done: p.done.filter(function (c) { return !c.note; }), removed: p.removed, prefs: p.prefs,
                          plans: p.plans, plans_removed: p.plans_removed });
        return Promise.all((r.body.done || []).map(function (c) {
          var o = Object.assign({}, c);
          if (!o.note) return o;
          if (!dk) { delete o.note; return o; }                  // can't open it: keep what this device has
          return openNote(dk, o.note).then(function (t) { if (t === null) delete o.note; else o.note = t; return o; });
        })).then(function (opened) {
          D.merge(Object.assign({}, r.body, { done: opened }));
          now = load() || {};
          now.since = r.body.now; now.email = !!r.body.email; now.created = r.body.created_at || now.created; now.last = Date.now();
          live.error = "";
          save(now);
        });
      }).then(null, function (ex) {
        if (ex && ex.gone) { var g = load() || {}; g.gone = true; save(g); live.error = ""; return; }
        live.error = OFFLINE;
      })
      .then(function () {
        live.syncing = false; running = null; emit();
        if (again) { again = false; schedule(300); }
        return state();
      });
    return running;
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () { sync(); }, ms == null ? 1200 : ms);
  }

  // ---- starting, opening and leaving a profile ----
  function create(email) {
    var key = newKey();
    var made = subtle ? newVault(key, email) : Promise.resolve({ dk: null, vault: {} });
    return made.then(function (nv) {
      return post("/profile", { key: key, email: email || "", vault: nv.vault }).then(function (r) { r.nv = nv; return r; });
    }).then(function (r) {
      if (r.status === 400) throw new Error((r.body.errors && r.body.errors.email) || r.body.error || "Please check your email.");
      if (r.status !== 201 && r.status !== 200) throw new Error((r.body && r.body.error) || OFFLINE);
      save({ key: key, since: null, email: !!email, last: 0, dk: r.nv.dk || undefined });
      if (email) keepEmail(email);
      try { localStorage.removeItem(DECLINED); } catch (e) { /* fine */ }
      return sync(true).then(function () { return key; });
    }, function (ex) {
      if (ex && ex.message && !/fetch|network|abort/i.test(ex.message)) throw ex;
      throw new Error("We couldn't reach our server just now, so your profile wasn't started. Your missions are still on this device. Please try again in a little while.");
    });
  }
  function open(key) {
    // a profile link opened here: this device joins that profile, and what's already here is added to it
    var st = load();
    if (st && st.key && st.key !== key && !st.gone) D.removeAll();       // switching profiles: this device starts over from the link's
    save({ key: key, since: null, email: false, last: 0 });
    return sync(true);
  }
  function setEmail(email) {
    var st = load();
    var lock = email && st && st.dk && subtle ? emailVault(unb64u(st.dk), email) : Promise.resolve(null);
    return lock.then(function (v) {
      return post("/profile/email", { email: email || "", vault: v }, st && st.key);
    }).then(function (r) {
      if (r.status === 401) { st.gone = true; save(st); throw new Error("This profile's link has stopped working."); }
      if (r.status !== 200) throw new Error((r.body.errors && r.body.errors.email) || r.body.error || OFFLINE);
      st.email = !!r.body.email; save(st);
      keepEmail(st.email ? email : "");
      return st.email;
    }, function () { throw new Error(OFFLINE); });
  }
  // after a new link: the recovery email opens the notes key, which is then locked with the new link
  function unlock(email) {
    var st = load();
    var v = st && st.vault;
    if (!st || !v || !v.we || !v.salt || !subtle) return Promise.reject(new Error("There's nothing to unlock here."));
    var dkBytes;
    return emailLock(email, unb64u(v.salt)).then(function (k) { return unseal(k, v.we); }).then(function (b) {
      dkBytes = b;
      return linkLock(st.key).then(function (k) { return seal(k, dkBytes); });
    }, function () { throw new Error("That email doesn't open your notes. Check it's the recovery email you used, with no typos."); })
      .then(function (wk) { return post("/profile/vault", { vault: { wk: wk } }, st.key); })
      .then(function (r) {
        if (r.status !== 200) throw new Error((r.body && r.body.error) || OFFLINE);
        var now = load() || {};
        now.dk = b64u(dkBytes); now.locked = false; delete now.vault; now.since = null;   // start over, so every note comes in readable
        save(now);
        return sync(true);
      });
  }
  function lost(email, startedAt) {
    return post("/profile/lost", { email: email, elapsed_ms: Date.now() - (startedAt || 0), website: "" }).then(function (r) {
      if (r.status === 400) throw new Error((r.body.errors && r.body.errors.email) || "That email doesn't look right.");
      if (r.status === 429) throw new Error(r.body.error || "Please wait a little while and try again.");
      if (r.status !== 200) throw new Error(OFFLINE);
      return true;
    }, function () { throw new Error(OFFLINE); });
  }
  function remove() {
    var st = load();
    if (!st || !st.key || st.gone) { save(null); return Promise.resolve(); }
    return post("/profile/remove", {}, st.key).then(function (r) {
      if (r.status !== 200 && r.status !== 401) throw new Error((r.body && r.body.error) || OFFLINE);
      save(null); keepEmail("");
    }, function () { throw new Error("We couldn't reach our server, so nothing was removed. Please try again in a little while."); });
  }
  function signOut() { save(null); keepEmail(""); D.removeAll(); }

  // ---- "Start a free profile?" (after Mark done, every time, until there's a profile) ----
  var dlg = null, opener = null;
  function el(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  function copyBox(id, value, label) {
    var box = el("input", { id: id, class: "link-box", type: "text", readonly: true, value: value, "aria-label": label });
    var note = el("span", { class: "copy-note", role: "status" });
    var btn = el("button", { type: "button", class: "btn small", onclick: function () {
      box.select();
      (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject()).then(function () { note.textContent = "Copied."; },
        function () { note.textContent = "Select it and copy."; });
    } }, "Copy");
    return el("div", { class: "copy-row" }, box, btn, note);
  }
  function ready(key, email) {
    return [el("h2", { id: "profile-dlg-title", text: "Your profile is ready" }),
      el("p", {}, "Your missions and stamps are saved to it. Open this link on any phone or computer to see your profile there too. ",
        el("b", { text: "Anyone with the link can open your profile, so keep it to yourself." })),
      copyBox("profile-link", link(key), "Your profile link"),
      el("p", { class: "hint" }, "Your recovery code is the end of the link: ", el("code", { class: "recovery-code", text: key }),
        email ? " We've emailed both to you; check your spam folder if it doesn't arrive." :
          " Without a recovery email, this link is the only way back, so save it somewhere, like a note to yourself. You can add an email in your profile's Settings."),
      el("form", { method: "dialog", class: "profile-dlg-actions" }, el("button", { class: "btn primary", type: "submit", text: "Done" }))];
  }
  function declined() { try { return !!localStorage.getItem(DECLINED); } catch (e) { return !!memDeclined; } }
  var memDeclined = false;
  function offer(fromMark) {
    if (state().has) return;
    if (fromMark && declined()) return;
    if (!dlg) {
      dlg = el("dialog", { class: "profile-dlg", "aria-labelledby": "profile-dlg-title" });
      dlg.addEventListener("close", function () { if (opener && opener.isConnected) opener.focus(); });
      document.body.append(dlg);
    }
    opener = document.activeElement;
    var email = el("input", { id: "profile-email", type: "email", autocomplete: "email", maxlength: "200", placeholder: "you@example.com" });
    var err = el("p", { class: "form-status bad", role: "alert" });
    var start = el("button", { type: "submit", class: "btn primary profile-start" }, "Start my free profile");
    var form = el("form", { class: "profile-offer" },
      el("h2", { id: "profile-dlg-title", text: fromMark ? "Marked done! Keep it safe?" : "Start a free profile" }),
      el("p", {}, "A free AmbleBee profile keeps your missions and stamps safe, even if you clear your browser or get a new phone. ",
        "There's nothing to sign up for: no name, no password."),
      el("p", {}, el("b", { text: "We only keep your mission log: " }),
        "the missions you mark done, the days, your thumbs up or down, and any notes you write. Nothing else, and it's never shared or sold."),
      el("div", { class: "done-field" },
        el("label", { for: "profile-email" }, "Email me my profile link and recovery code ", el("span", { class: "opt", text: "(optional)" })),
        email,
        el("p", { class: "hint", text: "We send them there once. We don't keep your address, only a scrambled fingerprint of it, so we can send you a new link if you ever lose yours. We'll never email you for anything else." })),
      err,
      el("div", { class: "profile-dlg-actions" }, start,
        el("button", { type: "button", class: "btn small profile-later", onclick: function () {
          memDeclined = true;
          try { localStorage.setItem(DECLINED, new Date().toISOString()); } catch (e) { /* in memory */ }
          dlg.close();
        } }, "Not now")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      err.textContent = ""; start.disabled = true; start.textContent = "Starting…";
      create(email.value.trim()).then(function (key) {
        dlg.replaceChildren(el.apply(null, ["div", { class: "dialog-body profile-dlg-body" }].concat(ready(key, !!email.value.trim()))));
        var b = dlg.querySelector("#profile-link"); if (b) b.focus();
      }, function (ex) {
        err.textContent = ex.message; start.disabled = false; start.textContent = "Start my free profile"; email.focus();
      });
    });
    dlg.replaceChildren(el("div", { class: "dialog-body profile-dlg-body" }, form));
    if (!dlg.open) dlg.showModal();
    form.querySelector(".profile-start").focus();
  }

  // ---- a profile link opened on this device: /me/#<key> ----
  function fromAddress() {
    var h = location.hash.slice(1);
    if (!/^\/me\//.test(location.pathname) || !KEY_RE.test(h)) return;
    history.replaceState(null, "", location.pathname + location.search);   // the key doesn't stay in the address bar or history
    var st = load();
    if (st && st.key === h && !st.gone) { sync(true); return; }
    var other = st && st.key && !st.gone;
    if (other && !window.confirm("This device already has a different profile. Switch to the one in this link? " +
                                 "The missions here stay in the other profile, so you can switch back with its link.")) return;
    open(h).then(function () {
      try { window.dispatchEvent(new CustomEvent("amble:profile-opened")); } catch (e) { /* old browser */ }
    });
  }

  window.AmbleProfile = { has: function () { return state().has; }, state: state, sync: sync, create: create, open: open,
                          setEmail: setEmail, lost: lost, unlock: unlock, remove: remove, signOut: signOut, link: link, offer: offer, key: function () {
                            var st = load(); return st && st.key && !st.gone ? st.key : ""; } };

  window.addEventListener("amble:done", function () { if (state().has) schedule(); });
  window.addEventListener("amble:note", function () { if (state().has) schedule(2500); });   // typing a note: wait for a pause
  window.addEventListener("storage", function (e) { if (e.key === STORE) emit(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") sync(); });
  window.addEventListener("online", function () { sync(true); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { fromAddress(); sync(); });
  else { fromAddress(); sync(); }
})();
