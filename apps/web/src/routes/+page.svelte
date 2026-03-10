<script lang="ts">
  export let data: { agencies: any[] };
  let search = '';
  let province = 'all';

  function toTitleCaseName(value: unknown) {
    const input = String(value ?? '').trim();
    if (!input) return 'Unknown agency';
    return input
      .toLowerCase()
      .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
  }

  $: provinces = Array.from(
    new Set((data.agencies ?? []).map((agency) => agency.subdivisionCode).filter(Boolean)),
  ).sort((a, b) => String(a).localeCompare(String(b)));

  $: filteredAgencies = (data.agencies ?? []).filter((agency) => {
    if (province !== 'all' && agency.subdivisionCode !== province) return false;
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return [agency.displayName, agency.slug, agency.subdivisionCode, agency.timezone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  $: matchedProvinceCount = new Set(
    filteredAgencies.map((agency) => agency.subdivisionCode).filter(Boolean),
  ).size;

  function clearFilters() {
    search = '';
    province = 'all';
  }

  function formatThousands(value: unknown, suffix = '') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'n/a';
    return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
  }
</script>

<svelte:head>
  <title>Agencies | Canada Transit Atlas</title>
</svelte:head>

<section class="hero">
  <span class="hero-kicker">Transit Directory</span>
  <h2>Transit Agencies</h2>
  <p>Search by agency name/slug and narrow by province to quickly find the feed you need.</p>
</section>

<section class="panel">
  <header class="panel-head">
    <h3>Available Agencies</h3>
    <span class="count-pill">{filteredAgencies.length}/{data.agencies.length}</span>
  </header>
  <div class="search-row">
    <label class="search-wrap">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <input placeholder="Search by name, slug, province..." bind:value={search} />
    </label>
    <label class="province-wrap">
      <span class="filter-label">Province</span>
      <select bind:value={province}>
        <option value="all">All</option>
        {#each provinces as code}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </label>
    <button type="button" class="clear-btn" on:click={clearFilters}>Clear</button>
  </div>
  <p class="results-hint">{filteredAgencies.length} matches across {matchedProvinceCount || 0} provinces</p>
  <div class="agency-list">
    {#if filteredAgencies.length === 0}
      <p class="empty">No agencies match the current search.</p>
    {:else}
      {#each filteredAgencies as agency}
        <article class="agency-card">
          <div class="agency-card-head">
            <strong>{toTitleCaseName(agency.displayName)}</strong>
            <span class="agency-province">{agency.subdivisionCode ?? 'n/a'}</span>
          </div>
          <div class="agency-meta-grid">
            <span><small>Slug</small>{agency.slug}</span>
            <span><small>Timezone</small>{agency.timezone ?? 'n/a'}</span>
            <span><small>Country</small>{agency.countryCode ?? 'n/a'}</span>
            {#if agency.ridership}
              <span>
                <small>Latest trips ({agency.ridership.latestPassengerTripsMonth ?? 'n/a'})</small>
                {formatThousands(agency.ridership.latestPassengerTripsThousands, 'k')}
              </span>
              <span>
                <small>Latest revenue ({agency.ridership.latestRevenueMonth ?? 'n/a'})</small>
                ${formatThousands(agency.ridership.latestRevenueThousandsCad, 'k CAD')}
              </span>
              <span>
                <small>Ridership source</small>
                StatsCan table {agency.ridership.sourceTableId}
              </span>
            {/if}
          </div>
        </article>
      {/each}
    {/if}
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

  .hero-kicker {
    display: inline-block;
    margin-bottom: 0.25rem;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .hero h2 {
    margin: 0;
    color: var(--text-primary);
  }

  .hero p {
    margin-bottom: 0;
    margin-top: 0.45rem;
    color: var(--text-secondary);
  }

  .panel {
    border: 1px solid rgba(109, 144, 202, 0.34);
    border-radius: 0.9rem;
    background: var(--surface-2);
    box-shadow: 0 12px 30px var(--shadow-soft);
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.8rem;
    border-bottom: 1px solid rgba(95, 127, 183, 0.28);
  }

  .panel-head h3 {
    margin: 0;
    color: var(--text-primary);
  }

  .count-pill {
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border-primary));
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface-3) 86%, transparent);
    padding: 0.2rem 0.52rem;
    color: var(--text-primary);
    font-size: 0.76rem;
    font-weight: 600;
  }

  .search-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: end;
    padding: 0.82rem 1rem 0;
  }

  .search-wrap {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid rgba(105, 144, 206, 0.45);
    border-radius: 0.56rem;
    background: var(--surface-input);
    box-shadow: inset 0 1px 0 rgba(208, 225, 255, 0.04);
    padding: 0.12rem 0.18rem 0.12rem 0.58rem;
  }

  .search-icon {
    color: var(--accent);
    font-size: 0.8rem;
    line-height: 1;
  }

  input {
    width: 100%;
    margin: 0;
    padding: 0.52rem 0.42rem 0.52rem 0;
    border: 0;
    border-radius: 0.45rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.9rem;
    outline: none;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .province-wrap {
    display: grid;
    gap: 0.2rem;
  }

  .filter-label {
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 700;
    margin-left: 0.15rem;
  }

  select {
    min-width: 6.2rem;
    border: 1px solid rgba(110, 145, 202, 0.5);
    border-radius: 0.5rem;
    background: var(--surface-input-strong);
    color: var(--text-primary);
    padding: 0.46rem 0.5rem;
    font-size: 0.82rem;
    outline: none;
  }

  .clear-btn {
    border: 1px solid rgba(116, 149, 207, 0.52);
    border-radius: 0.5rem;
    background: var(--surface-3);
    color: var(--text-primary);
    padding: 0.48rem 0.62rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 0.02rem;
  }

  .clear-btn:hover {
    border-color: rgba(146, 177, 231, 0.64);
    background: #15315a;
  }

  .results-hint {
    margin: 0.48rem 1rem 0;
    color: var(--text-muted);
    font-size: 0.76rem;
  }

  .agency-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.76rem;
    padding: 1rem;
  }

  .agency-card {
    border: 1px solid rgba(105, 136, 190, 0.42);
    border-left: 3px solid rgba(96, 165, 250, 0.7);
    border-radius: 0.72rem;
    padding: 0.7rem 0.72rem 0.72rem;
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    transition:
      border-color 140ms ease,
      transform 140ms ease,
      box-shadow 140ms ease;
  }

  .agency-card:hover {
    border-color: rgba(135, 171, 232, 0.64);
    transform: translateY(-1px);
    box-shadow: 0 8px 20px rgba(5, 12, 27, 0.45);
  }

  .agency-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .agency-card-head strong {
    line-height: 1.2;
    color: var(--text-primary);
  }

  .agency-province {
    border: 1px solid color-mix(in srgb, var(--accent) 46%, var(--border-primary));
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface-input-strong) 90%, transparent);
    color: var(--text-primary);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0.14rem 0.42rem;
    flex-shrink: 0;
  }

  :global(html[data-theme='light']) .count-pill,
  :global(html[data-theme='light']) .agency-province {
    background: rgba(236, 244, 255, 0.95);
  }

  .agency-meta-grid {
    display: grid;
    gap: 0.32rem;
  }

  .agency-meta-grid span {
    display: grid;
    gap: 0.06rem;
    border: 1px solid rgba(105, 137, 194, 0.22);
    border-radius: 0.52rem;
    padding: 0.3rem 0.46rem;
    background: var(--surface-input);
    color: var(--text-secondary);
    font-size: 0.81rem;
    line-height: 1.22;
    overflow-wrap: anywhere;
  }

  .agency-meta-grid small {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.62rem;
    font-weight: 700;
  }

  .empty {
    color: var(--text-secondary);
    margin: 0;
    padding: 0.35rem;
  }

  @media (max-width: 760px) {
    .search-row {
      grid-template-columns: 1fr;
      align-items: stretch;
    }

    select,
    .clear-btn {
      width: 100%;
    }
  }
</style>
