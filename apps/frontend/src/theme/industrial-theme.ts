// ═══════════════════════════════════════════════════════════
//  Ant Design Theme — ISA-101 Industrial (Light + Dark)
//
//  Follows ISA-101.01-2015 guidelines:
//  - Neutral backgrounds (grey #F5F5F5 light / #141414 dark)
//  - Color reserved for anomalies / state indication
//  - High contrast text
//  - Sans-serif font (Inter) for readability
//
//  Usage: <ConfigProvider theme={getIndustrialTheme('light')}>
// ═══════════════════════════════════════════════════════════

import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeMode } from '@/stores/useUIStore';
import { PRIMARY } from './production-colors';

const sharedTokens = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  borderRadius: 6,
  borderRadiusLG: 8,
  borderRadiusSM: 4,
  padding: 16,
  paddingLG: 24,
  paddingSM: 12,
  paddingXS: 8,
  motionDurationMid: '0.2s',
  motionDurationSlow: '0.3s',
};

const sharedComponents = {
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
    itemColor: undefined as string | undefined, // set per mode
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
    railBg: undefined as string | undefined,
    railHoverBg: undefined as string | undefined,
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
};

export function getIndustrialTheme(mode: ThemeMode): ThemeConfig {
  if (mode === 'dark') {
    return {
      algorithm: theme.darkAlgorithm,
      token: {
        ...sharedTokens,
        colorPrimary: '#3B82F6',
        colorBgBase: '#141414',
        colorBgContainer: '#141414',
        colorBgElevated: '#1a1a1a',
        colorBgLayout: '#0d0d0d',
        colorText: '#E5E7EB',
        colorTextSecondary: '#9CA3AF',
        colorTextTertiary: '#6B7280',
        colorBorder: '#1f1f1f',
        colorBorderSecondary: '#1f1f1f',
      },
      components: {
        ...sharedComponents,
        Table: {
          headerBg: '#1a1a1a',
          headerColor: '#9CA3AF',
          cellPaddingBlock: 10,
          cellPaddingInline: 12,
          rowHoverBg: 'rgba(59, 130, 246, 0.06)',
          borderColor: '#1f1f1f',
        },
        Tabs: {
          ...sharedComponents.Tabs,
          itemColor: '#9CA3AF',
        },
        Slider: {
          ...sharedComponents.Slider,
          railBg: '#1f1f1f',
          railHoverBg: '#1f1f1f',
        },
      },
    };
  }

  // Light mode (default)
  return {
    algorithm: theme.defaultAlgorithm,
    token: {
      ...sharedTokens,
      colorPrimary: PRIMARY.base,
      colorBgBase: '#FFFFFF',
      colorBgContainer: '#FFFFFF',
      colorBgElevated: '#FFFFFF',
      colorBgLayout: '#F5F5F5',
      colorText: '#111827',
      colorTextSecondary: '#4B5563',
      colorTextTertiary: '#9CA3AF',
      colorBorder: '#E5E7EB',
      colorBorderSecondary: '#F1F5F9',
    },
    components: {
      ...sharedComponents,
      Table: {
        headerBg: '#F1F5F9',
        headerColor: '#4B5563',
        cellPaddingBlock: 10,
        cellPaddingInline: 12,
        rowHoverBg: 'rgba(30, 64, 175, 0.04)',
        borderColor: '#E5E7EB',
      },
      Tabs: {
        ...sharedComponents.Tabs,
        itemColor: '#4B5563',
      },
      Slider: {
        ...sharedComponents.Slider,
        railBg: '#E5E7EB',
        railHoverBg: '#E5E7EB',
      },
    },
  };
}

/** @deprecated Use getIndustrialTheme('light') instead */
export const industrialTheme = getIndustrialTheme('light');
