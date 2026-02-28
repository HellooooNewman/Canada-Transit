<script lang="ts">
  const nav = [
    { href: '/map', label: 'Map' },
    { href: '/', label: 'Agencies' },
    { href: '/gtfs', label: 'GTFS' },
  ];
</script>

<svelte:head>
  <title>Canada Transit Atlas</title>
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <h1>Canada Transit Atlas</h1>
    <nav>
      {#each nav as item}
        <a href={item.href}>{item.label}</a>
      {/each}
    </nav>
  </header>
  <main>
    <slot />
  </main>
  <footer class="footer"><a class="sources-link" href="/sources">Data Sources</a></footer>
</div>

<style>
  .app-shell {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    background: #0b1220;
    color: #eef2ff;
    display: flex;
    flex-direction: column;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #263244;
  }

  h1 {
    margin: 0;
    font-size: 1.15rem;
  }

  nav {
    display: flex;
    gap: 1rem;
  }

  a {
    color: #c4d2ff;
    text-decoration: none;
  }

  main {
    padding: 1.5rem;
    flex: 1;
  }

  .footer {
    padding: 0.75rem 1.5rem 1rem;
    border-top: 1px solid #1d2738;
    text-align: right;
  }

  .sources-link {
    font-size: 0.82rem;
    color: #8394bd;
  }
</style>
