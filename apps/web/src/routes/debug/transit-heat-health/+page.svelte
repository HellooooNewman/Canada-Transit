<script lang="ts">
  export let data: {
    endpoint: string;
    health: {
      versionKey: string | null;
      tileCount: number;
      minZoom: number | null;
      maxZoom: number | null;
      generatedAt: string | null;
      tilesByZoom: Array<{ zoom: number; tiles: number }>;
    };
  };

  function formatTimestamp(value: string | null) {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }
</script>

<svelte:head>
  <title>Transit Heat Health | Debug</title>
</svelte:head>

<section class="hero">
  <span class="kicker">Debug</span>
  <h2>Transit Heat Health</h2>
  <p>Operational view of the active precomputed heat tile set.</p>
</section>

<section class="panel">
  <header class="panel-header">
    <h3>Active Version</h3>
    <span>{data.health.versionKey ?? 'none'}</span>
  </header>
  <div class="summary-grid">
    <article><small>Tile Count</small><strong>{data.health.tileCount.toLocaleString()}</strong></article>
    <article><small>Zoom Range</small><strong>z{data.health.minZoom ?? '?'}-z{data.health.maxZoom ?? '?'}</strong></article>
    <article><small>Generated</small><strong>{formatTimestamp(data.health.generatedAt)}</strong></article>
    <article><small>API Endpoint</small><strong class="mono">{data.endpoint}</strong></article>
  </div>
</section>

<section class="panel">
  <header class="panel-header">
    <h3>Tiles by Zoom</h3>
    <span>{data.health.tilesByZoom.length} levels</span>
  </header>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Zoom</th>
          <th>Tiles</th>
        </tr>
      </thead>
      <tbody>
        {#if data.health.tilesByZoom.length === 0}
          <tr>
            <td colspan="2" class="empty">No zoom stats found.</td>
          </tr>
        {:else}
          {#each data.health.tilesByZoom as row}
            <tr>
              <td>z{row.zoom}</td>
              <td>{row.tiles.toLocaleString()}</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</section>

<style>
  .hero {
    border: 1px solid rgba(118, 150, 205, 0.34);
    border-radius: 0.85rem;
    background: var(--surface-1);
    box-shadow: inset 0 0 0 1px rgba(181, 206, 245, 0.08);
    padding: 1rem 1.1rem 1.05rem;
    margin-bottom: 1rem;
  }

  .kicker {
    display: inline-block;
    margin-bottom: 0.25rem;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--accent);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .hero p {
    margin-top: 0.45rem;
    color: var(--text-secondary);
  }

  .panel {
    border: 1px solid rgba(109, 144, 202, 0.34);
    border-radius: 0.9rem;
    background: var(--surface-2);
    box-shadow: 0 12px 30px var(--shadow-soft);
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.8rem;
    border-bottom: 1px solid rgba(95, 127, 183, 0.28);
  }

  .panel-header span {
    color: var(--text-muted);
    font-size: 0.76rem;
    overflow-wrap: anywhere;
    text-align: right;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 0.75rem;
    padding: 0.9rem 1rem 1rem;
  }

  .summary-grid article {
    border: 1px solid rgba(105, 136, 190, 0.42);
    border-left: 3px solid rgba(96, 165, 250, 0.7);
    border-radius: 0.72rem;
    padding: 0.62rem 0.7rem;
    background: var(--surface-3);
    display: grid;
    gap: 0.2rem;
  }

  .summary-grid small {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.62rem;
    font-weight: 700;
  }

  .summary-grid strong {
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    font-size: 0.76rem;
  }

  .table-wrap {
    padding: 0.75rem 1rem 1rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface-3);
    border: 1px solid var(--border-primary);
    border-radius: 0.6rem;
    overflow: hidden;
  }

  th,
  td {
    text-align: left;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid rgba(98, 131, 188, 0.24);
  }

  th {
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  td {
    color: var(--text-secondary);
    font-size: 0.86rem;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .empty {
    color: var(--text-muted);
  }
</style>
