// Theme preference, shared by the landing page and the editor.
// Runs after i18n.js, which supplies the two toggle labels.
// Loaded synchronously in <head> so the first paint already has the right
// palette. Only ever stamps a resolved value, so CSS needs one dark selector.
(function () {
  var STORAGE_KEY = 'edit-pdf:theme';
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  var root = document.documentElement;

  function readChoice() {
    try {
      var choice = localStorage.getItem(STORAGE_KEY);
      return choice === 'light' || choice === 'dark' ? choice : null;
    } catch (err) {
      return null;
    }
  }

  function writeChoice(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (err) { /* private mode */ }
  }

  function activeTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function labelToggles(theme) {
    var label = window.i18n.t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
    var toggles = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute('aria-label', label);
      toggles[i].setAttribute('title', label);
    }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    labelToggles(theme);
  }

  apply(readChoice() || (darkQuery.matches ? 'dark' : 'light'));

  darkQuery.addEventListener('change', function (event) {
    if (!readChoice()) apply(event.matches ? 'dark' : 'light');
  });

  document.addEventListener('click', function (event) {
    if (!event.target.closest || !event.target.closest('[data-theme-toggle]')) return;
    var next = activeTheme() === 'dark' ? 'light' : 'dark';
    writeChoice(next);
    apply(next);
  });

  document.addEventListener('DOMContentLoaded', function () { labelToggles(activeTheme()); });
})();
