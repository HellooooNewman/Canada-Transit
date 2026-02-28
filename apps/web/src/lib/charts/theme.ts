import type { ChartConfiguration } from 'chart.js';

export function buildHorizontalBarChartConfig(
  labels: string[],
  values: number[],
  datasetLabel: string,
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: datasetLabel,
          data: values,
          borderRadius: 8,
          backgroundColor: labels.map((_, index) => chartPalette(index, 0.75)),
          borderColor: labels.map((_, index) => chartPalette(index, 0.95)),
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          ticks: { color: '#bbcdf6' },
          grid: { color: 'rgba(130, 163, 223, 0.16)' },
        },
        y: {
          ticks: { color: '#d8e4ff' },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: '#d5e1ff',
          },
        },
        tooltip: {
          backgroundColor: '#111f3a',
          titleColor: '#f1f6ff',
          bodyColor: '#dbe8ff',
          borderColor: '#365483',
          borderWidth: 1,
        },
      },
    },
  };
}

export function buildDoughnutChartConfig(
  labels: string[],
  values: number[],
  datasetLabel: string,
): ChartConfiguration<'doughnut'> {
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          label: datasetLabel,
          data: values,
          borderWidth: 2,
          borderColor: '#0b1529',
          backgroundColor: labels.map((_, index) => chartPalette(index, 0.85)),
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#d5e1ff',
            padding: 12,
          },
        },
        tooltip: {
          backgroundColor: '#111f3a',
          titleColor: '#f1f6ff',
          bodyColor: '#dbe8ff',
          borderColor: '#365483',
          borderWidth: 1,
        },
      },
    },
  };
}

export function chartPalette(index: number, opacity: number) {
  const colors = [
    [89, 145, 255],
    [61, 214, 204],
    [119, 201, 110],
    [246, 175, 88],
    [233, 120, 118],
    [190, 133, 255],
    [88, 195, 255],
    [158, 167, 196],
  ];
  const [r, g, b] = colors[index % colors.length];
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
