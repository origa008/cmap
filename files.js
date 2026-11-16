// cmap — files page logic.
// Roadmaps 1–6 are free: no token, no payment. Roadmaps 7–9 are premium
// (locked for one Rs 999 payment). Tapping a locked file opens the unlock
// modal: upload a JazzCash screenshot, /api/verify checks it, and on a pass
// all 3 premium roadmaps unlock for 24 hours (HMAC token in sessionStorage).
// PDFs are fetched with fetch() + blob URLs so a 403 (expired/invalid token)
// is detected and the file re-locks instead of showing a broken preview.

(function () {
  "use strict";

  var WA_NUMBER = "923295363198"; // same number as the JazzCash account
  var MAX_DIM = 1600;
  var JPEG_QUALITY = 0.8;
  var PREMIUM_IDS = { 7: true, 8: true, 9: true };

  var ROADMAPS = [
    { id: 1, title: "Stream Choice", desc: "Class 9 · which stream fits your marks — Ayesha's plan" },
    { id: 2, title: "Pre-Medical", desc: "FSc Pre-Medical · MDCAT route to MBBS — Ahmed's plan" },
    { id: 3, title: "Pre-Engineering", desc: "FSc Pre-Engineering · ECAT route to UET/NUST — Bilal's plan" },
    { id: 4, title: "CS / IT", desc: "ICS · computing degrees & first tech job — Fatima's plan" },
    { id: 5, title: "Commerce", desc: "ICom · BBA, CA & banking routes — Hassan's plan" },
    { id: 6, title: "AI Potential & Impact", desc: "All tracks · how AI changes every career — WEF, IMF & ILO data" },
    { id: 7, title: "Evolving Skills", desc: "4 sectors · which skills are rising, which are fading — WEF, IRENA & SBP data", premium: true },
    { id: 8, title: "Remote & Sponsored Jobs", desc: "2 routes · freelancing from home or a sponsored visa abroad — GOV.UK & WHO data", premium: true },
    { id: 9, title: "Skills vs Degree", desc: "The real comparison · where the degree is law, where the portfolio decides — PIDE & Harvard data", premium: true },
  ];

  var eyebrow = document.getElementById("eyebrow");
  var successBanner = document.getElementById("unlock-success");
  var list = document.getElementById("file-list");
  var modal = document.getElementById("preview-modal");
  var frame = document.getElementById("preview-frame");
  var previewTitle = document.getElementById("preview-title");
  var previewClose = document.getElementById("preview-close");
  var unlockModal = document.getElementById("unlock-modal");
  var unlockClose = document.getElementById("unlock-close");

  var token = null;
  var ref = "";
  var unlocked = false;
  var blobUrls = {};

  /* ---------- Token + ref ---------- */
  var params = new URLSearchParams(window.location.search);
  var urlToken = params.get("token");
  var urlRef = params.get("ref");
  if (urlToken) {
    token = urlToken;
    try { sessionStorage.setItem("cmap_token", token); } catch (_) {}
  } else {
    try { token = sessionStorage.getItem("cmap_token"); } catch (_) {}
  }
  if (urlRef) {
    ref = urlRef;
    try { sessionStorage.setItem("cmap_ref", ref); } catch (_) {}
  } else {
    try { ref = sessionStorage.getItem("cmap_ref") || ""; } catch (_) {}
  }
  if (urlToken || urlRef) {
    // Keep the token and ref out of the address bar (and out of shared links).
    window.history.replaceState(null, "", window.location.pathname);
  }

  // Render immediately (free files usable, premium locked); then validate a
  // stored token in the background and unlock if it is still good.
  renderList();
  if (token) {
    fetch("/api/file?id=7&token=" + encodeURIComponent(token), { method: "GET" })
      .then(function (res) {
        if (res.ok) return res.blob();
        throw new Error("token rejected: " + res.status);
      })
      .then(function (blob) {
        blobUrls[7] = URL.createObjectURL(blob);
        unlocked = true;
        eyebrow.textContent = "Premium unlocked ✓";
        renderList();
      })
      .catch(function () {
        token = null;
        try { sessionStorage.removeItem("cmap_token"); } catch (_) {}
        renderList();
      });
  }

  /* ---------- List ---------- */
  function renderList() {
    list.innerHTML = "";
    ROADMAPS.forEach(function (r) {
      var locked = r.premium && !unlocked;
      var card = document.createElement("div");
      card.className = "file-card" + (locked ? " locked" : "");

      var num = document.createElement("div");
      num.className = "file-num";
      num.textContent = "0" + r.id;

      var meta = document.createElement("div");
      meta.className = "file-meta";
      var h3 = document.createElement("h3");
      h3.textContent = r.title;
      var p = document.createElement("p");
      p.className = "small muted";
      p.textContent = r.desc;
      meta.appendChild(h3);
      meta.appendChild(p);
      if (locked) {
        var tag = document.createElement("span");
        tag.className = "lock-tag";
        tag.textContent = "🔒 Locked · Rs 999";
        meta.appendChild(tag);
      }

      var actions = document.createElement("div");
      actions.className = "file-actions";
      if (locked) {
        var unlockBtn = document.createElement("button");
        unlockBtn.className = "btn btn-dark btn-sm";
        unlockBtn.type = "button";
        unlockBtn.textContent = "Unlock all 3 — Rs 999";
        unlockBtn.addEventListener("click", function () { openUnlockModal(); });
        actions.appendChild(unlockBtn);
        card.addEventListener("click", function () { openUnlockModal(); });
      } else {
        var previewBtn = document.createElement("button");
        previewBtn.className = "btn btn-ghost btn-sm";
        previewBtn.type = "button";
        previewBtn.textContent = "Preview";
        previewBtn.addEventListener("click", function () { previewRoadmap(r); });
        var dlBtn = document.createElement("button");
        dlBtn.className = "btn btn-dark btn-sm";
        dlBtn.type = "button";
        dlBtn.textContent = "Download PDF";
        dlBtn.addEventListener("click", function () { downloadRoadmap(r, dlBtn); });
        actions.appendChild(previewBtn);
        actions.appendChild(dlBtn);
      }

      card.appendChild(num);
      card.appendChild(meta);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  /* ---------- Fetch + preview/download ---------- */
  function fetchPdf(id) {
    if (blobUrls[id]) return Promise.resolve(blobUrls[id]);
    var url = "/api/file?id=" + id;
    if (token) url += "&token=" + encodeURIComponent(token);
    return fetch(url)
      .then(function (res) {
        if (res.ok) return res.blob();
        var err = new Error("fetch failed: " + res.status);
        err.status = res.status;
        throw err;
      })
      .then(function (blob) {
        blobUrls[id] = URL.createObjectURL(blob);
        return blobUrls[id];
      });
  }

  function handleFetchError(err) {
    if (err && err.status === 403) {
      // Token expired mid-session: re-lock and open the unlock modal.
      unlocked = false;
      token = null;
      try { sessionStorage.removeItem("cmap_token"); } catch (_) {}
      blobUrls = {};
      renderList();
      openUnlockModal();
      return;
    }
    showPageError("Could not load that roadmap. Check your connection and try again.");
  }

  function showPageError(msg) {
    var note = document.getElementById("page-error");
    if (!note) {
      note = document.createElement("div");
      note.id = "page-error";
      note.className = "result fail show";
      note.setAttribute("role", "status");
      list.parentNode.insertBefore(note, list);
    }
    note.innerHTML = "<p style=\"margin:0;\">" + escapeHtml(msg) + "</p>";
  }

  function previewRoadmap(r) {
    previewTitle.textContent = r.title + " — preview";
    modal.classList.add("show");
    frame.src = "about:blank";
    fetchPdf(r.id)
      .then(function (url) { frame.src = url; })
      .catch(function (err) {
        modal.classList.remove("show");
        handleFetchError(err);
      });
  }

  function downloadRoadmap(r, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Loading…";
    fetchPdf(r.id)
      .then(function (url) {
        var a = document.createElement("a");
        a.href = url;
        a.download = "cmap-roadmap-" + r.id + ".pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        btn.disabled = false;
        btn.textContent = label;
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = label;
        handleFetchError(err);
      });
  }

  /* ---------- Unlock modal ---------- */
  var zone = document.getElementById("drop-zone");
  var input = document.getElementById("shot-input");
  var preview = document.getElementById("shot-preview");
  var verifyBtn = document.getElementById("verify-btn");
  var hint = document.getElementById("verify-hint");
  var result = document.getElementById("result");

  var imageDataUrl = null;
  var verifying = false;

  function openUnlockModal() {
    unlockModal.classList.add("show");
  }

  function closeUnlockModal() {
    unlockModal.classList.remove("show");
  }

  function resetUnlockForm() {
    imageDataUrl = null;
    input.value = "";
    preview.src = "";
    preview.classList.remove("show");
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verify payment";
    hint.textContent = "Choose a screenshot first.";
    hideResult();
  }

  unlockClose.addEventListener("click", function () {
    closeUnlockModal();
    resetUnlockForm();
  });
  unlockModal.addEventListener("click", function (e) {
    if (e.target === unlockModal) {
      closeUnlockModal();
      resetUnlockForm();
    }
  });

  /* Copy buttons */
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy") || "";
      var done = function () {
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });

  /* File picking */
  zone.addEventListener("click", function () { input.click(); });
  zone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  zone.addEventListener("dragover", function (e) {
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", function () { zone.classList.remove("drag"); });
  zone.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("drag");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
  input.addEventListener("change", function () {
    if (input.files && input.files[0]) handleFile(input.files[0]);
  });

  function handleFile(file) {
    if (!file.type || file.type.indexOf("image/") !== 0) {
      showError("Please choose an image file (JPG or PNG).");
      return;
    }
    hideResult();
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        imageDataUrl = resizeToJpeg(img);
        preview.src = imageDataUrl;
        preview.classList.add("show");
        verifyBtn.disabled = false;
        hint.textContent = "Screenshot ready — tap Verify payment.";
      };
      img.onerror = function () {
        showError("Could not read that image. Please try another screenshot.");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function resizeToJpeg(img) {
    var scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    var w = Math.round(img.width * scale);
    var h = Math.round(img.height * scale);
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }

  /* Verification */
  verifyBtn.addEventListener("click", function () {
    if (!imageDataUrl || verifying) return;
    verifying = true;
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying…";
    hint.innerHTML = '<span class="spinner"></span>Checking your screenshot… usually 10–20 seconds.';
    hideResult();

    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl, ref: ref }),
    })
      .then(function (res) {
        return res.json().catch(function () { return { ok: false }; }).then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (r) {
        verifying = false;
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify payment";
        hint.textContent = "";

        if (r.status === 200 && r.data && r.data.ok) {
          if (r.data.verdict === "pass" && r.data.token) {
            token = r.data.token;
            unlocked = true;
            try { sessionStorage.setItem("cmap_token", token); } catch (_) {}
            closeUnlockModal();
            resetUnlockForm();
            eyebrow.textContent = "Premium unlocked ✓";
            successBanner.innerHTML = "<strong>Premium unlocked ✓</strong> — Evolving Skills, Remote &amp; Sponsored Jobs and Skills vs Degree are yours now. Enjoy them — and good luck with the plan.";
            successBanner.classList.add("show");
            renderList();
            return;
          }
          showVerdict(r.data);
          return;
        }
        var msg = (r.data && r.data.error) || "Something went wrong. Please try again.";
        showError(msg);
      })
      .catch(function () {
        verifying = false;
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify payment";
        hint.textContent = "";
        showError("No connection. Check your internet and try again.");
      });
  });

  /* ---------- Result rendering ---------- */
  function hideResult() {
    result.className = "result";
    result.innerHTML = "";
  }

  function showError(msg) {
    result.className = "result fail show";
    result.innerHTML = "<h3>Something went wrong</h3><p>" + escapeHtml(msg) + "</p>";
  }

  function waLink(text) {
    return "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(text);
  }

  function checkLines(checks) {
    if (!checks) return "";
    var labels = {
      amount: "Amount — at least Rs 999",
      name: "Name — Shahzada Danish Kaleem",
      account: "Account — 03295363198",
      datetime: "Date & time (within the last hour)",
    };
    var out = "<ul>";
    Object.keys(labels).forEach(function (key) {
      var c = checks[key] || {};
      var mark;
      if (c.status === "ok") mark = "✓";
      else if (c.status === "fail") mark = '<span class="bad">✗</span>';
      else mark = '<span class="unk">?</span>';
      var extra = "";
      if (c.status === "fail" && c.found !== undefined && c.found !== null) {
        extra = " — found " + escapeHtml(String(c.found));
      } else if (c.status === "unknown" && c.note) {
        extra = " — " + escapeHtml(c.note);
      }
      out += '<li class="check-line">' + mark + " " + labels[key] + extra + "</li>";
    });
    return out + "</ul>";
  }

  function showVerdict(data) {
    if (data.verdict === "fail") {
      result.className = "result fail show";
      result.innerHTML =
        "<h3>Payment not verified</h3>" +
        "<p>" + escapeHtml(data.message || "This payment could not be verified.") + "</p>" +
        checkLines(data.checks) +
        "<p>Fix the payment and upload a new screenshot, or " +
        '<a href="' + waLink("Hi, my cmap payment was not verified. Can you help?") + '" target="_blank" rel="noopener">message us on WhatsApp</a>.</p>';
    } else {
      // review
      result.className = "result review show";
      result.innerHTML =
        "<h3>Under manual check</h3>" +
        "<p>" + escapeHtml(data.message || "Your screenshot is saved for a quick manual check.") + "</p>" +
        checkLines(data.checks) +
        "<p>You can also upload a clearer screenshot, or " +
        '<a href="' + waLink("Hi, I uploaded my cmap payment screenshot. Can you check it?") + '" target="_blank" rel="noopener">message us on WhatsApp</a>.</p>';
    }
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- Preview modal wiring ---------- */
  previewClose.addEventListener("click", function () {
    modal.classList.remove("show");
    frame.src = "about:blank";
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      modal.classList.remove("show");
      frame.src = "about:blank";
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      modal.classList.remove("show");
      frame.src = "about:blank";
      closeUnlockModal();
    }
  });
})();
