import { AppProps } from "next/app";
import Head from "next/head";
import Script from "next/script";
import {
  MantineProvider,
  ColorScheme,
  MantineThemeOverride,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { t } from "@lingui/macro";

// Styles specific to noUI slider
import "nouislider/dist/nouislider.css";
import "../css/slider.css";

import languages from "../src/languages/index.json";

i18n.load("en", {});
i18n.activate("en");

export default function App(props: AppProps & { colorScheme: ColorScheme }) {
  const { Component, pageProps } = props;

  return (
    <>
      <Head>
        <title>DeFi Strategy</title>
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width"
        />
        <meta
          name="description"
          content={t`DeFi Strategy — Simulate. Optimize. Grow. An Aave debt simulator and liquidation calculator.`}
        />
        <Script
          strategy="afterInteractive"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "42f927fda7404332a3720866ad63795f"}'
        />
        <link rel="shortcut icon" href="/favicon.ico" />
        {languages.map((language) => {
          return (
            <link
              key={language.code}
              rel="alternate"
              hrefLang={language.code}
              href={`https://defisim.xyz/${language.code}`}
            />
          );
        })}
      </Head>
      <I18nProvider i18n={i18n}>
        <MantineProvider theme={theme} withGlobalStyles withNormalizeCSS>
          <Component {...pageProps} />
          <Notifications />
        </MantineProvider>
      </I18nProvider>
    </>
  );
}

const theme: MantineThemeOverride = {
  colorScheme: "dark",
  primaryColor: "blue",
  colors: {
    blue: [
      "#e0f7ff",
      "#b3ecff",
      "#80dfff",
      "#4dd2ff",
      "#26c9ff",
      "#00C4FF",
      "#00a8d9",
      "#0088b3",
      "#00688c",
      "#004966",
    ],
    violet: [
      "#f0e6ff",
      "#d9b8ff",
      "#c28aff",
      "#ab5cff",
      "#9940f5",
      "#8B3FE8",
      "#7232cc",
      "#5a25b0",
      "#421994",
      "#2c0d78",
    ],
  },
  breakpoints: {
    xs: "0",
    sm: "576",
    md: "768",
    lg: "992",
    xl: "1200",
  },
  components: {
    Header: {
      styles: {
        root: {
          background: "linear-gradient(135deg, #0d1117 0%, #12172a 100%)",
          borderBottom: "1px solid rgba(0, 196, 255, 0.15)",
        },
      },
    },
    Divider: {
      styles: {
        label: {
          color: "#00C4FF",
        },
      },
    },
    Badge: {
      styles: (theme: any, params: any) => ({
        root: params.color === "green"
          ? { background: "linear-gradient(90deg, #00C4FF, #8B3FE8)", border: "none" }
          : {},
      }),
    },
    Mark: {
      styles: (theme: any, params: any) => ({
        root: params.color === "green"
          ? { background: "rgba(0, 196, 255, 0.25)", color: "#00C4FF" }
          : params.color === "yellow"
          ? { background: "rgba(255, 196, 0, 0.2)", color: "#FFC400" }
          : params.color === "red"
          ? { background: "rgba(255, 60, 60, 0.2)", color: "#FF5555" }
          : {},
      }),
    },
    Progress: {
      styles: {
        bar: {
          backgroundImage: "linear-gradient(90deg, #00C4FF, #8B3FE8)",
        },
      },
    },
  },
};
