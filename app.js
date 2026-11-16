// cmap — landing page behaviour
// Scroll-fade statements, reveal-on-scroll, roadmap tabs, form validation +
// submission to /api/request, sticky mobile CTA. No dependencies.

(function () {
  "use strict";

  /* ---------- Scroll-fade statements (words gray -> dark) ---------- */
  var fadeEls = Array.prototype.slice.call(document.querySelectorAll(".scroll-fade"));
  fadeEls.forEach(function (el) {
    // Split into word spans, preserving any <em> lime-highlighted words.
    var nodes = Array.prototype.slice.call(el.childNodes);
    el.textContent = "";
    nodes.forEach(function (node) {
      var isEm = node.nodeType === 1 && node.tagName === "EM";
      var text = node.textContent;
      text.split(/\s+/).filter(Boolean).forEach(function (word) {
        var span = document.createElement("span");
        span.className = "w" + (isEm ? " lit-lime" : "");
        span.textContent = word;
        el.appendChild(span);
        el.appendChild(document.createTextNode(" "));
      });
    });
  });

  function updateFade() {
    fadeEls.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      var vh = window.innerHeight;
      // Progress: 0 when the element's top hits 85% of viewport, 1 when its
      // bottom passes 35% of viewport.
      var start = vh * 0.85;
      var end = vh * 0.35;
      var progress = (start - rect.top) / (start - end + rect.height);
      progress = Math.max(0, Math.min(1, progress));
      var words = el.querySelectorAll(".w");
      var litCount = Math.floor(progress * words.length);
      words.forEach(function (w, i) {
        w.classList.toggle("lit", i < litCount);
      });
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Roadmap tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".roadmap-panel"));

  function activateTab(id, scroll) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-target") === id;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach(function (p) {
      p.classList.toggle("active", p.id === id);
    });
    if (scroll) {
      document.getElementById("roadmaps").scrollIntoView({ behavior: "smooth" });
    }
  }

  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      activateTab(t.getAttribute("data-target"), false);
    });
  });

  // Dark index card rows jump to the matching tab.
  Array.prototype.slice.call(document.querySelectorAll(".index-row")).forEach(function (row) {
    row.addEventListener("click", function () {
      activateTab(row.getAttribute("data-target"), true);
    });
  });

  /* ---------- Sticky mobile CTA ---------- */
  var sticky = document.querySelector(".sticky-cta");
  var priceSection = document.getElementById("price");
  function updateSticky() {
    if (!sticky) return;
    var pastHero = window.scrollY > window.innerHeight * 0.8;
    var priceRect = priceSection ? priceSection.getBoundingClientRect() : null;
    var priceVisible = priceRect && priceRect.top < window.innerHeight * 0.5 && priceRect.bottom > 0;
    sticky.classList.toggle("visible", pastHero && !priceVisible);
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateFade();
      updateSticky();
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  updateFade();
  updateSticky();

  /* ---------- Forms (hero + price) ---------- */
  var PK_MOBILE = /^(?:\+?92|0)?3\d{9}$/;

  function normalisePhone(raw) {
    var cleaned = String(raw || "").replace(/[\s\-()]/g, "");
    if (!PK_MOBILE.test(cleaned)) return null;
    var digits = cleaned.replace(/^\+?92/, "").replace(/^0/, "");
    return "+92 " + digits.slice(0, 3) + " " + digits.slice(3);
  }

  function setFieldError(form, name, message) {
    var field = form.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    var input = field.querySelector("input, select");
    var err = field.querySelector(".error");
    if (message) {
      field.classList.add("has-error");
      if (input) input.classList.add("invalid");
      if (err) err.textContent = message;
    } else {
      field.classList.remove("has-error");
      if (input) input.classList.remove("invalid");
    }
  }

  function showStatus(form, kind, message) {
    var status = form.querySelector(".form-status");
    if (!status) return;
    status.className = "form-status show " + kind;
    status.textContent = message;
  }

  function clearStatus(form) {
    var status = form.querySelector(".form-status");
    if (status) status.className = "form-status";
  }

  Array.prototype.slice.call(document.querySelectorAll("form.roadmap-form")).forEach(function (form) {
    // Clear a field's error as the user fixes it.
    form.addEventListener("input", function (e) {
      var field = e.target.closest("[data-field]");
      if (field) {
        field.classList.remove("has-error");
        e.target.classList.remove("invalid");
      }
      clearStatus(form);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearStatus(form);

      var name = form.elements.name.value.trim();
      var whatsappRaw = form.elements.whatsapp.value.trim();
      var className = form.elements.class.value;
      var track = form.elements.track.value;
      var marks = form.elements.marks.value.trim();

      var valid = true;
      if (!name || name.length < 2) {
        setFieldError(form, "name", "Please enter your name.");
        valid = false;
      }
      var phone = normalisePhone(whatsappRaw);
      if (!phone) {
        setFieldError(form, "whatsapp", "Enter a valid Pakistani number, e.g. 0300-1234567.");
        valid = false;
      }
      if (!valid) return;

      var btn = form.querySelector('button[type="submit"]');
      var originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Sending…";

      fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          whatsapp: phone,
          class: className,
          track: track,
          marks: marks,
        }),
      })
        .then(function (res) {
          return res.json().catch(function () { return { ok: false }; }).then(function (data) {
            return { status: res.status, data: data };
          });
        })
        .then(function (result) {
          if (result.status === 200 && result.data && result.data.ok) {
            // Request saved — open the files page (the 6 core roadmaps are
            // free; the Notion page id (ref) links a later premium unlock
            // back to this lead).
            var ref = result.data.ref || "";
            var filesUrl = "/files" + (ref ? "?ref=" + encodeURIComponent(ref) : "");
            window.location.href = filesUrl;
          } else {
            var msg = (result.data && result.data.error) ||
              "Something went wrong. Please try again.";
            showStatus(form, "error", msg);
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        })
        .catch(function () {
          showStatus(form, "error", "No connection. Check your internet and try again.");
          btn.disabled = false;
          btn.textContent = originalLabel;
        });
    });
  });

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
