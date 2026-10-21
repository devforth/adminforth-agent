import type { Config } from 'vega-embed';
import { CHART_COLORS } from '@/afcl/chartUtils';

// charts of the agent follow the AFCL charts of the design system: one categorical palette in fixed order,
// 2px lines, 4px rounded bar ends, recessive horizontal grid, muted axes, no frame around the plot.
// Colors come from the --chart-* properties of the chart container, which take them from the theme tokens
export function vegaLiteConfig(container: HTMLElement): Config {
  const style = getComputedStyle(container);
  const token = (name: string) => style.getPropertyValue(`--chart-${name}`).trim();
  const text = token('text');
  const muted = token('muted');
  const surface = token('surface');

  return {
    background: 'transparent',
    // vega measures a container chart by clientWidth, so the space around the chart is vega padding, not CSS padding
    padding: 12,
    font: style.fontFamily,
    view: { stroke: null, continuousHeight: 200 },
    range: { category: CHART_COLORS },
    scale: { bandPaddingInner: 0.3 },
    mark: { color: CHART_COLORS[0] },
    bar: { cornerRadiusEnd: 4, binSpacing: 2 },
    line: { strokeWidth: 2, strokeJoin: 'round', strokeCap: 'round' },
    area: { fillOpacity: 0.12, line: true },
    point: { size: 36, stroke: surface, strokeWidth: 1.5 },
    arc: { stroke: surface, strokeWidth: 2 },
    text: { color: text, fontSize: 11 },
    title: {
      anchor: 'start',
      color: text,
      fontSize: 13,
      fontWeight: 600,
      subtitleColor: muted,
      subtitleFontSize: 12,
      subtitlePadding: 2,
      offset: 16,
    },
    axis: {
      domainColor: token('baseline'),
      gridColor: token('grid'),
      ticks: false,
      labelColor: muted,
      labelFontSize: 11,
      labelPadding: 6,
      labelOverlap: true,
      labelSeparation: 8,
      titleColor: muted,
      titleFontSize: 11,
      titleFontWeight: 500,
      titlePadding: 8,
    },
    axisX: { grid: false },
    axisXDiscrete: { labelAngle: 0 },
    axisY: { domain: false },
    legend: {
      orient: 'bottom',
      direction: 'horizontal',
      labelColor: text,
      labelFontSize: 11,
      titleColor: muted,
      titleFontSize: 11,
      titleFontWeight: 500,
      symbolSize: 64,
      columnPadding: 12,
    },
  };
}
