// ═══════════════════════════════════════════════════════════
//  Ant Design Theme — ISA-101 Industrial
//
//  Follows ISA-101.01-2015 guidelines:
//  - Neutral backgrounds (grey #F0F0F0)
//  - Color reserved for anomalies / state indication
//  - High contrast text (#000 on light)
//  - Sans-serif font (Inter) for readability
//
//  Usage: <ConfigProvider theme={industrialTheme}>
// ═══════════════════════════════════════════════════════════

import type { ThemeConfig } from 'antd';
import { PRIMARY, SURFACE, TEXT } from './production-colors';

export const industrialTheme: ThemeConfig = {
  token: {
    // ── Colors ──
    colorPrimary: PRIMARY.base,
    colorBgBase: SURFACE.background,
    colorBgContainer: SURFACE.card,
    colorBgElevated: SURFACE.raised,
    colorBgLayout: SURFACE.background,
    colorText: TEXT.primary,
    colorTextSecondary: TEXT.secondary,
    colorTextTertiary: TEXT.muted,
    colorBorder: SURFACE.border,
    colorBorderSecondary: SURFACE.borderSubtle,

    // ── Typography ──
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,

    // ── Shape ──
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    // ── Spacing ──
    padding: 16,
    paddingLG: 24,
    paddingSM: 12,
    paddingXS: 8,

    // ── Motion ──
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Table: {
      headerBg: SURFACE.header,
      headerColor: TEXT.secondary,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      rowHoverBg: 'rgba(37, 99, 235, 0.04)',
      borderColor: SURFACE.border,
    },
    Card: {
      headerBg: 'transparent',
      paddingLG: 20,
    },
    Button: {
      primaryColor: '#FFFFFF',
      fontWeight: 500,
    },
    Tag: {
      fontSizeSM: 11,
    },
    Badge: {
      fontSize: 11,
    },
    Tabs: {
      itemColor: TEXT.secondary,
      itemActiveColor: PRIMARY.base,
      itemSelectedColor: PRIMARY.base,
      inkBarColor: PRIMARY.base,
    },
    Switch: {
      colorPrimary: PRIMARY.base,
      colorPrimaryHover: PRIMARY.hover,
    },
    Slider: {
      trackBg: PRIMARY.light,
      trackHoverBg: PRIMARY.light,
      handleColor: PRIMARY.base,
      handleActiveColor: PRIMARY.hover,
      railBg: SURFACE.border,
      railHoverBg: SURFACE.border,
    },
    Select: {
      optionSelectedBg: PRIMARY.light,
    },
    Input: {
      activeBorderColor: PRIMARY.base,
      hoverBorderColor: PRIMARY.hover,
    },
    Tooltip: {
      colorBgSpotlight: '#1E293B',
      colorTextLightSolid: '#FFFFFF',
    },
  },
};
