import type { ThemeConfig } from 'antd';

// СУ-10 brand tokens (from su10.ru live stylesheet).
export const SU = {
  primary: '#A05850',
  primaryDark: '#9C5148',
  primaryActive: '#9B5148',
  ink: '#000000',
  inkSoft: '#1E1D1D',
  muted: '#8B8996',
  surface: '#FFFFFF',
  surfaceAlt: '#F9F9FA',
  hairline: '#E4E5E9',
  error: '#FF0000',
  radius: 10,
} as const;

export const su10Theme: ThemeConfig = {
  token: {
    colorPrimary: SU.primary,
    colorInfo: SU.primary,
    colorLink: SU.primaryDark,
    colorLinkHover: SU.primary,
    colorText: SU.inkSoft,
    colorTextSecondary: SU.muted,
    colorBorder: SU.hairline,
    colorBorderSecondary: SU.hairline,
    colorBgLayout: SU.surfaceAlt,
    colorBgContainer: SU.surface,
    colorError: SU.error,
    borderRadius: SU.radius,
    borderRadiusLG: SU.radius,
    borderRadiusSM: 6,
    fontFamily:
      "'Inter', 'PT Root UI', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: 14,
    controlHeight: 40,
  },
  components: {
    Layout: {
      headerBg: SU.surface,
      headerColor: SU.ink,
      footerBg: SU.ink,
      bodyBg: SU.surfaceAlt,
      headerHeight: 68,
    },
    Button: {
      colorPrimaryHover: SU.primaryDark,
      colorPrimaryActive: SU.primaryActive,
      primaryColor: '#FFFFFF',
      fontWeight: 500,
      borderRadius: SU.radius,
    },
    Card: { borderRadiusLG: SU.radius, colorBorderSecondary: SU.hairline },
    Table: { headerBg: SU.surfaceAlt, borderColor: SU.hairline, rowHoverBg: SU.surfaceAlt },
    Menu: { itemSelectedColor: SU.primaryDark, horizontalItemSelectedColor: SU.primaryDark },
    Statistic: { colorTextDescription: SU.muted },
    Tag: { borderRadiusSM: 6 },
    Steps: { colorPrimary: SU.primary },
  },
};
