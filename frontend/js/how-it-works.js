// Cambio lingua della pagina "Come funziona" (spostato da script inline per la CSP).
"use strict";
(function(){
  const ANCHORS_IT = { privacy: "privacy-it", "who-can-change": "chi-puo-modificare" };

  function setLang(lang) {
    document.querySelectorAll("[data-lang]").forEach(el => {
      el.style.display = el.dataset.lang === lang ? "block" : "none";
    });
    document.getElementById("btn-en").classList.toggle("active", lang === "en");
    document.getElementById("btn-it").classList.toggle("active", lang === "it");
    document.documentElement.lang = lang;
    try { localStorage.setItem("mycarbook-how-lang", lang); } catch (e) { /* ignora */ }
  }

  document.getElementById("btn-en").addEventListener("click", () => setLang("en"));
  document.getElementById("btn-it").addEventListener("click", () => setLang("it"));

  let saved = null;
  try { saved = localStorage.getItem("mycarbook-how-lang"); } catch (e) { /* ignora */ }
  const lang = saved || ((navigator.language || "").toLowerCase().startsWith("it") ? "it" : "en");
  setLang(lang);

  // I link "#privacy" dall'app portano alla sezione nella lingua attiva.
  const hash = location.hash.slice(1);
  if (lang === "it" && ANCHORS_IT[hash]) {
    const target = document.getElementById(ANCHORS_IT[hash]);
    if (target) target.scrollIntoView();
  }
})();
