<script lang="ts">
  const sources = [
    {
      name: 'MobilityData GTFS Schedule Catalog',
      url: 'https://database.mobilitydata.org/',
      description: 'Source directory for Canadian GTFS schedule feeds.',
    },
    {
      name: 'GTFS Schedule Reference',
      url: 'https://gtfs.org/documentation/schedule/reference/',
      description: 'Official GTFS static specification used as source of truth.',
    },
    {
      name: 'GTFS Realtime Reference',
      url: 'https://gtfs.org/documentation/realtime/reference/',
      description: 'Official GTFS realtime specification for future phases.',
    },
  ];
</script>

<svelte:head>
  <title>Sources | Canada Transit Atlas</title>
</svelte:head>

<section class="hero">
  <h2>Sources</h2>
  <p>Reference links for the data and transit resources used by this project.</p>
</section>

<section class="panel">
  <header class="panel-header">
    <h3>External References</h3>
    <span>{sources.length}</span>
  </header>

  <div class="list">
    {#each sources as source}
      <article class="card">
        <strong>{source.name}</strong>
        <span>{source.description}</span>
        <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
      </article>
    {/each}
  </div>
</section>

<p class="notice">
  Canada Transit Atlas is unofficial and is not affiliated with any transit agency.
  All trademarks and copyrights belong to their respective owners.
</p>

<style>
  h2,
  h3,
  p {
    margin: 0;
  }

  .hero {
    border: 1px solid #24324a;
    border-radius: 0.75rem;
    background: linear-gradient(135deg, #0e1a31, #111d38);
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
  }

  .hero p {
    margin-top: 0.4rem;
    color: #b8c8eb;
  }

  .panel {
    border: 1px solid #273856;
    border-radius: 0.8rem;
    background: linear-gradient(180deg, #0e1a31 0%, #0a1425 100%);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    padding: 0.8rem 0.9rem;
    border-bottom: 1px solid #22314b;
  }

  .panel-header span {
    color: #9bb0df;
    font-size: 0.78rem;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.8rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border: 1px solid #283a5a;
    border-radius: 0.56rem;
    padding: 0.65rem;
    background: linear-gradient(180deg, #111e36 0%, #0f1a2f 100%);
  }

  .card span {
    color: #adc0ea;
    font-size: 0.86rem;
  }

  a {
    color: #8ab0ff;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .notice {
    margin-top: 1rem;
    border: 1px solid #2a3955;
    border-radius: 0.7rem;
    background: #0e1a30;
    padding: 0.75rem 0.9rem;
    color: #aec1eb;
    font-size: 0.85rem;
    line-height: 1.4;
  }
</style>
