<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { isDebugEnabled } from '$lib/feature-flags';

  const debugEnabled = isDebugEnabled();
  const nav = [
    { href: '/map', label: 'Map' },
    { href: '/', label: 'Agencies' },
    { href: '/gtfs', label: 'GTFS' },
    ...(debugEnabled ? [{ href: '/debug/transit-heat-health', label: 'Debug' }] : []),
  ];

  type Theme = 'dark' | 'light';
  const THEME_STORAGE_KEY = 'cta-theme';

  let theme: Theme = 'dark';

  function applyTheme(nextTheme: Theme, persist = true) {
    theme = nextTheme;
    if (!browser) return;
    document.documentElement.dataset.theme = nextTheme;
    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    }
  }

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }

  onMount(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
      applyTheme(savedTheme, false);
      return;
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light', false);
  });
</script>

<svelte:head>
  <title>Canada Transit Atlas</title>
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <h1>Canada Transit Atlas</h1>
    <div class="topbar-actions">
      <nav>
        {#each nav as item}
          <a href={item.href}>{item.label}</a>
        {/each}
      </nav>
      <button
        class="theme-toggle"
        type="button"
        on:click={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </div>
  </header>
  <main>
    <slot />
  </main>
  <footer class="footer"><a class="sources-link" href="/sources">Data Sources</a></footer>
</div>

<style>
  :global(:root) {
    --bg-app: #0b1220;
    --text-primary: #eef2ff;
    --text-secondary: #c4d2ff;
    --text-muted: #8fa5cc;
    --border-primary: #263244;
    --border-secondary: #1d2738;
    --surface-1: #101d34;
    --surface-2: #0d172b;
    --surface-3: #12213c;
    --surface-input: #0c1b33;
    --surface-input-strong: #10213e;
    --accent: #8eb7fb;
    --accent-strong: #60a5fa;
    --link: #8ab0ff;
    --danger: #fca5a5;
    --danger-strong: #7f1d1d;
    --danger-bg: rgba(127, 29, 29, 0.88);
    --shadow-soft: rgba(1, 7, 20, 0.32);
  }

  :global(html[data-theme='light']) {
    --bg-app: #f3f6fb;
    --text-primary: #16223a;
    --text-secondary: #2f3f5e;
    --text-muted: #5a6b89;
    --border-primary: #c6d3e8;
    --border-secondary: #d8e1f0;
    --surface-1: #ffffff;
    --surface-2: #f7faff;
    --surface-3: #eef3fb;
    --surface-input: #ffffff;
    --surface-input-strong: #ffffff;
    --accent: #2f6fc4;
    --accent-strong: #2563eb;
    --link: #1f5bb8;
    --danger: #b42318;
    --danger-strong: #b42318;
    --danger-bg: rgba(180, 35, 24, 0.12);
    --shadow-soft: rgba(15, 23, 42, 0.1);
  }

  :global(html),
  :global(body) {
    background: var(--bg-app);
    color: var(--text-primary);
  }

  .app-shell {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    background: var(--bg-app);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-primary);
  }

  h1 {
    margin: 0;
    font-size: 1.15rem;
  }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  nav {
    display: flex;
    gap: 1rem;
  }

  a {
    color: var(--text-secondary);
    text-decoration: none;
  }

  .theme-toggle {
    border: 1px solid var(--border-primary);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-primary);
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    cursor: pointer;
  }

  main {
    padding: 1.5rem;
    flex: 1;
  }

  .footer {
    padding: 0.75rem 1.5rem 1rem;
    border-top: 1px solid var(--border-secondary);
    text-align: right;
  }

  .sources-link {
    font-size: 0.82rem;
    color: var(--text-muted);
  }
</style>
