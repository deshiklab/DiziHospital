/* DiziHospital design tokens v0.3.0 — GENERATED. Do not edit. */
export const tokensVersion = "0.3.0";
export const tokens = {
  "color": {
    "brand": {
      "50": "#E6F4F6",
      "100": "#C2E4E9",
      "300": "#5FB3BF",
      "500": "#0E6E7A",
      "600": "#0B5C66",
      "700": "#0A4F58",
      "900": "#062F35"
    },
    "surface": {
      "canvas": "#F7F9FB",
      "default": "#FFFFFF",
      "sunken": "#EEF2F6",
      "raised": "#FFFFFF",
      "inverse": "#101828",
      "overlay": "rgba(16, 24, 40, 0.40)"
    },
    "border": {
      "subtle": "#E4E9F0",
      "default": "#D7DEE7",
      "strong": "#98A2B3",
      "focus": "#0E6E7A"
    },
    "text": {
      "primary": "#101828",
      "secondary": "#475467",
      "tertiary": "#5A6474",
      "disabled": "#98A2B3",
      "inverse": "#FFFFFF",
      "link": "#0B5C66"
    },
    "safety": {
      "critical": "#B3261E",
      "warning": "#8A4F00",
      "success": "#197648",
      "info": "#1D4ED8"
    },
    "clinical": {
      "status-neutral": "#667085",
      "status-admitted": "#1D4ED8",
      "status-discharged": "#197648",
      "status-in-progress": "#8A4F00",
      "status-awaiting": "#7C3AED",
      "status-cancelled": "#667085",
      "status-no-show": "#8A4F00",
      "critical-value": "#B3261E",
      "allergy": "#B3261E",
      "interaction": "#8A4F00"
    },
    "chart": {
      "series-1": "#0E6E7A",
      "series-2": "#1D4ED8",
      "series-3": "#7C3AED",
      "series-4": "#B26B00",
      "series-5": "#1B7F4B",
      "series-6": "#0F766E",
      "series-7": "#B3261E",
      "series-8": "#475467"
    }
  },
  "typography": {
    "family": {
      "ui": "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
      "bengali": "'Noto Sans Bengali', 'Inter', sans-serif",
      "numeric": "'Inter', ui-monospace, monospace"
    },
    "size": {
      "xs": "12px",
      "sm": "13px",
      "base": "14px",
      "md": "16px",
      "lg": "18px",
      "xl": "20px",
      "2xl": "24px",
      "3xl": "30px",
      "4xl": "38px"
    },
    "weight": {
      "regular": "400",
      "medium": "500",
      "semibold": "600",
      "bold": "700"
    },
    "lineHeight": {
      "tight": "1.25",
      "normal": "1.5",
      "relaxed": "1.65"
    }
  },
  "space": {
    "0": "0px",
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
    "10": "40px",
    "12": "48px",
    "16": "64px"
  },
  "radius": {
    "sm": "6px",
    "md": "10px",
    "lg": "14px",
    "full": "9999px"
  },
  "elevation": {
    "none": "none",
    "sm": "0 1px 2px rgba(16,24,40,0.06)",
    "md": "0 4px 12px rgba(16,24,40,0.10)",
    "lg": "0 12px 32px rgba(16,24,40,0.16)"
  },
  "motion": {
    "duration": {
      "fast": "120ms",
      "base": "180ms",
      "slow": "240ms"
    },
    "easing": {
      "standard": "cubic-bezier(0.2, 0, 0, 1)",
      "entrance": "cubic-bezier(0, 0, 0.2, 1)",
      "exit": "cubic-bezier(0.4, 0, 1, 1)"
    },
    "reduced": "all durations collapse to 1ms when prefers-reduced-motion is set"
  },
  "density": {
    "comfortable": {
      "rowHeight": "40px",
      "fieldHeight": "36px",
      "cellPaddingX": "12px"
    },
    "compact": {
      "rowHeight": "32px",
      "fieldHeight": "30px",
      "cellPaddingX": "8px"
    }
  },
  "breakpoint": {
    "sm": "640px",
    "md": "768px",
    "lg": "1024px",
    "xl": "1280px",
    "2xl": "1536px"
  },
  "target": {
    "touch": "44px",
    "pointer": "28px",
    "focusRingWidth": "2px",
    "focusRingOffset": "2px"
  },
  "print": {
    "a4": "210mm x 297mm",
    "a5": "148mm x 210mm",
    "thermal80": "80mm roll",
    "label": "50mm x 25mm specimen label",
    "margin": "12mm"
  },
  "zIndex": {
    "base": "0",
    "sticky": "100",
    "drawer": "200",
    "dropdown": "300",
    "modal": "400",
    "toast": "500",
    "palette": "600"
  },
  "sync": {
    "live": "#197648",
    "lanOnly": "#5A6B7B",
    "queued": "#8A4F00",
    "syncing": "#1D4ED8",
    "conflict": "#B3261E",
    "stale": "#5A6B7B",
    "freshnessThresholdMinutes": 5
  }
} as const;
export type Tokens = typeof tokens;
export type TokenName = "color.brand.50" | "color.brand.100" | "color.brand.300" | "color.brand.500" | "color.brand.600" | "color.brand.700" | "color.brand.900" | "color.surface.canvas" | "color.surface.default" | "color.surface.sunken" | "color.surface.raised" | "color.surface.inverse" | "color.surface.overlay" | "color.border.subtle" | "color.border.default" | "color.border.strong" | "color.border.focus" | "color.text.primary" | "color.text.secondary" | "color.text.tertiary" | "color.text.disabled" | "color.text.inverse" | "color.text.link" | "color.safety.critical" | "color.safety.warning" | "color.safety.success" | "color.safety.info" | "color.clinical.status-neutral" | "color.clinical.status-admitted" | "color.clinical.status-discharged" | "color.clinical.status-in-progress" | "color.clinical.status-awaiting" | "color.clinical.status-cancelled" | "color.clinical.status-no-show" | "color.clinical.critical-value" | "color.clinical.allergy" | "color.clinical.interaction" | "color.chart.series-1" | "color.chart.series-2" | "color.chart.series-3" | "color.chart.series-4" | "color.chart.series-5" | "color.chart.series-6" | "color.chart.series-7" | "color.chart.series-8" | "typography.family.ui" | "typography.family.bengali" | "typography.family.numeric" | "typography.size.xs" | "typography.size.sm" | "typography.size.base" | "typography.size.md" | "typography.size.lg" | "typography.size.xl" | "typography.size.2xl" | "typography.size.3xl" | "typography.size.4xl" | "typography.weight.regular" | "typography.weight.medium" | "typography.weight.semibold" | "typography.weight.bold" | "typography.lineHeight.tight" | "typography.lineHeight.normal" | "typography.lineHeight.relaxed" | "space.0" | "space.1" | "space.2" | "space.3" | "space.4" | "space.5" | "space.6" | "space.8" | "space.10" | "space.12" | "space.16" | "radius.sm" | "radius.md" | "radius.lg" | "radius.full" | "elevation.none" | "elevation.sm" | "elevation.md" | "elevation.lg" | "motion.duration.fast" | "motion.duration.base" | "motion.duration.slow" | "motion.easing.standard" | "motion.easing.entrance" | "motion.easing.exit" | "motion.reduced" | "density.comfortable.rowHeight" | "density.comfortable.fieldHeight" | "density.comfortable.cellPaddingX" | "density.compact.rowHeight" | "density.compact.fieldHeight" | "density.compact.cellPaddingX" | "breakpoint.sm" | "breakpoint.md" | "breakpoint.lg" | "breakpoint.xl" | "breakpoint.2xl" | "target.touch" | "target.pointer" | "target.focusRingWidth" | "target.focusRingOffset" | "print.a4" | "print.a5" | "print.thermal80" | "print.label" | "print.margin" | "zIndex.base" | "zIndex.sticky" | "zIndex.drawer" | "zIndex.dropdown" | "zIndex.modal" | "zIndex.toast" | "zIndex.palette" | "sync.live" | "sync.lanOnly" | "sync.queued" | "sync.syncing" | "sync.conflict" | "sync.stale" | "sync.freshnessThresholdMinutes";
/** CSS custom property name for a token path, e.g. cssVar('color.brand.500') -> var(--dizi-color-brand-500) */
export const cssVar = (path: TokenName): string => ({
  "color.brand.50": 'var(--dizi-color-brand-50)',
  "color.brand.100": 'var(--dizi-color-brand-100)',
  "color.brand.300": 'var(--dizi-color-brand-300)',
  "color.brand.500": 'var(--dizi-color-brand-500)',
  "color.brand.600": 'var(--dizi-color-brand-600)',
  "color.brand.700": 'var(--dizi-color-brand-700)',
  "color.brand.900": 'var(--dizi-color-brand-900)',
  "color.surface.canvas": 'var(--dizi-color-surface-canvas)',
  "color.surface.default": 'var(--dizi-color-surface-default)',
  "color.surface.sunken": 'var(--dizi-color-surface-sunken)',
  "color.surface.raised": 'var(--dizi-color-surface-raised)',
  "color.surface.inverse": 'var(--dizi-color-surface-inverse)',
  "color.surface.overlay": 'var(--dizi-color-surface-overlay)',
  "color.border.subtle": 'var(--dizi-color-border-subtle)',
  "color.border.default": 'var(--dizi-color-border-default)',
  "color.border.strong": 'var(--dizi-color-border-strong)',
  "color.border.focus": 'var(--dizi-color-border-focus)',
  "color.text.primary": 'var(--dizi-color-text-primary)',
  "color.text.secondary": 'var(--dizi-color-text-secondary)',
  "color.text.tertiary": 'var(--dizi-color-text-tertiary)',
  "color.text.disabled": 'var(--dizi-color-text-disabled)',
  "color.text.inverse": 'var(--dizi-color-text-inverse)',
  "color.text.link": 'var(--dizi-color-text-link)',
  "color.safety.critical": 'var(--dizi-color-safety-critical)',
  "color.safety.warning": 'var(--dizi-color-safety-warning)',
  "color.safety.success": 'var(--dizi-color-safety-success)',
  "color.safety.info": 'var(--dizi-color-safety-info)',
  "color.clinical.status-neutral": 'var(--dizi-color-clinical-status-neutral)',
  "color.clinical.status-admitted": 'var(--dizi-color-clinical-status-admitted)',
  "color.clinical.status-discharged": 'var(--dizi-color-clinical-status-discharged)',
  "color.clinical.status-in-progress": 'var(--dizi-color-clinical-status-in-progress)',
  "color.clinical.status-awaiting": 'var(--dizi-color-clinical-status-awaiting)',
  "color.clinical.status-cancelled": 'var(--dizi-color-clinical-status-cancelled)',
  "color.clinical.status-no-show": 'var(--dizi-color-clinical-status-no-show)',
  "color.clinical.critical-value": 'var(--dizi-color-clinical-critical-value)',
  "color.clinical.allergy": 'var(--dizi-color-clinical-allergy)',
  "color.clinical.interaction": 'var(--dizi-color-clinical-interaction)',
  "color.chart.series-1": 'var(--dizi-color-chart-series-1)',
  "color.chart.series-2": 'var(--dizi-color-chart-series-2)',
  "color.chart.series-3": 'var(--dizi-color-chart-series-3)',
  "color.chart.series-4": 'var(--dizi-color-chart-series-4)',
  "color.chart.series-5": 'var(--dizi-color-chart-series-5)',
  "color.chart.series-6": 'var(--dizi-color-chart-series-6)',
  "color.chart.series-7": 'var(--dizi-color-chart-series-7)',
  "color.chart.series-8": 'var(--dizi-color-chart-series-8)',
  "typography.family.ui": 'var(--dizi-typography-family-ui)',
  "typography.family.bengali": 'var(--dizi-typography-family-bengali)',
  "typography.family.numeric": 'var(--dizi-typography-family-numeric)',
  "typography.size.xs": 'var(--dizi-typography-size-xs)',
  "typography.size.sm": 'var(--dizi-typography-size-sm)',
  "typography.size.base": 'var(--dizi-typography-size-base)',
  "typography.size.md": 'var(--dizi-typography-size-md)',
  "typography.size.lg": 'var(--dizi-typography-size-lg)',
  "typography.size.xl": 'var(--dizi-typography-size-xl)',
  "typography.size.2xl": 'var(--dizi-typography-size-2xl)',
  "typography.size.3xl": 'var(--dizi-typography-size-3xl)',
  "typography.size.4xl": 'var(--dizi-typography-size-4xl)',
  "typography.weight.regular": 'var(--dizi-typography-weight-regular)',
  "typography.weight.medium": 'var(--dizi-typography-weight-medium)',
  "typography.weight.semibold": 'var(--dizi-typography-weight-semibold)',
  "typography.weight.bold": 'var(--dizi-typography-weight-bold)',
  "typography.lineHeight.tight": 'var(--dizi-typography-line-height-tight)',
  "typography.lineHeight.normal": 'var(--dizi-typography-line-height-normal)',
  "typography.lineHeight.relaxed": 'var(--dizi-typography-line-height-relaxed)',
  "space.0": 'var(--dizi-space-0)',
  "space.1": 'var(--dizi-space-1)',
  "space.2": 'var(--dizi-space-2)',
  "space.3": 'var(--dizi-space-3)',
  "space.4": 'var(--dizi-space-4)',
  "space.5": 'var(--dizi-space-5)',
  "space.6": 'var(--dizi-space-6)',
  "space.8": 'var(--dizi-space-8)',
  "space.10": 'var(--dizi-space-10)',
  "space.12": 'var(--dizi-space-12)',
  "space.16": 'var(--dizi-space-16)',
  "radius.sm": 'var(--dizi-radius-sm)',
  "radius.md": 'var(--dizi-radius-md)',
  "radius.lg": 'var(--dizi-radius-lg)',
  "radius.full": 'var(--dizi-radius-full)',
  "elevation.none": 'var(--dizi-elevation-none)',
  "elevation.sm": 'var(--dizi-elevation-sm)',
  "elevation.md": 'var(--dizi-elevation-md)',
  "elevation.lg": 'var(--dizi-elevation-lg)',
  "motion.duration.fast": 'var(--dizi-motion-duration-fast)',
  "motion.duration.base": 'var(--dizi-motion-duration-base)',
  "motion.duration.slow": 'var(--dizi-motion-duration-slow)',
  "motion.easing.standard": 'var(--dizi-motion-easing-standard)',
  "motion.easing.entrance": 'var(--dizi-motion-easing-entrance)',
  "motion.easing.exit": 'var(--dizi-motion-easing-exit)',
  "motion.reduced": 'var(--dizi-motion-reduced)',
  "density.comfortable.rowHeight": 'var(--dizi-density-comfortable-row-height)',
  "density.comfortable.fieldHeight": 'var(--dizi-density-comfortable-field-height)',
  "density.comfortable.cellPaddingX": 'var(--dizi-density-comfortable-cell-padding-x)',
  "density.compact.rowHeight": 'var(--dizi-density-compact-row-height)',
  "density.compact.fieldHeight": 'var(--dizi-density-compact-field-height)',
  "density.compact.cellPaddingX": 'var(--dizi-density-compact-cell-padding-x)',
  "breakpoint.sm": 'var(--dizi-breakpoint-sm)',
  "breakpoint.md": 'var(--dizi-breakpoint-md)',
  "breakpoint.lg": 'var(--dizi-breakpoint-lg)',
  "breakpoint.xl": 'var(--dizi-breakpoint-xl)',
  "breakpoint.2xl": 'var(--dizi-breakpoint-2xl)',
  "target.touch": 'var(--dizi-target-touch)',
  "target.pointer": 'var(--dizi-target-pointer)',
  "target.focusRingWidth": 'var(--dizi-target-focus-ring-width)',
  "target.focusRingOffset": 'var(--dizi-target-focus-ring-offset)',
  "print.a4": 'var(--dizi-print-a4)',
  "print.a5": 'var(--dizi-print-a5)',
  "print.thermal80": 'var(--dizi-print-thermal80)',
  "print.label": 'var(--dizi-print-label)',
  "print.margin": 'var(--dizi-print-margin)',
  "zIndex.base": 'var(--dizi-z-index-base)',
  "zIndex.sticky": 'var(--dizi-z-index-sticky)',
  "zIndex.drawer": 'var(--dizi-z-index-drawer)',
  "zIndex.dropdown": 'var(--dizi-z-index-dropdown)',
  "zIndex.modal": 'var(--dizi-z-index-modal)',
  "zIndex.toast": 'var(--dizi-z-index-toast)',
  "zIndex.palette": 'var(--dizi-z-index-palette)',
  "sync.live": 'var(--dizi-sync-live)',
  "sync.lanOnly": 'var(--dizi-sync-lan-only)',
  "sync.queued": 'var(--dizi-sync-queued)',
  "sync.syncing": 'var(--dizi-sync-syncing)',
  "sync.conflict": 'var(--dizi-sync-conflict)',
  "sync.stale": 'var(--dizi-sync-stale)',
  "sync.freshnessThresholdMinutes": 'var(--dizi-sync-freshness-threshold-minutes)',
} as const)[path];
