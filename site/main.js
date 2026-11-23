/* AskouT · site one page (sem dependências) */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const avatar = (k) => `assets/avatares/${k}.jpg`;

  let W = innerWidth, H = innerHeight;
  document.body.classList.add("is-loading");

  /* ---------------- Loader ---------------- */
  const finishLoading = () => {
    $("#loader").classList.add("is-done");
    document.body.classList.remove("is-loading");
    document.body.classList.add("is-ready");
  };
  // Progresso: sobe até 90% no tempo mínimo e só completa quando a página carregou
  let loaded = false, loadP = 0;
  Promise.race([
    Promise.all([document.fonts ? document.fonts.ready : null, new Promise((r) => addEventListener("load", r))]),
    new Promise((r) => setTimeout(r, 4000)),
  ]).then(() => { loaded = true; });
  (() => {
    const fill = $("#loaderFill"), count = $("#loaderCount"), t0 = performance.now();
    const tick = (now) => {
      const minT = clamp((now - t0) / 1500);
      const target = Math.min(minT, loaded ? 1 : 0.9);
      loadP += (target - loadP) * 0.12;
      if (target === 1 && loadP > 0.995) loadP = 1;
      fill.style.clipPath = `inset(${78 - loadP * 56}% 0 0 0)`; // o desenho ocupa de 22% a 78% da imagem
      count.textContent = Math.round(loadP * 100);
      if (loadP === 1) { setTimeout(finishLoading, 280); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();

  /* ---------------- Cena da marca (canvas) ----------------
     Fundo azul-noite, névoa rosada e "ondas de som" nas cores do logo. */
  const canvas = $("#scene");
  const ctx = canvas.getContext("2d");
  let DPR = 1, fogSprite = null, fogs = [], sparks = [], ready = false;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const WAVE = ["#ffc48a", "#ff8f8f", "#ff6fb5", "#ff4fb0", "#c86bff", "#8f7bff", "#5ac8ff"];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function buildScene() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    canvas.width = W * DPR;
    canvas.height = H * DPR;

    fogSprite = document.createElement("canvas");
    fogSprite.width = fogSprite.height = 256;
    const f = fogSprite.getContext("2d");
    const g = f.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(214,120,235,1)");
    g.addColorStop(1, "rgba(214,120,235,0)");
    f.fillStyle = g;
    f.fillRect(0, 0, 256, 256);

    const fogTint = ["rgba(255,79,176,", "rgba(163,92,255,", "rgba(255,140,200,"];
    fogs = Array.from({ length: 22 }, () => ({
      x: Math.random() * W, y: H * rand(0.72, 1.05), r: Math.max(W, H) * rand(0.18, 0.4),
      v: rand(-0.15, 0.15), a: rand(0.05, 0.12), tint: fogTint[(Math.random() * 3) | 0],
    }));
    sparks = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rand(0.4, 1.6), v: rand(0.1, 0.45), t: Math.random() * 6 }));
    ready = true;
  }

  // Forma do logo: pico alto no meio, dois picos menores dos lados
  const peak = (u) => Math.exp(-u * u * 9) + 0.42 * Math.exp(-((u - 0.42) ** 2) * 42) + 0.42 * Math.exp(-((u + 0.42) ** 2) * 42) + 0.2 * Math.exp(-((u - 0.78) ** 2) * 60) + 0.2 * Math.exp(-((u + 0.78) ** 2) * 60);

  function drawScene(t) {
    mouse.sx = lerp(mouse.sx, mouse.x, 0.05);
    mouse.sy = lerp(mouse.sy, mouse.y, 0.05);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // Fundo
    const bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#1d1460");
    bg.addColorStop(0.45, "#0b0830");
    bg.addColorStop(1, "#04030f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Ondas
    const time = reduced ? 0 : t;
    const base = H * 0.97, amp = H * 0.36, span = Math.min(W * 0.62, H * 1.1);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    WAVE.forEach((color, i) => {
      const k = i - (WAVE.length - 1) / 2;
      const breathe = 1 + Math.sin(time / 1600 + i * 0.7) * 0.06;
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 6) {
        const u = (x - W / 2 - k * span * 0.035 - mouse.sx * 30) / span;
        const wob = Math.sin(u * 7 + time / 900 + i) * 0.035 + Math.sin(u * 17 - time / 700 + i * 2) * 0.012;
        const y = base - amp * breathe * (peak(u) * (1 - Math.abs(k) * 0.07) + wob) + mouse.sy * 14;
        x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.07; ctx.lineWidth = 22; ctx.stroke();
      ctx.globalAlpha = 0.16; ctx.lineWidth = 8; ctx.stroke();
      ctx.globalAlpha = 0.75; ctx.lineWidth = 1.6; ctx.stroke();
    });

    // Reflexo no chão molhado
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const floor = ctx.createLinearGradient(0, base - 10, 0, H);
    floor.addColorStop(0, "rgba(4,3,15,0)");
    floor.addColorStop(0.25, "rgba(4,3,15,.75)");
    floor.addColorStop(1, "rgba(4,3,15,.95)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, base - 10, W, H - base + 10);

    // Névoa
    for (const f of fogs) {
      if (!reduced) { f.x += f.v; if (f.x < -f.r) f.x = W + f.r; if (f.x > W + f.r) f.x = -f.r; }
      ctx.globalAlpha = f.a;
      ctx.drawImage(fogSprite, f.x - f.r, f.y - f.r * 0.5, f.r * 2, f.r);
    }

    // Partículas subindo
    ctx.fillStyle = "#fff";
    for (const s of sparks) {
      if (!reduced) { s.y -= s.v; if (s.y < -4) { s.y = H + 4; s.x = Math.random() * W; } }
      ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(time / 800 + s.t));
      ctx.fillRect(s.x + mouse.sx * -12, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  const brand = $("#brand");

  // Anel do logo em vetor (nítido em qualquer tamanho)
  (() => {
    const g = $("#ring .ring__spin"), NS = "http://www.w3.org/2000/svg";
    const pt = (deg, r) => { const a = ((deg - 90) * Math.PI) / 180; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]; };
    const segs = [["#ff2fd0", 2, 36], ["#3d4dff", 39, 72], ["#b23bff", 75, 98], ["#22c3ff", 101, 124], ["#ff2fd0", 127, 168], ["#ff8a1f", 171, 196], ["#2f6bff", 199, 238], ["#22c3ff", 241, 261], ["#ff8a1f", 264, 281], ["#b23bff", 284, 318], ["#3d4dff", 321, 359]];
    segs.forEach(([color, a, b], i) => {
      const [x1, y1] = pt(a, 80), [x2, y2] = pt(b, 80);
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M${x1} ${y1} A80 80 0 0 1 ${x2} ${y2}`);
      p.setAttribute("pathLength", 1);
      p.setAttribute("stroke", color);
      p.style.setProperty("--i", i);
      g.append(p);
    });
    [[18, "#3d4dff"], [62, "#ff8a1f"], [112, "#3d4dff"], [150, "#ff8a1f"], [200, "#22c3ff"], [228, "#b23bff"], [292, "#ff2fd0"], [336, "#3d4dff"]].forEach(([deg, color], i) => {
      const [x1, y1] = pt(deg, 81), [x2, y2] = pt(deg + 9, 90);
      const l = document.createElementNS(NS, "line");
      Object.entries({ x1, y1, x2, y2, stroke: color }).forEach(([k, v]) => l.setAttribute(k, v));
      l.style.setProperty("--i", i);
      g.append(l);
    });
    $("#outroRing").prepend($("#ring").cloneNode(true));
    $("#outroRing .ring").removeAttribute("id");
  })();

  /* ---------------- Posições das seções ---------------- */
  const intro = $("#intro"), hero = $("#introHero"), introTop = $("#introTop"), introBottom = $("#introBottom");
  const manifesto = $("#manifesto");
  const bigwords = $$(".chapter__bigword");
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const cardrevs = $$(".cardrev").map((el) => ({
    el, frame: $(".cardrev__frame", el), word: $(".cardrev__word", el), phone: $(".cardrev__phone", el),
    parts: $$(".cardrev__text > *", el),
  }));

  // Títulos em linhas, reveladas por máscara
  $$(".reveal .display").forEach((d) => {
    d.innerHTML = d.innerHTML.split(/<br\s*\/?>/i).map((part) => `<span class="ln"><span>${part.trim()}</span></span>`).join("");
  });
  let pos = {};

  function measure() {
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    pos = {
      intro: [top(intro), intro.offsetHeight],
      man: [top(manifesto), manifesto.offsetHeight],
      doc: document.documentElement.scrollHeight,
    };
  }

  // Palavras do manifesto
  const manText = $("#manifestoText");
  (function splitWords(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.append(part);
          else { const s = document.createElement("span"); s.className = "w"; s.textContent = part; frag.append(s); }
        });
        child.replaceWith(frag);
      } else splitWords(child);
    }
  })(manText);
  const words = $$(".w", manText);

  /* ---------------- Laço principal ---------------- */
  const nav = $("#nav"), bar = $("#progress");
  let lastWordOn = -1;

  function onFrame(t) {
    // A página pode ter carregado sem tamanho (aba em segundo plano): refaz o layout quando ele aparece
    if (innerWidth && (innerWidth !== W || innerHeight !== H) && !onResize.t) onResize();
    const y = scrollY;
    measure();

    bar.style.transform = `scaleX(${clamp(y / (pos.doc - H))})`;
    nav.classList.toggle("is-solid", y > pos.intro[1] - H * 1.1);

    // Intro
    const [iT, iH] = pos.intro;
    if (y < iT + iH && ready) {
      drawScene(t);
      const p = reduced ? 1 : clamp((y - iT) / (iH - H));
      const z = clamp(p / 0.62);
      const s = 1 + Math.pow(z, 2.4) * 9;
      brand.style.transform = `translateY(${z * -4}vh) scale(${s})`;
      brand.style.opacity = clamp(1 - (z - 0.3) / 0.45);
      canvas.style.transform = `scale(${1 + 0.25 * z})`;
      const fade = clamp(1 - z * 5);
      introTop.style.opacity = introBottom.style.opacity = fade;
      introBottom.style.transform = `translateY(${z * 80}px)`;
      introTop.style.transform = `translateY(${-z * 80}px)`;
      hero.style.opacity = clamp((p - 0.58) / 0.12);
      hero.classList.toggle("is-on", p > 0.62);
    }

    // Manifesto
    const [mT, mH] = pos.man;
    if (y > mT - H && y < mT + mH) {
      const m = clamp((y - mT) / (mH - H));
      const on = Math.floor(m * 1.15 * words.length);
      if (on !== lastWordOn) {
        words.forEach((w, i) => w.classList.toggle("on", i < on));
        lastWordOn = on;
      }
    }

    // Palavras gigantes atrás dos capítulos
    for (const b of bigwords) {
      const r = b.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > H) continue;
      const k = (r.top + r.height / 2 - H / 2) / H;
      b.style.transform = `translateX(${-15 + k * 25 * Number(b.dataset.drift)}vw)`;
    }

    // Cartões de capítulo: o quadro cresce até a tela cheia
    for (const c of cardrevs) {
      const r = c.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > H) continue;
      const p = clamp(-r.top / (r.height - H));
      const e = ease(clamp(p / 0.55));
      const small = W < 900;
      c.frame.style.setProperty("--ins-y", `${(1 - e) * (small ? 26 : 30)}%`);
      c.frame.style.setProperty("--ins-x", `${(1 - e) * (small ? 14 : 34)}%`);
      c.frame.style.setProperty("--rad", `${(1 - e) * 36}px`);
      c.word.style.transform = `translateX(${(0.5 - p) * 30}vw) scale(${1.3 - e * 0.3})`;
      if (c.phone) c.phone.style.transform = `translateY(${(0.5 - p) * 30}vh) rotate(${(1 - e) * 8}deg) scale(${0.8 + e * 0.2})`;
      c.parts.forEach((el, i) => {
        const k = clamp((p - 0.32 - i * 0.06) / 0.22);
        el.style.opacity = k;
        el.style.transform = `translateY(${(1 - ease(k)) * 60}px)`;
      });
      c.frame.style.opacity = 1 - clamp((p - 0.88) / 0.12) * 0.6;
    }

    requestAnimationFrame(onFrame);
  }

  function onResize() {
    onResize.t = 0;
    W = innerWidth; H = innerHeight;
    if (!W || !H) return;
    buildScene();
    measure();
  }
  addEventListener("resize", () => { clearTimeout(onResize.t); onResize.t = setTimeout(onResize, 120); });
  addEventListener("load", measure);
  if (reduced) { intro.style.height = "100vh"; }
  if (W && H) buildScene();
  measure();
  requestAnimationFrame(onFrame);

  addEventListener("mousemove", (e) => {
    mouse.x = e.clientX / W - 0.5;
    mouse.y = e.clientY / H - 0.5;
  });

  /* ---------------- Rolagem suave com inércia (mouse/trackpad) ---------------- */
  if (finePointer && !reduced) {
    document.documentElement.style.scrollBehavior = "auto";
    let target = scrollY, cur = scrollY, running = false;
    const maxY = () => document.documentElement.scrollHeight - innerHeight;
    // Velocidade da rolagem: SPEED = quanto anda por giro da roda; FOLLOW = quão rápido alcança (mais alto = mais firme)
    const SPEED = 0.8, FOLLOW = 0.1;
    const step = () => {
      cur = lerp(cur, target, FOLLOW);
      if (Math.abs(target - cur) < 0.5) { cur = target; running = false; }
      scrollTo(0, cur);
      if (running) requestAnimationFrame(step);
    };
    const go = (y) => { target = clamp(y, 0, maxY()); if (!running) { cur = scrollY; running = true; requestAnimationFrame(step); } };
    addEventListener("wheel", (e) => {
      if (e.ctrlKey || document.body.classList.contains("menu-open")) return;
      e.preventDefault();
      go((running ? target : scrollY) + e.deltaY * SPEED * (e.deltaMode === 1 ? 40 : 1));
    }, { passive: false });
    addEventListener("scroll", () => { if (!running) target = cur = scrollY; }, { passive: true });
    $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
      const el = $(a.getAttribute("href") === "#topo" ? "#intro" : a.getAttribute("href"));
      if (!el) return;
      e.preventDefault();
      go(el.getBoundingClientRect().top + scrollY);
    }));
  }

  /* ---------------- Cores por seção ---------------- */
  const themeObs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      document.body.style.setProperty("--c1", e.target.dataset.c1);
      document.body.style.setProperty("--c2", e.target.dataset.c2);
    }
  }, { rootMargin: "-45% 0px -45% 0px" });
  $$("[data-c1]").forEach((el) => themeObs.observe(el));

  /* ---------------- Revelação ---------------- */
  const revObs = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); revObs.unobserve(e.target); }
  }, { threshold: 0.15 });
  $$(".reveal").forEach((el, i) => { if (el.classList.contains("card")) el.style.transitionDelay = `${(i % 5) * 0.07}s`; revObs.observe(el); });

  /* ---------------- Menu ---------------- */
  const burger = $("#burger"), menu = $("#menu");
  const setMenu = (open) => {
    document.body.classList.toggle("menu-open", open);
    burger.setAttribute("aria-expanded", open);
    burger.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    menu.setAttribute("aria-hidden", !open);
  };
  burger.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
  $$("a", menu).forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape") { setMenu(false); } });

  /* ---------------- Cursor, ímã e inclinação ---------------- */
  if (finePointer && !reduced) {
    $$(".magnetic").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * 0.25}px, ${dy * 0.3}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });

    $$(".tilt").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        if (!el.classList.contains("is-in")) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.transform = `rotateX(${(0.5 - py) * 12}deg) rotateY(${(px - 0.5) * 14}deg) translateZ(0)`;
        el.style.setProperty("--mx", `${px * 100}%`);
        el.style.setProperty("--my", `${py * 100}%`);
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ---------------- Confete ---------------- */
  function confetti(el, count = 46) {
    const r = el.getBoundingClientRect();
    const colors = ["#ffc48a", "#ff6f91", "#ff4fb0", "#a35cff", "#5ac8ff", "#fff"];
    for (let i = 0; i < count; i++) {
      const s = document.createElement("i");
      const size = rand(6, 11);
      Object.assign(s.style, {
        position: "fixed", left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px`,
        width: `${size}px`, height: `${size * 0.45}px`, background: colors[i % colors.length],
        borderRadius: "2px", zIndex: 140, pointerEvents: "none",
      });
      document.body.append(s);
      const a = rand(0, Math.PI * 2), d = rand(80, 260);
      s.animate([
        { transform: "translate(-50%,-50%) rotate(0)", opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 60}px) rotate(${rand(-540, 540)}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${Math.cos(a) * d * 1.1}px, ${Math.sin(a) * d + 120}px) rotate(${rand(-720, 720)}deg)`, opacity: 0 },
      ], { duration: rand(1100, 1700), easing: "cubic-bezier(.2,.8,.3,1)" }).onfinish = () => s.remove();
    }
  }

  /* ---------------- Demo: NOW (livre agora) ---------------- */
  (() => {
    const radar = $("#radar"), btn = $("#flashBtn"), label = $("#flashLabel"), status = $("#flashStatus"), toasts = $("#toasts");
    const friends = $$(".radar__friend", radar);
    const chips = $$("#flashDemo .chip");
    let minutes = 120, active = false, endAt = 0, timers = [], tick = 0;

    const fmt = (ms) => {
      const s = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      return (h ? `${h}:` : "") + `${String(m).padStart(h ? 2 : 1, "0")}:${String(ss).padStart(2, "0")}`;
    };
    const liveCount = () => friends.filter((f) => f.classList.contains("is-live")).length;
    const render = () => {
      if (!active) return;
      const n = liveCount();
      status.innerHTML = `NOW ativo · <b>${fmt(endAt - Date.now())}</b> restantes` + (n ? ` · ${n} ${n > 1 ? "amigos livres" : "amigo livre"}. Bora?` : " · procurando amigos…");
    };

    function toast(f) {
      const t = document.createElement("div");
      t.className = "toast";
      t.innerHTML = `<img src="${f.querySelector("img").src}" alt="" /><div><b>${f.dataset.name}</b> também está livre<small>a ${f.dataset.dist} de você</small></div>`;
      toasts.append(t);
      timers.push(setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 500); }, 3200));
    }

    function setActive(on) {
      active = on;
      radar.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on);
      label.textContent = on ? "Ativo" : "Ativar";
      status.classList.toggle("is-hot", on);
      timers.forEach(clearTimeout); timers = []; clearInterval(tick);
      friends.forEach((f) => f.classList.remove("is-live"));
      toasts.innerHTML = "";
      if (!on) { status.textContent = "NOW desligado. Ninguém mais vê você como livre."; return; }
      endAt = Date.now() + minutes * 60000;
      render();
      tick = setInterval(render, 1000);
      [0, 2, 1].forEach((idx, i) => timers.push(setTimeout(() => { friends[idx].classList.add("is-live"); toast(friends[idx]); render(); }, 900 + i * 1300)));
    }

    btn.addEventListener("click", () => setActive(!active));
    chips.forEach((c) => c.addEventListener("click", () => {
      chips.forEach((x) => x.classList.toggle("is-on", x === c));
      minutes = Number(c.dataset.min);
      if (active) { endAt = Date.now() + minutes * 60000; render(); }
      else status.textContent = `Você vai aparecer como livre por ${c.textContent}. Toque no raio.`;
    }));
  })();

  /* ---------------- Demo: chegada ao vivo (notificação que se atualiza) ---------------- */
  (() => {
    const box = $("#arrival"), title = $("#arrivalTitle"), body = $("#arrivalBody"), bar = $("#arrivalBar");
    if (!box) return;
    const steps = [
      [8, "650 m"], [6, "480 m"], [4, "310 m"], [2, "150 m"], [0, ""],
    ];
    let i = 0;
    const show = () => {
      const [min, dist] = steps[i];
      const done = min === 0;
      box.classList.toggle("is-done", done);
      title.textContent = done ? "Marina chegou" : "Marina está a caminho";
      body.textContent = done ? "Chegou em Bar do Zé" : `Chega em ~${min} min · ${dist} até Bar do Zé`;
      bar.style.width = `${10 + (90 * i) / (steps.length - 1)}%`;
    };
    if (reduced) { i = 2; show(); return; }
    show();
    setInterval(() => { i = (i + 1) % steps.length; show(); }, 1800);
  })();

  /* ---------------- Demo: Agenda ---------------- */
  (() => {
    const grid = $("#agendaGrid"), status = $("#agendaStatus"), bestBtn = $("#bestBtn"), syncBtn = $("#syncBtn");
    const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const dayLong = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
    const periods = ["Manhã", "Tarde", "Noite"];
    const periodLong = ["de manhã", "à tarde", "à noite"];
    const k = (d, p) => `${d}-${p}`;
    const friends = {
      Marina: ["2-2", "3-2", "4-2", "5-1", "5-2", "6-1"],
      Rafa: ["1-2", "4-2", "5-0", "5-2", "6-1"],
      Bia: ["0-2", "3-2", "4-2", "5-2", "6-0", "6-1"],
      Léo: ["2-2", "4-1", "4-2", "5-1", "6-1"],
    };
    const freeCount = (key) => Object.values(friends).filter((l) => l.includes(key)).length;
    const you = new Set(), busy = new Set();
    const cells = {};

    grid.append(Object.assign(document.createElement("span"), { className: "agenda__h" }));
    days.forEach((d) => grid.append(Object.assign(document.createElement("span"), { className: "agenda__h", textContent: d })));
    periods.forEach((pName, p) => {
      grid.append(Object.assign(document.createElement("span"), { className: "agenda__r", textContent: pName }));
      days.forEach((_, d) => {
        const key = k(d, p);
        const b = document.createElement("button");
        b.className = "slot";
        b.setAttribute("aria-label", `${dayLong[d]} ${periodLong[p]}`);
        b.addEventListener("click", () => {
          if (busy.has(key)) { status.textContent = "Ocupado na sua agenda sincronizada."; return; }
          you.has(key) ? you.delete(key) : you.add(key);
          paint();
        });
        cells[key] = b;
        grid.append(b);
      });
    });

    function paint(best = []) {
      for (const [key, b] of Object.entries(cells)) {
        const n = freeCount(key);
        b.style.setProperty("--heat", n / 4);
        b.classList.toggle("is-you", you.has(key));
        b.classList.toggle("is-busy", busy.has(key));
        b.classList.toggle("is-best", best.includes(key));
        b.innerHTML = `<span class="slot__dots">${"<i></i>".repeat(n + (you.has(key) ? 1 : 0))}</span>`;
        b.setAttribute("aria-pressed", you.has(key));
      }
      if (!best.length) status.classList.remove("is-hot");
    }

    bestBtn.addEventListener("click", () => {
      let pool = Object.keys(cells);
      const mine = pool.filter((key) => you.has(key));
      if (mine.length) pool = mine;
      const score = (key) => freeCount(key) + (you.has(key) ? 1 : 0);
      const top = Math.max(...pool.map(score));
      const best = pool.filter((key) => score(key) === top);
      paint(best);
      const names = best.map((key) => { const [d, p] = key.split("-").map(Number); return `${dayLong[d]} ${periodLong[p]}`; });
      const label = names.length > 1 ? `${names.slice(0, -1).join(", ")} ou ${names.at(-1)}` : names[0];
      status.classList.add("is-hot");
      if (mine.length) {
        status.textContent = `Melhor data: ${label}. ${top} de 5 podem${top === 5 ? "! Todo mundo junto." : "."}`;
        if (top === 5) confetti(cells[best[0]]);
      } else {
        status.textContent = `${label[0].toUpperCase() + label.slice(1)}: 4 de 4 amigos livres. Marque quando você pode para desempatar.`;
      }
    });

    syncBtn.addEventListener("click", () => {
      syncBtn.classList.add("is-spin");
      syncBtn.disabled = true;
      status.textContent = "Lendo só os horários ocupados (nunca o título dos compromissos)…";
      setTimeout(() => {
        busy.clear(); you.clear();
        for (let d = 0; d < 5; d++) { busy.add(k(d, 0)); busy.add(k(d, 1)); }
        busy.add(k(6, 1)); busy.add(k(1, 2));
        Object.keys(cells).forEach((key) => { if (!busy.has(key)) you.add(key); });
        paint();
        syncBtn.classList.remove("is-spin");
        syncBtn.disabled = false;
        syncBtn.lastChild.textContent = " Agenda sincronizada";
        status.textContent = "Pronto: seus horários livres vieram da agenda. Agora encontre a melhor data.";
      }, 1400);
    });

    paint();
  })();

  /* ---------------- Demo: Votação ---------------- */
  (() => {
    const root = $("#poll"), opts = $$(".poll__opt", root), stack = $("#pollStack"), count = $("#pollCount"), going = $("#goingBtn"), badge = $(".badge", root);
    const votes = [0, 0, 0];
    let mine = -1, started = false, done = false;
    const queue = [["a", 1], ["b", 0], ["c", 1], ["JP", 2], ["d", 1], ["CA", 0], ["LU", 1]];

    function render() {
      const total = votes.reduce((a, b) => a + b, 0);
      const lead = votes.indexOf(Math.max(...votes));
      opts.forEach((o, i) => {
        const p = total ? votes[i] / total : 0;
        o.style.setProperty("--p", p);
        o.querySelector(".poll__pct").textContent = `${Math.round(p * 100)}%`;
        o.classList.toggle("is-mine", i === mine);
        o.classList.toggle("is-win", done && i === lead);
      });
      count.textContent = `${total} ${total === 1 ? "voto" : "votos"}`;
    }
    function addFace(key) {
      const el = key.length === 1 ? Object.assign(document.createElement("img"), { src: avatar(key), alt: "" }) : Object.assign(document.createElement("span"), { textContent: key });
      stack.append(el);
    }

    function start() {
      if (started) return;
      started = true;
      queue.forEach(([who, o], i) => setTimeout(() => { if (done) return; votes[o]++; addFace(who); render(); }, 600 + i * 900));
    }
    new IntersectionObserver((e, obs) => { if (e[0].isIntersecting) { start(); obs.disconnect(); } }, { threshold: 0.4 }).observe(root);

    opts.forEach((o, i) => o.addEventListener("click", () => {
      if (done) return;
      start();
      if (mine === -1) {
        const me = document.createElement("span");
        me.textContent = "EU"; me.style.background = "var(--pink)"; me.style.color = "#1a0b2e";
        stack.append(me);
      } else votes[mine]--;
      mine = i; votes[i]++;
      going.disabled = false;
      going.textContent = "Eu vou! Confirmar presença";
      render();
    }));

    going.addEventListener("click", () => {
      if (done) return;
      done = true;
      const lead = votes.indexOf(Math.max(...votes));
      badge.textContent = `Data definida: ${opts[lead].querySelector(".poll__label").textContent}`;
      badge.classList.add("is-set");
      going.textContent = "Você vai! Até lá ✨";
      going.disabled = true;
      render();
      confetti(going, 60);
    });
    render();
  })();

  /* ---------------- Demo: Mapa ---------------- */
  (() => {
    const svg = $("#mapSvg"), pinsEl = $("#mapPins"), card = $("#mapCard"), map = $("#map");
    const NS = "http://www.w3.org/2000/svg";
    const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const a in attrs) e.setAttribute(a, attrs[a]); svg.append(e); return e; };

    // Parques
    add("path", { d: "M380 300 q60 -30 110 10 q20 60 -30 90 q-70 20 -90 -40z", fill: "#123a2e", opacity: ".7" });
    add("path", { d: "M80 120 h110 v80 h-110z", fill: "#123a2e", opacity: ".6", rx: 10 });
    // Rio
    add("path", { d: "M-20 460 C 120 420, 200 520, 320 480 S 520 380, 640 420", stroke: "#1b3d7a", "stroke-width": 26, opacity: ".9" });
    add("path", { d: "M-20 460 C 120 420, 200 520, 320 480 S 520 380, 640 420", stroke: "#5ac8ff", "stroke-width": 2, opacity: ".35" });
    // Ruas
    for (let i = 0; i < 16; i++) {
      add("line", { x1: i * 40 + rand(-6, 6), y1: -10, x2: i * 40 + rand(-30, 30), y2: 610, stroke: "#1e1840", "stroke-width": i % 4 ? 2 : 6 });
      add("line", { x1: -10, y1: i * 40 + rand(-6, 6), x2: 610, y2: i * 40 + rand(-30, 30), stroke: "#1e1840", "stroke-width": i % 5 ? 2 : 6 });
    }
    add("line", { x1: -10, y1: 600, x2: 610, y2: 40, stroke: "#2c2360", "stroke-width": 8 });
    add("line", { x1: 40, y1: -10, x2: 560, y2: 610, stroke: "#2c2360", "stroke-width": 5 });
    // Rota acesa
    const route = add("path", { d: "M188 222 L 260 250 L 300 330 L 286 345", stroke: "url(#mapGrad)", "stroke-width": 4, "stroke-dasharray": "8 8" });
    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `<linearGradient id="mapGrad"><stop offset="0" stop-color="#ff4fb0"/><stop offset="1" stop-color="#a35cff"/></linearGradient>`;
    svg.prepend(defs);
    if (!reduced) route.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -64 }], { duration: 1400, iterations: Infinity });

    const places = [
      { x: 31, y: 37, type: "local", name: "Rooftop Aurora", area: "Pinheiros · rooftop", when: ["hoje", "fds"], ev: [["Sunset DJ set", "Hoje · 18h"], ["Aniversário da Bia", "Sáb · 21h"], ["Jazz no terraço", "Dom · 17h"]] },
      { x: 62, y: 25, type: "local", name: "Bar do Zé", area: "Vila Madalena · boteco", when: ["hoje", "fds"], ev: [["Samba de roda", "Hoje · 20h"], ["Happy hour em dobro", "Sex · 18h"]] },
      { x: 48, y: 57, type: "local", name: "Galpão 22", area: "Barra Funda · casa de shows", when: ["fds"], ev: [["Festa Neon", "Sex · 23h"], ["Show: Banda Vapor", "Sáb · 22h"], ["Karaokê ao vivo", "Sáb · 19h"], ["Baile da madrugada", "Sáb · 1h"], ["Feijoada com roda", "Dom · 13h"]] },
      { x: 76, y: 63, type: "local", name: "Boteco da Esquina", area: "Perdizes · bar", when: [], ev: [["Quiz de bar", "Qua · 20h"]] },
      { x: 20, y: 70, type: "local", name: "Arena Lume", area: "Lapa · eventos", when: ["fds"], ev: [["Stand-up comedy", "Sex · 21h"], ["Festival de cerveja", "Sáb · 15h"]] },
      { x: 76, y: 42, type: "ev", name: "Piquenique ao pôr do sol", area: "Parque das Luzes · ao ar livre", when: ["hoje"], ev: [["Piquenique ao pôr do sol", "Hoje · 16h"]] },
      { x: 38, y: 86, type: "ev", name: "Feira na praça", area: "Praça do Coreto", when: ["fds"], ev: [["Feira gastronômica", "Dom · 11h"]] },
    ];
    const pins = places.map((pl, i) => {
      const b = document.createElement("button");
      b.className = `pin${pl.type === "ev" ? " pin--ev" : ""}`;
      b.style.left = `${pl.x}%`; b.style.top = `${pl.y}%`;
      b.style.animationDelay = `${0.1 * i}s`;
      b.innerHTML = `<b>${pl.ev.length}</b>`;
      b.setAttribute("aria-label", `${pl.name}: ${pl.ev.length} ${pl.ev.length > 1 ? "eventos" : "evento"}`);
      b.addEventListener("click", (e) => { e.stopPropagation(); open(i); });
      pinsEl.append(b);
      return b;
    });
    function open(i) {
      const pl = places[i];
      pins.forEach((p, j) => p.classList.toggle("is-active", j === i));
      card.hidden = false;
      card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
      card.innerHTML = `<h4>${pl.name}</h4><p>${pl.area}${pl.type === "ev" ? " · fora dos locais" : ""}</p><ul>${pl.ev.slice(0, 3).map(([n, w]) => `<li>${n}<span>${w}</span></li>`).join("")}${pl.ev.length > 3 ? `<li><em>+${pl.ev.length - 3} eventos</em><span></span></li>` : ""}</ul>`;
    }
    map.addEventListener("click", () => { if (dragged) return; card.hidden = true; pins.forEach((p) => p.classList.remove("is-active")); });

    $$("#mapFilters .chip").forEach((c, _, all) => c.addEventListener("click", () => {
      all.forEach((x) => x.classList.toggle("is-on", x === c));
      const f = c.dataset.f;
      pins.forEach((p, i) => p.classList.toggle("is-dim", f !== "all" && !places[i].when.includes(f)));
      card.hidden = true;
      pins.forEach((p) => p.classList.remove("is-active"));
    }));

    // Arrastar / parallax
    let ox = 0, oy = 0, dragging = false, dragged = false, sx = 0, sy = 0, bx = 0, by = 0;
    const max = 40;
    const apply = () => { const t = `translate(${ox}px, ${oy}px)`; svg.style.transform = t; pinsEl.style.transform = t; };
    map.addEventListener("pointerdown", (e) => { if (e.target.closest(".pin")) return; dragging = true; dragged = false; sx = e.clientX; sy = e.clientY; bx = ox; by = oy; map.setPointerCapture(e.pointerId); map.style.cursor = "grabbing"; });
    map.addEventListener("pointermove", (e) => {
      if (dragging) {
        if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) dragged = true;
        ox = clamp(bx + e.clientX - sx, -max, max); oy = clamp(by + e.clientY - sy, -max, max); apply();
      } else if (finePointer) {
        const r = map.getBoundingClientRect();
        ox = ((e.clientX - r.left) / r.width - 0.5) * -24; oy = ((e.clientY - r.top) / r.height - 0.5) * -24; apply();
      }
    });
    const end = () => { dragging = false; map.style.cursor = ""; setTimeout(() => { dragged = false; }, 0); };
    map.addEventListener("pointerup", end);
    map.addEventListener("pointercancel", end);
  })();

  /* ---------------- Demo: Conversa ---------------- */
  (() => {
    const body = $("#chatBody"), replay = $("#chatReplay");
    const script = [
      { who: "c", name: "Bia", text: "gente, bora sair sexta?" },
      { who: "b", name: "Rafa", text: "bora! mas onde?" },
      { who: "a", name: "Marina", text: "eu topo, só não muito longe 😅" },
      { me: true, text: "deixa que o AskouT acha um lugar no meio de todo mundo" },
      { bot: true },
      { who: "d", name: "Léo", text: "Aurora!! fechou 🔥" },
      { me: true, text: "marcado: sexta, 20h no Aurora ✨" },
    ];
    let timers = [];
    const wait = (ms) => new Promise((r) => timers.push(setTimeout(r, ms)));
    let run = 0;

    function bubble(m) {
      const d = document.createElement("div");
      if (m.bot) {
        d.className = "msg msg--bot";
        d.innerHTML = `<div class="sug"><b>✦ Sugestões perto de todo mundo</b><div>Rooftop Aurora<span>1,1 km</span></div><div>Bar do Zé<span>1,4 km</span></div><div>Galpão 22<span>2 km</span></div></div>`;
      } else if (m.me) {
        d.className = "msg msg--me";
        d.innerHTML = `<p>${m.text}</p>`;
      } else {
        d.className = "msg";
        d.innerHTML = `<img src="${avatar(m.who)}" alt="" /><p><small>${m.name}</small>${m.text}</p>`;
      }
      body.append(d);
      while (body.children.length > 7) body.firstElementChild.remove();
    }

    async function play() {
      const id = ++run;
      timers.forEach(clearTimeout); timers = [];
      body.innerHTML = "";
      for (const m of script) {
        if (!m.me) {
          const t = document.createElement("div");
          t.className = "msg";
          t.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
          body.append(t);
          await wait(m.bot ? 1200 : 900);
          if (id !== run) return;
          t.remove();
        } else {
          await wait(700);
          if (id !== run) return;
        }
        bubble(m);
        await wait(500);
        if (id !== run) return;
      }
    }
    new IntersectionObserver((e, obs) => { if (e[0].isIntersecting) { play(); obs.disconnect(); } }, { threshold: 0.4 }).observe(body);
    replay.addEventListener("click", play);
  })();

})();
