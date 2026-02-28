<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Chart as ChartInstance, ChartConfiguration } from 'chart.js';

  export let config: ChartConfiguration;
  export let title = 'Metric chart';
  export let height = 220;

  let canvasEl: HTMLCanvasElement;
  let chart: ChartInstance | null = null;
  let ChartCtor: (typeof import('chart.js'))['Chart'] | null = null;
  let ready = false;

  async function renderChart() {
    if (!ready || !ChartCtor || !canvasEl || !config) return;

    chart?.destroy();
    chart = new ChartCtor(canvasEl, config);
  }

  onMount(async () => {
    const module = await import('chart.js');
    module.Chart.register(...module.registerables);

    ChartCtor = module.Chart;
    ready = true;
    await renderChart();
  });

  $: if (ready) {
    void renderChart();
  }

  onDestroy(() => {
    chart?.destroy();
  });
</script>

<div class="metric-chart" style={`height: ${height}px;`}>
  <canvas bind:this={canvasEl} aria-label={title}></canvas>
</div>

<style>
  .metric-chart {
    position: relative;
    width: 100%;
    min-height: 180px;
  }
</style>
