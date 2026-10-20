// Ejected from @docusaurus/theme-mermaid so each color mode gets its own
// themeVariables. The stock component shares one options object across modes.
import React, {useEffect, useMemo, useRef} from 'react';
import ErrorBoundary from '@docusaurus/ErrorBoundary';
import {
  ErrorBoundaryErrorMessageFallback,
  useColorMode,
} from '@docusaurus/theme-common';
import {
  MermaidContainerClassName,
  useMermaidConfig,
  useMermaidRenderResult,
} from '@docusaurus/theme-mermaid/client';
import styles from './styles.module.css';

const fontFamily = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Site blues, same as src/components/Diagrams, so both diagram kinds match.
const palettes = {
  light: {
    darkMode: false,
    fontFamily,
    background: '#ffffff',
    primaryColor: '#e6effe',
    primaryTextColor: '#100f2f',
    primaryBorderColor: '#2d70f0',
    secondaryColor: '#f4f8ff',
    tertiaryColor: '#f4f8ff',
    mainBkg: '#e6effe',
    nodeBorder: '#2d70f0',
    textColor: '#100f2f',
    titleColor: '#100f2f',
    lineColor: '#1459db',
    clusterBkg: '#f4f8ff',
    clusterBorder: '#97c7fb',
    edgeLabelBackground: '#ffffff',
    noteBkgColor: '#f4f8ff',
    noteBorderColor: '#97c7fb',
    noteTextColor: '#100f2f',
    actorBkg: '#e6effe',
    actorBorder: '#2d70f0',
    actorTextColor: '#100f2f',
    actorLineColor: '#97c7fb',
    signalColor: '#1459db',
    signalTextColor: '#100f2f',
    labelBoxBkgColor: '#f4f8ff',
    labelBoxBorderColor: '#97c7fb',
    labelTextColor: '#100f2f',
    loopTextColor: '#100f2f',
  },
  dark: {
    darkMode: true,
    fontFamily,
    background: '#1b1b1d',
    primaryColor: '#1b2470',
    primaryTextColor: '#f4f8ff',
    primaryBorderColor: '#4e97f9',
    secondaryColor: '#131848',
    tertiaryColor: '#131848',
    mainBkg: '#1b2470',
    nodeBorder: '#4e97f9',
    textColor: '#f4f8ff',
    titleColor: '#f4f8ff',
    lineColor: '#78b4fb',
    clusterBkg: '#131848',
    clusterBorder: '#2b3c94',
    edgeLabelBackground: '#1b1b1d',
    noteBkgColor: '#131848',
    noteBorderColor: '#2b3c94',
    noteTextColor: '#f4f8ff',
    actorBkg: '#1b2470',
    actorBorder: '#4e97f9',
    actorTextColor: '#f4f8ff',
    actorLineColor: '#2b3c94',
    signalColor: '#78b4fb',
    signalTextColor: '#f4f8ff',
    labelBoxBkgColor: '#131848',
    labelBoxBorderColor: '#2b3c94',
    labelTextColor: '#f4f8ff',
    loopTextColor: '#f4f8ff',
  },
};

// Rounded corners for plain nodes and subgraphs.
const themeCSS = `
  .node rect, .node .label-container { rx: 8px; ry: 8px; }
  .cluster rect { rx: 12px; ry: 12px; }
  .cluster-label .nodeLabel { font-weight: 700; }
`;

function useCamusMermaidConfig() {
  const {colorMode} = useColorMode();
  const config = useMermaidConfig();
  return useMemo(
    () => ({
      ...config,
      themeVariables: {...palettes[colorMode], ...config.themeVariables},
      themeCSS: `${themeCSS}${config.themeCSS ?? ''}`,
    }),
    [colorMode, config],
  );
}

function MermaidRenderResult({renderResult}) {
  const ref = useRef(null);
  useEffect(() => {
    const div = ref.current;
    renderResult.bindFunctions?.(div);
  }, [renderResult]);
  return (
    <div
      ref={ref}
      className={`${MermaidContainerClassName} ${styles.container}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{__html: renderResult.svg}}
    />
  );
}

function MermaidRenderer({value}) {
  const config = useCamusMermaidConfig();
  const renderResult = useMermaidRenderResult({text: value, config});
  if (renderResult === null) {
    return null;
  }
  return <MermaidRenderResult renderResult={renderResult} />;
}

export default function Mermaid(props) {
  return (
    <ErrorBoundary
      fallback={(params) => <ErrorBoundaryErrorMessageFallback {...params} />}>
      <MermaidRenderer {...props} />
    </ErrorBoundary>
  );
}
